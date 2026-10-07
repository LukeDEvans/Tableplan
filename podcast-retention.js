// How long a subscription's episodes are kept in saved state.
//
// A feed's episodes older than 30 days are left out of everything that is
// stored (the synced media section, the device mirror, history snapshots),
// except the ones the user chose to keep: saved, added to the queue, in a
// playlist, or started in the last 30 days. The app still shows a show's full
// feed while it is open — that copy lives in memory and is re-fetched.
//
// Pure helpers only — no DOM, no app state. app.js calls them where state is
// written and where a feed is fetched.

export const EPISODE_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const EPISODE_MAX_AGE_MS = EPISODE_MAX_AGE_DAYS * DAY_MS;

function time(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

// Ids of episodes the user chose to keep, read from a state-shaped object.
export function keptEpisodeIds(source, now = Date.now()) {
  const keep = new Set();
  const s = source || {};
  for (const id of (Array.isArray(s.podcastSaved) ? s.podcastSaved : [])) keep.add(id);
  for (const id of (Array.isArray(s.podcastQueue) ? s.podcastQueue : [])) keep.add(id);
  for (const e of (Array.isArray(s.mediaQueueAdded) ? s.mediaQueueAdded : [])) {
    if (e && e.kind === "episode" && e.itemId) keep.add(e.itemId);
  }
  for (const list of Object.values(s.podcastPlaylistItems || {})) {
    for (const id of (Array.isArray(list) ? list : [])) keep.add(id);
  }
  // Unified Saved (Listen Later / Favourites): ids are "<kind>:<id>".
  for (const e of (Array.isArray(s.mediaSaved) ? s.mediaSaved : [])) {
    const key = typeof e === "string" ? e : (e && (e.id || e.key));
    if (typeof key === "string" && key.startsWith("podcast:")) keep.add(key.slice("podcast:".length));
  }
  // Started and not finished, listened to within the window: still in hand.
  for (const [id, p] of Object.entries(s.podcastProgress || {})) {
    if (!p || p.played || !(p.position > 0)) continue;
    const at = time(p.lastPlayedAt);
    if (at !== null && now - at <= EPISODE_MAX_AGE_MS) keep.add(id);
  }
  return keep;
}

// Is this episode stored? Recent ones and kept ones are. An episode with no
// readable date is kept, since its age can't be judged.
export function episodeIsRetained(episode, { now = Date.now(), keepIds = new Set(), maxAgeMs = EPISODE_MAX_AGE_MS } = {}) {
  if (!episode) return false;
  if (keepIds.has(episode.id)) return true;
  const at = time(episode.pubDate);
  return at === null || now - at <= maxAgeMs;
}

// The shows as they are stored: each one's episodes cut to the retained set.
// Returns the same show object when nothing was dropped.
export function pruneOldEpisodes(podcasts, opts = {}) {
  if (!Array.isArray(podcasts)) return podcasts;
  return podcasts.map((p) => {
    if (!p || !Array.isArray(p.episodes)) return p;
    const episodes = p.episodes.filter((e) => episodeIsRetained(e, opts));
    return episodes.length === p.episodes.length ? p : { ...p, episodes };
  });
}

// A fresh feed replaces a show's episode list. A feed only lists its newest
// episodes, so a kept episode that has dropped off the end of it is carried
// over from the list we already had (after the fetched ones, newest first).
export function mergeFetchedEpisodes(fetched, existing, keepIds = new Set()) {
  const fresh = Array.isArray(fetched) ? fetched : [];
  const have = new Set(fresh.map((e) => e && e.id));
  const carried = (Array.isArray(existing) ? existing : [])
    .filter((e) => e && keepIds.has(e.id) && !have.has(e.id));
  return carried.length ? [...fresh, ...carried] : fresh;
}
