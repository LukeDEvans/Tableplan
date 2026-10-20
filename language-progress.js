// Language practice progress (LANGUAGE_PRACTICE.md §5). Pure: no storage here;
// app.js keeps the two synced keys in the personal `recreate` section:
//
//   state.languageWords    { <entryId>: { seen, c, w, last, scope } }
//       seen  times the word was put on the board
//       c / w correct matches / wrong attempts made with this word's card
//       last  ISO time it was last practiced; scope where (e.g. "lesson:nl-s1-2")
//   state.languageSessions [{ id, lang, scope, label, startedAt, endedAt,
//                             durationMs, correct, attempts, target, reached, endReason }]
//
// Both are written once per finished session, never per tap or tick.
//
// Merging (mergeStates in app.js): counters only ever grow, so two copies merge
// by taking the larger of each field. A stale copy can't lower anything and
// re-applying the same copy changes nothing. The one cost: two devices
// practicing the same word offline at the same time keep the larger count, not
// the sum. Sessions merge by id, newest SESSION_CAP kept.

export const SESSION_CAP = 50;

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

function cleanStat(s) {
  if (!s || typeof s !== "object") return null;
  const out = { seen: num(s.seen), c: num(s.c), w: num(s.w), last: typeof s.last === "string" ? s.last : "" };
  if (typeof s.scope === "string" && s.scope) out.scope = s.scope;
  return out;
}

export function normalizeWordStats(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, s] of Object.entries(raw)) {
    const clean = cleanStat(s);
    if (id && clean) out[id] = clean;
  }
  return out;
}

export function mergeWordStats(a, b) {
  const A = normalizeWordStats(a);
  const B = normalizeWordStats(b);
  const out = { ...A };
  for (const [id, sb] of Object.entries(B)) {
    const sa = out[id];
    if (!sa) { out[id] = sb; continue; }
    const later = (sb.last || "") > (sa.last || "") ? sb : sa;
    out[id] = {
      seen: Math.max(sa.seen, sb.seen),
      c: Math.max(sa.c, sb.c),
      w: Math.max(sa.w, sb.w),
      last: later.last || "",
      ...(later.scope ? { scope: later.scope } : {}),
    };
  }
  return out;
}

// Fold one finished game's per-word counts into the stored stats.
export function applySessionToWordStats(stats, sessionWords, { at, scope }) {
  const out = normalizeWordStats(stats);
  for (const [id, w] of Object.entries(sessionWords || {})) {
    if (!w || !(w.seen || w.c || w.w)) continue;
    const prev = out[id] || { seen: 0, c: 0, w: 0, last: "" };
    out[id] = {
      seen: prev.seen + num(w.seen),
      c: prev.c + num(w.c),
      w: prev.w + num(w.w),
      last: at,
      ...(scope ? { scope } : {}),
    };
  }
  return out;
}

export function normalizeSessions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((s) => s && typeof s.id === "string" && s.id)
    .map((s) => ({
      id: s.id,
      lang: typeof s.lang === "string" ? s.lang : "nl",
      scope: typeof s.scope === "string" ? s.scope : "",
      label: typeof s.label === "string" ? s.label : "",
      startedAt: typeof s.startedAt === "string" ? s.startedAt : "",
      endedAt: typeof s.endedAt === "string" ? s.endedAt : "",
      durationMs: num(s.durationMs),
      correct: num(s.correct),
      attempts: num(s.attempts),
      target: num(s.target),
      reached: !!s.reached,
      endReason: typeof s.endReason === "string" ? s.endReason : "",
    }));
}

const newestFirst = (x, y) => (y.endedAt || "").localeCompare(x.endedAt || "") || y.id.localeCompare(x.id);

export function mergeSessions(a, b, cap = SESSION_CAP) {
  const byId = new Map();
  for (const s of [...normalizeSessions(b), ...normalizeSessions(a)]) byId.set(s.id, s);
  return [...byId.values()].sort(newestFirst).slice(0, cap);
}

export function addSession(list, session, cap = SESSION_CAP) {
  return mergeSessions([session], list, cap);
}

export function lastSession(list, scopeKeyValue) {
  const all = normalizeSessions(list).sort(newestFirst);
  return scopeKeyValue ? all.find((s) => s.scope === scopeKeyValue) || null : all[0] || null;
}
