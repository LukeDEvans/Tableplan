// Travel optimize — the itinerary's quiet second opinion. It evaluates a day and
// PROPOSES improvements; it never changes the plan. Every function is pure and
// synchronous: routing distances are injected as a distanceFn(aLoc, bLoc) →
// minutes|null (the app prefetches them via the travel-time backend and memoizes
// a lookup), so the evaluator tests without a network and can't stall the UI.
//
// The output is a list of suggestions. Each is a proposal the UI renders as a
// "Possible improvement" card with a clear CURRENT → SUGGESTED diff and explicit
// Apply / Keep-current actions. Nothing here mutates a trip.

// Total travel cost of walking a fixed sequence of located points. Unknown
// segments (distanceFn returns null) are skipped rather than guessed, so a
// partially-routable day still yields a usable comparison.
export function routeCost(locations, distanceFn) {
  let total = 0;
  for (let i = 0; i < locations.length - 1; i++) {
    const d = distanceFn(locations[i], locations[i + 1]);
    if (typeof d === "number" && Number.isFinite(d)) total += d;
  }
  return total;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// Greedy nearest-neighbour order for larger sets, so we still improve dense days
// without a factorial blow-up.
function greedyOrder(items, anchorStart, distanceFn) {
  const remaining = items.slice();
  const order = [];
  let cur = anchorStart;
  while (remaining.length) {
    let bestIdx = 0, bestD = Infinity;
    remaining.forEach((it, i) => {
      const d = cur != null ? distanceFn(cur, it.location) : null;
      const cost = (typeof d === "number" && Number.isFinite(d)) ? d : 1e6;
      if (cost < bestD) { bestD = cost; bestIdx = i; }
    });
    const [picked] = remaining.splice(bestIdx, 1);
    order.push(picked);
    cur = picked.location;
  }
  return order;
}

// Find the lowest-cost ordering of `items` (each { location, … }) between two
// fixed anchor locations (either may be null). Exhaustive for small sets, greedy
// beyond a cap.
export function bestOrder(items, anchorStart, anchorEnd, distanceFn, { exhaustiveCap = 6 } = {}) {
  if (items.length <= 1) return items.slice();
  const cost = seq => routeCost([anchorStart, ...seq.map(s => s.location), anchorEnd].filter(v => v != null), distanceFn);
  if (items.length <= exhaustiveCap) {
    let best = items, bestC = cost(items);
    for (const perm of permutations(items)) {
      const c = cost(perm);
      if (c < bestC) { bestC = c; best = perm; }
    }
    return best;
  }
  const greedy = greedyOrder(items, anchorStart, distanceFn);
  return cost(greedy) < cost(items) ? greedy : items.slice();
}

// Suggest reordering the day's FLEXIBLE (untimed, movable, located) stops to cut
// travel time. Timed stops are immovable anchors. Returns a suggestion object or
// null when there's nothing worth proposing.
export function suggestReorder(timeline, distanceFn, { minSaveMin = 10 } = {}) {
  const stops = timeline.filter(e => e.kind === "stop");
  const movable = stops.filter(s => s.movable && !s.time && s.location);
  if (movable.length < 2) return null;

  // Anchor to the last located stop before the movable block and the first
  // located stop after it, so clustering respects where the day starts/ends.
  const firstMovableIdx = stops.indexOf(movable[0]);
  const lastMovableIdx = stops.indexOf(movable[movable.length - 1]);
  const anchorStart = (() => { for (let i = firstMovableIdx - 1; i >= 0; i--) if (stops[i].location) return stops[i].location; return null; })();
  const anchorEnd = (() => { for (let i = lastMovableIdx + 1; i < stops.length; i++) if (stops[i].location) return stops[i].location; return null; })();

  const currentCost = routeCost([anchorStart, ...movable.map(s => s.location), anchorEnd].filter(v => v != null), distanceFn);
  const best = bestOrder(movable, anchorStart, anchorEnd, distanceFn);
  const bestCost = routeCost([anchorStart, ...best.map(s => s.location), anchorEnd].filter(v => v != null), distanceFn);
  const saved = Math.round(currentCost - bestCost);

  const sameOrder = best.every((s, i) => s.id === movable[i].id);
  if (sameOrder || saved < minSaveMin) return null;

  return {
    type: "reorder",
    savedMin: saved,
    current: movable.map(s => ({ id: s.id, title: s.title })),
    suggested: best.map(s => ({ id: s.id, title: s.title })),
    // The dayOrder each movable stop should take to realize the suggestion,
    // keyed by stop id (the app applies these).
    apply: best.map((s, i) => ({ id: s.id, dayOrder: i })),
    reason: "shorter travel and a more natural geographic progression",
  };
}

// Flag transitions that don't leave enough time to make the next stop.
export function detectTightConnections(timeline) {
  const out = [];
  timeline.filter(e => e.kind === "transition" && e.routing && e.routing.buffer && e.routing.buffer.ok === false).forEach(t => {
    out.push({
      type: "tight",
      fromTitle: t.fromStop.title, toTitle: t.toStop.title,
      gapMin: t.routing.buffer.gapMin, needMin: t.routing.buffer.needMin,
      reason: "the gap is shorter than the travel time plus a cushion",
    });
  });
  return out;
}

// An unrealistically dense day: many stops with little slack. Heuristic, gentle.
export function detectOverpacked(timeline, { maxComfortable = 6 } = {}) {
  const stops = timeline.filter(e => e.kind === "stop" && e.type !== "lodging-stay");
  if (stops.length <= maxComfortable) return null;
  return {
    type: "overpacked",
    count: stops.length,
    reason: `${stops.length} stops in one day may be more than is enjoyable`,
  };
}

// Calendar conflicts: a household event overlapping a timed stop. `events` is a
// list of { title, start:"HH:MM", end:"HH:MM" } already filtered to the day.
export function detectCalendarConflicts(timeline, events = []) {
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const out = [];
  timeline.filter(e => e.kind === "stop" && e.time).forEach(s => {
    const sStart = toMin(s.time);
    const sEnd = toMin(s.endTime) ?? (sStart != null ? sStart + 60 : null);
    if (sStart == null) return;
    events.forEach(ev => {
      const eStart = toMin(ev.start), eEnd = toMin(ev.end) ?? (eStart != null ? eStart + 60 : null);
      if (eStart == null) return;
      if (sStart < eEnd && eStart < sEnd) {
        out.push({ type: "calendar", stopTitle: s.title, stopTime: s.time, eventTitle: ev.title, eventTime: ev.start, reason: "a household calendar event overlaps this itinerary item" });
      }
    });
  });
  return out;
}

// Top-level: gather every suggestion for a day. `timeline` should already carry
// resolved routing on its transitions when available (for tight-connection
// detection); reorder uses the injected distanceFn.
export function evaluateDay(timeline, { distanceFn = () => null, events = [] } = {}) {
  const suggestions = [];
  const reorder = suggestReorder(timeline, distanceFn);
  if (reorder) suggestions.push(reorder);
  const over = detectOverpacked(timeline);
  if (over) suggestions.push(over);
  suggestions.push(...detectTightConnections(timeline));
  suggestions.push(...detectCalendarConflicts(timeline, events));
  return suggestions;
}
