// Calendar → Meal Plan sharing. Pure, DOM-free (see test/calendar-meal-plan-share.test.js).
//
// The meal plan is one shared household record, but events live in whichever
// Calendar scope they were made in — and a PERSONAL calendar is only ever loaded
// on its owner's devices. Two things decide what the meal plan shows:
//
//   1. What a calendar scope puts on the meal plan: events ticked "Meal Plan",
//      plus every event of a calendar switched to "Show on Meal Plan" — including
//      a subscribed (read-only) feed, read from this device's feed cache.
//   2. Each member's personal share of that is copied into the shared `eat`
//      section (state.mealPlanSharedEvents[userId]) as a small snapshot — title,
//      times and repeat rule only — so the rest of the household sees it too.
import { normalizeRecurrence } from "./recurrence.js";
import { normalizeExternalEvent } from "./normalize.js";
import { sourceFromPlanCalendar } from "./sources.js";
import { hiddenIdSet, titleOverrideMap } from "./reconcile.js";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{1,2}:\d{2}$/;
export const SHARE_WINDOW_DAYS = 126; // 18 weeks: one back, the rest ahead

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysKey(key, days) {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

// The snapshot covers a fixed window that only moves once a week (the Sunday
// before last), so a copy made on Monday is still the same copy on Thursday.
export function shareWindowStart(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - date.getDay() - 7);
  return dateKey(date);
}

export function shareWindowEnd(startKey) {
  return addDaysKey(startKey, SHARE_WINDOW_DAYS);
}

// { calendarId: true } — which calendars are switched to "Show on Meal Plan".
export function normalizeMealPlanCalendarFlags(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, on] of Object.entries(value)) {
    if (id && typeof on === "boolean") out[id] = on;
  }
  return out;
}

// Everything one calendar scope puts on the meal plan.
//   scope    — that scope's plan-section data ({ planEvents, planCalendars,
//              planMealPlanCalendars, planExternalExclusions, planExternalOverrides })
//   cacheFor — (calendar) => this device's fetched feed events, or null if the
//              feed hasn't been fetched here
// Returns { events, uncachedCalendarIds }: `events` are full event objects, each
// with `color` resolved and `external: true` on feed events; the ids are the
// switched-on feeds this device holds no copy of.
export function mealPlanEventsFromScope(scope, cacheFor = () => null) {
  const events = [];
  const uncachedCalendarIds = [];
  if (!scope || typeof scope !== "object") return { events, uncachedCalendarIds };
  const calendars = Array.isArray(scope.planCalendars) ? scope.planCalendars : [];
  const flags = normalizeMealPlanCalendarFlags(scope.planMealPlanCalendars);
  const calendarById = new Map(calendars.map((cal) => [cal.id, cal]));

  for (const event of Array.isArray(scope.planEvents) ? scope.planEvents : []) {
    if (!event?.id) continue;
    if (!event.showInMealPlan && !(event.calendarId && flags[event.calendarId])) continue;
    events.push({ ...event, color: event.color || calendarById.get(event.calendarId)?.color || null });
  }

  const hidden = hiddenIdSet(scope.planExternalExclusions);
  const renamed = titleOverrideMap(scope.planExternalOverrides);
  for (const cal of calendars) {
    if (!cal?.id || !cal.url || cal.enabled === false || !flags[cal.id]) continue;
    const cached = cacheFor(cal);
    if (!Array.isArray(cached)) { uncachedCalendarIds.push(cal.id); continue; }
    const source = sourceFromPlanCalendar(cal);
    for (const raw of cached) {
      const event = normalizeExternalEvent(raw, source);
      if (!event.externalId || hidden.has(event.id)) continue;
      events.push({ ...event, title: renamed.get(event.id) || event.title, external: true });
    }
  }
  return { events, uncachedCalendarIds };
}

// The few fields the meal plan needs from an event — nothing else leaves the
// owner's calendar (no notes, location, attachment or chores).
export function slimSharedEvent(event) {
  const title = String(event?.title || "").trim();
  const date = String(event?.date || "");
  if (!event?.id || !title || !DATE_KEY.test(date)) return null;
  const startTime = CLOCK.test(String(event.startTime || "")) ? String(event.startTime) : null;
  const slim = {
    id: String(event.id),
    title,
    date,
    endDate: DATE_KEY.test(String(event.endDate || "")) && event.endDate > date ? event.endDate : null,
    allDay: event.allDay !== false || !startTime,
    startTime,
    endTime: startTime && CLOCK.test(String(event.endTime || "")) ? String(event.endTime) : null,
    recurrence: normalizeRecurrence(event.recurrence),
    exceptions: Array.isArray(event.exceptions) ? event.exceptions.filter((d) => DATE_KEY.test(String(d))).sort() : [],
    color: event.color ? String(event.color) : null
  };
  if (event.external) {
    slim.external = true;
    slim.calendarId = String(event.calendarId || "");
  }
  return slim;
}

function touchesWindow(event, startKey, endKey) {
  if (event.recurrence) return event.date <= endKey && (!event.recurrence.until || event.recurrence.until >= startKey);
  return event.date <= endKey && (event.endDate || event.date) >= startKey;
}

// The snapshot one member shares: their personal scope's meal-plan events inside
// the window, slimmed and in a stable order (so the same data always produces
// the same copy, whichever of their devices builds it). A switched-on feed this
// device hasn't fetched keeps the events the previous copy held for it.
export function buildSharedSnapshot(scope, { cacheFor, previous, now } = {}) {
  const windowStart = shareWindowStart(now);
  const windowEnd = shareWindowEnd(windowStart);
  const { events, uncachedCalendarIds } = mealPlanEventsFromScope(scope, cacheFor);
  const carried = new Set(uncachedCalendarIds);
  const kept = (Array.isArray(previous?.events) ? previous.events : [])
    .filter((event) => event?.external && carried.has(event.calendarId));
  const byId = new Map();
  for (const event of [...events, ...kept]) {
    const slim = slimSharedEvent(event);
    if (slim && !byId.has(slim.id) && touchesWindow(slim, windowStart, windowEnd)) byId.set(slim.id, slim);
  }
  return {
    windowStart,
    events: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  };
}

// state.mealPlanSharedEvents: { [userId]: { updatedAt, windowStart, events } }.
export function normalizeMealPlanSharedEvents(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [userId, entry] of Object.entries(value)) {
    if (!userId || !entry || typeof entry !== "object") continue;
    out[userId] = {
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      windowStart: DATE_KEY.test(String(entry.windowStart || "")) ? entry.windowStart : "",
      events: (Array.isArray(entry.events) ? entry.events : []).map(slimSharedEvent).filter(Boolean)
    };
  }
  return out;
}

// Each member only ever rewrites their own entry, as a whole: the later copy wins
// per member, and neither side's members are dropped.
export function mergeMealPlanSharedEvents(newer, older) {
  const a = normalizeMealPlanSharedEvents(newer);
  const b = normalizeMealPlanSharedEvents(older);
  const out = { ...b };
  for (const [userId, entry] of Object.entries(a)) {
    if (!out[userId] || entry.updatedAt >= out[userId].updatedAt) out[userId] = entry;
  }
  return out;
}

// What a device shows on its meal plan: its own two calendar scopes read live
// (first, so the owner always sees current data), then what the household shared.
// From its OWN snapshot a device takes only the feeds it holds no copy of.
//   liveScopes — [mealPlanEventsFromScope(...) results], active scope first
//   shared     — state.mealPlanSharedEvents
//   userId     — the signed-in member ("" when signed out / local dev)
// Events that came from someone else's snapshot carry `sharedBy: userId`.
export function mealPlanDisplayEvents(liveScopes, shared, userId = "") {
  const byId = new Map();
  const uncached = new Set();
  for (const scope of liveScopes || []) {
    for (const event of scope?.events || []) if (!byId.has(event.id)) byId.set(event.id, event);
    for (const id of scope?.uncachedCalendarIds || []) uncached.add(id);
  }
  for (const [ownerId, entry] of Object.entries(normalizeMealPlanSharedEvents(shared))) {
    const own = Boolean(userId) && ownerId === userId;
    for (const event of entry.events) {
      if (byId.has(event.id)) continue;
      if (own && !(event.external && uncached.has(event.calendarId))) continue;
      byId.set(event.id, own ? event : { ...event, sharedBy: ownerId });
    }
  }
  return [...byId.values()];
}
