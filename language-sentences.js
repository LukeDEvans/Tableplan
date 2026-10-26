// Sentence building (LANGUAGE_PRACTICE.md §15). Pure: no DOM, no storage;
// randomness is injected. A sentence is { id, text (Dutch), en, alts? } where
// `alts` lists other accepted Dutch word orders.

import { shuffle, plain, stripAccents } from "./language-drills.js";

// The words of a sentence as tiles: final punctuation and commas dropped,
// the first word lower-cased (a capital would give the start away) unless it
// looks like a name or "Ik"-style capital that's always written that way.
export function sentenceTokens(text) {
  const words = String(text || "")
    .replace(/[.?!…]+\s*$/, "")
    .replace(/[,;:"“”]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length && /^[A-Z][a-z]/.test(words[0]) && !ALWAYS_CAPITAL.has(words[0])) {
    words[0] = words[0][0].toLowerCase() + words[0].slice(1);
  }
  return words;
}

// Words that keep their capital at the start of a tile (names, countries,
// languages). Only matters for a sentence's first word.
const ALWAYS_CAPITAL = new Set(["Amerika", "Nederland", "Nederlands", "Engels", "Amsterdam", "Holland"]);

const tokenKey = (t) => stripAccents(plain(t));

// Tiles for one sentence: its words plus up to `extra` distractors taken from
// other sentences (never a word the sentence itself uses). Each tile has a
// stable id for the round.
export function buildTiles(sentence, others, { extra = 2, rng = Math.random } = {}) {
  const words = sentenceTokens(sentence.text);
  const own = new Set(words.map(tokenKey));
  const pool = [];
  const seen = new Set();
  for (const o of shuffle(others || [], rng)) {
    if (!o || o.id === sentence.id) continue;
    for (const w of sentenceTokens(o.text)) {
      const k = tokenKey(w);
      if (!k || own.has(k) || seen.has(k)) continue;
      seen.add(k);
      pool.push(w);
    }
    if (pool.length >= extra * 4) break;
  }
  const distractors = shuffle(pool, rng).slice(0, extra);
  const tiles = [...words, ...distractors].map((text, i) => ({ id: `t${i}`, text }));
  return shuffle(tiles, rng);
}

// Checks the tiles chosen (their texts, in order) against the sentence and its
// accepted alternatives. `marks[i]` is true where the chosen word is right for
// the closest accepted answer, so the UI can show which tiles are off.
export function checkSentence(chosen, sentence) {
  const answers = [sentence.text, ...(sentence.alts || [])].map((a) => sentenceTokens(a).map(tokenKey));
  const got = (chosen || []).map(tokenKey);
  let best = null;
  for (const ans of answers) {
    const marks = got.map((g, i) => g === ans[i]);
    const right = marks.filter(Boolean).length;
    const ok = got.length === ans.length && right === ans.length;
    if (ok) return { ok: true, marks };
    if (!best || right > best.right) best = { right, marks, length: ans.length };
  }
  return { ok: false, marks: best ? best.marks : [], missing: best ? Math.max(0, best.length - got.length) : 0 };
}

// The sentence with a final full stop if it had none (for display).
export function displaySentence(text) {
  const t = String(text || "").trim();
  return /[.?!…]$/.test(t) ? t : `${t}.`;
}
