// stamped-lists.js — add/remove stamps for small id-keyed lists that used to
// merge "newer copy wins" (ISSUES 2026-10-06; fixed 2026-11-17).
//
// Why: a device holding an EMPTY copy of such a list (fresh install, an old tab,
// a boot before the cloud copy arrived) that saved anything counted as newer and
// erased the list everywhere — how the Shop checklist's 22 items were lost on
// 2026-10-01. These lists now merge by UNION, and each id carries
// { added?, removed? } ISO stamps; after a merge an item stays unless it was
// removed after it was (last) added. Re-adding after a removal works, unlike a
// permanent tombstone.
//
// Stamps are made in one place, persist(): the ids now in each list are compared
// with the ids at the last persist() / cloud load (the baseline), the same way
// settings are stamped (settings-sync.js). So no add/remove button needs to
// change, and a device that booted empty stamps nothing until the cloud copy
// has loaded.
//
// Pure: no state, no clock reads (callers pass `now`).

// Which lists, where their stamps live (one stamps key per state section, since a
// key belongs to exactly one section), and how to read an item's id.
export const STAMPED_LISTS = Object.freeze({
  radioFavorites:        { stampsKey: "mediaListStamps", id: (x) => x?.id },
  radioFollowedPrograms: { stampsKey: "mediaListStamps", id: (x) => x?.id },
  nextStopItems:         { stampsKey: "groceryNextStopStamps",  id: (x) => x?.id },
});
export const STAMPS_KEYS = Object.freeze(["mediaListStamps", "groceryNextStopStamps"]);
const KEEP_DAYS = 120; // stamps for ids no longer listed are pruned after this

const iso = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
const later = (a, b) => (!a ? b : !b ? a : (Date.parse(a) >= Date.parse(b) ? a : b));

function idsOf(list, idOf) {
  const out = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const id = idOf(item);
    if (id != null && id !== "") out.add(String(id));
  }
  return out;
}

/** Stamps map shape: { [listKey]: { [id]: { added?, removed? } } } — junk dropped. */
export function normalizeListStamps(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [listKey, byId] of Object.entries(raw)) {
    if (!STAMPED_LISTS[listKey] || !byId || typeof byId !== "object" || Array.isArray(byId)) continue;
    const clean = {};
    for (const [id, v] of Object.entries(byId)) {
      if (!id || !v || typeof v !== "object") continue;
      const added = iso(v.added), removed = iso(v.removed);
      if (added || removed) clean[id] = { ...(added ? { added } : {}), ...(removed ? { removed } : {}) };
    }
    if (Object.keys(clean).length) out[listKey] = clean;
  }
  return out;
}

/** Later stamp wins per id and per field. */
export function mergeListStamps(a, b) {
  const A = normalizeListStamps(a), B = normalizeListStamps(b);
  const out = {};
  for (const listKey of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[listKey] || {}, y = B[listKey] || {};
    const merged = {};
    for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const added = later(x[id]?.added, y[id]?.added), removed = later(x[id]?.removed, y[id]?.removed);
      merged[id] = { ...(added ? { added } : {}), ...(removed ? { removed } : {}) };
    }
    out[listKey] = merged;
  }
  return out;
}

/** True when the id's last removal is newer than its last add. */
export function isStampedRemoved(byId, id) {
  const s = byId?.[String(id)];
  if (!s?.removed) return false;
  return !s.added || Date.parse(s.removed) > Date.parse(s.added);
}

/**
 * Union two copies of a list (first copy's items win on duplicate ids, its order
 * first), then drop what the stamps say was removed.
 */
export function mergeStampedList(listKey, newer, older, stamps) {
  const { id: idOf } = STAMPED_LISTS[listKey];
  const byId = stamps?.[listKey] || {};
  const seen = new Set();
  const out = [];
  for (const item of [...(Array.isArray(newer) ? newer : []), ...(Array.isArray(older) ? older : [])]) {
    const id = idOf(item);
    if (id == null || id === "") continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isStampedRemoved(byId, key)) out.push(item);
  }
  return out;
}

/** The ids in each stamped list right now (persist() keeps this as its baseline). */
export function listSnapshot(state) {
  const out = {};
  for (const [listKey, { id }] of Object.entries(STAMPED_LISTS)) out[listKey] = idsOf(state?.[listKey], id);
  return out;
}

/**
 * Stamp what changed since `baseline` into state[stampsKey] (mutates state).
 * Returns the new baseline and the list keys that changed.
 */
export function stampListChanges(state, baseline, now) {
  const next = listSnapshot(state);
  const changed = [];
  for (const [listKey, { stampsKey }] of Object.entries(STAMPED_LISTS)) {
    const before = baseline?.[listKey] || new Set();
    const after = next[listKey];
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    if (!added.length && !removed.length) continue;
    const all = normalizeListStamps(state[stampsKey]);
    const byId = all[listKey] || (all[listKey] = {});
    for (const id of added) byId[id] = { ...(byId[id] || {}), added: now };
    for (const id of removed) byId[id] = { ...(byId[id] || {}), removed: now };
    state[stampsKey] = all;
    changed.push(listKey);
  }
  return { baseline: next, changed };
}

/** Drop stamps for ids no longer listed whose last stamp is older than keepDays. */
export function pruneListStamps(stamps, state, now, keepDays = KEEP_DAYS) {
  const all = normalizeListStamps(stamps);
  const cutoff = Date.parse(now) - keepDays * 86400000;
  for (const [listKey, byId] of Object.entries(all)) {
    const listed = idsOf(state?.[listKey], STAMPED_LISTS[listKey].id);
    for (const [id, s] of Object.entries(byId)) {
      const last = Math.max(Date.parse(s.added || 0) || 0, Date.parse(s.removed || 0) || 0);
      if (!listed.has(id) && last < cutoff) delete byId[id];
    }
    if (!Object.keys(byId).length) delete all[listKey];
  }
  return all;
}
