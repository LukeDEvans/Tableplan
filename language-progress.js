// Language practice progress (LANGUAGE_PRACTICE.md §5). Pure: no storage here;
// app.js keeps the two synced keys in the personal `recreate` section:
//
//   state.languageWords    { <entryId>: { n: { <deviceId>: [seen, c, w] }, last, scope } }
//       seen  times the word was put on the board
//       c / w correct matches / wrong attempts made with this word's card
//       last  ISO time it was last practiced; scope where (e.g. "lesson:nl-s1-2")
//   state.languageSessions [{ id, lang, scope, label, startedAt, endedAt,
//                             durationMs, correct, attempts, target, reached, endReason }]
//
// Both are written once per finished session, never per tap or tick.
//
// Merging (mergeStates in app.js): each device only ever adds to its own
// counters, so two copies merge by taking the larger of each device's numbers,
// and a word's total is the sum across devices. A stale copy can't lower
// anything, re-applying a copy changes nothing, and practice done on a device
// holding an out-of-date copy still counts in full. Sessions merge by id,
// newest SESSION_CAP kept.

export const SESSION_CAP = 50;

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const triple = (t) => (Array.isArray(t) ? [num(t[0]), num(t[1]), num(t[2])] : [0, 0, 0]);

function cleanStat(s) {
  if (!s || typeof s !== "object") return null;
  const n = {};
  if (s.n && typeof s.n === "object" && !Array.isArray(s.n)) {
    for (const [dev, t] of Object.entries(s.n)) if (dev) n[dev] = triple(t);
  }
  const out = { n, last: typeof s.last === "string" ? s.last : "" };
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
    const n = { ...sa.n };
    for (const [dev, tb] of Object.entries(sb.n)) {
      const ta = n[dev] || [0, 0, 0];
      n[dev] = [Math.max(ta[0], tb[0]), Math.max(ta[1], tb[1]), Math.max(ta[2], tb[2])];
    }
    const later = (sb.last || "") > (sa.last || "") ? sb : sa;
    out[id] = { n, last: later.last || "", ...(later.scope ? { scope: later.scope } : {}) };
  }
  return out;
}

// Totals per word across devices: { id: { seen, c, w, last } }.
export function wordTotals(raw) {
  const out = {};
  for (const [id, s] of Object.entries(normalizeWordStats(raw))) {
    let seen = 0, c = 0, w = 0;
    for (const t of Object.values(s.n)) { seen += t[0]; c += t[1]; w += t[2]; }
    out[id] = { seen, c, w, last: s.last };
  }
  return out;
}

// Fold one finished game's per-word counts into this device's counters.
export function applySessionToWordStats(stats, sessionWords, { at, scope, device }) {
  const out = normalizeWordStats(stats);
  const dev = device || "device";
  for (const [id, w] of Object.entries(sessionWords || {})) {
    if (!w || !(w.seen || w.c || w.w)) continue;
    const prev = out[id] || { n: {}, last: "" };
    const t = prev.n[dev] || [0, 0, 0];
    out[id] = {
      n: { ...prev.n, [dev]: [t[0] + num(w.seen), t[1] + num(w.c), t[2] + num(w.w)] },
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
