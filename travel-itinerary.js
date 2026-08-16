// Travel itinerary — the day-timeline projection that turns Explore's storage
// model (trip.days[dateKey][section][]) into the household's mental model of a
// day: a single chronological list of STOPS with TRANSITIONS between the located
// ones. This module is pure (no DOM, no network): it decides what the day looks
// like; travel-transitions.js layers routing on top, and app.js renders it.
//
//   Stop        — a place you are (a hotel check-in, an activity, a meal, a
//                 flight/leg you take). Normalized from the per-section items.
//   Transition  — the gap between two consecutive located stops. May already be
//                 bridged by an explicit travel leg (the user planned it), or be
//                 an open connection the routing engine can fill.
//
// The canonical store is unchanged — this is a read-only projection over it, so
// existing trips keep working and nothing migrates.

const SECTION_KEYS = ["travel", "lodging", "activities", "food"];

const LODGING_ICONS  = { hotel: "🏨", airbnb: "🏠", hostel: "🛏️", resort: "🌴", camping: "⛺", other: "🏠" };
const ACTIVITY_ICONS = { sightseeing: "🏛️", museum: "🎨", tour: "🗺️", adventure: "🏄", entertainment: "🎭", other: "⭐" };
const FOOD_ICONS     = { breakfast: "🍳", lunch: "🥗", dinner: "🍽️", snack: "☕" };
const LEG_ICONS      = { airplane: "✈️", train: "🚂", bus: "🚌", automobile: "🚗", "car-own": "🚗", "car-rental": "🚙", walk: "🚶", bike: "🚲", other: "🔀" };

const str = (v, d = "") => (v == null ? d : String(v));

// A HH:MM string → minutes since midnight, or null. Non-destructive: bad input
// sorts as untimed rather than throwing.
export function timeToMinutes(t) {
  if (!t || typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

export function addMinutes(t, delta) {
  const base = timeToMinutes(t);
  if (base == null || !Number.isFinite(delta)) return "";
  const total = ((base + delta) % 1440 + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

// Safe accessor mirroring app.js tripDayItems, but read-only (never mutates the
// trip — important for a pure projection). Legacy string values are treated as
// empty; app.js migrates them on write.
function dayItems(trip, dateKey, section) {
  const day = trip && trip.days && trip.days[dateKey];
  const val = day && day[section];
  return Array.isArray(val) ? val : [];
}

function isLeg(item)      { return !!(item && (item.mode || item.from || item.to)); }
function isLodging(item)  { return !!(item && item.itemType === "lodging"); }
function isActivity(item) { return !!(item && item.itemType === "activity"); }
function isFood(item)     { return !!(item && item.itemType === "food"); }

// A "major" leg is a timeline EVENT you sit inside (a flight, a train, anything
// that spans dates or carries a flight number) — it renders as a stop. A local
// ground hop (walk / drive / transit / bike within a day) is not an event; it is
// the CONNECTIVE TISSUE between two stops, so it renders as a transition and
// only ever appears as a transition's explicitLeg — never as its own stop card.
export function isMajorLeg(item) {
  if (!isLeg(item)) return false;
  if (item.mode === "airplane" || item.mode === "train") return true;
  if (item.flightNumber) return true;
  if (item.departDate && item.arriveDate && item.departDate !== item.arriveDate) return true;
  return false;
}

// ── Normalizers: item → stop ────────────────────────────────────────────────
// A stop is the projection's currency. `location` is the best routable string
// (empty when the item has none — such stops still show but produce no
// transition). `time` is null for untimed stops.

function activityStop(item, ownerDateKey) {
  const start = str(item.startLocation || item.location);
  return {
    kind: "stop", type: "activity", section: "activities",
    id: item.id, ownerDateKey, raw: item,
    time: str(item.activityTime) || null,
    endTime: item.activityTime && item.duration ? addMinutes(item.activityTime, parseInt(item.duration, 10) || 0) : "",
    title: str(item.name || item.title, "Activity"),
    subtitle: [item.activityType, item.duration].filter(Boolean).join(" · "),
    icon: ACTIVITY_ICONS[item.activityType] || "⭐",
    location: start,
    endLocation: str(item.endLocation),
    hasReservation: !!item.confirmationNo,
    movable: true,
  };
}

function foodStop(item, ownerDateKey) {
  return {
    kind: "stop", type: "food", section: "food",
    id: item.id, ownerDateKey, raw: item,
    time: str(item.reservationTime) || null,
    endTime: "",
    title: str(item.name || item.title, "Meal"),
    subtitle: [item.mealType, item.cuisine].filter(Boolean).join(" · "),
    icon: FOOD_ICONS[item.mealType] || "🍽️",
    location: str(item.address || item.name),
    hasReservation: !!(item.reservationTime || item.reservationNo),
    movable: true,
  };
}

function lodgingStop(item, ownerDateKey, phase) {
  // phase: "in" (check-in today), "out" (check-out today), "stay" (mid-stay)
  const time = phase === "out" ? str(item.checkOutTime) : str(item.checkInTime);
  const label = phase === "out" ? "Check-out" : phase === "stay" ? "Staying" : "Check-in";
  return {
    kind: "stop", type: "lodging-" + phase, section: "lodging",
    id: item.id, ownerDateKey, raw: item,
    time: time || null,
    endTime: "",
    title: str(item.name || item.title, "Lodging"),
    subtitle: label,
    icon: LODGING_ICONS[item.lodgingType] || "🏨",
    location: str(item.address || item.name),
    hasReservation: !!item.confirmationNo,
    movable: false,
  };
}

function legStop(item, ownerDateKey, role) {
  // role: "depart" (leaves this day), "arrive" (lands this day), "span" (in transit)
  const route = [item.from, item.to].filter(Boolean).join(" → ") || "Travel";
  return {
    kind: "stop", type: "leg", legRole: role, section: "travel",
    id: item.id, ownerDateKey, raw: item,
    time: (role === "arrive" ? str(item.arriveTime) : str(item.departTime)) || null,
    endTime: "",
    title: route,
    subtitle: [item.flightNumber, item.mode].filter(Boolean).join(" · "),
    icon: LEG_ICONS[item.mode] || "🚀",
    // A leg is itself movement — its "location" for chaining is where it leaves
    // you (its destination), so the next transition is measured from there.
    location: str(item.to),
    fromLocation: str(item.from),
    hasReservation: !!(item.flightNumber || item.confirmationNo),
    movable: false,
    isExplicitLeg: true,
  };
}

// ── Day timeline ────────────────────────────────────────────────────────────
// Collect every stop that belongs on this calendar day, order it (timed first
// by clock, then untimed by dayOrder), and weave transition entries between
// consecutive located stops. Returns a flat, render-ready list.

export function collectDayStops(trip, dateKey) {
  const stops = [];

  // This day's own items
  dayItems(trip, dateKey, "activities").filter(isActivity).forEach(it => stops.push(activityStop(it, dateKey)));
  dayItems(trip, dateKey, "food").filter(isFood).forEach(it => stops.push(foodStop(it, dateKey)));
  dayItems(trip, dateKey, "lodging").filter(isLodging).forEach(it => {
    if (it.checkInDate === dateKey || (!it.checkInDate && !it.checkOutDate)) stops.push(lodgingStop(it, dateKey, "in"));
  });
  dayItems(trip, dateKey, "travel").filter(isMajorLeg).forEach(it => {
    if (!it.departDate || it.departDate === dateKey) stops.push(legStop(it, dateKey, "depart"));
  });

  // Items owned by other days that surface here (arriving legs, spanning legs,
  // check-outs, mid-stay nights). Scan all day buckets once.
  const allKeys = trip && trip.days ? Object.keys(trip.days) : [];
  allKeys.forEach(ok => {
    if (ok === dateKey) return;
    dayItems(trip, ok, "travel").filter(isMajorLeg).forEach(leg => {
      if (leg.arriveDate === dateKey && leg.departDate !== dateKey) stops.push(legStop(leg, ok, "arrive"));
      else if (leg.departDate && leg.arriveDate && dateKey > leg.departDate && dateKey < leg.arriveDate) stops.push(legStop(leg, ok, "span"));
    });
    dayItems(trip, ok, "lodging").filter(isLodging).forEach(lo => {
      if (lo.checkOutDate === dateKey) stops.push(lodgingStop(lo, ok, "out"));
    });
  });

  return orderStops(stops);
}

// Timed stops sort by clock; untimed stops keep their user-arranged dayOrder and
// trail the timed ones. Arrivals nudge to the front of an equal time so "you
// land, then you do things" reads correctly.
export function orderStops(stops) {
  const rank = s => {
    const t = timeToMinutes(s.time);
    if (t != null) return t * 10 + (s.legRole === "arrive" ? 0 : s.legRole === "depart" ? 9 : 5);
    return null;
  };
  const timed = stops.filter(s => rank(s) != null).sort((a, b) => rank(a) - rank(b));
  const order = s => (Number.isFinite(s.raw && s.raw.dayOrder) ? s.raw.dayOrder : Number.MAX_SAFE_INTEGER);
  const untimed = stops.filter(s => rank(s) == null).sort((a, b) => order(a) - order(b));
  return [...timed, ...untimed];
}

// Find an explicit travel leg on `dateKey` that bridges a→b (loose match, same
// heuristic app.js already uses for connection detection).
function bridgingLeg(trip, dateKey, aLoc, bLoc) {
  const norm = s => str(s).trim().toLowerCase();
  const a = norm(aLoc), b = norm(bLoc);
  if (!a || !b) return null;
  const match = (legVal, wp) => {
    const x = norm(legVal), y = norm(wp);
    return x && y && (x === y || x.includes(y) || y.includes(x));
  };
  return dayItems(trip, dateKey, "travel").filter(isLeg).find(l => match(l.from, aLoc) && match(l.to, bLoc)) || null;
}

// The full render-ready timeline: [stop, transition, stop, transition, stop, …].
// A transition is emitted between two consecutive stops only when both are
// located and they are different places, and it carries any explicit leg that
// already bridges them (so the UI shows "planned" vs "open"). Legs that ARE the
// movement (a flight, a drive the user entered as a stop) don't get a synthetic
// transition in front of their destination — they already moved you.
export function buildDayTimeline(trip, dateKey) {
  const stops = collectDayStops(trip, dateKey);
  const entries = [];
  const norm = s => str(s).trim().toLowerCase();

  for (let i = 0; i < stops.length; i++) {
    const cur = stops[i];
    entries.push(cur);
    const next = stops[i + 1];
    if (!next) continue;

    // Where cur leaves you, and where next expects you to be.
    const fromLoc = cur.location;
    const toLoc = next.type === "leg" ? next.fromLocation : next.location;
    if (!fromLoc || !toLoc || norm(fromLoc) === norm(toLoc)) continue;

    // If next is itself a leg whose origin already equals fromLoc, the leg is
    // the transition — don't synthesize one.
    if (next.type === "leg" && norm(next.fromLocation) === norm(fromLoc)) continue;

    const leg = bridgingLeg(trip, dateKey, fromLoc, toLoc);
    entries.push({
      kind: "transition",
      id: "tr_" + (cur.id || i) + "_" + (next.id || (i + 1)),
      fromStop: cur, toStop: next,
      fromLocation: fromLoc, toLocation: toLoc,
      explicitLeg: leg,           // null → an open connection to plan/route
      planned: !!leg,
    });
  }
  return entries;
}

// Trip-level day list (inclusive). Empty when dates aren't set — the caller then
// shows the idea/undated experience instead of a day grid.
export function tripDayKeys(trip) {
  if (!trip || !trip.startDate || !trip.endDate) return [];
  const start = new Date(trip.startDate + "T00:00:00");
  const end = new Date(trip.endDate + "T00:00:00");
  if (isNaN(start) || isNaN(end) || end < start) return [];
  const keys = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) keys.push(d.toISOString().slice(0, 10));
  return keys;
}

// A light per-day summary for collapsed day headers and the readiness view:
// counts, whether the day is empty (an opportunity, not an error), how many
// open (unrouted) transitions remain.
export function daySummary(trip, dateKey) {
  const timeline = buildDayTimeline(trip, dateKey);
  const stops = timeline.filter(e => e.kind === "stop");
  const transitions = timeline.filter(e => e.kind === "transition");
  const activities = stops.filter(s => s.type === "activity").length;
  const meals = stops.filter(s => s.type === "food").length;
  const legs = stops.filter(s => s.type === "leg").length;
  return {
    dateKey,
    stopCount: stops.length,
    activities, meals, legs,
    isEmpty: stops.length === 0,
    openTransitions: transitions.filter(t => !t.planned).length,
    firstTime: (stops.find(s => s.time) || {}).time || null,
  };
}

export const _internals = { activityStop, foodStop, lodgingStop, legStop, dayItems, bridgingLeg };
