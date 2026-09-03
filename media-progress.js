// media-progress.js — persisted playback position for resumable audio (music,
// audiobooks). Podcast already had `podcastProgress`; this generalizes the SAME
// proven pattern to the rest of audio so "continue where you left off" works beyond
// podcasts (matrix item 23). A flat map keyed by a stable media id →
// { position, duration, lastPlayedAt }, synced in the media section (unionByKey),
// account-scoped like all state. Pure — the shell captures the position and calls
// these; resume flows through the existing playback engine's startPosition.

export function normalizeMediaProgress(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

export function getPosition(map, key) {
  const e = normalizeMediaProgress(map)[key];
  return e && typeof e === "object" ? e : null;
}

// Immutable set. Ignores a missing key. Floors to whole seconds; a non-positive
// position clears the entry (nothing to resume).
export function setPosition(map, key, { position, duration = 0, at = new Date().toISOString() } = {}) {
  const m = { ...normalizeMediaProgress(map) };
  if (!key) return m;
  const pos = Math.max(0, Math.floor(Number(position) || 0));
  if (pos <= 0) { delete m[key]; return m; }
  m[key] = { position: pos, duration: Math.max(0, Math.floor(Number(duration) || 0)), lastPlayedAt: at };
  return m;
}

export function clearPosition(map, key) {
  const m = { ...normalizeMediaProgress(map) };
  delete m[key];
  return m;
}

// The position to resume from, or 0 when resuming would be unhelpful: only resume
// content the listener is genuinely partway through — past `minPosition` seconds and
// not within `tailGuard` seconds of the end — so short songs and all-but-finished
// tracks don't awkwardly jump. Mirrors the podcast/video resume behavior.
export function resumePositionFor(map, key, { minPosition = 45, tailGuard = 15 } = {}) {
  const e = getPosition(map, key);
  if (!e) return 0;
  const { position, duration } = e;
  if (!(position > minPosition)) return 0;
  if (duration > 0 && position >= duration - tailGuard) return 0; // essentially finished
  return position;
}

// Keep the map bounded to the `cap` most-recently-played entries.
export function pruneMediaProgress(map, { cap = 200 } = {}) {
  const m = normalizeMediaProgress(map);
  const keys = Object.keys(m);
  if (keys.length <= cap) return m;
  const kept = keys
    .sort((a, b) => String(m[b]?.lastPlayedAt || "").localeCompare(String(m[a]?.lastPlayedAt || "")))
    .slice(0, cap);
  const out = {};
  for (const k of kept) out[k] = m[k];
  return out;
}

// Resumable items for a Today/Continue projection: entries with a meaningful resume
// point, newest first. Pure — the caller maps ids back to titles/targets.
export function resumableEntries(map, { minPosition = 45, tailGuard = 15, limit = 10 } = {}) {
  const m = normalizeMediaProgress(map);
  return Object.keys(m)
    .filter((k) => resumePositionFor(m, k, { minPosition, tailGuard }) > 0)
    .map((k) => ({ id: k, position: m[k].position, duration: m[k].duration || 0, lastPlayedAt: m[k].lastPlayedAt || null }))
    .sort((a, b) => String(b.lastPlayedAt || "").localeCompare(String(a.lastPlayedAt || "")))
    .slice(0, limit);
}
