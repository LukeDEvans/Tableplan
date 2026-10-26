import { describe, it, expect } from "vitest";
import {
  parsePaste, splitLine, looksLikeSentence, genderOf, upsertUserLesson, addPastedWords,
  mergeUserWords, mergeUserLessons, deleteUserWord, deleteUserLesson, editUserWord, buildCourse,
  entriesInCourseOrder, userLessonId, normalizeUserWords,
} from "../language-words.js";
import { DUTCH_COURSE } from "../language-nl-starter.js";
import { STARTER_SENTENCES } from "../language-nl-sentences.js";
import { validateCourse } from "../language-curriculum.js";
import { seededRng } from "../language-match.js";

describe("language-words: pasting", () => {
  it("splits on tab, =, dashes and spaced colons/hyphens, but not inside a word", () => {
    expect(splitLine("de man\tman")).toEqual({ left: "de man", right: "man" });
    expect(splitLine("de man = man")).toEqual({ left: "de man", right: "man" });
    expect(splitLine("de man — the man")).toEqual({ left: "de man", right: "the man" });
    expect(splitLine("de e-mail - email")).toEqual({ left: "de e-mail", right: "email" });
    expect(splitLine("Waar is …?")).toEqual({ left: "Waar is …?", right: "" });
    expect(splitLine("1. de kat : cat")).toEqual({ left: "de kat", right: "cat" });
    expect(splitLine("   ")).toBeNull();
  });

  it("reads alternatives, gender, sentences and errors", () => {
    const items = parsePaste("de hond = dog\nhet meisje = girl\nlopen = to walk; to go\nHoe gaat het? = How are you?\nzomaar\nja = ja\n");
    expect(items.map((i) => i.text)).toEqual(["de hond", "het meisje", "lopen", "Hoe gaat het?", "zomaar", "ja"]);
    expect(items[0]).toMatchObject({ en: "dog", gender: "de", kind: "word" });
    expect(items[1].gender).toBe("het");
    expect(items[2]).toMatchObject({ en: "to walk", alsoEn: ["to go"] });
    expect(items[3]).toMatchObject({ kind: "sentence", gender: "" });
    expect(items[4].error).toBe("no-english");
    expect(items[5].error).toBe("same");
  });

  it("sentence detection keeps short phrases as words", () => {
    expect(looksLikeSentence("dank je wel")).toBe(false);
    expect(looksLikeSentence("Ik woon in Amsterdam")).toBe(true);
    expect(looksLikeSentence("Hoe heet je?")).toBe(true);
    expect(looksLikeSentence("Waar is …")).toBe(false);
    expect(genderOf("de man is groot.")).toBe("");
  });
});

describe("language-words: lessons and words", () => {
  const rng = seededRng(7);
  it("adds a lesson by unit and lesson number, with titles, and shares the unit title", () => {
    let { lessons, id } = upsertUserLesson({}, { unit: 2, lesson: 1, unitTitle: "Greetings", title: "Hello" }, "2026-10-26T10:00:00Z");
    expect(id).toBe(userLessonId(2, 1));
    ({ lessons } = upsertUserLesson(lessons, { unit: 2, lesson: 2 }, "2026-10-26T10:01:00Z"));
    expect(lessons["nl-u2-2"].unitTitle).toBe("Greetings");
    ({ lessons } = upsertUserLesson(lessons, { unit: 2, lesson: 2, unitTitle: "Meeting people" }, "2026-10-26T10:02:00Z"));
    expect(lessons["nl-u2-1"].unitTitle).toBe("Meeting people");
    expect(lessons["nl-u2-1"].title).toBe("Hello");
    expect(upsertUserLesson({}, { unit: 0, lesson: 1 }, "x").id).toBe("");
  });

  it("adds pasted words, skipping errors and duplicates in the lesson", () => {
    const items = parsePaste("de hond = dog\nde kat = cat\nde hond = hound\nnope");
    const { words, added, skipped } = addPastedWords({}, "nl-u1-1", items, { at: "t1", rng, now: 1000 });
    expect(added.length).toBe(2);
    expect(skipped.map((s) => s.reason)).toEqual(["duplicate", "no-english"]);
    expect(Object.values(words).map((w) => w.text)).toEqual(["de hond", "de kat"]);
    expect(new Set(added).size).toBe(2);
  });

  it("edits and deletes with tombstones that win a merge", () => {
    const { words, added } = addPastedWords({}, "nl-u1-1", parsePaste("de hond = dog"), { at: "2026-10-26T10:00:00Z", rng, now: 1 });
    const id = added[0];
    const edited = editUserWord(words, id, { en: "the dog" }, "2026-10-26T11:00:00Z");
    expect(edited[id].en).toBe("the dog");
    const gone = deleteUserWord(edited, id, "2026-10-26T12:00:00Z");
    expect(gone[id].del).toBe(true);
    expect(mergeUserWords(words, gone)[id].del).toBe(true); // the stale copy can't revive it
    expect(mergeUserWords(gone, words)[id].del).toBe(true);
  });

  it("a missing id is never a deletion", () => {
    const { words } = addPastedWords({}, "nl-u1-1", parsePaste("de hond = dog"), { at: "t", rng, now: 2 });
    expect(Object.keys(mergeUserWords({}, words)).length).toBe(1);
    expect(Object.keys(mergeUserLessons({}, { "nl-u1-1": { unit: 1, lesson: 1, at: "t" } })).length).toBe(1);
  });

  it("deleting a lesson removes its words", () => {
    const { lessons } = upsertUserLesson({}, { unit: 1, lesson: 1 }, "t1");
    const { words } = addPastedWords({}, "nl-u1-1", parsePaste("de hond = dog\nde kat = cat"), { at: "t1", rng, now: 3 });
    const out = deleteUserLesson(lessons, words, "nl-u1-1", "t2");
    expect(out.lessons["nl-u1-1"].del).toBe(true);
    expect(Object.values(out.words).every((w) => w.del)).toBe(true);
  });

  it("normalizing drops junk and live words missing a side", () => {
    expect(normalizeUserWords({ a: { text: "x", en: "", lesson: "l" }, b: { text: "x", en: "y", lesson: "" }, c: { text: "x", en: "y", lesson: "l", at: "t" } })).toEqual({ c: { kind: "word", text: "x", en: "y", lesson: "l", at: "t" } });
  });
});

describe("language-words: the course", () => {
  const rng = seededRng(3);
  const setup = () => {
    let { lessons } = upsertUserLesson({}, { unit: 1, lesson: 2, title: "Food" }, "t");
    ({ lessons } = upsertUserLesson(lessons, { unit: 1, lesson: 1, unitTitle: "Basics" }, "t"));
    let { words } = addPastedWords({}, "nl-u1-2", parsePaste("het brood = bread\nIk eet brood. = I eat bread."), { at: "t", rng, now: 10 });
    ({ words } = addPastedWords(words, "nl-u1-1", parsePaste("de jongen = boy\nhet meisje = girl"), { at: "t", rng, now: 20 }));
    return { lessons, words };
  };

  it("your lessons come first, in unit/lesson order, and sentences are kept apart", () => {
    const { lessons, words } = setup();
    const c = buildCourse(DUTCH_COURSE, lessons, words, { showStarter: true, starterSentences: STARTER_SENTENCES });
    expect(c.levels[0].title).toBe("Your course");
    expect(c.levels[0].units[0].title).toBe("Unit 1: Basics");
    expect(c.levels[0].units[0].lessons.map((l) => l.title)).toEqual(["Lesson 1", "Lesson 2: Food"]);
    expect(entriesInCourseOrder(c).slice(0, 3).map((e) => e.text)).toEqual(["de jongen", "het meisje", "het brood"]);
    expect(c.sentences[0].text).toBe("Ik eet brood.");
    expect(c.sentences.length).toBe(1 + STARTER_SENTENCES.length);
    expect(validateCourse(c)).toEqual([]);
  });

  it("the starter set can be hidden once you have your own lessons", () => {
    const { lessons, words } = setup();
    const c = buildCourse(DUTCH_COURSE, lessons, words, { showStarter: false, starterSentences: STARTER_SENTENCES });
    expect(c.levels.length).toBe(1);
    expect(c.entries.every((e) => e.user)).toBe(true);
    expect(c.sentences.length).toBe(1);
    // With no lessons of your own, the starter set always shows.
    expect(buildCourse(DUTCH_COURSE, {}, {}, { showStarter: false }).entries.length).toBe(DUTCH_COURSE.entries.length);
  });

  it("starter sentences point at real starter lessons", () => {
    const lessonIds = new Set(DUTCH_COURSE.levels[0].units.flatMap((u) => u.lessons.map((l) => l.id)));
    for (const s of STARTER_SENTENCES) expect(lessonIds.has(s.lesson)).toBe(true);
    expect(new Set(STARTER_SENTENCES.map((s) => s.id)).size).toBe(STARTER_SENTENCES.length);
  });
});
