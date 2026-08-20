// State synchronization core — the pure merge primitives that power cross-device
// sync (ARCHITECTURE.md §11). Extracted from app.js's mergeStates() so the
// highest-risk data-model logic is directly unit-tested. These are the building
// blocks; mergeStates() still orchestrates the per-section merge in app.js and
// delegates to these. Pure, DOM-free, no app state.
//
// The core guarantee: a sync between two devices must never LOSE an addition and
// never let a just-booted (empty) client ERASE populated cloud data — while real
// deletions still propagate via tombstones. `unionById` and `unionByKey` both
// preserve the other side's data when one side is empty (empty-never-erases);
// tombstones are the explicit opt-out that lets a genuine delete win.

/**
 * Union two id-keyed arrays, newer (a) winning on id collision. Records without a
 * stable `id` are dropped (they can't be merged safely). A tombstone Set removes
 * ids deleted on either device. Empty `a` → keeps all of `b` (empty never erases).
 * @param {Array} a   newer side (wins on collision)
 * @param {Array} b   older side (base)
 * @param {Set<string>|null} tombstonedSet  stringified ids to exclude, or null
 */
export function unionById(a, b, tombstonedSet = null) {
  const map = new Map((b || []).filter((x) => x?.id != null).map((x) => [x.id, x]));
  (a || []).filter((x) => x?.id != null).forEach((x) => map.set(x.id, x));
  const arr = [...map.values()];
  return tombstonedSet ? arr.filter((x) => !tombstonedSet.has(String(x.id))) : arr;
}

/** Union two string arrays into a de-duped, blank-stripped set (order: a then b). */
export function unionStrings(a, b) {
  return [...new Set([...(a || []), ...(b || [])].map(String).filter(Boolean))];
}

/** Union two flat keyed maps; newer (a) keys win on conflict. Empty a keeps b. */
export function unionByKey(a, b) {
  return { ...(b || {}), ...(a || {}) };
}

/** Combine two tombstone maps (key → id[]) by unioning each key's id list. */
export function mergeTombstones(a, b) {
  const result = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    result[key] = [...new Set([...(a?.[key] || []), ...(b?.[key] || [])])];
  }
  return result;
}

/** Resolve a tombstone Set for a given key from a tombstones map (or null).
 *  Matches mergeStates() exactly: ids are stored as strings and unionById
 *  compares String(x.id) against the set. */
export function tombstoneSetFor(tombstones, key) {
  return key && tombstones?.[key]?.length ? new Set(tombstones[key]) : null;
}
