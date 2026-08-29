import { describe, it, expect } from "vitest";
import {
  SORTABLE_DEFAULTS, preActivationOutcome, autoScrollVelocity,
  insertionIndex, moveInArray, reorderDelta,
} from "../sortable-core.js";

describe("preActivationOutcome — tap vs long-press vs scroll", () => {
  it("mouse/pen: begins a drag once moved past the start threshold", () => {
    expect(preActivationOutcome(2, "mouse")).toBe("wait");
    expect(preActivationOutcome(5, "mouse")).toBe("activate");
    expect(preActivationOutcome(9, "pen")).toBe("activate");
  });
  it("touch: small drift waits (long-press still valid); past tolerance is a scroll → cancel", () => {
    expect(preActivationOutcome(0, "touch")).toBe("wait");   // a tap, holding still
    expect(preActivationOutcome(9, "touch")).toBe("wait");   // within tolerance
    expect(preActivationOutcome(10, "touch")).toBe("cancel"); // scrolling
  });
  it("touch never 'activates' from movement (only the long-press timer does)", () => {
    for (const d of [0, 3, 8, 20, 200]) expect(preActivationOutcome(d, "touch")).not.toBe("activate");
  });
  it("honors custom thresholds", () => {
    expect(preActivationOutcome(6, "touch", { touchTolerancePx: 5 })).toBe("cancel");
    expect(preActivationOutcome(3, "mouse", { mouseStartPx: 3 })).toBe("activate");
  });
});

describe("autoScrollVelocity — proportional, continuous", () => {
  const opts = { edgePx: 100, maxVel: 20 };
  it("is zero away from both edges", () => {
    expect(autoScrollVelocity(500, 0, 1000, opts)).toBe(0);
  });
  it("scrolls up near the top and down near the bottom", () => {
    expect(autoScrollVelocity(10, 0, 1000, opts)).toBeLessThan(0);
    expect(autoScrollVelocity(995, 0, 1000, opts)).toBeGreaterThan(0);
  });
  it("accelerates toward the edge (monotonic ramp)", () => {
    const near = autoScrollVelocity(990, 0, 1000, opts); // 10px from bottom
    const mid = autoScrollVelocity(940, 0, 1000, opts);  // 60px from bottom
    const edgeIn = autoScrollVelocity(905, 0, 1000, opts); // 95px (just inside zone)
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(edgeIn);
    expect(edgeIn).toBeGreaterThanOrEqual(1); // always moves once inside the zone
  });
  it("caps at maxVel at/over the very edge", () => {
    expect(autoScrollVelocity(1000, 0, 1000, opts)).toBe(20);
    expect(autoScrollVelocity(1200, 0, 1000, opts)).toBe(20); // beyond the edge stays capped
    expect(autoScrollVelocity(0, 0, 1000, opts)).toBe(-20);
  });
  it("prefers the nearer edge in a tiny container", () => {
    expect(autoScrollVelocity(20, 0, 60, { edgePx: 40, maxVel: 20 })).toBeLessThan(0); // closer to top
  });
});

describe("reorder math", () => {
  it("insertionIndex counts rows whose center is above the pointer", () => {
    const centers = [10, 30, 50, 70];
    expect(insertionIndex(centers, 5)).toBe(0);
    expect(insertionIndex(centers, 35)).toBe(2);
    expect(insertionIndex(centers, 999)).toBe(4);
  });
  it("moveInArray moves an item and clamps the destination", () => {
    expect(moveInArray(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInArray(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveInArray(["a", "b"], 0, 99)).toEqual(["b", "a"]);
  });
  it("reorderDelta reports from/to or null when unchanged", () => {
    expect(reorderDelta(["a", "b", "c"], ["b", "a", "c"], "a")).toEqual({ itemId: "a", fromIndex: 0, toIndex: 1 });
    expect(reorderDelta(["a", "b", "c"], ["a", "b", "c"], "a")).toBe(null);
    expect(reorderDelta(["a", "b"], ["a", "b"], "zzz")).toBe(null);
  });
});

describe("defaults", () => {
  it("long-press default sits in the 400–500ms target", () => {
    expect(SORTABLE_DEFAULTS.longPressMs).toBeGreaterThanOrEqual(400);
    expect(SORTABLE_DEFAULTS.longPressMs).toBeLessThanOrEqual(500);
  });
});
