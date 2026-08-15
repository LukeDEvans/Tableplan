import { describe, it, expect } from "vitest";
import { rat } from "../music/rational.js";
import {
  makePosition, makeRange, samePosition, compareWithinMovement,
  comparePositions, positionInRange,
} from "../music/position.js";

const base = { workId: "w1", movementId: "m1", editionId: "e1" };

describe("ScorePosition — edition-pinned, exact offset", () => {
  it("requires workId, movementId AND editionId (edition-pinned in V1)", () => {
    expect(() => makePosition({ movementId: "m1", editionId: "e1" })).toThrow(/workId/);
    expect(() => makePosition({ workId: "w1", editionId: "e1" })).toThrow(/movementId/);
    expect(() => makePosition({ workId: "w1", movementId: "m1" })).toThrow(/editionId/);
  });
  it("defaults offset to the downbeat {0,1} and keeps exact rationals", () => {
    expect(makePosition({ ...base, measureIndex: 4 }).offset).toEqual({ num: 0, den: 1 });
    expect(makePosition({ ...base, measureIndex: 4, offset: rat(1, 3) }).offset).toEqual({ num: 1, den: 3 });
  });
  it("refuses a float offset (exact rational only)", () => {
    expect(() => makePosition({ ...base, measureIndex: 0, offset: 1.5 })).toThrow(/exact rational/);
  });
  it("keeps measureId as a distinct stable anchor from measureIndex", () => {
    const p = makePosition({ ...base, measureIndex: 7, measureId: "m_abc" });
    expect(p.measureIndex).toBe(7);
    expect(p.measureId).toBe("m_abc");
  });
});

describe("ScorePosition — ordering by exact time", () => {
  it("orders by measure then exact offset (triplet before the 'and')", () => {
    const downbeat = makePosition({ ...base, measureIndex: 3, offset: rat(0, 1) });
    const triplet = makePosition({ ...base, measureIndex: 3, offset: rat(1, 3) });
    const andOf1 = makePosition({ ...base, measureIndex: 3, offset: rat(1, 2) });
    expect(compareWithinMovement(downbeat, triplet)).toBe(-1);
    expect(compareWithinMovement(triplet, andOf1)).toBe(-1); // 1/3 < 1/2, exactly
  });
  it("equality uses coordinates, not the measureId hint", () => {
    const a = makePosition({ ...base, measureIndex: 2, offset: rat(1, 2), measureId: "x" });
    const b = makePosition({ ...base, measureIndex: 2, offset: rat(2, 4), measureId: "y" });
    expect(samePosition(a, b)).toBe(true);
  });
  it("refuses to compare across editions (needs EditionMapping)", () => {
    const a = makePosition({ ...base, measureIndex: 0 });
    const b = makePosition({ workId: "w1", movementId: "m1", editionId: "e2", measureIndex: 0 });
    expect(() => compareWithinMovement(a, b)).toThrow(/different editions/);
  });
  it("orders across movements with a movement order", () => {
    const a = makePosition({ ...base, measureIndex: 5 });
    const b = makePosition({ workId: "w1", movementId: "m2", editionId: "e1", measureIndex: 0 });
    expect(comparePositions(a, b, ["m1", "m2"])).toBe(-1);
    expect(() => comparePositions(a, b)).toThrow(/movementOrder/);
  });
});

describe("ScoreRange", () => {
  it("normalizes orientation and tests inclusive containment", () => {
    const r = makeRange({ ...base, measureIndex: 10 }, { ...base, measureIndex: 4 });
    expect(r.start.measureIndex).toBe(4);
    expect(r.end.measureIndex).toBe(10);
    expect(positionInRange(makePosition({ ...base, measureIndex: 4 }), r)).toBe(true);
    expect(positionInRange(makePosition({ ...base, measureIndex: 11 }), r)).toBe(false);
  });
  it("rejects endpoints spanning editions", () => {
    expect(() => makeRange({ ...base, measureIndex: 0 }, { workId: "w1", movementId: "m1", editionId: "e2", measureIndex: 1 })).toThrow(/Edition/);
  });
});
