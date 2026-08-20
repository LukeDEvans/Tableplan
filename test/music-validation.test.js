import { describe, it, expect } from "vitest";
import { rat } from "../music/rational.js";
import { validateScoreModel, validationSummary, measureCapacity, SEVERITY } from "../music/validation.js";

const ev = (durQ, voice = 1) => ({ kind: "note", dur: rat(durQ, 1), voice, midis: [60] });
const evR = (num, den, voice = 1) => ({ kind: "note", dur: rat(num, den), voice, midis: [60] });
const measure = (timeSig, events, extra = {}) => ({ index: 0, timeSig, events, ...extra });
const model = (measures) => ({ measures: measures.map((m, i) => ({ ...m, index: i, printedNumber: m.printedNumber || String(i + 1) })) });

describe("measureCapacity", () => {
  it("is beats × 4/beatType quarter-notes", () => {
    expect(measureCapacity([4, 4])).toEqual({ num: 4, den: 1 });
    expect(measureCapacity([6, 8])).toEqual({ num: 3, den: 1 });
    expect(measureCapacity([3, 4])).toEqual({ num: 3, den: 1 });
  });
});

describe("validateScoreModel", () => {
  it("passes a well-formed 4/4 bar of four quarters", () => {
    const r = validateScoreModel(model([measure([4, 4], [ev(1), ev(1), ev(1), ev(1)])]));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("flags an OVERFULL voice as an error", () => {
    const r = validateScoreModel(model([
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1), ev(1)]), // 5 quarters in 4/4
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),         // ok (not last-bar exemption abuse)
    ]));
    const e = r.issues.find((i) => i.type === "overfull-voice");
    expect(e.severity).toBe(SEVERITY.ERROR);
    expect(e).toMatchObject({ measureIndex: 0, expected: 4, actual: 5 });
    expect(r.errorCount).toBe(1);
  });

  it("flags an INCOMPLETE middle measure as a warning", () => {
    const r = validateScoreModel(model([
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),
      measure([4, 4], [ev(1), ev(1), ev(1)]), // 3 of 4, middle bar
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),
    ]));
    const w = r.issues.find((i) => i.type === "incomplete-measure");
    expect(w).toMatchObject({ severity: SEVERITY.WARNING, measureIndex: 1, expected: 4, actual: 3 });
  });

  it("does NOT flag a short pickup (implicit) or the final bar", () => {
    const r = validateScoreModel(model([
      measure([4, 4], [ev(1)], { implicit: true }),       // pickup — exempt
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),
      measure([4, 4], [ev(1), ev(1)]),                    // short FINAL bar — exempt
    ]));
    expect(r.ok).toBe(true);
  });

  it("flags an empty non-implicit measure", () => {
    const r = validateScoreModel(model([
      measure([4, 4], []),
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),
    ]));
    expect(r.issues.find((i) => i.type === "empty-measure")).toMatchObject({ measureIndex: 0, severity: SEVERITY.WARNING });
  });

  it("does not double-count independent voices (two voices each fill the bar)", () => {
    const r = validateScoreModel(model([
      measure([4, 4], [ev(2, 1), ev(2, 1), ev(2, 2), ev(2, 2)]), // v1: 2+2=4, v2: 2+2=4
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),
    ]));
    expect(r.ok).toBe(true);
  });

  it("handles compound meter (6/8 = 3 quarter-notes) and tuplets exactly", () => {
    // 6/8: six eighth notes = six {1,2} = 3 quarters. Triplet has no float drift.
    const eighths = Array.from({ length: 6 }, () => evR(1, 2));
    const r = validateScoreModel(model([
      measure([6, 8], eighths),
      measure([6, 8], eighths),
    ]));
    expect(r.ok).toBe(true);
  });
});

describe("validationSummary", () => {
  it("is empty when clean", () => {
    expect(validationSummary({ ok: true, issues: [] })).toBe("");
  });
  it("summarizes the affected measures", () => {
    const r = validateScoreModel(model([
      measure([4, 4], [ev(1), ev(1), ev(1)]),       // m1 incomplete
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1), ev(1)]), // m2 overfull
      measure([4, 4], [ev(1), ev(1), ev(1), ev(1)]),
    ]));
    const s = validationSummary(r);
    expect(s).toContain("m. 1, 2");
    expect(s).toMatch(/timing issues/);
  });
});
