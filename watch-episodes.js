// ── Episode lists live on the device (WATCH_AUDIT.md D3 / decision 6; Luke, 2026-10-31) ──
//
// A season's episode list (names, numbers, lengths, air dates) is TMDB data
// that anyone can fetch again, so it never belongs in the synced Watch row: it
// used to be saved there for every season ever opened and re-sent with every
// tick. It now lives in this device's storage, keyed by TMDB id — the same list
// serves the Personal and Household copies of a show.
//
// What IS synced stays on the show (seasonProgress, tickAt …; watch-merge.js).
// Bounded: at most `maxShows` shows, least recently used dropped first. If
// storage is unavailable the lists live in memory for the session and are
// fetched again next time.

export function createEpisodeStore({
  storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(),
  key = "live.watchEpisodes.v1",
  maxShows = 80,
  now = () => Date.now(),
} = {}) {
  let data = null; // { [tmdbId]: { at, seasons: { [n]: Episode[] } } }

  function load() {
    if (data) return data;
    try { data = JSON.parse(storage?.getItem(key) || "{}") || {}; } catch { data = {}; }
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    return data;
  }

  function save() {
    const d = load();
    const ids = Object.keys(d);
    if (ids.length > maxShows) {
      ids.sort((x, y) => (d[x]?.at || 0) - (d[y]?.at || 0));
      for (const id of ids.slice(0, ids.length - maxShows)) delete d[id];
    }
    try { storage?.setItem(key, JSON.stringify(d)); } catch { /* full or blocked: memory only */ }
  }

  const idOf = (tmdbId) => (tmdbId == null || tmdbId === "" ? null : String(tmdbId));

  /** All loaded seasons of a show: { [season]: Episode[] } (never null). */
  function seasons(tmdbId) {
    const id = idOf(tmdbId);
    return (id && load()[id]?.seasons) || {};
  }

  /** One season's episodes ([] when not loaded). */
  function get(tmdbId, season) {
    const list = seasons(tmdbId)[season];
    return Array.isArray(list) ? list : [];
  }

  /** Store a season's episodes. Returns true when it changed what's stored. */
  function set(tmdbId, season, episodes) {
    const id = idOf(tmdbId);
    if (!id || !Array.isArray(episodes)) return false;
    const d = load();
    const entry = d[id] || (d[id] = { at: 0, seasons: {} });
    const changed = JSON.stringify(entry.seasons[season] || null) !== JSON.stringify(episodes);
    entry.seasons[season] = episodes;
    entry.at = now();
    save();
    return changed;
  }

  /**
   * Take over lists an older client saved on the show (item.episodeData), for
   * seasons this device doesn't have yet. Returns true if anything was added.
   */
  function adopt(tmdbId, episodeData) {
    const id = idOf(tmdbId);
    if (!id || !episodeData || typeof episodeData !== "object") return false;
    const d = load();
    let added = false;
    for (const [season, list] of Object.entries(episodeData)) {
      if (!Array.isArray(list) || !list.length) continue;
      const entry = d[id] || (d[id] = { at: now(), seasons: {} });
      if (Array.isArray(entry.seasons[season]) && entry.seasons[season].length) continue;
      entry.seasons[season] = list;
      added = true;
    }
    if (added) save();
    return added;
  }

  return { seasons, get, set, adopt };
}

export const watchEpisodes = createEpisodeStore();
