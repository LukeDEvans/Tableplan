// Source adapters — turn EXISTING app stores (podcasts + podcastProgress, music
// favourites, saved-podcast ids) into canonical MediaItems so the unified
// Continue / Saved layer (media-state.js) sees them alongside Watch. These are
// pure, DOM-free mappers: they add no store and change no playback. `source`
// carries what the app's existing play bridges need (episode+show, favourite
// entity), so resuming/playing routes back through the proven engines. Design
// §12 (Continue) / §14 (Saved) — the point is one Continue and one Saved list
// across every kind, not per-kind rails.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";

const str = (v, d = "") => (v == null ? d : String(v));
const num = (v) => (typeof v === "number" && isFinite(v) ? v : (v != null && isFinite(+v) ? +v : 0));
const iso = (v) => { const t = Date.parse(v); return isFinite(t) ? t : 0; };

// ── Podcasts (in-progress + saved) ─────────────────────────────────────────────
// One episode → a canonical PODCAST item. `progress` is a podcastProgress entry
// { position, duration, lastPlayedAt, played? } or null.
export function podcastEpisodeToItem(episode, show, progress) {
  if (!episode || !episode.id) return null;
  const p = progress || null;
  const position = p ? num(p.position) : 0;
  const duration = p ? num(p.duration) || num(episode.duration) : num(episode.duration);
  const userProgress = p
    ? (p.played
        ? { kind: "position", position, duration, completed: true }
        : { kind: "position", position, duration })
    : null;
  return makeMediaItem({
    kind: MEDIA_KIND.PODCAST,
    id: `pod_${episode.id}`,
    title: str(episode.title) || "Episode",
    subtitle: str(show && show.title),
    artworkUrl: str(episode.art) || str(show && show.art),
    providerRefs: [{ providerId: "podcast", externalId: str(episode.id) }],
    meta: { episodeId: str(episode.id), showTitle: str(show && show.title) },
    source: { episode, show: show || null },
    userState: userProgress ? { progress: userProgress, lastAt: p ? iso(p.lastPlayedAt) : 0 } : {},
  });
}

// Find an episode (and its show) by id across the podcasts store — mirrors the
// app's findPodcastEpisode, kept pure so it's testable.
function findEpisode(podcasts, episodeId) {
  for (const show of (Array.isArray(podcasts) ? podcasts : [])) {
    const episode = (show && Array.isArray(show.episodes) ? show.episodes : []).find((e) => e && e.id === episodeId);
    if (episode) return { episode, show };
  }
  return { episode: null, show: null };
}

/** In-progress podcast episodes as canonical items (Continue feeds on these). */
export function podcastsToContinueItems(podcasts, podcastProgress) {
  const prog = podcastProgress && typeof podcastProgress === "object" ? podcastProgress : {};
  const out = [];
  for (const [episodeId, p] of Object.entries(prog)) {
    if (!p || p.played) continue;                 // finished → not a Continue candidate
    const { episode, show } = findEpisode(podcasts, episodeId);
    if (!episode) continue;                        // episode no longer in the store
    const item = podcastEpisodeToItem(episode, show, p);
    if (item) out.push(item);
  }
  return out;
}

/** Saved (bookmarked) podcast episodes → canonical items (Saved feeds on these). */
export function podcastSavedToItems(podcasts, savedIds, podcastProgress) {
  const ids = Array.isArray(savedIds) ? savedIds : [];
  const prog = podcastProgress && typeof podcastProgress === "object" ? podcastProgress : {};
  const out = [];
  for (const id of ids) {
    const { episode, show } = findEpisode(podcasts, id);
    if (!episode) continue;
    const item = podcastEpisodeToItem(episode, show, prog[id] || null);
    if (item) out.push(item);
  }
  return out;
}

// ── Music favourites ───────────────────────────────────────────────────────────
// A musicLibrary favourite { key, type, entity, at } → a canonical MUSIC item.
// `entity` is the canonical recording/album/etc.; `source` keeps { type, entity }
// so the play bridge hands it to the existing music engine (playFavorite path).
export function musicFavoriteToItem(fav) {
  if (!fav || !fav.entity) return null;
  const e = fav.entity;
  const subtitle =
    str(e.artist) ||
    str(e.composer) ||
    (Array.isArray(e.artists) ? e.artists.map((a) => (a && a.name) || a).filter(Boolean).join(", ") : "") ||
    (Array.isArray(e.performers) ? e.performers.map((a) => (a && a.name) || a).filter(Boolean).join(", ") : "") ||
    str(e.album) ||
    str(fav.type);
  return makeMediaItem({
    kind: MEDIA_KIND.MUSIC,
    id: `mus_fav_${str(fav.key) || str(e.id)}`,
    title: str(e.title) || str(e.name) || "Untitled",
    subtitle,
    artworkUrl: str(e.artworkUrl) || str(e.art) || str(e.image),
    providerRefs: [{ providerId: "music", externalId: str(e.id) }],
    meta: { musicKind: str(fav.type) || "favorite", favorite: true },
    source: e, // the canonical entity — handed straight to the existing music bridge (openMusicItem)
    userState: { lastAt: iso(fav.at) },
  });
}

/** All music favourites as canonical items (newest-favourited first). */
export function musicFavoritesToItems(musicLibrary) {
  const favs = musicLibrary && Array.isArray(musicLibrary.favorites) ? musicLibrary.favorites : [];
  return favs.map(musicFavoriteToItem).filter(Boolean);
}
