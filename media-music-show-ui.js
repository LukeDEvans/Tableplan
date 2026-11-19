// media-music-show-ui.js — music shows under the Listen bell (AMPLIFIER_DESIGN.md).
//
// The bell lists shows waiting to be heard (saved articles carrying a
// `musicShow`, written by the inbox sweep from NYT's The Amplifier). Play hands
// the whole show to the iPhone's native player (LiveTtsPlugin) in one go — the
// intro and each song's write-up as speech, each song as an Apple Music item —
// and the player runs it by itself, so it keeps going with the phone locked.
// This module only follows along: which part is playing (for the mini-player),
// where to resume, and marking the show finished.
//
// Outside the iPhone app there is no native player: Play opens the show as an
// article to read (each song links to Apple Music).
//
// Notifications-window rules (CLAUDE.md): an empty bell shows a toast instead of
// opening; the window closes itself when its last show is addressed.

import { pendingMusicShows, buildShowSegments, songsMissingIds, pickCatalogSong, catalogSearchPath, showSubtitle, segmentIndex } from "./media-music-show.js";

const POS_KEY = "live-music-show-pos-v1"; // device-only: { [articleId]: segmentId }
const IMPORT_KEY = "live-music-show-import-v1"; // set once the recent issues were fetched on this device

export function createMusicShowsModule(deps) {
  const {
    getState, persist, markArticleRead, openArticle, escapeHtml, showToast,
    nativeTts, nativeAppleMusic, nativeVoiceId, voiceSpeed, playbackRate,
    stopOtherPlayback, setMiniPlayer, onPlaybackChange, setPageNotifCount, showListen,
    callGmailApi,
  } = deps;

  let session = null; // { id, article, segments, idx, playing, subs, ended }
  let panel = null;

  // ── Device-only resume position ───────────────────────────────────────────
  function readPositions() {
    try { const v = JSON.parse(localStorage.getItem(POS_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
  }
  function writePosition(articleId, segmentId) {
    try {
      const all = readPositions();
      if (segmentId) all[articleId] = segmentId; else delete all[articleId];
      // Only shows still waiting keep a position.
      const keep = new Set(pending().map((a) => a.id));
      for (const k of Object.keys(all)) if (!keep.has(k)) delete all[k];
      localStorage.setItem(POS_KEY, JSON.stringify(all));
    } catch { /* storage unavailable: start from the top next time */ }
  }

  function pending() {
    const st = getState();
    return pendingMusicShows(st.savedArticles, st.readArticleIds);
  }

  // ── The bell ──────────────────────────────────────────────────────────────
  // The bell's count, and the Listen mark in the menus and on the mini-player.
  function updateBadge() {
    const n = pending().length;
    const badge = document.getElementById("mediaNotifBadge");
    if (badge) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.hidden = n === 0;
    }
    setPageNotifCount("media", n);
  }

  function rowHtml(a) {
    const s = a.musicShow;
    const resume = readPositions()[a.id];
    const playingThis = session && session.id === a.id;
    const label = playingThis ? (session.playing ? "Playing" : "Resume") : resume ? "Resume" : "Play";
    return `<div class="music-show-row" data-show-id="${escapeHtml(a.id)}">` +
      (s.image ? `<img class="music-show-art" src="${escapeHtml(s.image)}" alt="" loading="lazy">` : `<div class="music-show-art music-show-art--blank" aria-hidden="true"></div>`) +
      `<div class="music-show-body"><div class="music-show-kicker">${escapeHtml(a.author || "Music show")}</div>` +
      `<div class="music-show-title">${escapeHtml(s.title || a.title || "Music show")}</div>` +
      `<div class="music-show-sub">${escapeHtml(showSubtitle(s))}</div>` +
      `<div class="music-show-actions"><button class="primary-btn compact-btn" type="button" data-show-play${playingThis && session.playing ? " disabled" : ""}>${label}</button>` +
      `<button class="secondary-btn compact-btn" type="button" data-show-read>Read</button>` +
      `<button class="icon-btn music-show-dismiss" type="button" data-show-dismiss aria-label="Dismiss" title="Dismiss"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>` +
      `</div></div>`;
  }

  function closePanel() {
    if (!panel) return;
    const d = panel;
    panel = null;
    try { d.close(); } catch { /* not open */ }
    d.remove();
  }

  function renderPanel() {
    if (!panel) return;
    const list = pending();
    if (!list.length) { closePanel(); return; } // last one addressed → close
    panel.querySelector(".music-show-list").innerHTML = list.map(rowHtml).join("");
  }

  function openPanel() {
    const list = pending();
    if (!list.length) { showToast("You're all caught up."); return; }
    closePanel();
    const d = document.createElement("dialog");
    d.className = "recipe-dialog auth-dialog ingest-dialog music-show-dialog";
    d.innerHTML =
      `<div class="recipe-form"><div class="ingest-head"><h3 style="margin:0">Listen</h3>` +
      `<button class="icon-btn" type="button" data-show-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>` +
      `<div class="music-show-list"></div></div>`;
    document.body.appendChild(d);
    panel = d;
    renderPanel();
    d.showModal();
    d.addEventListener("close", () => { if (panel === d) panel = null; d.remove(); });
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-show-close]")) { closePanel(); return; }
      const row = e.target.closest("[data-show-id]");
      if (!row) return;
      const id = row.dataset.showId;
      if (e.target.closest("[data-show-play]")) { closePanel(); play(id); }
      else if (e.target.closest("[data-show-read]")) { closePanel(); openArticle(id); }
      else if (e.target.closest("[data-show-dismiss]")) { dismiss(id); renderPanel(); }
    });
  }

  function dismiss(id) {
    if (session && session.id === id) stop();
    writePosition(id, null);
    markArticleRead(id); // finished or dismissed: off the bell for good, kept in history
    updateBadge();
  }

  // ── First run: the issues already in the mailbox ──────────────────────────
  // New issues arrive through the inbox sweep. The ones that came before this
  // feature (already turned into plain articles) are fetched once per device:
  // the server saves them and returns the records, which are merged in here so
  // the bell shows them now rather than after the next sync.
  let importTried = false; // a failed try waits for the next app start, not the next visit
  async function importRecentOnce() {
    if (importTried) return;
    try { if (localStorage.getItem(IMPORT_KEY)) return; } catch { return; }
    importTried = true;
    try {
      const res = await callGmailApi({ action: "importMusicShows" });
      if (!res || res.error) return; // Gmail not connected or offline: try again another time
      const st = getState();
      if (!Array.isArray(st.savedArticles)) st.savedArticles = [];
      const have = new Set(st.savedArticles.map((a) => a && a.id));
      const read = new Set(Array.isArray(st.readArticleIds) ? st.readArticleIds : []);
      let added = 0;
      for (const a of Array.isArray(res.articles) ? res.articles : []) {
        if (!a || !a.id || !a.musicShow || have.has(a.id) || read.has(a.id)) continue;
        st.savedArticles.push(a);
        added++;
      }
      if (added) persist();
      try { localStorage.setItem(IMPORT_KEY, "1"); } catch { /* try again next time */ }
      updateBadge();
    } catch { /* try again at the next app start */ }
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  const toPluginItem = (seg) => (seg.kind === "appleMusic"
    ? { id: seg.id, kind: "appleMusic", songId: seg.songId, title: seg.title, subtitle: seg.subtitle }
    : { id: seg.id, kind: "speech", text: seg.text, title: seg.title, subtitle: seg.subtitle });

  // Apple Music sign-in, then a catalog search for any song the newsletter link
  // didn't resolve. Returns { ok, ids } — ok false means songs can't play.
  async function prepareSongs(article) {
    const am = nativeAppleMusic();
    if (!am) return { ok: false, ids: {} };
    let status = null;
    try { status = await am.getStatus(); } catch { /* plugin error */ }
    if (!status || !status.authorized) {
      try { status = await am.authorize(); } catch { status = null; }
    }
    if (!status || !status.authorized) return { ok: false, ids: {} };
    const ids = {};
    const missing = songsMissingIds(article);
    let changed = false;
    await Promise.all(missing.map(async (song) => {
      try {
        const { body } = await am.api({ path: catalogSearchPath(status.storefront, song) });
        const data = body ? JSON.parse(body) : null;
        const id = pickCatalogSong(data && data.results && data.results.songs && data.results.songs.data, song);
        if (id) { ids[song.n] = id; song.appleMusicId = id; changed = true; }
      } catch { /* left out: its write-up is still read */ }
    }));
    if (changed) persist(); // other devices skip the search next time
    return { ok: true, ids };
  }

  async function play(id) {
    const st = getState();
    const article = (st.savedArticles || []).find((a) => a.id === id);
    if (!article || !article.musicShow) return;
    const tts = nativeTts();
    if (!tts) {
      showToast("The songs play in the iPhone app — here it opens to read.");
      openArticle(id);
      return;
    }
    if (session && session.id === id) { toggle(); return; }

    const songs = await prepareSongs(article);
    if (!songs.ok) showToast("Sign in to Apple Music to hear the songs — the write-ups will still play.");
    let segments = buildShowSegments(article, { ids: songs.ids });
    if (!songs.ok) segments = segments.filter((s) => s.kind !== "appleMusic");
    if (!segments.length) return;

    stopOtherPlayback(); // podcasts, read-aloud, music, radio — never overlap
    stop({ keepPlugin: true });

    const resumeId = readPositions()[id];
    const start = Math.max(0, segmentIndex(segments, resumeId));
    const s = { id, article, segments, idx: start, playing: true, subs: [], ended: false };
    session = s;
    const live = () => session === s;

    try {
      s.subs.push(await tts.addListener("ttsItemStart", (e) => {
        if (!live() || !e) return;
        const k = segmentIndex(s.segments, e.id);
        if (k < 0) { stop({ keepPlugin: true }); return; } // something else took over the player
        s.idx = k;
        s.playing = true;
        writePosition(s.id, e.id);
        refresh();
      }));
      s.subs.push(await tts.addListener("ttsFinish", (e) => {
        if (!live() || !e || e.hasNext) return;
        if (segmentIndex(s.segments, e.id) !== s.segments.length - 1) { stop({ keepPlugin: true }); return; }
        finish();
      }));
      s.subs.push(await tts.addListener("ttsState", (e) => {
        if (!live()) return;
        s.playing = !!(e && e.playing);
        refresh();
      }));
      s.subs.push(await tts.addListener("ttsSongFailed", (e) => {
        if (!live() || !e) return;
        const seg = s.segments.find((x) => x.id === e.id);
        showToast(`Couldn't play “${seg ? seg.title : "this song"}” — moving on.`);
      }));
      if (!live()) return;
      const opts = { voiceId: nativeVoiceId(), rate: playbackRate(), speechSpeed: voiceSpeed() };
      await tts.play({ item: toPluginItem(segments[start]), ...opts });
      await tts.setUpcoming({ items: segments.slice(start + 1).map(toPluginItem) });
    } catch (e) {
      if (live()) { stop(); showToast("Couldn't start this show."); }
      return;
    }
    writePosition(id, segments[start].id);
    refresh();
  }

  function finish() {
    const s = session;
    if (!s || s.ended) return;
    s.ended = true;
    const title = (s.article.musicShow && s.article.musicShow.title) || s.article.title || "the show";
    stop({ keepPlugin: true }); // the plugin already stopped at the end of its queue
    writePosition(s.id, null);
    markArticleRead(s.id);
    updateBadge();
    showToast(`Finished “${title}”.`);
  }

  function stop({ keepPlugin = false } = {}) {
    const s = session;
    if (!s) return;
    session = null;
    (s.subs || []).forEach((h) => { try { h && h.remove && h.remove(); } catch { /* noop */ } });
    if (!keepPlugin) { const tts = nativeTts(); if (tts) { try { tts.stop(); } catch { /* noop */ } } }
    onPlaybackChange();
  }

  function toggle() {
    const s = session;
    const tts = nativeTts();
    if (!s || !tts) return;
    s.playing = !s.playing; // optimistic; ttsState confirms
    (s.playing ? tts.resume() : tts.pause()).catch(() => {});
    refresh();
  }

  // Forward → the next part (a write-up or a song); back → the part before
  // (from the first part: that part again, from its start).
  async function step(dir) {
    const s = session;
    const tts = nativeTts();
    if (!s || !tts) return;
    if (dir > 0) {
      if (s.idx >= s.segments.length - 1) { finish(); try { await tts.stop(); } catch { /* noop */ } return; }
      try { await tts.next(); } catch { /* noop */ }
      return;
    }
    const k = Math.max(0, s.idx - 1);
    try {
      await tts.play({ item: toPluginItem(s.segments[k]), voiceId: nativeVoiceId(), rate: playbackRate(), speechSpeed: voiceSpeed() });
      await tts.setUpcoming({ items: s.segments.slice(k + 1).map(toPluginItem) });
      s.idx = k;
      s.playing = true;
      writePosition(s.id, s.segments[k].id);
      refresh();
    } catch { /* noop */ }
  }

  function info() {
    const s = session;
    if (!s) return null;
    const seg = s.segments[s.idx] || {};
    const show = s.article.musicShow || {};
    const part = seg.kind === "appleMusic" ? `Playing ${seg.title}${seg.subtitle ? ` · ${seg.subtitle}` : ""}` : seg.title;
    return { art: show.image || "", title: part || show.title || "Music show", show: show.title || s.article.title || "", date: `${s.idx + 1} of ${s.segments.length}`, desc: "" };
  }

  function refresh() {
    const i = info();
    if (i) setMiniPlayer(i.title, i.show, i.art);
    onPlaybackChange();
    if (panel) renderPanel();
  }

  return {
    openPanel,
    updateBadge,
    importRecentOnce,
    play,
    stop,
    toggle,
    step,
    info,
    open: () => showListen(),
    active: () => !!session,
    isPlaying: () => !!(session && session.playing),
    pendingCount: () => pending().length,
  };
}
