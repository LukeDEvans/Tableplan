// Travel Mode — the runtime brain. While traveling, Explore stops being a
// planner and becomes "what do we need to know right now?". This module turns a
// day's itinerary into a NOW / NEXT / LATER snapshot the household reads at a
// glance. Pure and time-injected (the clock is passed in), so it tests
// deterministically. Rendering and weather live in app.js.
import { buildDayTimeline, timeToMinutes, tripDayKeys } from "./travel-itinerary.js";

export function minutesNow(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function dayKeyOf(date) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Classify a day's timeline against the current minute into done / current /
// next / later, and identify the single NEXT stop plus the transition that leads
// to it (for a "leave by" hint). Untimed stops trail as "later" todos.
export function classifyDay(timeline, nowMin) {
  const stops = timeline.filter(e => e.kind === "stop");
  const transitions = timeline.filter(e => e.kind === "transition");
  const entries = [];
  let current = null, next = null;

  for (const s of stops) {
    const start = timeToMinutes(s.time);
    const end = timeToMinutes(s.endTime);
    let state;
    if (start == null) {
      state = "later"; // untimed → a loose todo for later in the day
    } else if (end != null && nowMin >= end) {
      state = "done";
    } else if (nowMin >= start && (end == null ? nowMin < start + 60 : nowMin < end)) {
      state = "current";
    } else if (nowMin < start) {
      state = "upcoming";
    } else {
      state = "done"; // started, no end, well past
    }
    if (state === "current" && !current) current = s;
    if (state === "upcoming" && !next) next = s;
    entries.push({ stop: s, state });
  }

  // If nothing is "current", the next upcoming stop is what to focus on.
  const focus = current || next;
  // The transition immediately preceding the focus stop (its incoming hop) —
  // the timeline is [stop, transition, stop, …], so it's the entry just before.
  let incomingTransition = null;
  if (focus) {
    const fi = timeline.indexOf(focus);
    if (fi > 0 && timeline[fi - 1] && timeline[fi - 1].kind === "transition") incomingTransition = timeline[fi - 1];
  }
  return { entries, current, next, focus, incomingTransition, transitions };
}

// The full runtime snapshot for a trip at a moment in time.
export function travelSnapshot(trip, now = new Date()) {
  const keys = tripDayKeys(trip);
  const dateKey = dayKeyOf(now);
  const dayNumber = keys.indexOf(dateKey) + 1; // 0 → not a trip day
  const onTrip = dayNumber > 0;
  const timeline = onTrip ? buildDayTimeline(trip, dateKey) : [];
  const nowMin = minutesNow(now);
  const day = classifyDay(timeline, nowMin);

  // If today has no remaining focus (all done / empty), look ahead to the next
  // trip day that has stops, so NEXT is never blank mid-trip.
  let lookahead = null;
  if (onTrip && !day.focus) {
    for (let i = keys.indexOf(dateKey) + 1; i < keys.length; i++) {
      const tl = buildDayTimeline(trip, keys[i]);
      const firstStop = tl.find(e => e.kind === "stop");
      if (firstStop) { lookahead = { dateKey: keys[i], dayNumber: i + 1, stop: firstStop, timeline: tl }; break; }
    }
  }

  return {
    dateKey, dayNumber, onTrip,
    timeline,
    entries: day.entries,
    current: day.current,
    next: day.focus,
    incomingTransition: day.incomingTransition,
    lookahead,
    beforeTrip: !onTrip && keys.length > 0 && dateKey < keys[0],
    afterTrip: !onTrip && keys.length > 0 && dateKey > keys[keys.length - 1],
  };
}
