// Travel model — trip lifecycle and safe migrations. Pure logic: the stored
// enum is the source of truth, dates refine what the household actually sees,
// and ideas become first-class (undated) trips so there is ONE lifecycle:
//
//   IDEA → PLANNING → BOOKED → TRAVELING → COMPLETED
//
// An idea needs no dates. A dated trip whose window has passed reads COMPLETED;
// one happening now reads TRAVELING, regardless of a stale stored value — so the
// UI never shows "planning" for a trip you are on. Nothing here mutates trips.

export const TRIP_STATUS = Object.freeze({
  IDEA: "idea",
  PLANNING: "planning",
  BOOKED: "booked",
  TRAVELING: "traveling",
  COMPLETED: "completed",
});

export const TRIP_STATUS_ORDER = ["idea", "planning", "booked", "traveling", "completed"];

export const TRIP_STATUS_META = Object.freeze({
  idea:      { label: "Idea",      icon: "💡", tone: "idea" },
  planning:  { label: "Planning",  icon: "🗓️", tone: "planning" },
  booked:    { label: "Booked",    icon: "✅", tone: "booked" },
  traveling: { label: "Traveling", icon: "🧭", tone: "traveling" },
  completed: { label: "Completed", icon: "🏁", tone: "completed" },
});

export function todayKey(now = new Date()) {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The status to DISPLAY. Dates win over a stale stored enum for the two states
// that are objectively determined by the calendar (traveling / completed);
// otherwise the stored value stands, defaulting sensibly.
export function deriveStatus(trip, today = todayKey()) {
  if (!trip) return TRIP_STATUS.PLANNING;
  const stored = TRIP_STATUS_ORDER.includes(trip.status) ? trip.status : null;
  if (stored === TRIP_STATUS.IDEA) return TRIP_STATUS.IDEA;
  if (!trip.startDate) return stored || TRIP_STATUS.PLANNING;
  const start = trip.startDate;
  const end = trip.endDate || trip.startDate;
  if (end < today) return TRIP_STATUS.COMPLETED;
  if (start <= today && end >= today) return TRIP_STATUS.TRAVELING;
  // Future-dated: keep an explicit booked/planning, else planning.
  return stored && stored !== TRIP_STATUS.TRAVELING && stored !== TRIP_STATUS.COMPLETED ? stored : TRIP_STATUS.PLANNING;
}

export function isIdea(trip) { return deriveStatus(trip) === TRIP_STATUS.IDEA; }
export function isTraveling(trip, today = todayKey()) { return deriveStatus(trip, today) === TRIP_STATUS.TRAVELING; }
export function isCompleted(trip, today = todayKey()) { return deriveStatus(trip, today) === TRIP_STATUS.COMPLETED; }

// Is the trip starting within `days`? Drives the "Enter Travel Mode?" prompt.
export function startsWithin(trip, days, today = todayKey()) {
  if (!trip || !trip.startDate) return false;
  const start = new Date(trip.startDate + "T00:00:00");
  const now = new Date(today + "T00:00:00");
  if (isNaN(start) || isNaN(now)) return false;
  const diff = Math.round((start - now) / 86400000);
  return diff >= 0 && diff <= days;
}

// Sort key for the Explore home: active/traveling first, then upcoming by date,
// then planning/ideas, then completed last. Lower sorts earlier.
export function homeSortRank(trip, today = todayKey()) {
  const s = deriveStatus(trip, today);
  if (s === TRIP_STATUS.TRAVELING) return 0;
  if (s === TRIP_STATUS.COMPLETED) return 4;
  if (s === TRIP_STATUS.IDEA) return 3;
  return trip.startDate ? 1 : 2; // dated upcoming before undated planning
}

export function compareForHome(a, b, today = todayKey()) {
  const ra = homeSortRank(a, today), rb = homeSortRank(b, today);
  if (ra !== rb) return ra - rb;
  // Within a rank: soonest upcoming first; most-recent completed first.
  if (a.startDate && b.startDate) {
    const s = deriveStatus(a, today);
    return s === TRIP_STATUS.COMPLETED ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate);
  }
  if (a.startDate) return -1;
  if (b.startDate) return 1;
  return (b.updatedAt || "").localeCompare(a.updatedAt || "");
}

// Non-destructive, idempotent migration of legacy state.travelIdeas[] into
// first-class idea trips. Returns the NEW trip objects to append (the caller
// persists them); re-running is safe because each converted trip carries a
// deterministic id derived from the idea, so already-migrated ideas are skipped.
// The original travelIdeas array is left untouched.
export function migrateIdeasToTrips(state, { now = new Date().toISOString() } = {}) {
  const ideas = Array.isArray(state && state.travelIdeas) ? state.travelIdeas : [];
  if (!ideas.length) return [];
  const trips = Array.isArray(state.trips) ? state.trips : [];
  const existingIds = new Set(trips.map(t => t && t.id));
  const out = [];
  for (const idea of ideas) {
    if (!idea || !idea.id) continue;
    const id = "trip_idea_" + idea.id;
    if (existingIds.has(id)) continue;
    out.push({
      id,
      name: idea.destination || "Trip idea",
      destination: idea.destination || "",
      status: TRIP_STATUS.IDEA,
      startDate: "", endDate: "",
      party: ["Luke"],
      currency: "USD",
      notes: idea.description || "",
      tags: Array.isArray(idea.tags) ? idea.tags.slice() : [],
      saved: [], refs: [],
      days: {},
      fromIdeaId: idea.id,
      createdAt: idea.createdAt || now,
      updatedAt: now,
    });
  }
  return out;
}
