// finance-review-gesture.js — pure gesture classification for the transaction
// review deck. Kept DOM-free so the safety-critical rule is unit-tested:
//
//   Vertical = browse. Horizontal-right = approve. Nothing else changes state.
//
// The recognizer locks an axis on first meaningful movement and never
// re-classifies, so a drag that starts vertical can never later approve just
// because the finger drifts diagonally. Left never approves. Only a decisive
// rightward drag on the horizontal axis approves.

export const REVIEW_GESTURE = Object.freeze({
  deadzonePx: 8,            // movement under this in both axes = undecided
  approveThresholdPx: 90,   // horizontal-right past this = approve on release
});

// Lock the axis once the finger has moved past the deadzone. Returns
// "x" | "y" | null (still undecided). Callers cache the first non-null result
// for the whole gesture and must not recompute it — that is the safety rule.
export function reviewGestureAxis(dx, dy, opts = {}) {
  const dz = opts.deadzonePx ?? REVIEW_GESTURE.deadzonePx;
  if (Math.abs(dx) < dz && Math.abs(dy) < dz) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

// Given the LOCKED axis and the final horizontal displacement, decide what a
// release does:
//   "approve" — only when the axis is horizontal AND the drag went right past
//               the threshold.
//   "browse"  — any vertical gesture (the deck scroll-snaps to prev/next).
//   "none"    — horizontal but left, or not far enough right: a no-op.
// A vertical axis therefore can NEVER return "approve", regardless of dx.
export function reviewGestureAction(axis, dx, opts = {}) {
  const th = opts.approveThresholdPx ?? REVIEW_GESTURE.approveThresholdPx;
  if (axis !== "x") return "browse";
  if (dx >= th) return "approve";
  return "none";
}
