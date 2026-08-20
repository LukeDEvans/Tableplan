// Watch → canonical Media adapter. Proves the design's key promise (§14/§20): the
// existing Watch model (tmdbId, streamingProviders, status, seasonProgress) can be
// WRAPPED into the canonical envelope with NO migration — the watchItem stays the
// authoritative record (kept on `source`); this just projects it so universal
// Search / Continue / History / the Playback Coordinator can consume video the
// same way they consume audio. Pure, DOM-free.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { matchProviderId, tmdbWatchProvidersToRefs } from "./media-availability.js";

// Provider-name mapping is shared with the TMDB availability provider (one
// availability mechanism, not two). Re-exported for existing callers/tests.
export { matchProviderId };
const refsFromProviders = tmdbWatchProvidersToRefs;

// Per-kind progress from Watch's own state (design §12 — video semantics, not audio).
function watchProgress(item) {
  if (item.status === "watched") return { kind: "completed", completed: true };
  if (item.type === "tv" && item.seasonProgress && typeof item.seasonProgress === "object") {
    const seasons = Object.keys(item.seasonProgress).map(Number).filter(Number.isFinite);
    if (seasons.length) return { kind: "episodic", season: Math.max(...seasons) };
  }
  return null; // "want" = saved, no progress yet
}

const POSTER = (p) => (p ? `https://image.tmdb.org/t/p/w342${p}` : "");

export function watchItemToMediaItem(item) {
  if (!item || !item.title) return null;
  return makeMediaItem({
    kind: MEDIA_KIND.VIDEO,
    id: item.id,
    title: item.title,
    subtitle: item.type === "tv" ? "TV series" : "Movie",
    artworkUrl: POSTER(item.posterPath),
    year: item.year || "",
    providerRefs: [
      // TMDB is always the metadata/availability anchor for a video Work.
      { providerId: "tmdb", externalId: item.tmdbId != null ? String(item.tmdbId) : "" },
      ...refsFromProviders(item.streamingProviders),
    ],
    userState: {
      saved: item.status === "want",
      status: item.status,
      progress: watchProgress(item),
    },
    source: item, // authoritative watchItem preserved — no migration
  });
}

export function watchItemsToMediaItems(items) {
  return (Array.isArray(items) ? items : []).map(watchItemToMediaItem).filter(Boolean);
}
