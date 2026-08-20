// Jellyfin media provider — the FULL-contract video provider (design §17): your
// own server, so it legitimately supports auth, library search, metadata,
// artwork, native in-app playback and progress. It is NOT a privileged domain
// concept — it's a MediaProvider like any other, and it's the strongest test of
// the whole provider + coordinator architecture. HTTP client injected
// (deps.fetchJson) so it's unit-testable without a live server; isAvailable()
// gates on reachability. Produces canonical MediaItems.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { MEDIA_CAP } from "./media-provider.js";

const trimSlash = (s) => String(s || "").replace(/\/+$/, "");
const str = (v, d = "") => (v == null ? d : String(v));
const ticksToSec = (t) => (t ? Math.round(Number(t) / 1e7) : null); // 100-ns ticks → seconds

async function defaultFetchJson(url, { signal } = {}) {
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`jellyfin HTTP ${r.status}`);
  return r.json();
}

export function createJellyfinMediaProvider(config = {}, deps = {}) {
  const url = trimSlash(config.url);
  const apiKey = str(config.apiKey);
  const userId = str(config.userId);
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const configured = !!(url && apiKey && userId);
  const key = () => `api_key=${encodeURIComponent(apiKey)}`;

  // A Jellyfin item → canonical MediaItem. Its providerRef carries the direct
  // stream uri (native in-app playback) + a deep link into the Jellyfin web app.
  function mapItem(it) {
    const id = str(it && it.Id);
    if (!id) return null;
    const type = str(it.Type);
    const hasArt = it.ImageTags && it.ImageTags.Primary;
    const streamUri = `${url}/Videos/${id}/stream?static=true&${key()}`;
    return makeMediaItem({
      kind: MEDIA_KIND.VIDEO,
      id: `jf_${id}`,
      title: str(it.Name) || "Untitled",
      subtitle: type === "Series" ? "TV series" : type === "Episode" ? str(it.SeriesName) : "Movie",
      artworkUrl: hasArt ? `${url}/Items/${id}/Images/Primary?maxWidth=342&${key()}` : "",
      year: it.ProductionYear != null ? String(it.ProductionYear) : "",
      providerRefs: [{
        providerId: "jellyfin", externalId: id, uri: streamUri,
        deepLink: `${url}/web/index.html#!/details?id=${id}`,
      }],
      // A TMDB id (when the server scraped one) gives a trustworthy cross-
      // provider identity, so this native copy MERGES with the same title's
      // streamer availability instead of showing as a separate result.
      meta: (it.ProviderIds && it.ProviderIds.Tmdb) ? { tmdbId: String(it.ProviderIds.Tmdb) } : {},
      userState: it.UserData ? {
        favorite: !!it.UserData.IsFavorite,
        progress: it.UserData.PlaybackPositionTicks
          ? { kind: "position", position: ticksToSec(it.UserData.PlaybackPositionTicks), duration: ticksToSec(it.RunTimeTicks) }
          : null,
      } : {},
      source: it,
    });
  }

  return {
    id: "jellyfin",
    label: config.label || "Jellyfin",
    kind: "video",
    capabilities: new Set([
      MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.AUTH, MEDIA_CAP.LIBRARY,
      MEDIA_CAP.FAVORITES, MEDIA_CAP.NATIVE_PLAYBACK, MEDIA_CAP.PROGRESS, MEDIA_CAP.DOWNLOADS, MEDIA_CAP.DEEP_LINK,
    ]),
    configured,

    async isAvailable() {
      if (!configured) return false;
      try { await fetchJson(`${url}/System/Info/Public`); return true; }
      catch { return false; }
    },

    async search(query, { limit = 24, signal } = {}) {
      const q = str(query).trim();
      if (!q || !configured) return [];
      const params = new URLSearchParams({
        searchTerm: q, Recursive: "true", IncludeItemTypes: "Movie,Series",
        Fields: "ProductionYear,Overview,SeriesName,ProviderIds", Limit: String(limit), api_key: apiKey,
      });
      const data = await fetchJson(`${url}/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`, { signal });
      return (Array.isArray(data && data.Items) ? data.Items : []).map(mapItem).filter(Boolean);
    },

    // In-progress items (Jellyfin's own "Continue Watching") → canonical items
    // carrying position progress. Feeds the unified Continue rail (design §12).
    async resume({ limit = 20, signal } = {}) {
      if (!configured) return [];
      const params = new URLSearchParams({
        Limit: String(limit), Recursive: "true", MediaTypes: "Video",
        Fields: "ProductionYear,SeriesName,ProviderIds", api_key: apiKey,
      });
      const data = await fetchJson(`${url}/Users/${encodeURIComponent(userId)}/Items/Resume?${params.toString()}`, { signal });
      return (Array.isArray(data && data.Items) ? data.Items : []).map(mapItem).filter(Boolean);
    },

    // The whole Movie/Series library as canonical items (ProviderIds included) —
    // used to build a tmdbId→native-copy index so any title the user OWNS gets an
    // in-app Play across the hub (Watch cards especially). One cached fetch.
    async libraryItems({ signal } = {}) {
      if (!configured) return [];
      const params = new URLSearchParams({
        Recursive: "true", IncludeItemTypes: "Movie,Series",
        Fields: "ProductionYear,SeriesName,ProviderIds", api_key: apiKey,
      });
      const data = await fetchJson(`${url}/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`, { signal });
      return (Array.isArray(data && data.Items) ? data.Items : []).map(mapItem).filter(Boolean);
    },
  };
}
