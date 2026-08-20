import { describe, it, expect } from "vitest";
import { makeSection, sectionContains, sectionTag, sectionStats } from "../music/section.js";

describe("makeSection", () => {
  it("normalizes a 1-based inclusive range with a default label", () => {
    const s = makeSection({ workId: "w1", startMeasure: 42, endMeasure: 57 });
    expect(s).toMatchObject({ workId: "w1", startMeasure: 42, endMeasure: 57, label: "Measures 42–57", targetTempo: null });
    expect(s.id).toMatch(/^sec_/);
  });
  it("guards a bad range (end ≥ start ≥ 1) and parses target tempo", () => {
    expect(makeSection({ startMeasure: 0, endMeasure: -3 })).toMatchObject({ startMeasure: 1, endMeasure: 1 });
    expect(makeSection({ startMeasure: 10, endMeasure: 4 })).toMatchObject({ startMeasure: 10, endMeasure: 10 });
    expect(makeSection({ startMeasure: 1, endMeasure: 4, targetTempo: "96" }).targetTempo).toBe(96);
    expect(makeSection({ startMeasure: 1, endMeasure: 4, targetTempo: "" }).targetTempo).toBe(null);
  });
});

describe("sectionContains", () => {
  const s = makeSection({ startMeasure: 42, endMeasure: 57 });
  it("tests inclusive 1-based membership", () => {
    expect(sectionContains(s, 42)).toBe(true);
    expect(sectionContains(s, 57)).toBe(true);
    expect(sectionContains(s, 41)).toBe(false);
    expect(sectionContains(s, 58)).toBe(false);
  });
});

describe("sectionStats — deliberate-practice progress", () => {
  const section = makeSection({ id: "sec_A", workId: "w1", startMeasure: 42, endMeasure: 57, targetTempo: 100 });
  const sess = (id, tempo, accuracy, taggedWith) => ({
    id, startedAt: `2026-08-${id}`,
    sectionsPracticed: taggedWith ? [{ sectionId: taggedWith, startMeasure: 42, endMeasure: 57 }] : [],
    metrics: [tempo != null && { type: "tempo", value: tempo }, accuracy != null && { type: "accuracy", value: accuracy }].filter(Boolean),
  });

  it("aggregates only sessions tagged with this section", () => {
    const sessions = [ // newest first
      sess("13", 96, 0.9, "sec_A"),
      sess("12", 80, 0.7, "sec_A"),
      sess("11", 999, 1, "sec_OTHER"),  // different section — ignored
      sess("10", 60, 0.5, null),        // untagged — ignored
    ];
    const st = sectionStats(section, sessions);
    expect(st.attempts).toBe(2);
    expect(st.bestTempo).toBe(96);
    expect(st.lastTempo).toBe(96);       // newest tagged session
    expect(st.bestAccuracy).toBe(0.9);
    expect(st.targetReached).toBe(false); // 96 < 100
    expect(st.tempoProgress).toBeCloseTo(0.96, 5);
  });

  it("marks the target reached once best tempo meets it", () => {
    const st = sectionStats(section, [sess("14", 104, 0.95, "sec_A")]);
    expect(st.targetReached).toBe(true);
    expect(st.tempoProgress).toBe(1); // capped
  });

  it("is empty for a section never practiced", () => {
    expect(sectionStats(section, [])).toMatchObject({ attempts: 0, bestTempo: null, targetReached: false });
  });
});

describe("sectionTag", () => {
  it("produces the compact tag stored on a session", () => {
    const s = makeSection({ id: "sec_A", startMeasure: 42, endMeasure: 57 });
    expect(sectionTag(s)).toEqual({ sectionId: "sec_A", startMeasure: 42, endMeasure: 57 });
  });
});
