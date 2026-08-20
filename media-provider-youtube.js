// YouTube media provider — one of the two genuinely-playable video providers
// (with Jellyfin) that validate the Playback Coordinator. Uses the official
// YouTube Data API v3 for search/metadata and the IFrame embed for in-app
// playback (design §18) — no scraping, no restriction circumvention. The HTTP
// client is injected (deps.fetchJson), so the app can route through a Netlify
// proxy to keep the API key server-side (as it does for TMDB) and this stays
// unit-testable without a live key. Produces canonical MediaItems.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { MEDIA_CAP } from "./media-provider.js";

const YT_API = "https://www.googleapis.com/youtube/v3/search";
const WATCH = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
const EMBED = (id) => `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
const str = (v, d = "") => (v == null ? d : String(v));

async function defaultFetchJson(url, { signal } = {}) {
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`youtube HTTP ${r.status}`);
  return r.json();
}

// A YouTube search hit → canonical MediaItem. externalId is the videoId; the
// coordinator plays it via the EMBED uri (embedded) or the WATCH deep link.
function mapItem(it) {
  const videoId = str(it && it.id && it.id.videoId);
  if (!videoId) return null;
  const sn = (it && it.snippet) || {};
  const thumb = (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default)) || {};
  return makeMediaItem({
    kind: MEDIA_KIND.VIDEO,
    id: `yt_${videoId}`,
    title: str(sn.title) || "YouTube video",
    subtitle: str(sn.channelTitle),
    artworkUrl: str(thumb.url),
    year: str(sn.publishedAt).slice(0, 4),
    providerRefs: [{ providerId: "youtube", externalId: videoId, uri: EMBED(videoId), deepLink: WATCH(videoId) }],
    source: it,
  });
}

/**
 * @param config { apiKey?, base?, proxied? } — base overrides the API endpoint
 *   (e.g. a Netlify proxy); proxied marks it available without a client key.
 * @param deps   { fetchJson? }
 */
export function createYouTubeProvider(config = {}, deps = {}) {
  const apiKey = str(config.apiKey);
  const base = str(config.base) || YT_API;
  const proxied = !!config.proxied;
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const configured = !!(apiKey || proxied);

  return {
    id: "youtube",
    label: config.label || "YouTube",
    kind: "video",
    capabilities: new Set([
      MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK,
      MEDIA_CAP.EMBEDDED_PLAYBACK, MEDIA_CAP.NATIVE_PLAYBACK, MEDIA_CAP.DEEP_LINK, MEDIA_CAP.NATIVE_APP,
    ]),
    configured,
    async isAvailable() { return configured; },

    async search(query, { limit = 12, signal } = {}) {
      const q = str(query).trim();
      if (!q || !configured) return [];
      const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: String(limit), q });
      if (apiKey) params.set("key", apiKey);
      const data = await fetchJson(`${base}?${params.toString()}`, { signal });
      return (Array.isArray(data && data.items) ? data.items : []).map(mapItem).filter(Boolean);
    },
  };
}
