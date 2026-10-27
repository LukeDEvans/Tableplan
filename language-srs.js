// Spaced repetition for Dutch flashcards (LANGUAGE_PRACTICE.md §12). Pure: no
// DOM, no storage, no clock of its own (every call takes `now` in ms and an
// optional `dayOf(ms)` that turns a time into a local day number).
//
// Scheduler: FSRS-4.5 with its published default weights and 90 % target
// retention. A card's next interval is how many days until the chance of
// remembering it drops to 90 %. Intervals are whole days.
//
// A card is stored compactly (state.languageCards, personal `recreate` row):
//   "<entryId>|r" (recognize: Dutch → English), "<entryId>|p" (produce:
//   English → Dutch), "<sentenceId>|s" (sentence building)
//   → [stability, difficulty, dueDay, lastMs, reps, lapses, firstDay]
//
// Merge: per card, the copy with the later lastMs wins (a review fully
// determines the card). On a tie the earlier dueDay wins, so "pull forward"
// (a miss in another exercise) survives a merge.

export const FSRS_W = Object.freeze([
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
]);
export const RETENTION = 0.9;
export const MAX_INTERVAL_DAYS = 3650;
export const KNOWN_STABILITY_DAYS = 21;
export const GRADES = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });

const DECAY = -0.5;
const FACTOR = 19 / 81; // so that R(S, S) = 0.9
const DAY_MS = 86_400_000;

// Local day number (days since 1970-01-01 in the device's time zone).
export function localDay(ms) {
  const d = new Date(ms);
  return Math.floor((ms - d.getTimezoneOffset() * 60_000) / DAY_MS);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const int = (v) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0);

export function cardKey(entryId, dir) {
  return `${entryId}|${dir}`;
}

export function parseCardKey(k) {
  const i = String(k).lastIndexOf("|");
  if (i <= 0) return null;
  const dir = k.slice(i + 1);
  if (!["r", "p", "s"].includes(dir)) return null;
  return { entryId: k.slice(0, i), dir };
}

// ── Encode / decode ──────────────────────────────────────────────────────────
export function decodeCard(t) {
  if (!Array.isArray(t) || t.length < 6) return null;
  const s = Number(t[0]);
  const d = Number(t[1]);
  if (!(s > 0) || !(d >= 1 && d <= 10)) return null;
  return {
    s, d,
    due: int(t[2]),
    last: int(t[3]),
    reps: Math.max(0, int(t[4])),
    lapses: Math.max(0, int(t[5])),
    first: t.length > 6 ? int(t[6]) : int(t[2]),
  };
}

export function encodeCard(c) {
  return [round2(Math.max(0.01, c.s)), round2(clamp(c.d, 1, 10)), int(c.due), int(c.last), int(c.reps), int(c.lapses), int(c.first)];
}

export function normalizeCards(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, t] of Object.entries(raw)) {
    if (!parseCardKey(k)) continue;
    const c = decodeCard(t);
    if (c) out[k] = encodeCard(c);
  }
  return out;
}

export function mergeCards(newer, older) {
  const A = normalizeCards(newer);
  const B = normalizeCards(older);
  const out = { ...A };
  for (const [k, tb] of Object.entries(B)) {
    const ta = out[k];
    if (!ta) { out[k] = tb; continue; }
    if (tb[3] > ta[3] || (tb[3] === ta[3] && tb[2] < ta[2])) out[k] = tb;
  }
  return out;
}

// ── FSRS ─────────────────────────────────────────────────────────────────────
export function retrievability(elapsedDays, stability) {
  return Math.pow(1 + FACTOR * Math.max(0, elapsedDays) / stability, DECAY);
}

function intervalFor(stability) {
  const days = (stability / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}

const initStability = (g, w) => Math.max(0.1, w[g - 1]);
const initDifficulty = (g, w) => clamp(w[4] - (g - 3) * w[5], 1, 10);

function nextDifficulty(d, g, w) {
  const next = d - w[6] * (g - 3);
  return clamp(w[7] * initDifficulty(4, w) + (1 - w[7]) * next, 1, 10);
}

function recallStability(d, s, r, g, w) {
  const hard = g === 2 ? w[15] : 1;
  const easy = g === 4 ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy);
}

function forgetStability(d, s, r, w) {
  const f = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.min(f, s);
}

// The card after one answer. `card` is a decoded card or null (new).
function step(card, grade, today, w) {
  const g = clamp(int(grade), 1, 4);
  if (!card || card.reps === 0) {
    return { s: initStability(g, w), d: initDifficulty(g, w), lapse: g === 1 };
  }
  const elapsed = Math.max(0, today - card.lastDay);
  const r = retrievability(elapsed, card.s);
  const d = nextDifficulty(card.d, g, w);
  if (g === 1) return { s: Math.max(0.1, forgetStability(card.d, card.s, r, w)), d, lapse: true };
  return { s: recallStability(card.d, card.s, r, g, w), d, lapse: false };
}

// Days until each grade would bring the card back. Kept in order: Again ≤
// Hard < Good < Easy, so the buttons never contradict each other.
export function previewIntervals(stored, now, { dayOf = localDay, w = FSRS_W } = {}) {
  const today = dayOf(now);
  const card = withLastDay(decodeCard(stored), dayOf);
  const days = {};
  for (const g of [1, 2, 3, 4]) {
    const n = step(card, g, today, w);
    days[g] = g === 1 ? 1 : intervalFor(n.s);
  }
  days[2] = Math.max(1, Math.min(days[2], days[3]));
  if (days[3] <= days[2]) days[3] = days[2] + 1;
  if (days[4] <= days[3]) days[4] = days[3] + 1;
  return days;
}

function withLastDay(card, dayOf) {
  return card ? { ...card, lastDay: card.last ? dayOf(card.last) : card.due } : null;
}

// Answer a card. Returns the new stored tuple.
export function reviewCard(stored, grade, now, { dayOf = localDay, w = FSRS_W } = {}) {
  const today = dayOf(now);
  const card = withLastDay(decodeCard(stored), dayOf);
  const n = step(card, grade, today, w);
  const g = clamp(int(grade), 1, 4);
  const interval = previewIntervals(stored, now, { dayOf, w })[g];
  return encodeCard({
    s: n.s,
    d: n.d,
    due: today + interval,
    last: now,
    reps: (card?.reps || 0) + 1,
    lapses: (card?.lapses || 0) + (n.lapse && card && card.reps > 0 ? 1 : 0),
    first: card ? card.first : today,
  });
}

// A miss somewhere else (matching, de/het, listening): bring the card back
// today without touching what the scheduler has learned about it.
export function pullForward(stored, now, { dayOf = localDay } = {}) {
  const c = decodeCard(stored);
  if (!c) return stored;
  const today = dayOf(now);
  return c.due > today ? encodeCard({ ...c, due: today }) : stored;
}

export function isDue(stored, today) {
  const c = decodeCard(stored);
  return !!c && c.due <= today;
}

export function isKnown(stored) {
  const c = decodeCard(stored);
  return !!c && c.s >= KNOWN_STABILITY_DAYS;
}

export function formatInterval(days) {
  const d = Math.max(1, Math.round(days));
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  const y = d / 365;
  return `${y < 10 ? Math.round(y * 10) / 10 : Math.round(y)}y`;
}

// ── Building a session ───────────────────────────────────────────────────────
// entries: words in course order (the scope's, or everything).
// Returns { due: [item], fresh: [item], queue: [item], counts } where an item
// is { key, entryId, dir, isNew }.
//
// - Due cards (recognize and produce) come first, most overdue first.
// - New words: up to `newLimit` minus words already introduced today.
// - A word's produce card becomes available the day after its recognize card
//   was first answered right (stability ≥ 1 day and a review before today).
//   Produce introductions share the same daily limit.
// - New cards are spread through the reviews (one after every 4).
export function buildSession(cards, entries, now, { newLimit = 10, dayOf = localDay, maxDue = 200 } = {}) {
  const today = dayOf(now);
  const all = normalizeCards(cards);
  const due = [];
  const freshR = [];
  const freshP = [];
  let introducedToday = 0;
  for (const [k, t] of Object.entries(all)) {
    if (k.endsWith("|s")) continue; // sentences don't count against new words
    const c = decodeCard(t);
    if (c && c.first === today && c.reps > 0) introducedToday += 1;
  }
  const seen = new Set();
  for (const e of entries || []) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    for (const dir of ["r", "p"]) {
      const k = cardKey(e.id, dir);
      const t = all[k];
      if (t) {
        const c = decodeCard(t);
        if (c.due <= today) due.push({ key: k, entryId: e.id, dir, isNew: false, over: today - c.due, r: retrievability(today - dayOf(c.last || 0), c.s) });
      } else if (dir === "r") {
        freshR.push({ key: k, entryId: e.id, dir, isNew: true });
      } else {
        const r = decodeCard(all[cardKey(e.id, "r")]);
        if (r && r.reps > 0 && r.s >= 1 && dayOf(r.last) < today) freshP.push({ key: k, entryId: e.id, dir, isNew: true });
      }
    }
  }
  due.sort((a, b) => b.over - a.over || a.r - b.r);
  const room = Math.max(0, newLimit - introducedToday);
  // Produce cards for words already learned come before brand-new words: they
  // build on what's known.
  const fresh = [...freshP, ...freshR].slice(0, room);
  const dueList = due.slice(0, maxDue).map(({ over, r, ...rest }) => rest);
  const queue = [];
  let f = 0;
  dueList.forEach((item, i) => {
    queue.push(item);
    if ((i + 1) % 4 === 0 && f < fresh.length) queue.push(fresh[f++]);
  });
  while (f < fresh.length) queue.push(fresh[f++]);
  return {
    due: dueList,
    fresh,
    queue,
    counts: { due: dueList.length, fresh: fresh.length, introducedToday, newRemaining: Math.max(0, room - fresh.length), freshAvailable: freshR.length + freshP.length },
  };
}

// Where a re-shown card goes after "Again": a few cards later, never last
// unless the queue is short.
export function againGap(remaining) {
  return Math.min(Math.max(remaining, 0), 3);
}

// Counts for a set of words: how many are due today, new, known.
export function deckCounts(cards, entries, now, { dayOf = localDay } = {}) {
  const today = dayOf(now);
  const all = normalizeCards(cards);
  let due = 0, fresh = 0, known = 0, learning = 0;
  for (const e of entries || []) {
    const r = all[cardKey(e.id, "r")];
    const p = all[cardKey(e.id, "p")];
    if (!r) fresh += 1;
    else {
      if (isKnown(r)) known += 1; else learning += 1;
    }
    if (r && isDue(r, today)) due += 1;
    if (p && isDue(p, today)) due += 1;
  }
  return { due, fresh, known, learning, total: (entries || []).length };
}

// ── Problem words (§24) ─────────────────────────────────────────────────────
// A card answered "Again" this many times after it was learned keeps eating
// review time; it gets flagged so a note or memory trick can be added.
export const LEECH_LAPSES = 4;

// Entry ids whose recognize or produce card has lapsed LEECH_LAPSES+ times,
// worst first.
export function problemWordIds(cards) {
  const worst = new Map();
  for (const [k, t] of Object.entries(normalizeCards(cards))) {
    const p = parseCardKey(k);
    if (!p || p.dir === "s") continue;
    const c = decodeCard(t);
    if (c.lapses >= LEECH_LAPSES) worst.set(p.entryId, Math.max(worst.get(p.entryId) || 0, c.lapses));
  }
  return [...worst.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export function lapsesOf(cards, entryId) {
  const all = normalizeCards(cards);
  return Math.max(decodeCard(all[cardKey(entryId, "r")])?.lapses || 0, decodeCard(all[cardKey(entryId, "p")])?.lapses || 0);
}
