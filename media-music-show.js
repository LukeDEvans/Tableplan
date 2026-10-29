// media-music-show.js — music shows in Listen (AMPLIFIER_DESIGN.md). Pure.
//
// A music show is a saved article carrying a `musicShow` record (written by
// netlify/functions/_music-show.js from a playlist newsletter such as NYT's The
// Amplifier): an intro, then songs, each with a write-up and an Apple Music
// catalog id. Shows are listed under the Listen bell, never in the queue, and
// play as: intro → song 1's write-up → song 1 → song 2's write-up → song 2 → …
//
// This module decides which shows are waiting, turns a show into the ordered
// segments the iPhone's native player runs (LiveTtsPlugin: "speech" items and
// "appleMusic" items), and matches a song to an Apple Music search result when
// the newsletter's link couldn't be resolved.

export function isMusicShow(article) {
  const s = article && article.musicShow;
  return !!(s && typeof s === "object" && Array.isArray(s.songs) && s.songs.length);
}

// Shows still waiting under the bell: not finished or dismissed (both mark the
// article read), newest first.
export function pendingMusicShows(savedArticles, readIds) {
  const read = new Set(Array.isArray(readIds) ? readIds : []);
  return (Array.isArray(savedArticles) ? savedArticles : [])
    .filter((a) => isMusicShow(a) && !read.has(a.id))
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
}

// What the voice says before a song's write-up.
export function songSpokenIntro(song) {
  const title = String(song.title || "").trim();
  const artist = String(song.artist || "").trim();
  return `Number ${song.n}: ${title}${artist ? `, by ${artist}` : ""}.`;
}

export function showSubtitle(show) {
  const n = (show && show.songs && show.songs.length) || 0;
  const parts = [];
  if (show && show.author) parts.push(show.author);
  parts.push(show && show.durationText ? show.durationText : `${n} song${n === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// The show as an ordered list of native player items. `ids` (song number → an
// Apple Music id) fills in songs the server couldn't resolve; a song with no id
// at all is left out (its write-up is still read). Each item:
//   { id, kind: "speech", text, title, subtitle, n? }
//   { id, kind: "appleMusic", songId, title, subtitle, n }
export function buildShowSegments(article, { ids = {} } = {}) {
  if (!isMusicShow(article)) return [];
  const show = article.musicShow;
  const base = String(article.id);
  const showTitle = show.title || article.title || "Music show";
  const out = [];
  const introText = [showTitle + ".", show.author ? `By ${show.author}.` : "", show.intro || ""].filter(Boolean).join("\n\n").trim();
  if (introText) out.push({ id: `${base}#intro`, kind: "speech", text: introText, title: showTitle, subtitle: "Introduction" });
  for (const song of show.songs) {
    if (!song || !Number.isFinite(Number(song.n))) continue;
    const label = `${song.n}. ${song.title}`;
    const talk = [songSpokenIntro(song), song.text || ""].filter(Boolean).join("\n\n");
    out.push({ id: `${base}#${song.n}`, kind: "speech", text: talk, title: label, subtitle: song.artist || showTitle, n: song.n });
    const songId = song.appleMusicId || ids[song.n] || null;
    if (songId) out.push({ id: `${base}#${song.n}:song`, kind: "appleMusic", songId: String(songId), title: song.title || label, subtitle: song.artist || "", n: song.n });
  }
  return out;
}

// Songs that need a catalog search before playing.
export function songsMissingIds(article) {
  if (!isMusicShow(article)) return [];
  return article.musicShow.songs.filter((s) => s && !s.appleMusicId);
}

// The segment list position of a segment id (−1 when unknown).
export function segmentIndex(segments, id) {
  return (segments || []).findIndex((s) => s.id === id);
}

// ── Matching a song to Apple Music search results ────────────────────────────

export function normalizeForMatch(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s*[([].*?[)\]]\s*/g, " ")   // (Live), [Remastered]
    .replace(/\s+-\s+.*$/, "")               // "Song - 2004 Remaster"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looseEqual(a, b) {
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

// songsData: the Apple Music API's results.songs.data (catalog songs). Returns
// the best match's id, or null. The title must match; a matching artist wins, and
// a wanted "(Live)" prefers a live recording.
export function pickCatalogSong(songsData, song) {
  const wantTitle = normalizeForMatch(song && song.title);
  const wantArtist = normalizeForMatch(song && song.artist);
  const wantLive = /\blive\b/i.test(String(song && song.title));
  let best = null;
  let bestScore = 0;
  for (const r of Array.isArray(songsData) ? songsData : []) {
    const a = (r && r.attributes) || {};
    if (!r || !r.id) continue;
    const title = normalizeForMatch(a.name);
    if (!looseEqual(title, wantTitle)) continue;
    let score = title === wantTitle ? 3 : 2;
    const artist = normalizeForMatch(a.artistName);
    if (wantArtist && looseEqual(artist, wantArtist)) score += 4;
    else if (wantArtist && wantArtist.split(" ").some((w) => w.length > 3 && artist.includes(w))) score += 2;
    if (wantLive && /\blive\b/i.test(String(a.name))) score += 1;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  // Title alone (score ≤ 3) is too weak a match: a cover would play.
  return best && bestScore >= 5 ? String(best.id) : null;
}

export function catalogSearchPath(storefront, song) {
  const sf = /^[a-z]{2}$/i.test(String(storefront || "")) ? String(storefront).toLowerCase() : "us";
  const term = `${song.artist || ""} ${song.title || ""}`.replace(/\s+/g, " ").trim();
  return `/v1/catalog/${sf}/search?term=${encodeURIComponent(term)}&types=songs&limit=8`;
}
