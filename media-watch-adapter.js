// Watch → canonical Media adapter. Proves the design's key promise (§14/§20): the
// existing Watch model (tmdbId, streamingProviders, status, seasonProgress) can be
// WRAPPED into the canonical envelope with NO migration — the watchItem stays the
// authoritative record (kept on `source`); this just projects it so universal
// Search / Continue / History / the Playback Coordinator can consume video the
// same way they consume audio. Pure, DOM-free.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";

// Display-name → catalog provider id. Everything else slugifies gracefully, so an
// unknown streamer still yields a ref (the coordinator falls back to a hand-off).
const NAME_TO_ID = [
  [/netflix/i, "netflix"], [/disney/i, "disney"], [/\bmax\b|hbo/i, "max"],
  [/paramount/i, "paramount"], [/espn/i, "espn"], [/xfinity/i, "xfinity"],
  [/prime video|amazon/i, "prime"], [/\bhulu\b/i, "hulu"], [/apple ?tv/i, "appletv"],
  [/youtube/i, "youtube"], [/peacock/i, "peacock"], [/\bpbs\b/i, "pbs"],
];

export function matchProviderId(name) {
  const s = String(name || "");
  for (const [re, id] of NAME_TO_ID) if (re.test(s)) return id;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

// TMDB watch/providers groups → providerRefs. flatrate/free/ads are subscription/
// free streaming (the "your services" candidates); rent/buy are also reachable.
function refsFromProviders(sp) {
  if (!sp || typeof sp !== "object") return [];
  const link = sp.link || null;
  const groups = [...(sp.flatrate || []), ...(sp.free || []), ...(sp.ads || []), ...(sp.rent || []), ...(sp.buy || [])];
  const seen = new Set();
  const refs = [];
  for (const p of groups) {
    const id = matchProviderId(p && p.provider_name);
    if (seen.has(id)) continue;
    seen.add(id);
    refs.push({ providerId: id, externalId: (p && p.provider_id != null) ? String(p.provider_id) : "", deepLink: link });
  }
  return refs;
}

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
