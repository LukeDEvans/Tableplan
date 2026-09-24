// Apple Music provider (MusicKit JS) — a PLAYBACK-OWNING MusicProvider.
//
// Unlike the URL providers (Internet Archive, Jamendo) that resolve a track to a
// streamable URL for the shared engine, Apple Music never hands out a raw URL
// (DRM): MusicKit owns its own player. So this adapter advertises
// CAP.OWNS_PLAYBACK + CAP.AUTH and implements the Transport contract documented
// in music-streaming.js, delegating to the MusicKit instance.
//
// EVERYTHING MusicKit-specific lives in this file: the SDK load, MusicKit.configure,
// the /v1/catalog + /v1/me API paths, event names, playbackState integers, error
// shapes. The rest of the app only ever sees CanonicalTrack/Album + the normalized
// NowPlaying/AuthStatus/SubscriptionStatus types. Swapping in Spotify later means a
// sibling file with the same surface — no caller changes.
//
// The MusicKit instance is injected via deps.getInstance() so this module is unit-
// testable against a fake and never touches window/global MusicKit in tests. The
// default loader (used in the browser) fetches a developer token from the Netlify
// apple-music-token function, loads the MusicKit v3 script, and configures it.

import {
  CAP, PLAYBACK_STATE, makeCanonicalTrack, makeCanonicalAlbum,
  makeNowPlaying, makeAuthStatus, makeSubscriptionStatus, makeProviderRef,
} from "./music-streaming.js";

const PROVIDER_ID = "applemusic";
const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const DEFAULT_TOKEN_ENDPOINT = "/.netlify/functions/apple-music-token";

const str = (v, d = "") => (v == null ? d : String(v));

// MusicKit artwork is a template ({w}/{h} placeholders); render a concrete URL.
function appleArtwork(art, size = 300) {
  if (!art || !art.url) return null;
  return str(art.url).replace("{w}", size).replace("{h}", size).replace("{f}", "jpg");
}

function msFromMinutes(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }

// ── Apple catalog schema → canonical (raw Apple shapes never leave this file) ──
// Library items ("i.…" songs) carry their catalog id in playParams; prefer it so
// the id is always one MusicKit's setQueue({songs}) can play.
function catalogIdOf(item) {
  const pp = (item.attributes && item.attributes.playParams) || {};
  return str(pp.catalogId || item.id);
}

function songToTrack(song) {
  const a = song.attributes || {};
  const id = catalogIdOf(song);
  // Apple tags classical recordings with work/movement/composer. Only use the
  // composer as the work's composer when the song IS tagged as part of a work —
  // for pop, composerName is songwriter credits and would mis-group results.
  const isWork = !!a.workName;
  return makeCanonicalTrack({
    id: `${PROVIDER_ID}:${id}`,
    title: a.name,
    artists: a.artistName ? [{ name: a.artistName, role: "artist" }] : [],
    composer: isWork && a.composerName ? a.composerName : null,
    work: isWork ? { title: a.workName } : null,
    movement: a.movementName || null,
    movementNo: a.movementNumber || null,
    album: a.albumName || null,
    trackNo: a.trackNumber || null,
    durationMs: msFromMinutes(a.durationInMillis),
    artworkUrl: appleArtwork(a.artwork),
    provider: PROVIDER_ID,
    providerRefs: [makeProviderRef({ provider: PROVIDER_ID, externalId: id, url: a.url })],
    // No `playable`: Apple Music owns playback; the id in providerRefs is what
    // setQueue/play consume.
  });
}

// Albums, playlists and artists all surface as a canonical "album" (a thing you
// open to get tracks); `kind` tells getItem which Apple endpoint expands it.
function albumToAlbum(album) {
  const a = album.attributes || {};
  return makeCanonicalAlbum({
    id: `${PROVIDER_ID}:${album.id}`,
    title: a.name,
    artist: a.artistName || null,
    year: a.releaseDate ? Number(String(a.releaseDate).slice(0, 4)) : null,
    artworkUrl: appleArtwork(a.artwork),
    trackCount: a.trackCount || null,
    kind: "album",
    provider: PROVIDER_ID,
    providerRefs: [makeProviderRef({ provider: PROVIDER_ID, externalId: album.id, url: a.url })],
  });
}

function playlistToAlbum(pl) {
  const a = pl.attributes || {};
  const desc = a.description && (a.description.short || a.description.standard);
  return makeCanonicalAlbum({
    id: `${PROVIDER_ID}:${pl.id}`,
    title: a.name,
    artist: a.curatorName || "Playlist",
    artworkUrl: appleArtwork(a.artwork),
    kind: "playlist",
    provider: PROVIDER_ID,
    providerRefs: [makeProviderRef({ provider: PROVIDER_ID, externalId: pl.id, url: a.url })],
    description: desc || null,
  });
}

function artistToAlbum(ar) {
  const a = ar.attributes || {};
  return makeCanonicalAlbum({
    id: `${PROVIDER_ID}:${ar.id}`,
    title: a.name,
    artist: (a.genreNames && a.genreNames[0]) || "Artist",
    artworkUrl: appleArtwork(a.artwork),
    kind: "artist",
    provider: PROVIDER_ID,
    providerRefs: [makeProviderRef({ provider: PROVIDER_ID, externalId: ar.id, url: a.url })],
  });
}

// Any Apple resource → canonical item, by its `type`. Stations / music videos /
// unknown types are dropped (null) — they can't be expanded into a song queue.
function resourceToItem(r) {
  if (!r || !r.type) return null;
  switch (r.type) {
    case "songs": case "library-songs": return songToTrack(r);
    case "albums": case "library-albums": return albumToAlbum(r);
    case "playlists": case "library-playlists": return playlistToAlbum(r);
    case "artists": return artistToAlbum(r);
    default: return null;
  }
}

// The Apple catalog id lives in the canonical track's providerRef.
function appleIdOf(track) {
  const ref = (track && track.providerRefs || []).find((r) => r.provider === PROVIDER_ID);
  if (ref && ref.externalId) return ref.externalId;
  // Tolerate a raw canonical id shaped "applemusic:<id>".
  const id = str(track && track.id);
  return id.startsWith(`${PROVIDER_ID}:`) ? id.slice(PROVIDER_ID.length + 1) : null;
}

// MusicKit playbackState integers → normalized PLAYBACK_STATE. (MusicKit.PlaybackStates:
// none 0, loading 1, playing 2, paused 3, stopped 4, ended 5, seeking 6, waiting 8,
// stalled 9, completed 10.)
function mapPlaybackState(n) {
  switch (n) {
    case 2: return PLAYBACK_STATE.PLAYING;
    case 3: return PLAYBACK_STATE.PAUSED;
    case 4: return PLAYBACK_STATE.STOPPED;
    case 5: case 10: return PLAYBACK_STATE.ENDED;
    case 1: case 6: case 8: case 9: return PLAYBACK_STATE.LOADING;
    default: return PLAYBACK_STATE.NONE;
  }
}

// The default browser loader: fetch a developer token, inject the MusicKit v3
// script, configure, and hand back the singleton instance. Isolated so tests
// inject their own getInstance and never load a script.
function makeDefaultLoader(config, deps) {
  const tokenEndpoint = config.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT;
  const fetchJson = deps.fetchJson || (async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) { const e = new Error(`token endpoint ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  });
  let instance = null;
  let loading = null;
  async function fetchToken() {
    const data = await fetchJson(tokenEndpoint);
    if (!data || !data.token) { const e = new Error("Apple Music not configured"); e.code = "not-configured"; throw e; }
    return data.token;
  }
  async function loadScript() {
    if (typeof document === "undefined") throw new Error("MusicKit requires a browser");
    if (globalThis.MusicKit) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = MUSICKIT_SRC; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error("Failed to load MusicKit"));
      document.head.appendChild(s);
    });
    // MusicKit signals readiness via a window event on some versions.
    if (!globalThis.MusicKit) await new Promise((r) => setTimeout(r, 0));
  }
  return async function getInstance() {
    if (instance) return instance;
    if (!loading) loading = (async () => {
      const token = await fetchToken(); // throws {code:"not-configured"} if no key yet
      await loadScript();
      const MK = globalThis.MusicKit;
      if (!MK) throw new Error("MusicKit unavailable");
      await MK.configure({
        developerToken: token,
        app: { name: config.appName || "TablePlan", build: config.appBuild || "1.0.0" },
      });
      instance = MK.getInstance();
      return instance;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  };
}

/**
 * @param config { storefront="us", tokenEndpoint, appName, appBuild }
 * @param deps   { getInstance?, fetchJson? } — inject getInstance() (returns a
 *               configured MusicKit instance) to make this testable; otherwise a
 *               default browser loader is used.
 */
export function createAppleMusicProvider(config = {}, deps = {}) {
  const configuredStorefront = config.storefront || null;
  const getInstance = deps.getInstance || makeDefaultLoader(config, deps);
  const listeners = new Set();

  // The catalog storefront: an explicit config wins; else the one MusicKit
  // reports for the signed-in user (so region-locked songs actually play); else us.
  const storefrontOf = (music) => configuredStorefront || (music && music.storefrontId) || "us";

  // Lazily obtain the instance; a "not-configured" error (no developer token yet)
  // is swallowed by isAvailable() and surfaced as a clear message elsewhere.
  async function instanceOrNull() {
    try { return await getInstance(); } catch { return null; }
  }

  // Wire the MusicKit instance's events to our normalized onChange listeners
  // exactly once. All MusicKit event-name knowledge is confined here.
  let wired = false;
  function wireEvents(music) {
    if (wired || !music || typeof music.addEventListener !== "function") return;
    wired = true;
    const fire = () => { const np = readNowPlaying(music); listeners.forEach((cb) => { try { cb(np); } catch { /* isolated */ } }); };
    music.addEventListener("playbackStateDidChange", fire);
    music.addEventListener("nowPlayingItemDidChange", fire);
    music.addEventListener("playbackTimeDidChange", fire);
  }

  function readNowPlaying(music) {
    if (!music) return makeNowPlaying({ state: PLAYBACK_STATE.NONE });
    const item = music.nowPlayingItem;
    const track = item ? songToTrack({ id: item.id, attributes: {
      name: item.title, artistName: item.artistName, albumName: item.albumName,
      durationInMillis: (music.currentPlaybackDuration || 0) * 1000, artwork: item.artwork,
    } }) : null;
    return makeNowPlaying({
      track,
      state: mapPlaybackState(music.playbackState),
      positionMs: Math.round((music.currentPlaybackTime || 0) * 1000),
      durationMs: Math.round((music.currentPlaybackDuration || 0) * 1000) || null,
    });
  }

  let current = null; // last instance used for playback (sync now-playing reads)
  async function ensureQueueAndPlay(track) {
    const music = await getInstance(); // throws if not configured — caller handles
    wireEvents(music);
    current = music;
    const id = appleIdOf(track);
    if (!id) throw new Error("Track has no Apple Music id");
    await music.setQueue({ songs: [id] });
    await music.play();
  }

  // Tracks of an expandable item. Library ids ("l." album, "p." playlist) live
  // under /v1/me/library; catalog ids under /v1/catalog/{storefront}.
  async function expand(music, kind, id) {
    const sf = storefrontOf(music);
    const songsOnly = (list) => (list || []).filter((r) => r && (!r.type || r.type === "songs" || r.type === "library-songs")).map(songToTrack);
    if (kind === "artist") {
      const [info, top] = await Promise.all([
        music.api.music(`/v1/catalog/${sf}/artists/${id}`).catch(() => null),
        music.api.music(`/v1/catalog/${sf}/artists/${id}/view/top-songs`, { limit: 20 }),
      ]);
      const ar = info && info.data && info.data.data && info.data.data[0];
      return { album: ar ? artistToAlbum(ar) : null, tracks: songsOnly(top && top.data && top.data.data) };
    }
    if (id.startsWith("l.") || id.startsWith("p.")) {
      const coll = id.startsWith("l.") ? "albums" : "playlists";
      const res = await music.api.music(`/v1/me/library/${coll}/${id}/tracks`, { limit: 100 });
      return { album: null, tracks: songsOnly(res && res.data && res.data.data) };
    }
    const coll = kind === "playlist" ? "playlists" : "albums";
    const res = await music.api.music(`/v1/catalog/${sf}/${coll}/${id}`, { include: "tracks" });
    const r = (res && res.data && res.data.data && res.data.data[0]) || null;
    const tracks = songsOnly(r && r.relationships && r.relationships.tracks && r.relationships.tracks.data);
    return { album: r ? (coll === "playlists" ? playlistToAlbum(r) : albumToAlbum(r)) : null, tracks };
  }

  return {
    id: PROVIDER_ID,
    label: config.label || "Apple Music",
    capabilities: new Set([CAP.SEARCH, CAP.GET_ITEM, CAP.ARTWORK, CAP.OWNS_PLAYBACK, CAP.AUTH, CAP.RECOMMEND]),

    // Cheap gate: available only once a developer token is configured (the key
    // has been added to the Netlify function's env). Inert otherwise — the
    // architecture never depends on it.
    async isAvailable() { return !!(await instanceOrNull()); },

    // ── Catalog ────────────────────────────────────────────────────────────
    // Songs first (the most direct answer), then albums, artists, playlists.
    async search(query, o = {}) {
      const music = await getInstance();
      const limit = Math.min(25, o.limit || 25);
      const res = await music.api.music(`/v1/catalog/${storefrontOf(music)}/search`, { term: query, types: "songs,albums,artists,playlists", limit });
      const results = (res && res.data && res.data.results) || {};
      const pick = (k, fn) => ((results[k] && results[k].data) || []).map(fn);
      return [
        ...pick("songs", songToTrack),
        ...pick("albums", albumToAlbum),
        ...pick("artists", artistToAlbum),
        ...pick("playlists", playlistToAlbum),
      ];
    },

    async getItem(albumOrRef, o = {}) {
      const music = await getInstance();
      const id = appleIdOf(albumOrRef) || str(albumOrRef && albumOrRef.externalId) || str(albumOrRef);
      const kind = (albumOrRef && albumOrRef.kind) || "album";
      const out = await expand(music, kind, id);
      // Keep the caller's header item when the endpoint didn't return one.
      return { album: out.album || (albumOrRef && albumOrRef.entity === "album" ? albumOrRef : null), tracks: out.tracks };
    },

    // A saved Apple ref never becomes a URL (DRM) — it resolves to an "owned"
    // source the app plays through the transport below. Lets saved favourites,
    // playlists and history play Apple recordings (music-source-resolver.js).
    async resolveRef(ref) {
      if (!ref || !ref.externalId) return null;
      return { provider: PROVIDER_ID, owned: true, externalId: str(ref.externalId), url: null };
    },

    // Discover home shelves: personal recommendations + recently played when
    // signed in, and the storefront's charts always. Each shelf is isolated — one
    // failing endpoint just drops that shelf. Returns [{ id, title, items[] }].
    async getHome(o = {}) {
      const music = await getInstance();
      const sf = storefrontOf(music);
      const cap = o.perShelf || 12;
      const shelves = [];
      const keep = (list) => (list || []).map(resourceToItem).filter(Boolean).slice(0, cap);
      const safeCall = (p) => p.then((r) => r, () => null);
      const authed = !!music.isAuthorized;
      const [recs, recent, charts] = await Promise.all([
        authed ? safeCall(music.api.music("/v1/me/recommendations", { limit: 6 })) : null,
        authed ? safeCall(music.api.music("/v1/me/recent/played", { limit: 10 })) : null,
        safeCall(music.api.music(`/v1/catalog/${sf}/charts`, { types: "songs,albums,playlists", limit: cap })),
      ]);
      if (recent) {
        const items = keep(recent.data && recent.data.data);
        if (items.length) shelves.push({ id: "recent", title: "Recently played", items });
      }
      for (const rec of ((recs && recs.data && recs.data.data) || [])) {
        const a = rec.attributes || {};
        const title = (a.title && a.title.stringForDisplay) || "For you";
        const items = keep(rec.relationships && rec.relationships.contents && rec.relationships.contents.data);
        if (items.length) shelves.push({ id: `rec:${rec.id}`, title: String(title), items });
      }
      const results = (charts && charts.data && charts.data.results) || {};
      for (const [k, label] of [["songs", "Top songs"], ["albums", "Top albums"], ["playlists", "Top playlists"]]) {
        const chart = (results[k] || [])[0];
        const items = keep(chart && chart.data);
        if (items.length) shelves.push({ id: `chart:${k}`, title: label, items });
      }
      return shelves;
    },

    // Settings diagnostic: can the developer token read the catalog? Tells "key
    // missing" / "key rejected by Apple" / "ok" apart (one tiny request).
    async checkCatalog() {
      let music;
      try { music = await getInstance(); } catch (e) { return { ok: false, state: e && e.code === "not-configured" ? "not-configured" : "load-failed", reason: String(e && e.message || e) }; }
      try {
        await music.api.music(`/v1/catalog/${storefrontOf(music)}/search`, { term: "bach", types: "songs", limit: 1 });
        return { ok: true, state: "ok", storefront: storefrontOf(music) };
      } catch (e) {
        return { ok: false, state: "rejected", reason: String(e && e.message || e) };
      }
    },

    // ── Transport (CAP.OWNS_PLAYBACK) ────────────────────────────────────────
    async play(track) { await ensureQueueAndPlay(track); },
    async pause() { const m = await instanceOrNull(); if (m) await m.pause(); },
    async resume() { const m = await instanceOrNull(); if (m) await m.play(); },
    async seek(positionMs) { const m = await instanceOrNull(); if (m) await m.seekToTime(Math.max(0, positionMs) / 1000); },
    async skipNext() { const m = await instanceOrNull(); if (m) await m.skipToNextItem(); },
    async skipPrevious() { const m = await instanceOrNull(); if (m) await m.skipToPreviousItem(); },
    getQueue() { return this._queueCache || []; },
    async setQueue(tracks) {
      const music = await getInstance();
      wireEvents(music);
      const ids = (tracks || []).map(appleIdOf).filter(Boolean);
      await music.setQueue({ songs: ids });
      this._queueCache = (tracks || []).map((t) => makeCanonicalTrack(t));
    },
    getNowPlaying() {
      // Sync read: return the last known instance's now-playing, else empty.
      return readNowPlaying(this._instance || current);
    },
    onChange(cb) {
      if (typeof cb !== "function") return () => {};
      listeners.add(cb);
      // Ensure events are wired as soon as an instance exists.
      instanceOrNull().then((m) => { if (m) { this._instance = m; wireEvents(m); } });
      return () => listeners.delete(cb);
    },

    // ── Auth / subscription (CAP.AUTH) ───────────────────────────────────────
    async getAuthStatus() {
      const m = await instanceOrNull();
      if (!m) return makeAuthStatus({ authorized: false, state: "not-configured", reason: "Apple Music isn't configured yet." });
      return makeAuthStatus({ authorized: !!m.isAuthorized, state: m.isAuthorized ? "authorized" : "unauthorized" });
    },
    async authorize() {
      const music = await getInstance(); // throws "not-configured" if no token
      wireEvents(music);
      this._instance = music;
      await music.authorize(); // opens Apple's auth flow, returns a music-user-token
      return makeAuthStatus({ authorized: !!music.isAuthorized, state: music.isAuthorized ? "authorized" : "unauthorized" });
    },
    async getSubscriptionStatus() {
      const m = await instanceOrNull();
      if (!m) return makeSubscriptionStatus({ active: false, canPlay: false, state: "not-configured" });
      if (!m.isAuthorized) return makeSubscriptionStatus({ active: false, canPlay: false, state: "unknown", reason: "Not signed in to Apple Music." });
      // An authorized user with an active subscription can read their own
      // storefront; a non-subscriber's music-user-token is rejected there. (Verify
      // against MusicKit at integration time — the honest, low-assumption probe.)
      try {
        await m.api.music("/v1/me/storefront");
        return makeSubscriptionStatus({ active: true, canPlay: true, state: "active" });
      } catch (e) {
        return makeSubscriptionStatus({ active: false, canPlay: false, state: "none", reason: "No active Apple Music subscription." });
      }
    },
  };
}
