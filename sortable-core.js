// sortable-core.js — pure, DOM-free logic for the shared sortable interaction.
//
// The interaction mechanics (pointer capture, clone, FLIP, auto-scroll loop) live
// in the DOM binder (sortable.js). The decisions that are pure functions of numbers
// live here so they can be unit-tested deterministically:
//   - gesture classification (tap vs long-press vs scroll)
//   - proportional edge auto-scroll velocity
//   - reorder index math
// See test/sortable-core.test.js. No DOM, no timers, no side effects.

export const SORTABLE_DEFAULTS = Object.freeze({
  longPressMs: 450,       // touch: hold this long to enter drag mode (400–500 target)
  touchTolerancePx: 9,    // touch: finger may drift this much during the long press
  mouseStartPx: 5,        // mouse/pen: begin dragging after this much movement
  edgePx: 64,             // auto-scroll edge-zone thickness
  maxScrollVel: 22,       // auto-scroll max px/frame at the very edge
});

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// Pre-activation gesture decision, given how far the pointer has moved since it
// went down. Returns "wait" | "activate" | "cancel".
//   mouse / pen: movement past `mouseStartPx` starts the drag immediately.
//   touch:       movement past `touchTolerancePx` before the long-press timer means
//                the user is scrolling → cancel the pending drag (never hijacks scroll).
export function preActivationOutcome(distancePx, pointerType, opts = {}) {
  const tol = opts.touchTolerancePx ?? SORTABLE_DEFAULTS.touchTolerancePx;
  const start = opts.mouseStartPx ?? SORTABLE_DEFAULTS.mouseStartPx;
  if (pointerType === "mouse" || pointerType === "pen") {
    return distancePx >= start ? "activate" : "wait";
  }
  return distancePx > tol ? "cancel" : "wait";
}

// Proportional auto-scroll velocity (signed px/frame; negative = scroll up) for a
// pointer at `pointerY` inside a container spanning [top, bottom] in viewport coords.
// Zero outside the edge zones; a quadratic ease-in ramps from ~1px at the zone's
// inner edge to `maxVel` at the very edge, so long lists are traversable smoothly
// and a stationary finger held at the edge keeps scrolling.
export function autoScrollVelocity(pointerY, top, bottom, opts = {}) {
  const edge = opts.edgePx ?? SORTABLE_DEFAULTS.edgePx;
  const maxVel = opts.maxVel ?? SORTABLE_DEFAULTS.maxScrollVel;
  const topDist = pointerY - top;
  const botDist = bottom - pointerY;
  if (edge <= 0) return 0;
  if (topDist < edge && topDist <= botDist) return -rampVelocity((edge - topDist) / edge, maxVel);
  if (botDist < edge) return rampVelocity((edge - botDist) / edge, maxVel);
  return 0;
}
function rampVelocity(t, maxVel) {
  const c = clamp01(t);
  const v = maxVel * c * c;      // quadratic ease-in
  return v < 1 ? 1 : Math.round(v); // always at least 1px once inside the zone
}

// Where should the dragged row land, given the vertical centers of the OTHER rows
// (in current DOM order) and the pointer's Y? Returns an insertion index in
// [0, centers.length]. Pure companion to the binder's elementFromPoint reorder
// (used for reasoning/tests; the binder itself reorders against live geometry).
export function insertionIndex(otherCenters, pointerY) {
  let i = 0;
  while (i < otherCenters.length && pointerY > otherCenters[i]) i++;
  return i;
}

// Apply a from→to move to an array of ids (pure; used by tests and any consumer
// that prefers indices over a materialized order).
export function moveInArray(arr, fromIndex, toIndex) {
  const a = arr.slice();
  if (fromIndex < 0 || fromIndex >= a.length) return a;
  const [item] = a.splice(fromIndex, 1);
  const to = Math.max(0, Math.min(a.length, toIndex));
  a.splice(to, 0, item);
  return a;
}

// Convenience: derive { fromIndex, toIndex } for a reorder from the old id order to
// the new id order of the same set (so a binder that only knows the final DOM order
// can still report indices to the consumer). Returns null if nothing moved.
export function reorderDelta(oldOrder, newOrder, movedId) {
  const fromIndex = oldOrder.indexOf(movedId);
  const toIndex = newOrder.indexOf(movedId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  return { itemId: movedId, fromIndex, toIndex };
}
