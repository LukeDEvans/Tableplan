// TMDB availability provider — the mechanism that answers "where can I watch
// this?" for VIDEO (design §3/§6/§9). TMDB is an AVAILABILITY AGGREGATOR, never
// represented as the streaming provider itself: search returns canonical video
// Works (with a TMDB metadata anchor), and availability() resolves the actual
// services (Max/Netflix/…) via TMDB's watch/providers data — the SAME mechanism
// the Watch page already uses (tmdb-search + tmdb-watch-providers), reused, not
// reinvented. It advertises NO playback capability; the Playback Coordinator
// decides Play/Open from the resolved service providers.
//
// HTTP is injected as URL builders + fetchJson, so the app routes through its
// existing Netlify proxies (key + auth stay server-side) and this stays
// unit-testable. Pure, DOM-free.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { MEDIA_CAP } from "./media-provider.js";
import { tmdbWatchProvidersToRefs } from "./media-availability.js";

const str = (v, d = "") => (v == null ? d : String(v));
const POSTER = (p) => (p ? `https://image.tmdb.org/t/p/w342${p}` : "");

async function defaultFetchJson(url, { signal } = {}) {
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`tmdb HTTP ${r.status}`);
  return r.json();
}

// tmdb-search's normalized result → canonical video Work. The tmdb ref is a
// metadata/availability ANCHOR (no playback); meta.tmdbId gives a trustworthy
// cross-provider identity so a Jellyfin copy or streamer availability merges in.
function mapResult(r) {
  const id = (r && r.id != null) ? String(r.id) : "";
  if (!id) return null;
  const type = r.type === "tv" ? "tv" : "movie";
  return makeMediaItem({
    kind: MEDIA_KIND.VIDEO,
    id: `tmdb_${id}`,
    title: str(r.title) || "Untitled",
    subtitle: type === "tv" ? "TV series" : "Movie",
    artworkUrl: POSTER(r.posterPath),
    year: str(r.year),
    providerRefs: [{ providerId: "tmdb", externalId: id }],
    meta: { tmdbId: id, tmdbType: type },
    source: r,
  });
}

function unionRefs(refs, extra) {
  const map = new Map();
  for (const ref of [...(refs || []), ...(extra || [])]) {
    if (!ref || !ref.providerId) continue;
    if (!map.has(ref.providerId)) map.set(ref.providerId, ref);
  }
  return [...map.values()];
}

/**
 * @param config { searchUrl?: (q)=>url, providersUrl?: (tmdbId,type)=>url }
 *   — injectable so the app uses its existing tmdb-search / tmdb-watch-providers
 *   proxies. isAvailable() is true once a search URL builder is provided.
 * @param deps   { fetchJson? }
 */
export function createTmdbProvider(config = {}, deps = {}) {
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const searchUrl = typeof config.searchUrl === "function" ? config.searchUrl : null;
  const providersUrl = typeof config.providersUrl === "function" ? config.providersUrl : null;
  const configured = !!searchUrl;

  return {
    id: "tmdb",
    label: config.label || "TMDB",
    kind: "video",
    capabilities: new Set([MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.AVAILABILITY]),
    configured,
    async isAvailable() { return configured; },

    async search(query, { signal } = {}) {
      const q = str(query).trim();
      if (!q || !configured) return [];
      const data = await fetchJson(searchUrl(q), { signal });
      return (Array.isArray(data && data.results) ? data.results : []).map(mapResult).filter(Boolean);
    },

    // The streaming services carrying a title — the "where can I watch this"
    // mechanism (providerRefs, NOT a search of the streamers themselves).
    async availability(tmdbId, type = "movie", { signal } = {}) {
      if (!providersUrl || tmdbId == null) return [];
      const data = await fetchJson(providersUrl(String(tmdbId), type === "tv" ? "tv" : "movie"), { signal });
      return tmdbWatchProvidersToRefs(data);
    },

    // Fold a title's availability into its canonical item (merged providerRefs).
    async enrich(item, { signal } = {}) {
      if (!item || !providersUrl) return item;
      const tmdbId = item.meta?.tmdbId || (item.providerRefs || []).find((r) => r.providerId === "tmdb")?.externalId;
      if (!tmdbId) return item;
      const refs = await this.availability(tmdbId, item.meta?.tmdbType || "movie", { signal });
      return { ...item, providerRefs: unionRefs(item.providerRefs, refs) };
    },
  };
}
