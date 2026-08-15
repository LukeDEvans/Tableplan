import { describe, it, expect } from "vitest";
import { createAccuracyTracker } from "../music/accuracy.js";

const on = (midi) => ({ type: "noteOn", note: { midi } });
const fs = (matched, measureIndex, skipped = 0) => ({ matched, skipped, position: { measureIndex } });

describe("accuracy tracker", () => {
  it("computes overall accuracy from matched vs total attempts", () => {
    const t = createAccuracyTracker();
    t.observe(fs(true, 0), on(60));
    t.observe(fs(true, 0), on(62));
    t.observe(fs(false, 0), on(99)); // wrong
    const s = t.summary();
    expect(s).toMatchObject({ played: 3, matched: 2, wrong: 1, accuracy: 0.67 });
  });

  it("counts skipped notes as missed", () => {
    const t = createAccuracyTracker();
    t.observe(fs(true, 0, 2), on(64)); // matched but jumped 2 notes
    expect(t.summary().missed).toBe(2);
  });

  it("ignores non-note events", () => {
    const t = createAccuracyTracker();
    t.observe(fs(false, 0), { type: "sustain" });
    t.observe(fs(false, 0), { type: "noteOff", note: { midi: 60 } });
    expect(t.count()).toBe(0);
  });

  it("flags trouble-spot measures (≥2 attempts, <60% correct), worst first", () => {
    const t = createAccuracyTracker();
    // measure 0: 3/3 correct — fine
    for (const m of [60, 62, 64]) t.observe(fs(true, 0), on(m));
    // measure 1: 1/3 correct — trouble
    t.observe(fs(true, 1), on(65)); t.observe(fs(false, 1), on(9)); t.observe(fs(false, 1), on(8));
    // measure 2: 0/2 correct — worse trouble
    t.observe(fs(false, 2), on(1)); t.observe(fs(false, 2), on(2));
    const s = t.summary();
    expect(s.troubleSpots).toEqual([2, 1]); // worst (measure 2) first
  });

  it("resets cleanly", () => {
    const t = createAccuracyTracker();
    t.observe(fs(true, 0), on(60));
    t.reset();
    expect(t.summary()).toMatchObject({ played: 0, matched: 0, troubleSpots: [] });
  });
});
