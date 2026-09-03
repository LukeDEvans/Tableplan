// reading-progress.js — READING position, a concern kept strictly SEPARATE from
// listening progress (media-progress.js / state.mediaProgress) and from
// consumption (state.readArticleIds / articleReadDates). Scrolling through the
// reader saves a READING position; it never marks the article consumed and never
// touches the media queue (audit §41, §47, §279–283: "partial read saves
// position, doesn't consume, doesn't touch queue. Reread starts fresh, preserves
// history"). Pure + DOM-free: a flat map id→{percent, position, updatedAt} that
// merges like mediaProgress (unionByKey). Callers own persistence + scroll wiring.

const nowIso = () => new Date().toISOString();

function clampPct(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Record the reading position for one article. Returns a NEW map (never mutates)
// so it slots straight into the immutable state-merge model. Structurally this can
// ONLY produce a reading-progress map — it has no path to consumption/queue state,
// which is the whole point of keeping the concern separate.
export function setReadingProgress(map, id, { percent, position, updatedAt } = {}) {
  id = id == null ? "" : String(id);
  if (!id) return map || {};
  const pos = Number(position);
  const next = { ...(map || {}) };
  next[id] = {
    percent: clampPct(percent),
    position: Number.isFinite(pos) ? Math.max(0, Math.round(pos)) : 0,
    updatedAt: String(updatedAt || nowIso()),
  };
  return next;
}

export function getReadingProgress(map, id) {
  const e = map && id != null ? map[String(id)] : null;
  return e && typeof e === "object" ? e : null;
}

// The saved read fraction [0..1], 0 when never opened.
export function readingPercent(map, id) {
  const e = getReadingProgress(map, id);
  return e ? clampPct(e.percent) : 0;
}

// Started reading (past a tiny threshold so an accidental open at the top doesn't
// count). Still NOT "consumed" — consumption is a separate record.
export function hasStarted(map, id, threshold = 0.02) {
  return readingPercent(map, id) >= threshold;
}

// Reached the end of the text. Callers MAY use this to offer/resolve consumption,
// but this module never resolves it for them (opening ≠ consumed).
export function isFinished(map, id, threshold = 0.95) {
  return readingPercent(map, id) >= threshold;
}

// Reread starts fresh (audit §283): drop the saved position, leaving history
// (readArticleIds/articleReadDates) untouched — those live elsewhere.
export function clearReadingProgress(map, id) {
  id = id == null ? "" : String(id);
  if (!map || !(id in map)) return map || {};
  const next = { ...map };
  delete next[id];
  return next;
}

// Bound the map to live articles: reading progress for a purged/retention-dropped
// article is dead weight. keepIds may be an array or a Set. Returns a NEW map.
export function pruneReadingProgress(map, keepIds) {
  if (!map || typeof map !== "object") return {};
  const keep = keepIds instanceof Set ? keepIds : new Set(keepIds || []);
  const next = {};
  for (const [id, v] of Object.entries(map)) if (keep.has(id)) next[id] = v;
  return next;
}
