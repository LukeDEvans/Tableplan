// Music media provider — folds the EXISTING music search (Internet Archive /
// Jamendo, via createMusicProviderRegistry) into universal search, so Discover
// finds MUSIC as well as video and the hub is truly universal — without a second
// music stack. It does NOT re-implement music playback: results carry the
// original CanonicalTrack/Album on `source`, and the app's Play bridge hands them
// to the proven audio engine (openMusicItem / playStreamingTrack). Native
// playback (in-app) is the capability; the search function is injected, so this
// is pure and unit-testable. Pure, DOM-free.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { MEDIA_CAP } from "./media-provider.js";

const str = (v, d = "") => (v == null ? d : String(v));

// A CanonicalTrack/Album → canonical MediaItem. `source` keeps the original so
// the play bridge can hand it straight to the existing music engine.
function mapMusicItem(it) {
  if (!it || !it.id) return null;
  const isAlbum = it.entity === "album";
  const subtitle = isAlbum
    ? (str(it.artist) || str(it.composer) || "Album")
    : ((Array.isArray(it.artists) ? it.artists.map((a) => a && a.name).filter(Boolean).join(", ") : "") || str(it.album));
  return makeMediaItem({
    kind: MEDIA_KIND.MUSIC,
    id: `mus_${it.id}`,
    title: str(it.title) || "Untitled",
    subtitle,
    artworkUrl: str(it.artworkUrl),
    year: it.year != null ? String(it.year) : "",
    providerRefs: [{ providerId: "music", externalId: String(it.id) }], // native audio; the engine resolves the stream
    meta: { musicKind: isAlbum ? "album" : "track" },
    source: it,
  });
}

/**
 * @param config { search?: (query, opts) => Promise<CanonicalTrack|Album[]> }
 *   — inject the music registry's aggregated search (its `.items`).
 */
export function createMusicMediaProvider(config = {}, deps = {}) {
  const search = typeof config.search === "function" ? config.search : null;
  return {
    id: "music",
    label: config.label || "Music",
    kind: "music",
    capabilities: new Set([MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.NATIVE_PLAYBACK]),
    configured: !!search,
    async isAvailable() { return !!search; },
    async search(query, opts = {}) {
      const q = str(query).trim();
      if (!q || !search) return [];
      const items = await search(q, opts);
      return (Array.isArray(items) ? items : []).map(mapMusicItem).filter(Boolean);
    },
  };
}
