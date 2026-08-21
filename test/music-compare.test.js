import { describe, it, expect } from "vitest";
import { attemptSummary, comparePerformances, comparisonHeadline } from "../music/compare.js";

// A session as the practice layer stores it: versioned metrics[].
const session = (id, { accuracy, tempo, tempoByMeasure, troubleSpots }) => ({
  id, startedAt: `2026-08-0${id}`, durationMs: 120000,
  metrics: [
    accuracy != null && { type: "accuracy", value: accuracy },
    tempo != null && { type: "tempo", value: tempo },
    tempoByMeasure && { type: "tempoByMeasure", value: tempoByMeasure },
    troubleSpots && { type: "troubleSpots", value: troubleSpots },
  ].filter(Boolean),
});

describe("attemptSummary", () => {
  it("pulls the compact attempt shape out of a session's metrics", () => {
    const s = attemptSummary(session(1, { accuracy: 0.8, tempo: 90, tempoByMeasure: { 0: 88 }, troubleSpots: [3, 5] }));
    expect(s).toMatchObject({ id: 1, accuracy: 0.8, avgTempo: 90, troubleSpots: [3, 5] });
    expect(s.tempoByMeasure).toEqual({ 0: 88 });
  });
  it("tolerates a manual session with no follow metrics", () => {
    const s = attemptSummary({ id: 9, metrics: [] });
    expect(s).toMatchObject({ accuracy: null, avgTempo: null, troubleSpots: [] });
  });
});

describe("comparePerformances (earlier a → later b, positive = improved)", () => {
  const a = attemptSummary(session(1, { accuracy: 0.72, tempo: 84, tempoByMeasure: { 0: 80, 1: 88, 2: 84 }, troubleSpots: [1, 2] }));
  const b = attemptSummary(session(2, { accuracy: 0.9, tempo: 102, tempoByMeasure: { 0: 100, 1: 104, 3: 96 }, troubleSpots: [3] }));
  const cmp = comparePerformances(a, b);

  it("computes average tempo and accuracy deltas", () => {
    expect(cmp.avgTempoDelta).toBe(18);        // 102 − 84  (the brief's "+18 BPM")
    expect(cmp.accuracyDelta).toBe(0.18);      // 0.9 − 0.72
  });
  it("diffs tempo per measure over the union of measures", () => {
    const m1 = cmp.tempoByMeasure.find((x) => x.measureIndex === 1);
    expect(m1).toEqual({ measureIndex: 1, a: 88, b: 104, delta: 16 });
    const m2 = cmp.tempoByMeasure.find((x) => x.measureIndex === 2); // only in a
    expect(m2).toEqual({ measureIndex: 2, a: 84, b: null, delta: null });
  });
  it("reports resolved and newly-appeared trouble spots", () => {
    expect(cmp.troubleResolved).toEqual([1, 2]); // troubled before, clean now
    expect(cmp.troubleNew).toEqual([3]);         // regressed
  });
});

describe("comparisonHeadline", () => {
  it("writes the human one-liner", () => {
    const a = attemptSummary(session(1, { accuracy: 0.72, tempo: 84, troubleSpots: [1, 2] }));
    const b = attemptSummary(session(2, { accuracy: 0.9, tempo: 102, troubleSpots: [] }));
    const h = comparisonHeadline(comparePerformances(a, b));
    expect(h).toContain("+18 BPM");
    expect(h).toContain("+18% accuracy");
    expect(h).toContain("resolved 2 trouble spots");
  });
  it("stays quiet when nothing meaningful changed", () => {
    const a = attemptSummary(session(1, { accuracy: 0.9, tempo: 100 }));
    const b = attemptSummary(session(2, { accuracy: 0.9, tempo: 100 }));
    expect(comparisonHeadline(comparePerformances(a, b))).toBe("");
  });
});
