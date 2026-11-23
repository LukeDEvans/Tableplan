// music-search-best.js — pure helpers for Listen's music search and artist pages
// (LISTEN_SEARCH_DESIGN.md). No DOM, no provider calls.
//
// - pickBestMusicResult: the one item the "Best result" card shows. A provider
//   that knows the answer marks it (`bestMatch: true`, Apple's "top results");
//   otherwise an artist whose name is the query wins, then the first song.
// - mergeArtistSongs: the artist page's "All songs" list grows a page at a time;
//   the same recording on a single and an album shows once.
// - pageParams: a provider "next" link → { path, params } for the next request.

const fold = (s) => String(s == null ? "" : s)
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

export function namesMatch(a, b) {
  const x = fold(a), y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "The Beatles" ↔ "Beatles"
  const noThe = (s) => s.replace(/^the /, "");
  return noThe(x) === noThe(y);
}

export function pickBestMusicResult(query, items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  const marked = list.find((i) => i.bestMatch);
  if (marked) return marked;
  const artist = list.find((i) => i.entity === "album" && i.kind === "artist" && namesMatch(i.title, query));
  if (artist) return artist;
  const album = list.find((i) => i.entity === "album" && (i.kind || "album") === "album" && namesMatch(i.title, query));
  if (album) return album;
  return list.find((i) => i.entity === "track") || list[0];
}

// Key for "the same song": ISRC when known, else title + first artist.
export function songKey(t) {
  if (!t) return "";
  if (t.isrc) return `isrc:${t.isrc}`;
  const artist = (t.artists && t.artists[0] && t.artists[0].name) || "";
  return `t:${fold(t.title)}|${fold(artist)}`;
}

// Append `incoming` to `existing`, skipping songs already listed (by songKey).
// Returns a new array; neither input is changed.
export function mergeArtistSongs(existing, incoming) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(out.map(songKey));
  for (const t of Array.isArray(incoming) ? incoming : []) {
    const k = songKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// "/v1/catalog/us/artists/1/albums?offset=25&limit=25" → { path, params }.
// Keeps the provider's own paging values; `extra` fills in what it left out.
export function pageParams(next, extra = {}) {
  if (!next || typeof next !== "string") return null;
  const [path, qs = ""] = next.split("?");
  if (!path.startsWith("/v1/")) return null;
  const params = { ...extra };
  for (const [k, v] of new URLSearchParams(qs)) params[k] = v;
  return { path, params };
}
