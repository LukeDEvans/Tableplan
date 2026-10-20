// Timed matching game (LANGUAGE_PRACTICE.md §2). Pure state machine: no DOM,
// no timers, no storage. Every call takes `now` (ms) and randomness comes from
// an injected rng, so the game is fully deterministic under test. The UI calls
// select() on taps and tick() whenever nextDueAt() says something is due.
//
// Board: two columns of slots. Each slot holds one pair's card (Dutch on the
// left, English on the right) and is "active", "matched" (just matched, waiting
// for its replacement, never selectable) or "empty" (the pool ran out).
//
// Guarantees (tested in test/language-match.test.js):
//  - only active cards can be selected; one selection per side; re-tapping a
//    selected card clears it;
//  - a correct pair counts once, turns both cards "matched" and schedules their
//    replacement after a random 500–1500 ms; a wrong pair counts an attempt and
//    changes nothing else;
//  - no pair, Dutch form or English form is ever on the board twice, so every
//    Dutch card has exactly one answer showing;
//  - only words from the pool are ever shown, never invented ones;
//  - once the game has ended (time, target or left) nothing changes it again.

import { normalizeForm, englishForms } from "./language-curriculum.js";

export const MATCH_DEFAULTS = Object.freeze({
  boardSize: 5,
  target: 30,
  durationMs: 120_000,
  refillMinMs: 500,
  refillMaxMs: 1500,
});

// Small seeded generator (mulberry32) for tests and replays.
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createMatchGame(pool, options = {}) {
  const opts = { ...MATCH_DEFAULTS, ...options };
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  const byId = new Map();
  for (const e of Array.isArray(pool) ? pool : []) {
    if (e?.id && e.text && e.en && !byId.has(e.id)) byId.set(e.id, e);
  }
  const entries = [...byId.values()];
  const boardSize = Math.max(0, Math.min(opts.boardSize, entries.length));
  return {
    status: "ready", // ready → playing → ended
    endReason: null, // "time" | "target" | "left"
    opts: { ...opts, boardSize, rng: undefined },
    rng,
    entries,
    byId,
    startedAt: null,
    endedAt: null,
    pausedAt: null,
    pausedMs: 0,
    correct: 0,
    attempts: 0,
    left: [],
    right: [],
    selected: { left: null, right: null },
    refills: [], // { left, right, dueAt }
    shown: {}, // id -> times placed on the board this game
    recent: [], // matched ids, newest last
    words: {}, // id -> { seen, c, w } for this game
    lastEvent: null,
  };
}

const isPlaying = (g) => g.status === "playing" && g.pausedAt == null;

export function elapsedMs(g, now) {
  if (g.startedAt == null) return 0;
  const end = g.endedAt ?? g.pausedAt ?? now;
  return Math.max(0, Math.min(g.opts.durationMs, end - g.startedAt - g.pausedMs));
}

export function remainingMs(g, now) {
  return Math.max(0, g.opts.durationMs - elapsedMs(g, now));
}

function wordStat(g, id) {
  if (!g.words[id]) g.words[id] = { seen: 0, c: 0, w: 0 };
  return g.words[id];
}

// Forms already on the board (active or awaiting replacement), so a new pair
// can't duplicate or be confused with one showing.
function boardForms(g, extraIds = []) {
  const ids = new Set(extraIds);
  // "matched" cards are still visible until replaced, so they count too.
  for (const s of g.left) if (s.pairId && s.state !== "empty") ids.add(s.pairId);
  const text = new Set();
  const en = new Set();
  for (const id of ids) {
    const e = g.byId.get(id);
    if (!e) continue;
    text.add(normalizeForm(e.text));
    for (const f of englishForms(e)) en.add(f);
  }
  return { ids, text, en };
}

// Pick the next pair: not on the board, not confusable with anything on it,
// preferably not just matched, and among the least-shown so every word gets
// its turn. Returns null when nothing fits (the slot stays empty; no word is
// ever invented to fill it).
function pickPair(g, placedThisRound) {
  const { ids, text, en } = boardForms(g, placedThisRound);
  const candidates = g.entries.filter((e) => {
    if (ids.has(e.id)) return false;
    if (text.has(normalizeForm(e.text))) return false;
    return !englishForms(e).some((f) => en.has(f));
  });
  if (!candidates.length) return null;
  const spare = g.entries.length - g.opts.boardSize;
  const window = Math.max(0, Math.min(3, spare));
  const recent = new Set(g.recent.slice(-window));
  const fresh = candidates.filter((e) => !recent.has(e.id));
  const choices = fresh.length ? fresh : candidates;
  const least = Math.min(...choices.map((e) => g.shown[e.id] || 0));
  const fair = choices.filter((e) => (g.shown[e.id] || 0) === least);
  return fair[Math.floor(g.rng() * fair.length)];
}

function place(g, pair, leftIndex, rightIndex) {
  g.left[leftIndex] = { pairId: pair.id, state: "active" };
  g.right[rightIndex] = { pairId: pair.id, state: "active" };
  g.shown[pair.id] = (g.shown[pair.id] || 0) + 1;
  wordStat(g, pair.id).seen += 1;
}

export function startGame(g, now) {
  if (g.status !== "ready") return g;
  g.status = "playing";
  g.startedAt = now;
  const n = g.opts.boardSize;
  g.left = Array.from({ length: n }, () => ({ pairId: null, state: "empty" }));
  g.right = Array.from({ length: n }, () => ({ pairId: null, state: "empty" }));
  const rightOrder = shuffle([...Array(n).keys()], g.rng);
  const placed = [];
  for (let i = 0; i < n; i += 1) {
    const pair = pickPair(g, placed);
    if (!pair) break;
    placed.push(pair.id);
    place(g, pair, i, rightOrder[i]);
  }
  g.lastEvent = { type: "start" };
  if (n === 0) endGame(g, now, "empty");
  return g;
}

export function endGame(g, now, reason) {
  if (g.status === "ended") return g;
  if (g.status === "ready") g.startedAt = now;
  if (g.pausedAt != null) {
    g.pausedMs += now - g.pausedAt;
    g.pausedAt = null;
  }
  // Time runs out exactly at the limit, however late the tick arrives.
  const limit = g.startedAt + g.pausedMs + g.opts.durationMs;
  g.endedAt = Math.min(now, limit);
  g.status = "ended";
  g.endReason = reason;
  g.refills = [];
  g.selected = { left: null, right: null };
  g.lastEvent = { type: "end", reason };
  return g;
}

export function pauseGame(g, now) {
  if (g.status === "playing" && g.pausedAt == null) g.pausedAt = now;
  return g;
}

export function resumeGame(g, now) {
  if (g.status !== "playing" || g.pausedAt == null) return g;
  const span = now - g.pausedAt;
  g.pausedMs += span;
  g.pausedAt = null;
  for (const r of g.refills) r.dueAt += span;
  return g;
}

// The next moment something happens without a tap: a replacement or time up.
export function nextDueAt(g) {
  if (!isPlaying(g)) return null;
  const timeUp = g.startedAt + g.pausedMs + g.opts.durationMs;
  return Math.min(timeUp, ...g.refills.map((r) => r.dueAt));
}

// Advance time: end the game when time is up, otherwise put replacements in
// for every due refill. Returns the events that happened.
export function tick(g, now) {
  if (!isPlaying(g)) return [];
  if (remainingMs(g, now) <= 0) {
    endGame(g, now, "time");
    return [g.lastEvent];
  }
  const due = g.refills.filter((r) => r.dueAt <= now);
  if (!due.length) return [];
  g.refills = g.refills.filter((r) => r.dueAt > now);
  for (const r of due) {
    g.left[r.left] = { pairId: null, state: "empty" };
    g.right[r.right] = { pairId: null, state: "empty" };
  }
  // Cross-assign when several land together, so a new Dutch card's answer
  // isn't always the card that appeared beside it.
  const lefts = due.map((r) => r.left);
  const rights = shuffle(due.map((r) => r.right), g.rng);
  const slots = [];
  const placed = [];
  lefts.forEach((li, k) => {
    const pair = pickPair(g, placed);
    if (!pair) return;
    placed.push(pair.id);
    place(g, pair, li, rights[k]);
    slots.push({ left: li, right: rights[k] });
  });
  // Slots left empty earlier (a clash kept them blank) get a pair if one fits now.
  const emptyL = g.left.map((x, i) => (x.state === "empty" ? i : -1)).filter((i) => i >= 0);
  const emptyR = shuffle(g.right.map((x, i) => (x.state === "empty" ? i : -1)).filter((i) => i >= 0), g.rng);
  for (let k = 0; k < Math.min(emptyL.length, emptyR.length); k += 1) {
    const pair = pickPair(g, placed);
    if (!pair) break;
    placed.push(pair.id);
    place(g, pair, emptyL[k], emptyR[k]);
    slots.push({ left: emptyL[k], right: emptyR[k] });
  }
  g.lastEvent = { type: "refill", slots };
  return [g.lastEvent];
}

// A tap on a card. Returns what happened:
//   ignored · select · deselect · match { left, right, pairId } · miss { left, right }
export function select(g, side, index, now) {
  if (side !== "left" && side !== "right") return { type: "ignored" };
  if (!isPlaying(g)) return { type: "ignored" };
  tick(g, now);
  if (!isPlaying(g)) return { type: "ignored" };
  const slot = g[side][index];
  if (!slot || slot.state !== "active") return { type: "ignored" };
  if (g.selected[side] === index) {
    g.selected[side] = null;
    return (g.lastEvent = { type: "deselect", side, index });
  }
  g.selected[side] = index;
  const li = g.selected.left;
  const ri = g.selected.right;
  if (li == null || ri == null) return (g.lastEvent = { type: "select", side, index });

  const L = g.left[li];
  const R = g.right[ri];
  g.selected = { left: null, right: null };
  g.attempts += 1;
  if (L.pairId === R.pairId) {
    g.correct += 1;
    wordStat(g, L.pairId).c += 1;
    L.state = "matched";
    R.state = "matched";
    g.recent.push(L.pairId);
    if (g.recent.length > 10) g.recent.shift();
    const span = Math.max(0, g.opts.refillMaxMs - g.opts.refillMinMs);
    g.refills.push({ left: li, right: ri, dueAt: now + g.opts.refillMinMs + Math.floor(g.rng() * (span + 1)) });
    const ev = (g.lastEvent = { type: "match", left: li, right: ri, pairId: L.pairId });
    if (g.correct >= g.opts.target) endGame(g, now, "target");
    return ev;
  }
  wordStat(g, L.pairId).w += 1; // counted against the Dutch card being matched
  return (g.lastEvent = { type: "miss", left: li, right: ri });
}

// Accuracy = correct ÷ completed attempts. A lone selection isn't an attempt.
// With no attempts at all, accuracy is null (shown as "—"), never 0 % or 100 %.
export function gameSummary(g, now) {
  return {
    correct: g.correct,
    attempts: g.attempts,
    accuracy: g.attempts ? g.correct / g.attempts : null,
    target: g.opts.target,
    reached: g.correct >= g.opts.target,
    durationMs: elapsedMs(g, now),
    endReason: g.endReason,
    words: { ...g.words },
  };
}

export function pairText(g, pairId) {
  const e = g.byId.get(pairId);
  return e ? { text: e.text, en: e.en } : null;
}
