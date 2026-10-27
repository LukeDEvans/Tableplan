// Fill in the blank (LANGUAGE_PRACTICE.md §22). Pure; randomness injected.
//
// From a sentence and the course's words, blank one word the learner knows
// (preferring words from the course over other content words) and keep the
// rest. Sources: your pasted sentences, the starter sentences, and sentences
// saved with words from your reading (whose English is the word's meaning).

import { plain, stripAccents, shuffle } from "./language-drills.js";

const STOP = new Set(("de het een en of maar dat die dit deze ik je jij u hij zij ze wij we jullie mijn jouw zijn haar ons onze hun " +
  "is was niet ook nog wel al er naar met van voor op in aan uit om bij te tot als dan heel veel geen wat waar hoe wie zo nu").split(" "));

const key = (s) => stripAccents(plain(s));
const bare = (text) => key(String(text || "").replace(/^(de|het|een)\s+/i, ""));

// "het brood," → { lead: "", word: "brood", trail: "," }
function splitToken(tok) {
  const m = String(tok).match(/^([«"“'‘(]*)(.*?)([.,!?;:»"”'’)…]*)$/);
  return m ? { lead: m[1], word: m[2], trail: m[3] } : { lead: "", word: tok, trail: "" };
}

// Build one blank from a sentence. `vocab` maps a bare form to its entry.
// Returns null when nothing in the sentence is worth blanking.
export function makeCloze(sentence, vocab, rng = Math.random, { preferForm = "" } = {}) {
  const text = String(sentence?.text || "").trim();
  if (!text) return null;
  const parts = text.split(/(\s+)/);
  const candidates = [];
  parts.forEach((p, i) => {
    if (!p.trim()) return;
    const t = splitToken(p);
    const k = key(t.word);
    if (!k || /\d/.test(k)) return;
    const entry = vocab.get(k) || null;
    const isForm = preferForm && k === key(preferForm);
    const content = k.length >= 4 && !STOP.has(k);
    if (isForm || entry || content) candidates.push({ i, t, entry, weight: isForm ? 100 : entry ? 10 : 1 });
  });
  if (!candidates.length) return null;
  const top = Math.max(...candidates.map((c) => c.weight));
  const best = candidates.filter((c) => c.weight === top);
  const pick = best[Math.floor(rng() * best.length)];
  const before = parts.slice(0, pick.i).join("") + pick.t.lead;
  const after = pick.t.trail + parts.slice(pick.i + 1).join("");
  return {
    id: `${sentence.id}:${pick.i}`,
    sentenceId: sentence.id,
    before,
    answer: pick.t.word,
    after,
    en: sentence.en || "",
    hint: sentence.hint || (pick.entry && pick.entry.en) || "",
    entryId: pick.entry?.id || sentence.entryId || "",
    first: pick.t.word.slice(0, 1),
    length: pick.t.word.length,
    full: text,
  };
}

// The vocabulary map for a set of entries (single words and "de/het + noun").
export function vocabMap(entries) {
  const m = new Map();
  for (const e of entries || []) {
    const b = bare(e.text);
    if (b && !b.includes(" ") && !m.has(b)) m.set(b, e);
  }
  return m;
}

// Sentences usable for blanks: course sentences (with their English), and
// reading examples saved with a word (`ex`, blanked on the word as it appeared).
export function clozeSources(sentences, entries) {
  const out = [];
  for (const s of sentences || []) if (s?.text && s.text.trim().split(/\s+/).length >= 3) out.push({ id: s.id, text: s.text, en: s.en, lesson: s.lesson });
  for (const e of entries || []) {
    if (e?.ex && e.ex.trim().split(/\s+/).length >= 3) out.push({ id: `${e.id}:ex`, text: e.ex, en: "", hint: e.en, entryId: e.id, form: e.w || "", lesson: e.lesson });
  }
  return out;
}

export function clozeRound(sources, entries, n = 10, rng = Math.random) {
  const vocab = vocabMap(entries);
  const out = [];
  for (const s of shuffle(sources, rng)) {
    if (out.length >= n) break;
    const c = makeCloze(s, vocab, rng, { preferForm: s.form });
    if (c) out.push(c);
  }
  return out;
}
