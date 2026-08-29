import { describe, it, expect } from "vitest";
import { reviewGestureAxis, reviewGestureAction, REVIEW_GESTURE } from "../finance-review-gesture.js";

describe("reviewGestureAxis — axis locking", () => {
  it("stays undecided inside the deadzone", () => {
    expect(reviewGestureAxis(0, 0)).toBe(null);
    expect(reviewGestureAxis(7, 7)).toBe(null);
  });
  it("locks horizontal when x dominates, vertical when y dominates", () => {
    expect(reviewGestureAxis(20, 5)).toBe("x");
    expect(reviewGestureAxis(5, 20)).toBe("y");
    expect(reviewGestureAxis(-20, 5)).toBe("x"); // leftward is still the x axis
  });
});

describe("reviewGestureAction — SAFETY: vertical/left never approve", () => {
  it("approves only on a decisive horizontal-right drag", () => {
    expect(reviewGestureAction("x", 200)).toBe("approve");
    expect(reviewGestureAction("x", REVIEW_GESTURE.approveThresholdPx)).toBe("approve");
  });
  it("NEVER approves on the vertical axis, even with a huge dx (diagonal finish)", () => {
    expect(reviewGestureAction("y", 500)).toBe("browse");
    expect(reviewGestureAction("y", -500)).toBe("browse");
    expect(reviewGestureAction("y", 0)).toBe("browse");
  });
  it("NEVER approves on a leftward horizontal drag (no-op)", () => {
    expect(reviewGestureAction("x", -200)).toBe("none");
    expect(reviewGestureAction("x", -1)).toBe("none");
  });
  it("does not approve a horizontal-right drag that is too small", () => {
    expect(reviewGestureAction("x", 50)).toBe("none");
    expect(reviewGestureAction("x", REVIEW_GESTURE.approveThresholdPx - 1)).toBe("none");
  });
  it("an undecided/null axis never approves", () => {
    expect(reviewGestureAction(null, 200)).toBe("browse");
  });
});
