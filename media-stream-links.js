// Exact title / episode links for Watch (STREAMING_HANDOFF_DESIGN.md §4.2).
// The stream-links function answers per title; this keeps the last good answer
// on the device for a week and picks, for a show, the next episode to watch.
//
// The links are public catalog data (no one's watch history), so the device
// cache isn't per account. Nothing here touches synced state or Supabase.

export const STREAM_LINKS_STORAGE_KEY = "live-stream-links-v1";
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_MS = 6 * 60 * 60 * 1000;   // a title with no links: ask again sooner
const MAX_ENTRIES = 300;
const CONCURRENCY = 2;
const RETRY_MS = 30 * 60 * 1000;     // after a failed lookup (function missing, offline)

const numKeys = (o) => Object.keys(o && typeof o === "object" ? o : {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);

/**
 * The first episode not yet marked watched, from the episode map
 * { "1": { "1": url, … }, … } and Watch's seasonProgress
 * ({ "1": { watched: true } | { episodes: { "3": true } } }). Season 0 (specials)
 * is skipped. null when everything's watched or there are no episodes.
 */
export function nextEpisode(episodes, seasonProgress = {}) {
  const sp = seasonProgress && typeof seasonProgress === "object" ? seasonProgress : {};
  for (const s of numKeys(episodes)) {
    if (s < 1) continue;
    const prog = sp[s] || sp[String(s)] || {};
    if (prog.watched === true) continue;
    const seen = prog.episodes && typeof prog.episodes === "object" ? prog.episodes : {};
    for (const e of numKeys(episodes[s])) {
      if (seen[e] === true || seen[String(e)] === true) continue;
      const url = episodes[s][e];
      if (url) return { season: s, episode: e, url };
    }
  }
  return null;
}

/** One service's links for a title, ready for link-out.js titleHandoff(). */
export function linksForProvider(entry, providerId, seasonProgress) {
  const p = entry && providerId ? entry[providerId] : null;
  if (!p) return {};
  const ep = p.episodes ? nextEpisode(p.episodes, seasonProgress) : null;
  if (ep) return { video: ep.url, title: p.title || "", episode: `S${ep.season} E${ep.episode}` };
  return { video: p.video || "", title: p.title || "" };
}

/**
 * A device cache in front of the function. get(type, id) answers from the cache
 * right away (undefined = not known yet) and, when missing or stale, queues one
 * fetch. fetchLinks(type, id) → { links } | throws.
 */
export function createStreamLinksCache({ storage = null, fetchLinks, now = () => Date.now() } = {}) {
  let map = null;
  const inflight = new Set();
  const failedAt = new Map(); // key → when its lookup last failed (this session only)
  const queue = [];
  let running = 0;

  function load() {
    if (map) return map;
    map = {};
    try { const raw = storage && storage.getItem(STREAM_LINKS_STORAGE_KEY); if (raw) map = JSON.parse(raw) || {}; } catch { map = {}; }
    return map;
  }
  function save() {
    try {
      const keys = Object.keys(map);
      if (keys.length > MAX_ENTRIES) keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0)).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete map[k]);
      storage && storage.setItem(STREAM_LINKS_STORAGE_KEY, JSON.stringify(map));
    } catch { /* storage full or blocked: memory only */ }
  }
  function pump() {
    while (running < CONCURRENCY && queue.length) {
      const [key, type, id] = queue.shift();
      running += 1;
      Promise.resolve()
        .then(() => fetchLinks(type, id))
        .then((res) => {
          if (res && !res.error) { load()[key] = { at: now(), links: res.links || null }; save(); failedAt.delete(key); }
          else failedAt.set(key, now());
        })
        .catch(() => { failedAt.set(key, now()); /* keep the old answer; try again later */ })
        .finally(() => { inflight.delete(key); running -= 1; pump(); });
    }
  }

  function get(type, id) {
    if (!["movie", "tv"].includes(type) || !id || typeof fetchLinks !== "function") return undefined;
    const key = `${type}:${id}`;
    const hit = load()[key];
    const age = hit ? now() - (hit.at || 0) : Infinity;
    const stale = !hit || age > (hit.links ? FRESH_MS : MISS_MS);
    const backingOff = failedAt.has(key) && now() - failedAt.get(key) < RETRY_MS;
    if (stale && !backingOff && !inflight.has(key)) { inflight.add(key); queue.push([key, type, id]); pump(); }
    return hit ? hit.links : undefined;
  }

  return { get };
}
