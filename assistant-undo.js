// assistant-undo.js — pure undo records for assistant tool calls.
//
// Before a write tool runs, the shell snapshots the top-level state keys that
// tool touches; after it runs, it fingerprints them. Undo is offered only while
// every one of those keys is still exactly as the tool left it — so undo can
// never clobber an edit Luke (or another device's sync) made afterwards.
//
// Sync merges id-keyed arrays by UNION with tombstones (mergeStates), so undo
// has to speak that language in both directions:
//  • undoing a DELETE: tombstones are unioned across devices, so a restored item
//    that kept its old id would be deleted again by the next sync. Undo never
//    removes tombstones; any restored item whose id the tool tombstoned comes
//    back under a fresh id instead.
//  • undoing an ADD: the added item may already have synced, and a plain removal
//    would be re-added by the union. Undo returns `deletions` for the shell to
//    tombstone (recordDeletion) alongside the patch.

// Top-level state keys each write tool mutates. A write tool missing here is not
// undoable (the shell simply shows no Undo button for it).
export const UNDO_KEYS = Object.freeze({
  add_task: ["doPlans", "doBacklog"],
  complete_task: ["doPlans", "doBacklog"],
  update_task: ["doPlans", "doBacklog"],
  delete_task: ["doPlans", "doBacklog"],
  add_grocery_item: ["persistentManualGroceries"],
  remove_grocery_item: ["persistentManualGroceries"],
  set_meal: ["plans"],
  add_to_watchlist: ["watchItems"],
  mark_watched: ["watchItems"],
  add_book: ["readingItems"],
  update_book_status: ["readingItems"],
  remove_from_list: ["watchItems", "readingItems"],
  log_meal: ["foodLogEntries"],
  log_checklist_entry: ["dailyChecklistEntries"],
  add_event: ["planEvents"],
  update_event: ["planEvents"],
  delete_event: ["planEvents"],
  log_workout: ["workouts"],
  add_workout: ["workouts"],
  add_piano_song: ["pianoSongs"],
  write_note: ["aiNotes"],
  update_note: ["aiNotes"],
  forget_note: ["aiNotes"],
  add_travel_idea: ["travelIdeas"],
  add_trip: ["trips", "planEvents"],
  add_trip_itinerary_day: ["trips"],
  add_trip_expense: ["trips"],
  generate_packing_list: ["trips"],
});

// State key → the tombstone key mergeStates filters it by. doPlans is nested
// ({ weekKey: { dayId: [task] } }) and uses the "doPlanTasks" key for its tasks.
const TOMBSTONE_KEYS = Object.freeze({
  planEvents: "planEvents", watchItems: "watchItems", readingItems: "readingItems",
  foodLogEntries: "foodLogEntries", dailyChecklistEntries: "dailyChecklistEntries",
  trips: "trips", travelIdeas: "travelIdeas", workouts: "workouts", pianoSongs: "pianoSongs",
  doBacklog: "doBacklog", doPlans: "doPlanTasks",
});

function itemIds(key, value) {
  const ids = new Set();
  const addArray = (arr) => arr.forEach((x) => { if (x && x.id != null) ids.add(String(x.id)); });
  if (key === "doPlans") {
    for (const week of Object.values(value || {})) {
      for (const tasks of Object.values(week || {})) if (Array.isArray(tasks)) addArray(tasks);
    }
  } else if (Array.isArray(value)) {
    addArray(value);
  }
  return ids;
}

export function undoKeysFor(toolName) {
  return UNDO_KEYS[toolName] || null;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function fingerprint(v) {
  return v === undefined ? "∅" : JSON.stringify(v);
}

function tombstoneIds(state) {
  const out = new Set();
  for (const ids of Object.values(state?.tombstones || {})) {
    if (Array.isArray(ids)) ids.forEach((id) => out.add(String(id)));
  }
  return out;
}

// Call BEFORE running the tool. Returns null for non-undoable tools.
export function captureBefore(state, toolName) {
  const keys = undoKeysFor(toolName);
  if (!keys) return null;
  const before = {};
  for (const k of keys) before[k] = clone(state?.[k]);
  return { tool: toolName, keys, before, tombstonesBefore: [...tombstoneIds(state)] };
}

// Call AFTER the tool ran. Returns the finished undo record, or null when the
// tool changed nothing (e.g. "no task found") — nothing to undo.
export function captureAfter(state, pending) {
  if (!pending) return null;
  const after = {};
  let changed = false;
  for (const k of pending.keys) {
    after[k] = fingerprint(state?.[k]);
    if (after[k] !== fingerprint(pending.before[k])) changed = true;
  }
  if (!changed) return null;
  const was = new Set(pending.tombstonesBefore);
  const newTombstones = [...tombstoneIds(state)].filter((id) => !was.has(id));
  return { tool: pending.tool, keys: pending.keys, before: pending.before, after, newTombstones, undone: false };
}

// Undo is safe only while every touched key is unchanged since the tool ran.
export function canUndo(state, record) {
  if (!record || record.undone) return false;
  return record.keys.every((k) => fingerprint(state?.[k]) === record.after[k]);
}

// Give every object (at any depth) whose `id` is in `ids` a fresh id.
function reIdDeep(value, ids, makeId) {
  if (Array.isArray(value)) return value.map((v) => reIdDeep(v, ids, makeId));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = reIdDeep(v, ids, makeId);
    if (out.id != null && ids.has(String(out.id))) out.id = makeId();
    return out;
  }
  return value;
}

// What undoing `record` takes: { patch: { key: restoredValue }, deletions:
// [{ key: tombstoneKey, id }] } — or null when undo is no longer safe.
// `makeId` mints replacement ids for resurrected items.
export function buildUndo(state, record, makeId) {
  if (!canUndo(state, record)) return null;
  const tomb = new Set(record.newTombstones || []);
  const patch = {};
  const deletions = [];
  for (const k of record.keys) {
    const restored = clone(record.before[k]);
    patch[k] = tomb.size ? reIdDeep(restored, tomb, makeId) : restored;
    const tk = TOMBSTONE_KEYS[k];
    if (!tk) continue;
    const keep = itemIds(k, patch[k]);
    for (const id of itemIds(k, state?.[k])) if (!keep.has(id)) deletions.push({ key: tk, id });
  }
  return { patch, deletions };
}
