// ── Watch items: per-tick merge (WATCH_AUDIT.md decision 5; Luke, 2026-10-31) ──
//
// Two people (or two devices) ticking episodes of the same show must both
// stick. The old merge kept ONE side's whole item, so a tick made on the phone
// could be undone by the laptop's older copy of that show.
//
// Now every change carries its own time:
//   tickAt["<season>:<episode>"] — when that episode was ticked or unticked
//   tabsAt["<categoryId>"]       — when the show was put in or taken out of a tab
//   updatedAt                    — when anything else (status, rating, notes…)
//                                  was last changed by a person
// and the merge decides each episode and each tab on its own, by its own time.
// Data without stamps (written before this) keeps the old rule: the side that
// mergeStates calls "newer" wins.
//
// Episode lists are device data (watch-episodes.js), never synced: the merge
// drops any `episodeData` an older client still sends.
//
// Pure: no DOM, no storage, no clock unless one is passed in.

const nowIso = () => new Date().toISOString();

const tickKey = (season, episode) => `${Number(season)}:${Number(episode)}`;

/** Tick or untick one episode, stamping the change. */
export function stampTick(item, season, episode, on, at = nowIso()) {
  if (!item) return;
  if (!item.seasonProgress || typeof item.seasonProgress !== "object") item.seasonProgress = {};
  const sd = item.seasonProgress[season] || (item.seasonProgress[season] = {});
  if (!sd.episodes || typeof sd.episodes !== "object") sd.episodes = {};
  sd.episodes[episode] = !!on;
  if (!item.tickAt || typeof item.tickAt !== "object") item.tickAt = {};
  item.tickAt[tickKey(season, episode)] = at;
}

/** Put a show in a tab or take it out, stamping the change. */
export function stampTab(item, categoryId, on, at = nowIso()) {
  if (!item || !categoryId) return;
  const cats = Array.isArray(item.categories) ? item.categories : [];
  const has = cats.includes(categoryId);
  if (on && !has) item.categories = [...cats, categoryId];
  else if (!on && has) item.categories = cats.filter((c) => c !== categoryId);
  else item.categories = cats;
  if (!item.tabsAt || typeof item.tabsAt !== "object") item.tabsAt = {};
  item.tabsAt[categoryId] = at;
}

/** Mark a person's change to anything else on the show (status, rating, notes). */
export function touchItem(item, at = nowIso()) {
  if (item) item.updatedAt = at;
}

function maxStamps(a, b) {
  const out = { ...(b || {}) };
  for (const [k, v] of Object.entries(a || {})) {
    if (typeof v === "string" && (!out[k] || v > out[k])) out[k] = v;
  }
  return out;
}

// Which side decides one key: the one with the later stamp; a stamped side over
// an unstamped one; with no stamps at all, the base (mergeStates' "newer" side
// unless both items carry updatedAt).
function pick(key, base, other, baseStamps, otherStamps) {
  const sb = baseStamps?.[key], so = otherStamps?.[key];
  if (sb && so) return so > sb ? other : base;
  if (so && !sb) return other;
  return base;
}

function mergeSeasonProgress(base, other) {
  const bp = base.seasonProgress || {}, op = other.seasonProgress || {};
  const out = {};
  for (const season of new Set([...Object.keys(bp), ...Object.keys(op)])) {
    const bs = bp[season] || {}, os = op[season] || {};
    const merged = { ...os, ...bs };
    const be = bs.episodes || {}, oe = os.episodes || {};
    const eps = {};
    for (const ep of new Set([...Object.keys(be), ...Object.keys(oe)])) {
      const key = tickKey(season, ep);
      const from = pick(key, base, other, base.tickAt, other.tickAt);
      const val = from === base ? (ep in be ? be[ep] : oe[ep]) : (ep in oe ? oe[ep] : be[ep]);
      if (val !== undefined) eps[ep] = !!val;
    }
    if (Object.keys(eps).length || bs.episodes || os.episodes) merged.episodes = eps;
    out[season] = merged;
  }
  return out;
}

function mergeCategories(base, other) {
  const bc = Array.isArray(base.categories) ? base.categories : [];
  const oc = Array.isArray(other.categories) ? other.categories : [];
  const ids = [...new Set([...bc, ...oc, ...Object.keys(base.tabsAt || {}), ...Object.keys(other.tabsAt || {})])];
  return ids.filter((id) => {
    const from = pick(id, base, other, base.tabsAt, other.tabsAt);
    if (from === base && !base.tabsAt?.[id] && !other.tabsAt?.[id]) return bc.includes(id); // legacy: base's tabs
    return (from === base ? bc : oc).includes(id);
  });
}

/** Merge two copies of one show. `a` is mergeStates' newer side. */
export function mergeWatchItem(a, b) {
  if (!b) return a;
  if (!a) return b;
  const base = a.updatedAt && b.updatedAt ? (b.updatedAt > a.updatedAt ? b : a) : a;
  const other = base === a ? b : a;
  const out = { ...base };
  out.seasonProgress = mergeSeasonProgress(base, other);
  out.categories = mergeCategories(base, other);
  const tickAt = maxStamps(base.tickAt, other.tickAt);
  const tabsAt = maxStamps(base.tabsAt, other.tabsAt);
  if (Object.keys(tickAt).length) out.tickAt = tickAt; else delete out.tickAt;
  if (Object.keys(tabsAt).length) out.tabsAt = tabsAt; else delete out.tabsAt;
  const upd = [a.updatedAt, b.updatedAt].filter(Boolean).sort().pop();
  if (upd) out.updatedAt = upd;
  delete out.episodeData;
  return out;
}

/**
 * Merge two watch lists (mergeStates' newer side first). Same membership rule
 * as unionById — every id from either side, minus tombstoned ids — but a show
 * on both sides is merged tick by tick instead of one copy replacing the other.
 */
export function mergeWatchItems(newer, older, tombstoned = null) {
  const map = new Map();
  for (const x of older || []) if (x?.id != null) map.set(x.id, x);
  for (const x of newer || []) {
    if (x?.id == null) continue;
    map.set(x.id, map.has(x.id) ? mergeWatchItem(x, map.get(x.id)) : x);
  }
  const out = [];
  for (const x of map.values()) {
    if (tombstoned && tombstoned.has(String(x.id))) continue;
    if ("episodeData" in x) { const { episodeData: _e, ...rest } = x; out.push(rest); } else out.push(x);
  }
  return out;
}
