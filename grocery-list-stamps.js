// grocery-list-stamps.js — add/remove timestamps for the manual grocery list
// (state.persistentManualGroceries, a plain list of strings).
//
// Why: sync merges that list by UNION, so an item removed on one device came back
// whenever an older copy that still had it merged in (Luke, 2026-09-29: fix with
// timestamped removals, keep the plain-string list). Each item name (normalized
// like the grocery code's normalize()) gets { added?, removed? } ISO stamps in
// state.persistentManualGroceryStamps; after any merge or load an item stays only
// if it wasn't removed, or was added again after its removal.
//
// Pure: no state, no clock reads (callers pass `now`), fully unit-tested.

export const GROCERY_STAMPS_KEY = "persistentManualGroceryStamps";
const KEEP_DAYS = 120; // stamps older than this, for items no longer listed, are pruned

// Same normalization as the grocery code's normalize() (so "2 Eggs" ~ "eggs").
export function groceryKey(value) {
  return String(value || "").toLowerCase().replace(/^[\d\s./-]+/, "").replace(/\s+/g, " ").trim();
}

function isoOr(v) {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined;
}

export function normalizeGroceryStamps(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!k || !v || typeof v !== "object") continue;
    const added = isoOr(v.added), removed = isoOr(v.removed);
    if (added || removed) out[k] = { ...(added ? { added } : {}), ...(removed ? { removed } : {}) };
  }
  return out;
}

const later = (a, b) => (!a ? b : !b ? a : (Date.parse(a) >= Date.parse(b) ? a : b));

// Record an add / a removal. Mutates and returns `stamps` (callers own it on state).
export function stampGroceryAdd(stamps, item, now) {
  const k = groceryKey(item);
  if (!k) return stamps;
  stamps[k] = { ...(stamps[k] || {}), added: now };
  return stamps;
}
export function stampGroceryRemove(stamps, item, now) {
  const k = groceryKey(item);
  if (!k) return stamps;
  stamps[k] = { ...(stamps[k] || {}), removed: now };
  return stamps;
}

// Stamp whatever changed between two versions of the list (rename, bulk edits,
// assistant Undo). Keys present only in `before` are removals; only in `after`,
// adds.
export function stampGroceryListDiff(stamps, before, after, now) {
  const b = new Set((before || []).map(groceryKey).filter(Boolean));
  const a = new Set((after || []).map(groceryKey).filter(Boolean));
  for (const k of b) if (!a.has(k)) stamps[k] = { ...(stamps[k] || {}), removed: now };
  for (const k of a) if (!b.has(k)) stamps[k] = { ...(stamps[k] || {}), added: now };
  return stamps;
}

// Removed and not re-added since.
export function isGroceryRemoved(stamps, item) {
  const s = stamps?.[groceryKey(item)];
  if (!s?.removed) return false;
  return !(s.added && Date.parse(s.added) > Date.parse(s.removed));
}

// Merge two devices' stamps: the later time wins for each of added / removed.
export function mergeGroceryStamps(a, b) {
  const A = normalizeGroceryStamps(a), B = normalizeGroceryStamps(b);
  const out = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const added = later(A[k]?.added, B[k]?.added);
    const removed = later(A[k]?.removed, B[k]?.removed);
    out[k] = { ...(added ? { added } : {}), ...(removed ? { removed } : {}) };
  }
  return out;
}

// The list with removed items taken out (order preserved).
export function applyGroceryStamps(list, stamps) {
  return (Array.isArray(list) ? list : []).filter((item) => !isGroceryRemoved(stamps, item));
}

// Drop stamps that can no longer matter: older than KEEP_DAYS and for items not on
// the list. (A device offline longer than that could still resurrect an item —
// accepted; it's the same window as a plain re-add.)
export function pruneGroceryStamps(stamps, list, now, keepDays = KEEP_DAYS) {
  const cutoff = Date.parse(now) - keepDays * 86400000;
  const listed = new Set((list || []).map(groceryKey));
  const out = {};
  for (const [k, s] of Object.entries(normalizeGroceryStamps(stamps))) {
    const newest = Math.max(Date.parse(s.added || 0) || 0, Date.parse(s.removed || 0) || 0);
    if (listed.has(k) || newest >= cutoff) out[k] = s;
  }
  return out;
}
