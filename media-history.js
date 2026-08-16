// Unified media listening history — ONE cross-type store (state.mediaHistory)
// that every media kind writes to, instead of per-type silos. Answers "what did
// I listen to recently" across podcasts, music, radio and article audio, and
// gives AI/future surfaces a single normalized place to query.
//
//   entry = { kind, id, title, subtitle, artworkUrl, ref, at }
//     kind    "podcast" | "music" | "radio" | "article"
//     id      stable id WITHIN that kind (kind+id is the identity)
//     ref     kind-specific payload the app uses to replay/reopen the item
//
// Pure functions over a plain array (the app stores it at state.mediaHistory and
// calls persist()); no DOM/storage here, so it's fully testable.

const str = (v, d = "") => (v == null ? d : String(v));

export function makeHistoryEntry(p = {}) {
  return {
    kind: str(p.kind),
    id: str(p.id),
    title: str(p.title) || "Untitled",
    subtitle: str(p.subtitle) || "",
    artworkUrl: str(p.artworkUrl) || "",
    ref: p.ref != null ? p.ref : null,
    at: Number.isFinite(p.at) ? p.at : Date.now(),
  };
}

// Prepend an entry, de-duped by kind+id (most-recent wins), capped. Returns a new
// array; a bad entry (no kind/id) leaves the list unchanged.
export function pushHistory(list, entry, { cap = 60 } = {}) {
  const arr = Array.isArray(list) ? list : [];
  const e = makeHistoryEntry(entry);
  if (!e.kind || !e.id) return arr.slice();
  const key = `${e.kind}:${e.id}`;
  const out = arr.filter((h) => `${h.kind}:${h.id}` !== key);
  out.unshift(e);
  return out.slice(0, cap);
}

// Recent entries, optionally filtered by kind (or an array of kinds), newest
// first. `list` is assumed already newest-first (pushHistory maintains that).
export function recentHistory(list, { kind, limit } = {}) {
  let out = Array.isArray(list) ? list.slice() : [];
  if (kind) { const kinds = Array.isArray(kind) ? kind : [kind]; out = out.filter((h) => kinds.includes(h.kind)); }
  return limit != null ? out.slice(0, limit) : out;
}

export function lastPlayed(list, opts = {}) { return recentHistory(list, { ...opts, limit: 1 })[0] || null; }

// One-time migration of the old per-type histories into the unified list.
export function migrateLegacyHistory(list, { music = [], radio = [] } = {}) {
  let out = Array.isArray(list) ? list.slice() : [];
  // Oldest-first insertion so the newest legacy entry ends up on top.
  const musicEntries = (Array.isArray(music) ? music : []).slice().reverse().map((h) => makeHistoryEntry({
    kind: "music", id: h.id, title: h.title, subtitle: h.artist, artworkUrl: h.artworkUrl,
    ref: { mkind: h.kind, canonical: h.canonical || null, recording: h.recording || null }, at: h.at,
  }));
  const radioEntries = (Array.isArray(radio) ? radio : []).slice().reverse().map((h) => makeHistoryEntry({
    kind: "radio", id: h.id, title: h.name, subtitle: h.category, artworkUrl: h.logoUrl, ref: h, at: h.at,
  }));
  for (const e of [...musicEntries, ...radioEntries]) out = pushHistory(out, e);
  return out;
}
