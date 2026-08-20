// Media provider & capability registry — generalizes the proven MusicProvider
// pattern (createMusicProviderRegistry) to ALL of Media. A provider is a plain
// adapter that advertises a capability SET; the rest of Media asks what a
// provider supports rather than assuming (design §4/§7). Adding a provider =
// declare metadata + capabilities + register — no changes to Search, Discover,
// History, Favourites, Continue, the player, or navigation.
//
// Two registries, per design §5: the static KNOWN catalog (what the app can know
// about) and the user's CONNECTED set (what they actually have access to). Pure,
// DOM-free; the real network adapters (Jellyfin/YouTube/TMDB) plug in later.

export const MEDIA_CAP = Object.freeze({
  SEARCH: "search",
  DISCOVERY: "discovery",
  METADATA: "metadata",
  ARTWORK: "artwork",
  AVAILABILITY: "availability",       // "where can I watch this" (TMDB) — NOT a search of the streamer
  AUTH: "authentication",
  LIBRARY: "library",
  FAVORITES: "favorites",
  RECOMMENDATIONS: "recommendations",
  NATIVE_PLAYBACK: "nativePlayback",  // in-app via our engine / a full player
  EMBEDDED_PLAYBACK: "embeddedPlayback",
  WEB_PLAYBACK: "webPlayback",
  DEEP_LINK: "deepLink",
  NATIVE_APP: "nativeApp",            // hand off to the provider's installed app
  PROGRESS: "progress",
  DOWNLOADS: "downloads",
  LIVE: "livePlayback",
});

const ALL_CAPS = new Set(Object.values(MEDIA_CAP));
const str = (v, d = "") => (v == null ? d : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);

/** Normalize a provider descriptor; capabilities coerced to a validated Set. */
export function makeProvider(p = {}) {
  const caps = new Set(arr(p.capabilities).map(str).filter((c) => ALL_CAPS.has(c)));
  return {
    id: str(p.id),
    label: str(p.label) || str(p.id),
    kind: str(p.kind) || "video",        // primary media kind this provider deals in
    capabilities: caps,
    // Adapter hooks are optional here; concrete network adapters implement them.
    search: typeof p.search === "function" ? p.search : null,
    isAvailable: typeof p.isAvailable === "function" ? p.isAvailable : null,
  };
}

export function hasCapability(provider, cap) {
  const c = provider && provider.capabilities;
  return !!(c && (c.has ? c.has(cap) : arr(c).includes(cap)));
}

/** The static, extensible catalog of KNOWN providers with HONEST capabilities
 *  (design §9). Commercial streamers get metadata/availability/deep-link/handoff
 *  only — no search API, no in-app playback (DRM + anti-embedding). Re-verify per
 *  provider at implementation time (§28). */
export const PROVIDER_CATALOG = [
  // Full in-app providers (your own server / open APIs)
  { id: "jellyfin", label: "Jellyfin", kind: "video", capabilities: [
    MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.AUTH, MEDIA_CAP.LIBRARY,
    MEDIA_CAP.FAVORITES, MEDIA_CAP.NATIVE_PLAYBACK, MEDIA_CAP.PROGRESS, MEDIA_CAP.DOWNLOADS, MEDIA_CAP.DEEP_LINK ] },
  { id: "youtube", label: "YouTube", kind: "video", capabilities: [
    MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.EMBEDDED_PLAYBACK,
    MEDIA_CAP.NATIVE_PLAYBACK, MEDIA_CAP.DEEP_LINK, MEDIA_CAP.NATIVE_APP ] },
  { id: "internetarchive", label: "Internet Archive", kind: "music", capabilities: [
    MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.NATIVE_PLAYBACK ] },
  { id: "jamendo", label: "Jamendo", kind: "music", capabilities: [
    MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.NATIVE_PLAYBACK ] },
  { id: "mpr", label: "MPR", kind: "radio", capabilities: [
    MEDIA_CAP.METADATA, MEDIA_CAP.NATIVE_PLAYBACK, MEDIA_CAP.LIVE ] },
  { id: "pbs", label: "PBS", kind: "video", capabilities: [
    MEDIA_CAP.METADATA, MEDIA_CAP.WEB_PLAYBACK, MEDIA_CAP.DEEP_LINK, MEDIA_CAP.NATIVE_APP ] },
  // Availability aggregator — powers universal video search WITHOUT a streamer API
  { id: "tmdb", label: "TMDB", kind: "video", capabilities: [
    MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.AVAILABILITY ] },
  // Commercial streamers — metadata (via TMDB) + availability + handoff ONLY
  // (DRM + anti-embedding: no legitimate 3rd-party search or in-app playback).
  ...["netflix", "disney", "max", "paramount", "espn", "xfinity", "hulu", "prime", "appletv", "peacock"].map((id) => ({
    id, label: { netflix: "Netflix", disney: "Disney+", max: "Max", paramount: "Paramount+", espn: "ESPN",
      xfinity: "Xfinity Stream", hulu: "Hulu", prime: "Prime Video", appletv: "Apple TV", peacock: "Peacock" }[id],
    kind: "video", capabilities: [MEDIA_CAP.METADATA, MEDIA_CAP.AVAILABILITY, MEDIA_CAP.DEEP_LINK, MEDIA_CAP.NATIVE_APP],
  })),
];

/**
 * The registry. `connectedIds` = providers the user actually has (Jellyfin
 * configured, "I subscribe to Max"); everything else is "known but other".
 */
export function createMediaProviderRegistry(providers = PROVIDER_CATALOG, { connectedIds = [] } = {}) {
  const list = arr(providers).map(makeProvider).filter((p) => p.id);
  const byId = new Map(list.map((p) => [p.id, p]));
  const connected = new Set(arr(connectedIds).map(str));
  return {
    all: () => list.slice(),
    get: (id) => byId.get(str(id)) || null,
    has: (id) => byId.has(str(id)),
    withCapability: (cap) => list.filter((p) => hasCapability(p, cap)),
    isConnected: (id) => connected.has(str(id)),
    connectedProviders: () => list.filter((p) => connected.has(p.id)),
    setConnected: (ids) => { connected.clear(); arr(ids).map(str).forEach((i) => connected.add(i)); },
    // Providers that can actually search their own catalog (for universal search).
    searchable: () => list.filter((p) => hasCapability(p, MEDIA_CAP.SEARCH)),
  };
}
