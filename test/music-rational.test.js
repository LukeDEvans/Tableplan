import { describe, it, expect } from "vitest";
import { rat, add, sub, compare, equals, toNumber, toTicks, fromTicks, fromDivisions, lcmAll, gcd } from "../music/rational.js";

describe("rational — exact musical time", () => {
  it("reduces on construction and normalizes sign to the numerator", () => {
    expect(rat(2, 4)).toEqual({ num: 1, den: 2 });
    expect(rat(3, -6)).toEqual({ num: -1, den: 2 });
    expect(rat(0, 5)).toEqual({ num: 0, den: 1 });
  });
  it("represents arbitrary tuplets exactly", () => {
    expect(rat(1, 3)).toEqual({ num: 1, den: 3 });     // triplet eighth = 1/3 quarter
    expect(rat(1, 28)).toEqual({ num: 1, den: 28 });   // 7-tuplet sixteenth
  });
  it("adds and subtracts exactly (no float drift)", () => {
    expect(add(rat(1, 3), rat(1, 6))).toEqual({ num: 1, den: 2 });
    expect(sub(rat(1, 1), rat(1, 3))).toEqual({ num: 2, den: 3 });
    // three triplet-eighths sum to exactly one quarter
    expect(add(add(rat(1, 3), rat(1, 3)), rat(1, 3))).toEqual({ num: 1, den: 1 });
  });
  it("compares by exact cross-multiplication", () => {
    expect(compare(rat(1, 3), rat(1, 2))).toBe(-1);
    expect(compare(rat(2, 4), rat(1, 2))).toBe(0);
    expect(equals(rat(2, 4), rat(1, 2))).toBe(true);
  });
  it("toNumber is display-only", () => { expect(toNumber(rat(3, 2))).toBeCloseTo(1.5); });
});

describe("rational — resolution bridge", () => {
  it("converts to integer ticks exactly when resolution is a multiple of den", () => {
    expect(toTicks(rat(1, 3), 960)).toEqual({ ticks: 320, exact: true });   // 960/3
    expect(toTicks(rat(1, 4), 960)).toEqual({ ticks: 240, exact: true });
  });
  it("flags inexact conversion rather than lying", () => {
    const r = toTicks(rat(1, 7), 960); // 960 not divisible by 7
    expect(r.exact).toBe(false);
    expect(r.ticks).toBe(Math.round(960 / 7));
  });
  it("round-trips ticks ↔ rational", () => {
    expect(fromTicks(320, 960)).toEqual({ num: 1, den: 3 });
    expect(fromDivisions(2, 8)).toEqual({ num: 1, den: 4 }); // 2 divisions of 8-per-quarter = 1/4 quarter
  });
  it("derives a resolution as the LCM of denominators present", () => {
    // divisions 3 (triplets) and 4 (sixteenths) → LCM covers both exactly
    expect(lcmAll([1, 2, 3, 4])).toBe(12);
    expect(lcmAll([3, 4, 7])).toBe(84);
    expect(toTicks(rat(1, 7), lcmAll([3, 4, 7]) * 1).exact).toBe(true); // 84 divisible by 7
    expect(gcd(12, 18)).toBe(6);
  });
});
