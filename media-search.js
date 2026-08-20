// Universal search aggregator — the provider-agnostic search/availability domain
// layer (design §6/§10). It queries every eligible provider adapter, normalizes
// into canonical MediaItems, tolerates individual provider failures, and merges
// the same title's availability across providers. It knows NOTHING about any
// provider's API (adapters do that) and it does NOT decide how playback happens
// (the Playback Coordinator does) — it only describes the content and its
// provider/playback possibilities. Pure, DOM-free; providers injected.
//
//   query → eligible providers (capability-gated) → provider.search()
//         → canonical MediaItems → dedupe/merge → aggregate result

import { contentKey } from "./media-model.js";
import { MEDIA_CAP, hasCapability } from "./media-provider.js";
import { playAction } from "./playback-coordinator.js";

const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
const richness = (it) => (it.title && it.title !== "Untitled" ? 2 : 0) + (it.artworkUrl ? 1 : 0) + (it.meta && it.meta.tmdbId ? 1 : 0);

// Union provider refs by providerId; prefer a ref that carries a playable uri.
function unionRefs(a, b) {
  const map = new Map();
  for (const r of [...(a || []), ...(b || [])]) {
    if (!r || !r.providerId) continue;
    const ex = map.get(r.providerId);
    if (!ex) map.set(r.providerId, r);
    else if (!ex.uri && r.uri) map.set(r.providerId, { ...ex, ...r });
  }
  return [...map.values()];
}

function mergeUserState(a = {}, b = {}) {
  return {
    saved: !!(a.saved || b.saved),
    favorite: !!(a.favorite || b.favorite),
    status: a.status || b.status || null,
    progress: a.progress || b.progress || null,
    lastAt: Math.max(a.lastAt || 0, b.lastAt || 0) || null,
  };
}

// Same canonical content from two providers → ONE item with combined targets
// (design §9: one content, multiple provider availability/playback targets).
function mergeItems(a, b) {
  const base = richness(a) >= richness(b) ? a : b;
  const other = base === a ? b : a;
  return {
    ...base,
    artworkUrl: base.artworkUrl || other.artworkUrl,
    subtitle: base.subtitle || other.subtitle,
    year: base.year || other.year,
    providerRefs: unionRefs(base.providerRefs, other.providerRefs),
    userState: mergeUserState(base.userState, other.userState),
    meta: { ...other.meta, ...base.meta },
  };
}

/** Dedupe by contentKey (TMDB id for video, else kind:id), merging targets.
 *  Conservative — no fuzzy cross-provider identity beyond a shared TMDB id. */
export function dedupeItems(items) {
  const byKey = new Map();
  const order = [];
  for (const it of (items || [])) {
    const k = contentKey(it);
    if (!byKey.has(k)) { byKey.set(k, it); order.push(k); }
    else byKey.set(k, mergeItems(byKey.get(k), it));
  }
  return order.map((k) => byKey.get(k));
}

/** Which providers may be queried: SEARCH capability + an actual search impl. */
export function eligibleProviders(providers) {
  return (providers || []).filter((p) => hasCapability(p, MEDIA_CAP.SEARCH) && typeof p.search === "function");
}

/**
 * Query all eligible providers, isolated, and aggregate.
 * @returns { query, items: MediaItem[], providerStatuses:[{provider,ok,count,error?}] }
 * A single provider failing/timing out never fails the whole search.
 */
export async function universalSearch(query, { providers = [], limit = 25, signal } = {}) {
  const q = String(query || "").trim();
  const targets = eligibleProviders(providers);
  if (!q || !targets.length) {
    return { query: q, items: [], providerStatuses: targets.map((p) => ({ provider: p.id, ok: true, count: 0 })) };
  }
  const settled = await Promise.allSettled(targets.map(async (p) => {
    if (p.isAvailable && !(await safe(() => p.isAvailable(), false))) throw new Error("provider unavailable");
    const items = await p.search(q, { limit, signal });
    return { provider: p.id, items: Array.isArray(items) ? items : [] };
  }));
  const collected = [];
  const providerStatuses = settled.map((r, i) => {
    const pid = targets[i].id;
    if (r.status === "fulfilled") { collected.push(...r.value.items); return { provider: pid, ok: true, count: r.value.items.length }; }
    return { provider: pid, ok: false, count: 0, error: String((r.reason && r.reason.message) || r.reason) };
  });
  return { query: q, items: dedupeItems(collected), providerStatuses };
}

/** Optionally fold streaming availability into video items (on-demand; N calls).
 *  The Discover UI will typically call this lazily per item. */
export async function enrichWithAvailability(items, tmdbProvider, opts = {}) {
  if (!tmdbProvider || typeof tmdbProvider.enrich !== "function") return items || [];
  return Promise.all((items || []).map((it) =>
    (it && it.meta && it.meta.tmdbId) ? safe(() => tmdbProvider.enrich(it, opts), it) : it));
}

/**
 * Describe an item's provider availability for the (future) Discover UI, split
 * into YOUR SERVICES (connected) vs OTHER SERVICES (known but not connected).
 * Each entry's Play/Open action is DERIVED FROM the Playback Coordinator — this
 * never re-implements coordinator logic. The `tmdb` metadata anchor is not a
 * watch target and is excluded.
 * @returns { yours:[Entry], others:[Entry] }  Entry = { providerId,label,known,connected,action,mode,uri }
 */
export function describeAvailability(item, registry) {
  const yours = [], others = [];
  for (const ref of (item && item.providerRefs) || []) {
    if (ref.providerId === "tmdb") continue; // availability anchor, not a service
    const known = registry.has(ref.providerId);
    const connected = registry.isConnected(ref.providerId);
    const provider = registry.get(ref.providerId);
    // Ask the coordinator what pressing Play on THIS provider would do.
    const act = playAction({ ...item, providerRefs: [ref] }, registry);
    const entry = {
      providerId: ref.providerId,
      label: (provider && provider.label) || ref.providerId,
      known, connected,
      action: act.kind,                 // "play" | "handoff" | "none"
      mode: act.target ? act.target.mode : null,
      uri: act.target ? act.target.uri : (ref.deepLink || ref.uri || null),
    };
    (connected ? yours : others).push(entry);
  }
  return { yours, others };
}
