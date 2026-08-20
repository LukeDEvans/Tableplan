// Podcast media provider — folds podcast-EPISODE search (the iTunes Search API,
// the same source the Podcasts tab uses) into universal search, so Discover finds
// individual episodes to play. It does NOT re-implement podcast playback: results
// carry a ready-to-play episode on `source.episode` (with an audioUrl), and the
// app's Play bridge hands it to startPodcastPlayback — the proven audio engine.
// `fetchJson` is injected → pure and unit-testable. DOM-free.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { MEDIA_CAP } from "./media-provider.js";

const str = (v, d = "") => (v == null ? d : String(v));

const ITUNES_EPISODES = (term, limit) =>
  `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcastEpisode&limit=${limit}`;

// One iTunes podcastEpisode result → { episode, show } shaped exactly like the
// Podcasts tab builds (so findPodcastEpisode / startPodcastPlayback accept it).
function toEpisode(r) {
  if (!r || r.trackId == null || !(r.episodeUrl || r.previewUrl)) return null;
  const id = `itunes-ep-${r.trackId}`;
  const episode = {
    id,
    title: str(r.trackName),
    showTitle: str(r.collectionName),
    pubDate: str(r.releaseDate),
    duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
    description: str(r.description) || str(r.shortDescription),
    audioUrl: str(r.episodeUrl) || str(r.previewUrl),
    art: str(r.artworkUrl600) || str(r.artworkUrl100),
  };
  const show = { id: str(r.collectionId), title: episode.showTitle, art: episode.art };
  return { episode, show };
}

function mapEpisode(r) {
  const es = toEpisode(r);
  if (!es) return null;
  const { episode, show } = es;
  return makeMediaItem({
    kind: MEDIA_KIND.PODCAST,
    id: `pod_${episode.id}`,
    title: episode.title || "Episode",
    subtitle: show.title,
    artworkUrl: episode.art,
    providerRefs: [{ providerId: "podcast", externalId: episode.id }],
    meta: { episodeId: episode.id, showTitle: show.title },
    source: { episode, show },  // ready for startPodcastPlayback via the play bridge
  });
}

/**
 * @param config { fetchJson?: (url, opts) => Promise<any> } — injected JSON fetch.
 */
export function createPodcastMediaProvider(config = {}, deps = {}) {
  const fetchJson = config.fetchJson || deps.fetchJson || null;
  return {
    id: "podcastsearch",
    label: config.label || "Podcasts",
    kind: "podcast",
    capabilities: new Set([MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK]),
    configured: !!fetchJson,
    async isAvailable() { return !!fetchJson; },
    async search(query, opts = {}) {
      const q = str(query).trim();
      if (!q || !fetchJson) return [];
      const data = await fetchJson(ITUNES_EPISODES(q, opts.limit || 20), { signal: opts.signal });
      const results = (data && Array.isArray(data.results)) ? data.results : [];
      return results.map(mapEpisode).filter(Boolean);
    },
  };
}
