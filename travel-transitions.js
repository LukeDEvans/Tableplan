// Travel transitions — the A→B engine. Given the gap between two itinerary
// stops, it decides how to get across it: ranks the modes, picks a recommended
// one, explains WHY, and works out when to leave. Pure logic + an injected
// fetcher, so it tests without a network and swaps providers freely.
//
// Routing data comes from a TransitProvider — a function (origin, destination) →
// Promise<{ walk, drive, transit, bike }?> where each mode is
// { durationMin, distance }. app.js injects the existing fetchTravelTimes
// (Google Distance Matrix via netlify/functions/travel-time.js); a test injects
// a stub; an offline build injects one that resolves null. Nothing here throws
// on missing data — a transition with no routes is still a valid, plannable gap.

export const MODE_META = Object.freeze({
  walk:    { key: "walk",    legMode: "walk",       icon: "🚶", label: "Walk" },
  transit: { key: "transit", legMode: "bus",        icon: "🚇", label: "Transit" },
  drive:   { key: "drive",   legMode: "automobile", icon: "🚗", label: "Drive" },
  taxi:    { key: "taxi",    legMode: "automobile", icon: "🚕", label: "Taxi" },
  bike:    { key: "bike",    legMode: "bike",       icon: "🚲", label: "Bike" },
});

const DEFAULT_BUFFER_MIN = 10; // arrive-early cushion baked into "leave by"

// Which mode makes the most sense. Matches app.js pickSuggestedTravelMode so the
// itinerary and the existing Transportation tab agree; exported so app.js can
// delegate to a single source of truth.
export function pickMode(times, hasCar) {
  if (!times) return null;
  const w = times.walk && times.walk.durationMin;
  const d = times.drive && times.drive.durationMin;
  const t = times.transit && times.transit.durationMin;
  if (w != null && w <= 18) return "walk";
  if (hasCar && d != null) return "drive";
  if (t != null && d != null) return t <= d * 1.5 ? "transit" : "drive";
  if (t != null) return "transit";
  if (d != null) return "drive";
  return w != null ? "walk" : null;
}

export function formatDuration(min) {
  if (min == null || !Number.isFinite(min)) return "";
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60), m = min % 60;
  return h + " hr" + (m ? " " + m + " min" : "");
}

// Turn raw times into a ranked, render-ready option list. The recommended mode
// (from pickMode) is flagged and floated to the top; unavailable modes are kept
// (disabled) so the UI can show the full menu.
export function rankRoutes(times, { hasCar = false } = {}) {
  const best = pickMode(times, hasCar);
  const order = ["walk", "transit", "drive", "bike"];
  const rows = order.map(key => {
    const t = times && times[key];
    return {
      ...MODE_META[key],
      durationMin: t && t.durationMin != null ? t.durationMin : null,
      distance: t && t.distance ? t.distance : "",
      available: !!(t && t.durationMin != null),
      recommended: key === best,
    };
  });
  rows.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (a.durationMin ?? 1e9) - (b.durationMin ?? 1e9);
  });
  return { best, rows };
}

// Why the recommended mode won — concrete, plain-language reasons the UI shows
// under the chooser ("Recommended because: short distance, favorable weather…").
export function recommendReasons(times, best, { weatherGood = null } = {}) {
  const reasons = [];
  if (!times || !best) return reasons;
  const w = times.walk && times.walk.durationMin;
  const d = times.drive && times.drive.durationMin;
  const t = times.transit && times.transit.durationMin;

  if (best === "walk") {
    if (w != null && w <= 12) reasons.push("short distance");
    else if (w != null) reasons.push("walkable");
    if (weatherGood === true) reasons.push("good weather for walking");
    if (d != null && w != null && w <= d + 8) reasons.push("no faster to drive");
  } else if (best === "transit") {
    if (d != null && t != null && t <= d) reasons.push("faster than driving");
    reasons.push("avoids parking and traffic");
  } else if (best === "drive") {
    if (t != null && d != null && d * 1.5 < t) reasons.push("much faster than transit");
    else reasons.push("car available");
    if (weatherGood === false) reasons.push("keeps you out of the weather");
  } else if (best === "bike") {
    reasons.push("quick on two wheels");
    if (weatherGood === true) reasons.push("good weather to ride");
  }
  return reasons;
}

// Given the target arrival time (the next stop's clock time) and the trip
// duration, when should you leave? Returns "HH:MM" or "". Buffer is the
// arrive-early cushion.
export function leaveByTime(arriveAtHHMM, durationMin, buffer = DEFAULT_BUFFER_MIN) {
  if (!arriveAtHHMM || durationMin == null || !Number.isFinite(durationMin)) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(String(arriveAtHHMM).trim());
  if (!m) return "";
  let mins = (+m[1]) * 60 + (+m[2]) - durationMin - buffer;
  mins = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
}

// Whether the plan leaves enough time to make the next stop: the free gap
// between the two stops' clock times must cover the trip plus buffer. Returns
// { ok, gapMin, needMin } or null when either stop is untimed (nothing to check).
export function bufferCheck(fromStop, toStop, durationMin, buffer = DEFAULT_BUFFER_MIN) {
  const toMin = s => {
    const v = s && (s.endTime || s.time);
    const m = v && /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  const a = toMin(fromStop), b = toStop && toStop.time ? (() => { const m = /^(\d{1,2}):(\d{2})/.exec(toStop.time); return m ? (+m[1]) * 60 + (+m[2]) : null; })() : null;
  if (a == null || b == null || durationMin == null) return null;
  const gapMin = b - a;
  const needMin = durationMin + buffer;
  return { ok: gapMin >= needMin, gapMin, needMin };
}

// Resolve one transition's routing. Returns a NEW object (never mutates input)
// carrying rows/best/reasons/leaveBy/buffer, or a graceful "unavailable" shape
// when the provider yields nothing. Designed so the caller can render a skeleton
// first, then swap in the resolved value.
export async function resolveTransition(transition, { fetchTimes, hasCar = false, weatherGood = null } = {}) {
  const base = { ...transition, routing: { status: "pending", rows: [], best: null, reasons: [] } };
  if (typeof fetchTimes !== "function" || !transition.fromLocation || !transition.toLocation) {
    return { ...base, routing: { status: "unavailable", rows: [], best: null, reasons: [] } };
  }
  let times = null;
  try {
    times = await fetchTimes(transition.fromLocation, transition.toLocation);
  } catch {
    times = null;
  }
  if (!times || (!times.walk && !times.drive && !times.transit && !times.bike)) {
    return { ...base, routing: { status: "unavailable", rows: [], best: null, reasons: [] } };
  }
  const { best, rows } = rankRoutes(times, { hasCar });
  const reasons = recommendReasons(times, best, { weatherGood });
  const bestRow = rows.find(r => r.recommended);
  const durationMin = bestRow ? bestRow.durationMin : null;
  const leaveBy = leaveByTime(transition.toStop && transition.toStop.time, durationMin);
  const buffer = bufferCheck(transition.fromStop, transition.toStop, durationMin);
  return { ...base, routing: { status: "ok", times, best, rows, reasons, durationMin, leaveBy, buffer } };
}
