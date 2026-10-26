// Answer checking and drill building for Dutch practice (LANGUAGE_PRACTICE.md
// §12, §14–16). Pure: no DOM, no storage; randomness is injected.

// ── Comparing answers ────────────────────────────────────────────────────────
export function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Lower case, typographic quotes made plain, punctuation and extra spaces dropped.
export function plain(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[.,!?;:¿¡"“”()…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

const ARTICLE = /^(de|het|een)\s+/;

// Checks typed Dutch against the expected answer (and any alternatives).
//   exact  — same apart from case and punctuation
//   close  — a missing accent, a missing or wrong article, or one small slip
//            (two in long answers); `why` says which
//   wrong  — anything else
export function compareAnswer(given, expected, alternatives = []) {
  const g = plain(given);
  if (!g) return { result: "wrong", why: "empty" };
  const targets = [expected, ...(alternatives || [])].map(plain).filter(Boolean);
  if (targets.includes(g)) return { result: "exact" };
  let best = { result: "wrong" };
  for (const t of targets) {
    if (stripAccents(g) === stripAccents(t)) return { result: "close", why: "accent", expected: t };
    const gNo = g.replace(ARTICLE, "");
    const tNo = t.replace(ARTICLE, "");
    if (gNo === tNo && g !== t) best = { result: "close", why: "article", expected: t };
    else if (best.result === "wrong") {
      const dist = levenshtein(stripAccents(g), stripAccents(t));
      const allowed = t.length >= 10 ? 2 : t.length >= 4 ? 1 : 0;
      if (dist > 0 && dist <= allowed) best = { result: "close", why: "typo", expected: t };
    }
  }
  return best;
}

// Which grade a typed answer earns: exact → Good, close → Hard, wrong → Again.
export function gradeForTyped(result) {
  return result === "exact" ? 3 : result === "close" ? 2 : 1;
}

// ── Speech recognition ───────────────────────────────────────────────────────
// Did any of the recognizer's guesses say the target? Lenient: case, accents,
// punctuation and an article don't matter, and long phrases may be ~15 % off.
export function speechMatches(transcripts, target) {
  const t = stripAccents(plain(target));
  const tNo = t.replace(ARTICLE, "");
  let best = null;
  for (const raw of Array.isArray(transcripts) ? transcripts : [transcripts]) {
    const h = stripAccents(plain(raw));
    if (!h) continue;
    const hNo = h.replace(ARTICLE, "");
    const dist = Math.min(levenshtein(h, t), levenshtein(hNo, tNo));
    const score = 1 - dist / Math.max(t.length, h.length, 1);
    if (!best || score > best.score) best = { heard: String(raw), score };
  }
  if (!best) return { ok: false, heard: "", score: 0 };
  const need = t.length <= 4 ? 1 : t.length <= 12 ? 0.8 : 0.85;
  return { ok: best.score >= need, heard: best.heard, score: best.score };
}

// ── de / het ─────────────────────────────────────────────────────────────────
const NOUN = /^(de|het)\s+([^\s.?!]+(?:\s[^\s.?!]+)?)$/i;

// One item per distinct noun (the same noun in two lessons appears once).
export function deHetItems(entries) {
  const out = [];
  const seen = new Set();
  for (const e of entries || []) {
    const m = String(e?.text || "").trim().match(NOUN);
    if (!m) continue;
    const noun = m[2];
    const k = noun.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: e.id, article: m[1].toLowerCase(), noun, en: e.en, text: e.text });
  }
  return out;
}

export function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Picks `n` items, preferring ones with more misses (weights 1 + misses × 2).
// `misses(id)` gives a count.
export function weightedPick(items, n, rng = Math.random, misses = () => 0) {
  const pool = items.map((it) => ({ it, w: 1 + 2 * Math.max(0, misses(it.id) || 0) }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let x = rng() * total;
    let i = 0;
    while (i < pool.length - 1 && x >= pool[i].w) { x -= pool[i].w; i += 1; }
    out.push(pool[i].it);
    pool.splice(i, 1);
  }
  return out;
}

// ── Listening ────────────────────────────────────────────────────────────────
// Up to `n - 1` other choices for a "which did you hear?" question: written
// differently from the target (and each other), same lesson first, then any.
export function listeningChoices(target, pool, n = 4, rng = Math.random) {
  const tk = plain(target.text);
  const used = new Set([tk]);
  const sameLesson = shuffle(pool.filter((e) => e.lesson === target.lesson), rng);
  const rest = shuffle(pool.filter((e) => e.lesson !== target.lesson), rng);
  const others = [];
  for (const e of [...sameLesson, ...rest]) {
    if (others.length >= n - 1) break;
    const k = plain(e.text);
    if (!k || used.has(k)) continue;
    used.add(k);
    others.push(e);
  }
  return shuffle([target, ...others], rng);
}

// Minimal pairs for the Sounds drill: words that differ by one sound learners
// mix up. Short/long vowels and the ui / u / oe / eu / ie families.
export const MINIMAL_PAIRS = Object.freeze([
  { a: { text: "man", en: "man" }, b: { text: "maan", en: "moon" }, sound: "a / aa" },
  { a: { text: "zon", en: "sun" }, b: { text: "zoon", en: "son" }, sound: "o / oo" },
  { a: { text: "kop", en: "cup" }, b: { text: "koop", en: "purchase" }, sound: "o / oo" },
  { a: { text: "pot", en: "pot" }, b: { text: "poot", en: "paw" }, sound: "o / oo" },
  { a: { text: "pen", en: "pen" }, b: { text: "peen", en: "carrot" }, sound: "e / ee" },
  { a: { text: "vis", en: "fish" }, b: { text: "vies", en: "dirty" }, sound: "i / ie" },
  { a: { text: "mus", en: "sparrow" }, b: { text: "muis", en: "mouse" }, sound: "u / ui" },
  { a: { text: "bus", en: "bus" }, b: { text: "buis", en: "tube" }, sound: "u / ui" },
  { a: { text: "boek", en: "book" }, b: { text: "buik", en: "belly" }, sound: "oe / ui" },
  { a: { text: "hoed", en: "hat" }, b: { text: "huid", en: "skin" }, sound: "oe / ui" },
  { a: { text: "tien", en: "ten" }, b: { text: "tuin", en: "garden" }, sound: "ie / ui" },
  { a: { text: "deur", en: "door" }, b: { text: "duur", en: "expensive" }, sound: "eu / uu" },
  { a: { text: "bed", en: "bed" }, b: { text: "bad", en: "bath" }, sound: "e / a" },
]);

// A Sounds question: one side of a pair is spoken; pick which you heard.
export function soundQuestion(pair, rng = Math.random) {
  const speakA = rng() < 0.5;
  return { pair, spoken: speakA ? pair.a : pair.b, choices: shuffle([pair.a, pair.b], rng) };
}
