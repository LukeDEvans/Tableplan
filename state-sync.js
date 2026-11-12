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

// ── Per-view delete lists ────────────────────────────────────────────────────
// A section with a row per view (Listen, Watch, Tasks, Calendar…) holds the SAME
// key in each row, so one list of deleted ids per key removed an item from every
// view that held that id: "remove from the household list" also removed it from
// Personal (ISSUES.md, 2026-10-27). A delete made in such a section is therefore
// recorded twice: under the plain key — which builds from before this change
// read, and which keeps every older delete working — and under `key@owner`,
// where the owner names the row it was made in (the person, the household or the
// business). A build that knows the owners applies a plain entry everywhere
// EXCEPT where it is accounted for by another owner's entry.
export const TOMBSTONE_OWNER_SEP = "@";

export function ownedTombstoneKey(key, owner) {
  return `${key}${TOMBSTONE_OWNER_SEP}${owner}`;
}

/** The deleted ids that apply to `key` in the row `owner` owns.
 *  owner null/"" = a key with one row for everyone, or a row that can't be named
 *  yet (not signed in): then only deletes no owner accounts for apply — holding a
 *  delete back heals at the next merge, applying another view's does not. */
export function tombstoneIdsFor(tombstones, key, owner = null) {
  const plain = Array.isArray(tombstones?.[key]) ? tombstones[key] : [];
  const prefix = key + TOMBSTONE_OWNER_SEP;
  let own = null;
  let others = null;
  for (const k of Object.keys(tombstones || {})) {
    if (!k.startsWith(prefix) || !Array.isArray(tombstones[k])) continue;
    if (owner && k === prefix + owner) own = tombstones[k].map(String);
    else (others || (others = [])).push(...tombstones[k].map(String));
  }
  if (!own && !others) return plain;
  const mine = new Set(own || []);
  const elsewhere = new Set((others || []).filter((id) => !mine.has(id)));
  return [...new Set([...mine, ...plain.map(String).filter((id) => !elsewhere.has(id))])];
}

/** A plain map (key → ids) of the deletes that apply now: every key resolved for
 *  the row `ownerOf(key)` names. With no owned entries it is the map itself. */
export function effectiveTombstones(tombstones, ownerOf = () => null) {
  const src = tombstones && typeof tombstones === "object" ? tombstones : {};
  const keys = Object.keys(src);
  if (!keys.some((k) => k.includes(TOMBSTONE_OWNER_SEP))) return src;
  const out = {};
  for (const k of keys) {
    const at = k.indexOf(TOMBSTONE_OWNER_SEP);
    const base = at === -1 ? k : k.slice(0, at);
    if (!(base in out)) out[base] = tombstoneIdsFor(src, base, ownerOf(base) || null);
  }
  return out;
}

/** Record a delete (in place): under the plain key and, with an owner, under the
 *  owner's key too. Each list keeps its newest `max` ids. */
export function addTombstone(tombstones, key, id, owner = null, max = Infinity) {
  const idStr = String(id);
  for (const k of owner ? [key, ownedTombstoneKey(key, owner)] : [key]) {
    if (!Array.isArray(tombstones[k])) tombstones[k] = [];
    if (!tombstones[k].includes(idStr)) tombstones[k].push(idStr);
    if (tombstones[k].length > max) tombstones[k] = tombstones[k].slice(-max);
  }
}

/** Take a delete back (in place), e.g. when the item is restored. */
export function removeTombstone(tombstones, key, id, owner = null) {
  const idStr = String(id);
  for (const k of owner ? [key, ownedTombstoneKey(key, owner)] : [key]) {
    if (Array.isArray(tombstones?.[k])) tombstones[k] = tombstones[k].filter((t) => t !== idStr);
  }
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
