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

// ── Section write bookkeeping (writeStateToSupabase) ─────────────────────────
// `lastWrittenSections[section]` is the JSON the server is known to hold for a
// section because WE wrote it (or just loaded it). The invariant that keeps edits
// from being lost: it may only ever record JSON that was actually SENT and
// ACKNOWLEDGED — never the live state at some later moment. Recording live state
// after an awaited write marked edits made DURING the in-flight write as clean,
// so they were never sent (INF-1).

/**
 * Which sections differ from what the server last acknowledged.
 * @param {Object<string,string[]>} sections  STATE_SECTIONS
 * @param {(keys:string[]) => string} sectionJson  current JSON for a section's keys
 * @param {Object<string,string>|null} lastWritten  null ⇒ everything is dirty
 * @param {(section:string) => boolean} [skip]  sections that must not be written now
 * @returns {{section:string, keys:string[], json:string}[]}
 */
export function computeDirtySections(sections, sectionJson, lastWritten, skip = () => false) {
  const dirty = [];
  for (const [section, keys] of Object.entries(sections)) {
    if (skip(section)) continue;
    const json = sectionJson(keys);
    if (!lastWritten || lastWritten[section] !== json) dirty.push({ section, keys, json });
  }
  return dirty;
}

/**
 * Write every dirty section concurrently; one failure never blocks recording the
 * others. `writeOne(entry)` resolves with the JSON it actually sent (it may differ
 * from entry.json when a conflict merge rewrote the section before retrying); a
 * non-string resolution falls back to the JSON captured when the write was planned.
 * @returns {Promise<{written: Object<string,string>, error: any}>}
 *   written — section → acknowledged JSON (successes only); error — first failure or null
 */
export async function writeDirtySections(dirty, writeOne) {
  const results = await Promise.allSettled(dirty.map((entry) => writeOne(entry)));
  const written = {};
  let error = null;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") written[dirty[i].section] = typeof r.value === "string" ? r.value : dirty[i].json;
    else if (error === null) error = r.reason ?? new Error(`section "${dirty[i].section}" write failed`);
  });
  return { written, error };
}

// ── Resume refresh (ISSUES.md "app never re-reads cloud state on resume") ──
// When the app comes back to the foreground it asks the server only for each
// section row's updated_at (a few KB), then downloads just the rows whose stamp
// differs from the one this session last saw. Bounded: runs only on a return
// to the foreground, at most once per interval, never while one is in flight.

/** Ids of probed rows ({id, updated_at}) whose stamp differs from the last-seen
 *  stamp map — including rows this session has never seen. */
export function changedSectionRowIds(probeRows, lastSeenStamps) {
  return (probeRows || [])
    .filter((r) => r && r.id && r.updated_at && lastSeenStamps?.[r.id] !== r.updated_at)
    .map((r) => r.id);
}

/** True when a resume check may run: none in flight and at least minIntervalMs
 *  since the last one started (0 = never checked). */
export function resumeCheckDue({ now, lastCheckAt, inFlight, minIntervalMs }) {
  if (inFlight) return false;
  return !lastCheckAt || now - lastCheckAt >= minIntervalMs;
}
