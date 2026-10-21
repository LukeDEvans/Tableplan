import { describe, it, expect } from "vitest";
import {
  validateCourse, resolveScope, reviewLessonIds, lessonStatus, lessonsInOrder,
  normalizeForm, scopeKey, VERIFICATION,
} from "../language-curriculum.js";
import { DUTCH_COURSE } from "../language-nl-starter.js";

const tiny = () => ({
  lang: "nl",
  sources: {
    own: { kind: "original", title: "t", retrieved: "2026-10-20", curriculumVersion: null },
    rs: { kind: "rosetta-stone", title: "RS", retrieved: "2026-11-02", curriculumVersion: "2026-11" },
  },
  levels: [{ id: "L", title: "L", units: [
    { id: "U1", title: "U1", lessons: [{ id: "A", title: "A" }, { id: "B", title: "B" }] },
    { id: "U2", title: "U2", lessons: [{ id: "C", title: "C" }] },
  ] }],
  entries: [
    { id: "a1", lang: "nl", text: "de hond", en: "dog", level: "L", unit: "U1", lesson: "A", source: "own", verification: "provisional" },
    { id: "b1", lang: "nl", text: "de kat", en: "cat", level: "L", unit: "U1", lesson: "B", source: "own", verification: "provisional" },
    { id: "c1", lang: "nl", text: "het huis", en: "house", level: "L", unit: "U2", lesson: "C", source: "rs", verification: "verified" },
  ],
});

describe("language-curriculum: the shipped Dutch course", () => {
  it("is valid", () => {
    expect(validateCourse(DUTCH_COURSE)).toEqual([]);
  });
  it("is all provisional, with no Rosetta Stone source", () => {
    expect(DUTCH_COURSE.entries.length).toBeGreaterThan(150);
    expect(DUTCH_COURSE.entries.every((e) => e.verification === VERIFICATION.PROVISIONAL)).toBe(true);
    expect(Object.values(DUTCH_COURSE.sources).some((s) => s.kind === "rosetta-stone")).toBe(false);
  });
  it("every lesson has at least five words, so a full board is possible", () => {
    for (const l of lessonsInOrder(DUTCH_COURSE)) {
      expect(DUTCH_COURSE.entries.filter((e) => e.lesson === l.id).length, l.id).toBeGreaterThanOrEqual(5);
    }
  });
  it("ids are the stable lesson-number form", () => {
    for (const e of DUTCH_COURSE.entries) expect(e.id).toMatch(/^nl-s\d+-\d+-\d{2}$/);
  });
});

describe("language-curriculum: validation", () => {
  it("accepts a sound course", () => expect(validateCourse(tiny())).toEqual([]));

  it("refuses a provisional source claiming verified", () => {
    const c = tiny();
    c.entries[0].verification = "verified";
    expect(validateCourse(c).join()).toMatch(/verified needs a rosetta-stone source/);
  });

  it("refuses a Rosetta Stone source without a version", () => {
    const c = tiny();
    c.sources.rs.curriculumVersion = null;
    expect(validateCourse(c).join()).toMatch(/curriculumVersion/);
  });

  it("refuses a Rosetta Stone entry left provisional", () => {
    const c = tiny();
    c.entries[2].verification = "provisional";
    expect(validateCourse(c).join()).toMatch(/must be marked verified/);
  });

  it("catches duplicate ids, wrong lessons, wrong language, and look-alike answers in one lesson", () => {
    const c = tiny();
    c.entries.push({ ...c.entries[0] });
    c.entries.push({ id: "x", lang: "fr", text: "chien", en: "Dog!", level: "L", unit: "U1", lesson: "A", source: "own", verification: "provisional" });
    c.entries.push({ id: "y", lang: "nl", text: "z", en: "z2", level: "L", unit: "U2", lesson: "A", source: "own", verification: "provisional" });
    c.entries.push({ id: "z", lang: "nl", text: "taxi", en: "Taxi", level: "L", unit: "U1", lesson: "B", source: "own", verification: "provisional" });
    const errs = validateCourse(c).join("\n");
    expect(errs).toMatch(/duplicate id/);
    expect(errs).toMatch(/lang "fr"/);
    expect(errs).toMatch(/English "dog" appears twice/);
    expect(errs).toMatch(/don't match lesson/);
    expect(errs).toMatch(/nothing to match/);
  });

  it("normalizes forms for comparison", () => {
    expect(normalizeForm("To walk")).toBe("walk");
    expect(normalizeForm("Hoe gaat het?")).toBe("hoe gaat het");
    expect(normalizeForm("één")).not.toBe(normalizeForm("een"));
  });
});

describe("language-curriculum: scopes", () => {
  it("a lesson draws only from that lesson", () => {
    expect(resolveScope(tiny(), { kind: "lesson", id: "A" }).map((e) => e.id)).toEqual(["a1"]);
  });
  it("a unit draws from all its lessons and nothing else", () => {
    expect(resolveScope(tiny(), { kind: "unit", id: "U1" }).map((e) => e.id)).toEqual(["a1", "b1"]);
  });
  it("a review draws only from the lessons it names", () => {
    expect(resolveScope(tiny(), { kind: "review", lessonIds: ["B", "C"] }).map((e) => e.id)).toEqual(["b1", "c1"]);
    expect(resolveScope(tiny(), { kind: "review", lessonIds: [] })).toEqual([]);
    expect(resolveScope(tiny(), { kind: "nonsense" })).toEqual([]);
  });
  it("review lessons are the practiced ones, in course order", () => {
    expect(reviewLessonIds(tiny(), { c1: { seen: 1 }, a1: { seen: 2 }, b1: { seen: 0 } })).toEqual(["A", "C"]);
    expect(reviewLessonIds(tiny(), null)).toEqual([]);
  });
  it("lesson status counts seen and matched words", () => {
    const s = lessonStatus(tiny(), "C", { c1: { seen: 2, c: 1, last: "2026-10-20T10:00:00Z" } });
    expect(s).toEqual({ total: 1, seen: 1, matched: 1, last: "2026-10-20T10:00:00Z", verified: true });
    expect(lessonStatus(tiny(), "A", {}).verified).toBe(false);
  });
  it("scope keys are stable", () => {
    expect(scopeKey({ kind: "lesson", id: "A" })).toBe("lesson:A");
    expect(scopeKey({ kind: "review", lessonIds: ["A"] })).toBe("review");
  });
});
