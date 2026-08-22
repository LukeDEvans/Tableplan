// Calendar source abstraction (§10-11). A CalendarSource describes WHERE events
// come from and how they behave, decoupled from the UI: local and external events
// converge to the same canonical Event before rendering, and the Calendar UI does
// not fundamentally change based on a source's provider or read/write capability.
//
// Today the only external provider is ICS (subscribed iCal feeds, stored as
// `planCalendars`). This module generalizes that into a provider registry so a
// future provider (e.g. Amion) is a straightforward addition rather than a
// parallel pipeline — Amion becomes `provider: "amion"` reusing the ICS parser.
//
// Pure and dependency-free: no app state, no IO.

const PROVIDERS = new Map();

// Register a provider descriptor. `readOnly` providers can be synced but not
// written back to; the UI treats their events as normal, colored by their
// owning Calendar (§9) — never as a separate "imported" category.
export function registerProvider(descriptor) {
  if (!descriptor?.id) throw new Error("provider needs an id");
  const normalized = {
    id: String(descriptor.id),
    label: String(descriptor.label || descriptor.id),
    readOnly: descriptor.readOnly !== false, // default read-only (safe)
    writable: descriptor.writable === true
  };
  PROVIDERS.set(normalized.id, normalized);
  return normalized;
}

export function getProvider(id) {
  return PROVIDERS.get(String(id)) || null;
}

export function listProviders() {
  return [...PROVIDERS.values()];
}

export function providerIsReadOnly(id) {
  const p = getProvider(id);
  return p ? p.readOnly : true; // unknown providers are treated as read-only
}

// ICS is the built-in read-only provider. Amion will register alongside it later.
registerProvider({ id: "ics", label: "iCal / ICS subscription", readOnly: true });

// Bridge from today's stored subscription shape (`planCalendars` entry) to a
// generalized CalendarSource. Data is NOT moved — this is a read-only view over
// the existing collection, so the two-list question stays open (see plan Fork 2).
//
// Note: today a subscription doubles as the event's organizational Calendar
// bucket (event.calendarId === the subscription id), so calendarId defaults to
// the source id until buckets are separated from sources.
export function sourceFromPlanCalendar(cal) {
  return {
    id: cal.id,                       // stable source id
    provider: "ics",
    calendarId: cal.id,               // owning Calendar bucket (§8)
    name: cal.name || "Calendar",
    color: cal.color || null,
    url: cal.url || "",
    enabled: cal.enabled !== false,
    readOnly: true,
    syncState: { lastFetched: cal.lastFetched || null }
  };
}
