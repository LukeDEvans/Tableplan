// Manual "Add to queue" entries for the Media queue (the blended All list).
//
// The queue is otherwise automatic: unplayed episodes inside the time window,
// unread saved articles, unfinished books. An entry here forces one more thing
// onto the END of it: an episode or article the automatic rules leave out, a
// music album (one row that plays all its tracks), or a single song.
//
// Pure data helpers only — no DOM, no app state. app.js owns storage
// (state.mediaQueueAdded, synced in the media section and union-merged by id
// with tombstones) and playback.
//
// Entry: { id, ref, kind, addedAt, ...payload }
//   id    random, never reused, so a removal's tombstone is exact and the same
//         thing can be added again later under a new id.
//   ref   what the entry points at ("episode:<id>", "album:lib:<artist>|<album>",
//         …). One entry per ref — adding twice is a no-op.
//   kind  "episode" | "article" | "album" | "track"

const KINDS = new Set(["episode", "article", "album", "track"]);

export function normalizeQueueAdded(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== "object" || !e.id || !e.ref || !KINDS.has(e.kind)) continue;
    if (seen.has(e.ref)) continue; // two devices added the same thing — keep the first
    seen.add(e.ref);
    out.push(e);
  }
  return out;
}

export const queueAddedFindRef = (list, ref) => normalizeQueueAdded(list).find((e) => e.ref === ref) || null;

function newEntryId(now) {
  const rand = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `qa_${now.toString(36)}_${rand}`;
}

// → { list, entry, added }. `added` is false (and `entry` the existing one)
// when that ref is already queued.
export function withQueueEntry(list, draft, { now = Date.now(), makeId = newEntryId } = {}) {
  const cur = normalizeQueueAdded(list);
  if (!draft || !draft.ref || !KINDS.has(draft.kind)) return { list: cur, entry: null, added: false };
  const existing = cur.find((e) => e.ref === draft.ref);
  if (existing) return { list: cur, entry: existing, added: false };
  const entry = { ...draft, id: makeId(now), addedAt: now };
  return { list: [...cur, entry], entry, added: true };
}

// → { list, removed } — `removed` are the dropped entries (the caller tombstones their ids).
export function withoutQueueEntries(list, match) {
  const cur = normalizeQueueAdded(list);
  const removed = cur.filter(match);
  return removed.length ? { list: cur.filter((e) => !match(e)), removed } : { list: cur, removed };
}

export const episodeRef = (id) => `episode:${id}`;
export const articleRef = (id) => `article:${id}`;
export const libraryAlbumRef = (artist, album) => `album:lib:${artist || ""}|${album || ""}`;
export const catalogAlbumRef = (id) => `album:cat:${id}`;
export const trackRef = (source, id) => `track:${source}:${id}`;

// A catalog album/playlist as stored in an entry: the fields a provider needs to
// load it again, without any track list it may carry (those are re-fetched at
// play time, so the synced entry stays small).
export function slimCatalogItem(item) {
  if (!item || typeof item !== "object") return null;
  const { tracks, items, ...rest } = item; // eslint-disable-line no-unused-vars
  return rest;
}

// The uploaded-library tracks that make up a library album entry, in list order.
export function libraryAlbumTracks(tracks, entry) {
  const artist = entry?.artist || "", album = entry?.album || "";
  return (Array.isArray(tracks) ? tracks : []).filter((t) => (t.album || "") === album && (t.artist || "") === artist);
}
