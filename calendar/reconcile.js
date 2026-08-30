// External-event reconciliation (§14-16). Pure functions that decide, on each
// sync, which incoming external events are new / changed / gone, and that apply
// the two kinds of local intent that must survive a re-sync:
//
//   • local EXCLUSION (§16): a read-only external event the user hid. The source
//     event still exists, so it keeps arriving — we must keep hiding it rather
//     than pretending the source deleted it.
//   • local OVERRIDE (§15): a field the user changed locally (e.g. a nicer
//     title). Source-controlled fields keep updating on sync; the overridden
//     field wins until reset.
//
// No app state, no IO — callers own persistence and merge. This module is ready
// to wire once the persistence/UI decision (plan Fork 2) is made.

// Source-controlled fields whose change means "this external event changed".
const SOURCE_FIELDS = ["title", "date", "startTime", "endTime", "endDate", "allDay", "notes", "location", "recurrence", "exceptions"];

function sourceSignature(ev) {
  return JSON.stringify(SOURCE_FIELDS.map((f) => ev?.[f] ?? null));
}

// Layer a per-event override map over a canonical event. Returns a new object;
// records which fields are locally overridden so the UI can offer "reset".
export function applyOverride(event, override) {
  if (!override || typeof override !== "object") return event;
  const keys = Object.keys(override).filter((k) => override[k] !== undefined);
  if (!keys.length) return event;
  return { ...event, ...override, _overriddenFields: keys };
}

// Remove one overridden field (reset to source value); returns a new overrides
// map for that event, or null when nothing remains.
export function resetOverrideField(override, field) {
  if (!override) return null;
  const next = { ...override };
  delete next[field];
  return Object.keys(next).length ? next : null;
}

// The persisted hide/unhide list is an array of toggle records
// { id, hidden, title, at } — a `hidden` flag (not a tombstone) so hide/unhide
// sync as a newer-wins field. These two helpers own that list's semantics (§16).

// The set of event ids currently hidden.
export function hiddenIdSet(records) {
  return new Set((records || []).filter((r) => r && r.hidden && r.id).map((r) => r.id));
}

// Upsert a toggle record; returns a new list (never mutates).
export function toggleExclusion(records, id, hidden, title = "") {
  const list = [...(records || [])];
  const at = new Date().toISOString();
  const i = list.findIndex((r) => r && r.id === id);
  if (i >= 0) list[i] = { ...list[i], hidden, at };
  else list.push({ id, hidden, title, at });
  return list;
}

// Local title-override records: { id, title, at }. A non-empty title renames the
// external event locally; empty is the reset state. These helpers own that list
// (§15), mirroring the exclusion helpers above.
export function titleOverrideMap(records) {
  const m = new Map();
  for (const r of records || []) if (r && r.id && r.title) m.set(r.id, r.title);
  return m;
}

export function upsertTitleOverride(records, id, title) {
  const list = [...(records || [])];
  const clean = String(title || "").trim();
  const at = new Date().toISOString();
  const i = list.findIndex((r) => r && r.id === id);
  if (i >= 0) list[i] = { ...list[i], title: clean, at };
  else list.push({ id, title: clean, at });
  return list;
}

// Drop excluded events from a list. `exclusions` may be a Set or an array of ids.
export function applyExclusions(events, exclusions) {
  if (!exclusions) return events;
  const set = exclusions instanceof Set ? exclusions : new Set(exclusions);
  if (!set.size) return events;
  return events.filter((e) => !set.has(e.id));
}

// Reconcile a source's incoming events against what we last saw.
//
//   previous:  array (or Map) of the source's canonical events from last sync
//   incoming:  array of freshly-normalized canonical events for the source
//   options.exclusions: Set/array of hidden event ids (§16)
//   options.overrides:  { [eventId]: { field: value } } local edits (§15)
//
// Returns { events, added, updated, unchanged, removed } where:
//   events    = the live set (incoming, minus exclusions, with overrides applied)
//   added     = ids present now but not before
//   updated   = ids present in both whose source signature changed
//   unchanged = ids present in both, unchanged
//   removed   = ids present before but gone from the source now (true deletions)
export function reconcile(previous, incoming, options = {}) {
  const prevMap = previous instanceof Map
    ? previous
    : new Map((previous || []).map((e) => [e.id, e]));
  const overrides = options.overrides || {};
  const exclusionSet = options.exclusions instanceof Set
    ? options.exclusions
    : new Set(options.exclusions || []);

  const added = [], updated = [], unchanged = [];
  const seen = new Set();
  const events = [];

  for (const ev of incoming || []) {
    seen.add(ev.id);
    const prior = prevMap.get(ev.id);
    if (!prior) added.push(ev.id);
    else if (sourceSignature(prior) !== sourceSignature(ev)) updated.push(ev.id);
    else unchanged.push(ev.id);

    if (exclusionSet.has(ev.id)) continue; // §16: stay hidden across re-sync
    events.push(applyOverride(ev, overrides[ev.id])); // §15: local edits win
  }

  const removed = [];
  for (const id of prevMap.keys()) if (!seen.has(id)) removed.push(id);

  return { events, added, updated, unchanged, removed };
}
