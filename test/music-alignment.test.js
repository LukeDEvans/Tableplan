import { describe, it, expect } from "vitest";
import { rat } from "../music/rational.js";
import { makePosition } from "../music/position.js";
import { absQuarters, buildAlignment, averageTempo, tempoCurve, tempoByMeasure, timeAtPosition, positionAtTime } from "../music/alignment.js";

const ctx = { workId: "w", movementId: "m", editionId: "e" };
// Two 4/4 measures = 4 quarters each.
const model = {
  measures: [
    { index: 0, timeSig: [4, 4], durationQuarters: { num: 4, den: 1 } },
    { index: 1, timeSig: [4, 4], durationQuarters: { num: 4, den: 1 } },
  ],
};
const pos = (measureIndex, offNum) => makePosition({ ...ctx, measureIndex, offset: rat(offNum, 1) });

describe("absQuarters", () => {
  it("accumulates preceding measure durations + within-measure offset", () => {
    expect(absQuarters(model, pos(0, 0))).toBe(0);
    expect(absQuarters(model, pos(0, 2))).toBe(2);
    expect(absQuarters(model, pos(1, 0))).toBe(4);   // after one 4-quarter bar
    expect(absQuarters(model, pos(1, 3))).toBe(7);
  });
});

describe("buildAlignment", () => {
  it("keeps a strictly forward spine (drops non-advancing / backward samples)", () => {
    const samples = [
      { position: pos(0, 0), tMs: 0 },
      { position: pos(0, 1), tMs: 500 },
      { position: pos(0, 1), tMs: 700 },   // no q advance → dropped
      { position: pos(0, 0), tMs: 900 },   // backward q → dropped
      { position: pos(1, 0), tMs: 2000 },
    ];
    const al = buildAlignment(samples, model, ctx);
    expect(al.points.map((p) => p.q)).toEqual([0, 1, 4]);
    expect(al.points.map((p) => p.tMs)).toEqual([0, 500, 2000]);
    expect(al.durationQuarters).toBe(4);
    expect(al.durationMs).toBe(2000);
  });
});

describe("averageTempo", () => {
  it("is quarter-notes-per-minute across the whole capture", () => {
    // 4 quarters in 2000 ms = 4 / (2/60) = 120 BPM
    const al = buildAlignment([{ position: pos(0, 0), tMs: 0 }, { position: pos(1, 0), tMs: 2000 }], model, ctx);
    expect(averageTempo(al)).toBe(120);
  });
  it("is null when indeterminate", () => {
    expect(averageTempo(buildAlignment([{ position: pos(0, 0), tMs: 0 }], model, ctx))).toBe(null);
  });
});

describe("tempoCurve", () => {
  it("reports local BPM per segment (catches a rush then a drag)", () => {
    const samples = [
      { position: pos(0, 0), tMs: 0 },
      { position: pos(0, 2), tMs: 500 },   // 2 q in 0.5s → 240 BPM (rushed)
      { position: pos(1, 0), tMs: 2500 },  // 2 q in 2.0s → 60 BPM (dragged)
    ];
    const curve = tempoCurve(buildAlignment(samples, model, ctx));
    expect(curve.map((c) => c.bpm)).toEqual([240, 60]);
    expect(curve[0].measureIndex).toBe(0);
    expect(curve[1].measureIndex).toBe(1);
  });
});

describe("tempoByMeasure", () => {
  it("gives a median local BPM per measure (the per-take spine for comparison)", () => {
    const samples = [
      { position: pos(0, 0), tMs: 0 },
      { position: pos(0, 2), tMs: 500 },   // measure 0 segment → 240 BPM
      { position: pos(1, 0), tMs: 2500 },  // measure 1 segment → 60 BPM
    ];
    const tbm = tempoByMeasure(buildAlignment(samples, model, ctx));
    expect(tbm[0]).toBe(240);
    expect(tbm[1]).toBe(60);
  });
});

describe("timeAtPosition / positionAtTime", () => {
  const al = buildAlignment([
    { position: pos(0, 0), tMs: 0 },
    { position: pos(1, 0), tMs: 2000 }, // 4 quarters over 2s → linear
  ], model, ctx);

  it("interpolates performance time for a musical position (click measure → hear)", () => {
    expect(timeAtPosition(al, model, pos(0, 2))).toBe(1000); // q=2 of 4 → halfway
    expect(timeAtPosition(al, model, pos(0, 0))).toBe(0);
    expect(timeAtPosition(al, model, pos(1, 0))).toBe(2000);
  });
  it("clamps outside the captured range instead of returning null", () => {
    expect(timeAtPosition(al, model, pos(1, 3))).toBe(2000); // beyond last point → clamp
  });
  it("inverts: performance time → musical location", () => {
    const at = positionAtTime(al, 1000);
    expect(at.q).toBe(2);
    expect(at.measureIndex).toBe(0);
  });
});
