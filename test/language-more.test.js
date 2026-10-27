import { describe, it, expect } from "vitest";
import { makeCloze, vocabMap, clozeSources, clozeRound } from "../language-cloze.js";
import { WORD_ORDER_ITEMS, WORD_ORDER_RULES } from "../language-nl-wordorder.js";
import { sentenceTokens, checkSentence } from "../language-sentences.js";
import { normalizeNotes, mergeNotes, setNote } from "../language-progress.js";
import { problemWordIds, lapsesOf, LEECH_LAPSES } from "../language-srs.js";
import { addReadingWord, buildCourse, READ_LESSON_ID, entriesInCourseOrder, normalizeUserWords } from "../language-words.js";
import { tokenizeParagraph, relativeTime } from "../language-ui-more.js";
import { validateCourse } from "../language-curriculum.js";
import { DUTCH_COURSE } from "../language-nl-starter.js";
import { STARTER_SENTENCES } from "../language-nl-sentences.js";
import { seededRng } from "../language-match.js";

describe("fill in the blank", () => {
  const vocab = vocabMap([{ id: "e1", text: "het brood", en: "bread" }, { id: "e2", text: "eten", en: "to eat" }]);
  it("blanks a course word, keeping punctuation around it", () => {
    const c = makeCloze({ id: "s1", text: "Wij eten brood.", en: "We eat bread." }, vocab, seededRng(1));
    expect(["eten", "brood"]).toContain(c.answer);
    expect(c.before + c.answer + c.after).toBe("Wij eten brood.");
    expect(c.entryId).toMatch(/^e[12]$/);
    expect(c.en).toBe("We eat bread.");
  });
  it("falls back to a content word, never a little word", () => {
    const c = makeCloze({ id: "s2", text: "Ik ga naar de markt.", en: "" }, vocab, seededRng(2));
    expect(c.answer).toBe("markt");
    expect(makeCloze({ id: "s3", text: "Ik ga.", en: "" }, vocab, seededRng(2))).toBeNull();
  });
  it("a reading example blanks the word as it appeared, with its meaning as the hint", () => {
    const src = clozeSources([], [{ id: "r1", text: "lopen", en: "to walk", ex: "Hij liep naar school.", w: "liep", lesson: READ_LESSON_ID }]);
    const c = makeCloze(src[0], new Map(), seededRng(3), { preferForm: src[0].form });
    expect(c).toMatchObject({ answer: "liep", hint: "to walk", entryId: "r1" });
  });
  it("a round over the starter sentences", () => {
    const r = clozeRound(clozeSources(STARTER_SENTENCES, []), DUTCH_COURSE.entries, 10, seededRng(4));
    expect(r.length).toBe(10);
    for (const c of r) expect(c.before + c.answer + c.after).toBe(c.full);
  });
});

describe("word order data", () => {
  it("every item rebuilds, its fixed start is shorter than the sentence, and its rule exists", () => {
    const ids = new Set();
    for (const it of WORD_ORDER_ITEMS) {
      const toks = sentenceTokens(it.text);
      expect(WORD_ORDER_RULES[it.rule], it.id).toBeTruthy();
      expect(it.start).toBeLessThan(toks.length - 1);
      expect(checkSentence(toks, it).ok).toBe(true);
      expect(ids.has(it.id)).toBe(false);
      ids.add(it.id);
    }
    expect(WORD_ORDER_ITEMS.length).toBeGreaterThanOrEqual(30);
  });
  it("swapping verb and subject is wrong", () => {
    const it = WORD_ORDER_ITEMS.find((x) => x.text === "Morgen werk ik thuis.");
    expect(checkSentence(["morgen", "ik", "werk", "thuis"], it).ok).toBe(false);
  });
});

describe("notes and problem words", () => {
  it("later note wins; a cleared note stays cleared", () => {
    const a = setNote({}, "w1", "sounds like bread", "2026-10-26T10:00:00Z");
    const b = setNote(a, "w1", "", "2026-10-26T11:00:00Z");
    expect(mergeNotes(a, b).w1.text).toBe("");
    expect(mergeNotes(b, a).w1.text).toBe("");
    expect(normalizeNotes({ x: "bad", y: { text: " a  b ", at: "t" } })).toEqual({ y: { text: "a b", at: "t" } });
  });
  it("words whose card lapsed 4+ times are problem words, worst first", () => {
    const cards = { "a|r": [2, 7, 1, 1, 9, LEECH_LAPSES, 1], "b|p": [2, 7, 1, 1, 9, 6, 1], "c|r": [2, 7, 1, 1, 9, 3, 1], "d|s": [2, 7, 1, 1, 9, 9, 1] };
    expect(problemWordIds(cards)).toEqual(["b", "a"]);
    expect(lapsesOf(cards, "b")).toBe(6);
  });
});

describe("words saved while reading", () => {
  it("adds once, into the reading lesson, and the course shows them", () => {
    const at = "2026-10-26T12:00:00Z";
    const r1 = addReadingWord({}, { text: "de school", en: "school", ex: "Pep trakteert op school.", w: "school", src: "Pep" }, { at, rng: seededRng(5), now: 1 });
    expect(r1.existed).toBe(false);
    const r2 = addReadingWord(r1.words, { text: "De school", en: "school" }, { at, rng: seededRng(5), now: 2 });
    expect(r2).toMatchObject({ existed: true, id: r1.id });
    const w = normalizeUserWords(r1.words)[r1.id];
    expect(w).toMatchObject({ lesson: READ_LESSON_ID, ex: "Pep trakteert op school.", w: "school", src: "Pep" });
    const c = buildCourse(DUTCH_COURSE, {}, r1.words, { showStarter: true, starterSentences: STARTER_SENTENCES });
    expect(c.levels[0].title).toBe("From your reading");
    expect(entriesInCourseOrder(c)[0].text).toBe("de school");
    expect(validateCourse(c)).toEqual([]);
  });
});

describe("reader text", () => {
  it("splits sentences and words, keeping every character", () => {
    const p = "Pep (12) heeft gewonnen! Hij bakt een taart, voor de klas.";
    const sents = tokenizeParagraph(p);
    expect(sents.length).toBe(2);
    const rebuilt = sents.map((s) => s.map((t) => t.word ? `${t.lead}${t.word}${t.trail}` : t.space || t.punct).join("")).join("");
    expect(rebuilt).toBe(p);
    expect(sents[1].filter((t) => t.word).map((t) => t.word)).toEqual(["Hij", "bakt", "een", "taart", "voor", "de", "klas"]);
    expect(sents[0].find((t) => t.word === "12")).toMatchObject({ lead: "(", trail: ")" });
  });
  it("relative times", () => {
    const now = Date.parse("2026-10-26T14:00:00Z");
    expect(relativeTime("2026-10-26T13:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-26T10:00:00Z", now)).toBe("4 h ago");
    expect(relativeTime("", now)).toBe("");
  });
});
