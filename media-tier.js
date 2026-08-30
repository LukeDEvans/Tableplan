// media-tier.js — pure helper for the Media "Playlist" tier board.
//
// The board renders exactly `podcastTierCount` tiers and drops any show/publication
// ranked into a HIGHER tier back to "unranked" (tier 0). Unlike the tier MAPS
// (podcastShowTiers / publicationTiers), which accumulate across the state
// sync-merge via unionByKey, the scalar count does NOT reliably survive a merge —
// so it could desync (e.g. count = 3 while shows sit in tiers 4–7) and silently
// empty the user's top tiers on reload, which reads as "the tier list didn't save".
//
// Derive the effective count so it can never be smaller than the highest tier
// actually assigned. This self-heals already-desynced stored data on the next load
// (and the next save then re-persists a consistent count). Capped so a corrupt
// value can't spawn a runaway number of tiers.

const TIER_CAP = 12; // far above realistic use; guards against corrupt values

export function deriveMediaTierCount(storedCount, showTiers, publicationTiers) {
  const stored = Number.isInteger(storedCount) ? storedCount : 3;
  const tierValues = (m) => (m && typeof m === "object" && !Array.isArray(m))
    ? Object.values(m).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const maxAssigned = Math.max(0, ...tierValues(showTiers), ...tierValues(publicationTiers));
  return Math.min(TIER_CAP, Math.max(stored, maxAssigned, 1));
}
