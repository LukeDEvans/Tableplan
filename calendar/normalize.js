// External event → canonical Event normalization (§13-14). Local events and
// external events must converge to the SAME canonical representation before they
// reach the Calendar renderer. This turns a raw provider event (e.g. the ICS
// parser's output: { uid, title, date, startTime, endTime, endDate, allDay,
// notes, location, recurrence, exceptions }) into a canonical event that carries
// stable external identity, so re-import reconciles instead of duplicating.
//
// Pure and dependency-free.

// The canonical id for an external event: source id + the provider's own id.
// Stable across syncs, so the reconcile layer can recognize the same event again.
export function externalEventId(sourceId, externalId) {
  return `${sourceId}:${externalId}`;
}

// Normalize one raw provider event against its CalendarSource. Raw fields are
// preserved (so notes/location/recurrence/exceptions survive for the detail
// panel and expansion), and identity + source/colour/bucket are layered on.
//
// Faithful to today's render path, which built:
//   { ...e, id: `${cal.id}:${e.uid}`, source: "ical",
//     calendarId: cal.id, color: cal.color, calendarName: cal.name }
// — this adds sourceId / externalId / provider / readOnly on top.
export function normalizeExternalEvent(raw, source) {
  const externalId = String(raw?.uid ?? raw?.externalId ?? "").trim();
  return {
    ...raw,
    id: externalEventId(source.id, externalId),
    externalId,
    sourceId: source.id,
    provider: source.provider,
    readOnly: source.readOnly !== false,
    // Existing render/CSS + the read-only click handler key off source === "ical";
    // all read-only external providers reuse that tag so their events look like
    // ordinary calendar events (§9), colored by their owning Calendar.
    source: "ical",
    calendarId: source.calendarId ?? source.id,
    calendarName: source.name ?? raw?.calendarName ?? "",
    color: source.color ?? raw?.color ?? null
  };
}

// Normalize a whole feed for a source.
export function normalizeExternalEvents(rawEvents, source) {
  return (Array.isArray(rawEvents) ? rawEvents : []).map((e) => normalizeExternalEvent(e, source));
}
