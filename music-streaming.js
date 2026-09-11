// On-demand Music — the streaming/discovery layer of the Music tab. This is a
// SEPARATE concern from the local library (music-library.js: owned files +
// Jellyfin). Both ultimately hand a playable URL to the one shared engine, but
// this layer is about *discovering and streaming* from free/open providers
// (Internet Archive, Musopen, Jamendo, …) rather than cataloguing owned bytes.
//
// Design goals (see MUSIC.md):
//   • The UI consumes normalized domain objects, never a provider's raw JSON.
//   • Provider-specific schemas stay inside each provider adapter.
//   • Canonical items carry provider references + license/provenance as
//     first-class metadata, and preserve the classical Composer → Work →
//     Movement → Recording distinction that the Cadence score system uses.
//   • One failing provider never breaks search — results are isolated.
//
// This module owns the normalized types, the MusicProvider contract (documented
// below), the provider registry, and cross-provider search aggregation. Provider
// adapters live in music-provider-*.js.

// ── ids & coercion ────────────────────────────────────────────────────────────
let _n = 0;
export function uid(prefix = "cm") { _n += 1; return `${prefix}_${Date.now().toString(36)}${_n.toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
const str = (v, d = "") => (v == null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const numOrNull = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── Provider capabilities ─────────────────────────────────────────────────────
// A provider advertises the subset it supports; callers check before using.
export const CAP = Object.freeze({
  SEARCH: "search",
  BROWSE: "browse",
  GET_ITEM: "getItem",       // expand an album/work into its tracks
  PLAYABLE: "playable",      // resolve a track to a streamable source (URL) for the shared engine
  ARTWORK: "artwork",
  LICENSE: "license",
  PAGINATION: "pagination",
  RECOMMEND: "recommend",
  // A provider that OWNS its own playback (transport lives inside the provider,
  // not the shared audio engine) — e.g. a DRM streamer whose SDK never hands out
  // a raw URL (Apple Music/MusicKit, Spotify Web Playback SDK). Such a provider
  // implements the Transport contract below INSTEAD of PLAYABLE, and the app
  // drives it through that surface rather than mediaEngine.load(url).
  OWNS_PLAYBACK: "ownsPlayback",
  // A provider that requires the user to authorize / hold a subscription. It
  // implements authorize()/getAuthStatus()/getSubscriptionStatus() (below).
  AUTH: "auth",
});

// Normalized playback state — the lowest common denominator every streamer can
// report. The app's mini-player/MediaSession consume THIS, never a provider's
// own state constant.
export const PLAYBACK_STATE = Object.freeze({
  NONE: "none",        // nothing loaded
  LOADING: "loading",  // buffering / preparing
  PLAYING: "playing",
  PAUSED: "paused",
  STOPPED: "stopped",
  ENDED: "ended",
});

// ── Normalized domain ─────────────────────────────────────────────────────────
// A pointer to the same logical item inside an external provider. Provider ids
// are NEVER the canonical id — a canonical item may gather several refs so the
// app can later learn "these are the same recording/work" (no entity resolution
// yet; the seam is here).
export function makeProviderRef(p = {}) {
  return { provider: str(p.provider), externalId: str(p.externalId), url: str(p.url) || null, collection: str(p.collection) || null };
}

// Licensing/provenance is first-class: accessible metadata never implies a right
// to redistribute, so we stream from the authorized source and keep the terms.
export function makeLicense(p = {}) {
  const url = str(p.url) || null;
  const type = str(p.type) || (url && /publicdomain|\/zero\//i.test(url) ? "public-domain" : url ? "custom" : "unknown");
  return {
    type,                                   // "public-domain" | "cc-*" | "custom" | "unknown"
    url,
    isPublicDomain: p.isPublicDomain != null ? !!p.isPublicDomain : /public-domain/.test(type),
    attribution: str(p.attribution) || null, // required credit text, when the licence needs it
    restrictions: arr(p.restrictions).map(String),
  };
}

// How to actually play a track. Streamed from the provider, never re-hosted.
export function makePlayableSource(p = {}) {
  return {
    provider: str(p.provider),
    url: str(p.url),
    mimeType: str(p.mimeType) || null,
    container: str(p.container) || null,     // "mp3" | "ogg" | "flac" | …
    bitrateKbps: numOrNull(p.bitrateKbps),
    streamable: p.streamable != null ? !!p.streamable : true,
  };
}

// A contributor with a role, so a classical performer/ensemble/composer and a
// pop artist all normalize the same way.
export function makeContributor(p = {}) {
  if (typeof p === "string") return { name: p, role: "artist", id: null };
  return { name: str(p.name), role: str(p.role) || "artist", id: str(p.id) || null };
}

// A canonical, provider-independent track/recording. For classical material the
// work/movement/composer fields carry the structure; for ordinary music they're
// simply empty and artists/album do the work.
export function makeCanonicalTrack(p = {}) {
  return {
    entity: "track",
    id: str(p.id) || uid("trk"),
    title: str(p.title) || "Untitled",
    artists: arr(p.artists).map(makeContributor),
    composer: p.composer ? makeContributor({ ...(typeof p.composer === "string" ? { name: p.composer } : p.composer), role: "composer" }) : null,
    work: p.work ? { title: str(p.work.title), catalog: str(p.work.catalog) || null } : null, // the musical work (vs this performance of it)
    movement: str(p.movement) || null,
    movementNo: numOrNull(p.movementNo),
    album: str(p.album) || null,
    trackNo: numOrNull(p.trackNo),
    durationMs: numOrNull(p.durationMs),
    artworkUrl: str(p.artworkUrl) || null,
    provider: str(p.provider),
    providerRefs: arr(p.providerRefs).map(makeProviderRef),
    license: p.license ? makeLicense(p.license) : makeLicense({}),
    playable: p.playable ? makePlayableSource(p.playable) : null, // may be resolved lazily via provider.getPlayable
  };
}

// A collection of tracks — an album, or (classical) a work/release. Search
// results are usually items at this granularity; expanding one yields tracks.
export function makeCanonicalAlbum(p = {}) {
  return {
    entity: "album",
    id: str(p.id) || uid("alb"),
    title: str(p.title) || "Untitled",
    artist: str(p.artist) || null,
    composer: str(p.composer) || null,
    year: numOrNull(p.year),
    artworkUrl: str(p.artworkUrl) || null,
    trackCount: numOrNull(p.trackCount),
    kind: str(p.kind) || "album",            // "album" | "work" | "collection"
    provider: str(p.provider),
    providerRefs: arr(p.providerRefs).map(makeProviderRef),
    license: p.license ? makeLicense(p.license) : makeLicense({}),
    description: str(p.description) || null,
  };
}

// ── Playback-owning providers: normalized transport types ─────────────────────
//
// The Transport contract (implemented by a provider that advertises
// CAP.OWNS_PLAYBACK). Every method is the lowest common denominator any major
// streamer's playback SDK exposes; provider-specific SDK calls stay INSIDE the
// adapter. Positions are MILLISECONDS (int); a track is a CanonicalTrack.
//
//   play(track): Promise<void>              start this track (replacing what plays)
//   pause(): Promise<void>
//   resume(): Promise<void>
//   seek(positionMs): Promise<void>
//   skipNext(): Promise<void>
//   skipPrevious(): Promise<void>
//   getQueue(): CanonicalTrack[]
//   setQueue(tracks): Promise<void>         replace the queue (does not auto-play)
//   getNowPlaying(): NowPlaying             current track + state (makeNowPlaying)
//   onChange(cb): () => void                subscribe to now-playing/state changes;
//                                           returns an unsubscribe fn. Fires on
//                                           play/pause/seek/track-change/ended.
//   getAuthStatus(): Promise<AuthStatus>    (CAP.AUTH) makeAuthStatus
//   getSubscriptionStatus(): Promise<SubscriptionStatus>  (CAP.AUTH) makeSubscriptionStatus
//   authorize(): Promise<AuthStatus>        (CAP.AUTH) trigger the provider's auth flow
//
// A playback-owning provider also implements the catalog surface it can
// (search/getItem) but NOT getPlayable — there is no URL to hand out.

export function makeNowPlaying(p = {}) {
  const state = str(p.state) || PLAYBACK_STATE.NONE;
  return {
    track: p.track ? makeCanonicalTrack(p.track) : null,
    state,                                       // one of PLAYBACK_STATE
    isPlaying: state === PLAYBACK_STATE.PLAYING,
    positionMs: Math.max(0, Math.round(numOrNull(p.positionMs) || 0)),
    durationMs: numOrNull(p.durationMs),
    canSeek: p.canSeek != null ? !!p.canSeek : true,
    canSkipNext: p.canSkipNext != null ? !!p.canSkipNext : true,
    canSkipPrevious: p.canSkipPrevious != null ? !!p.canSkipPrevious : true,
  };
}

export function makeAuthStatus(p = {}) {
  return {
    authorized: !!p.authorized,
    // "authorized" | "unauthorized" | "unavailable" | "not-configured"
    state: str(p.state) || (p.authorized ? "authorized" : "unauthorized"),
    reason: str(p.reason) || null,
  };
}

// Whether the user can actually stream full tracks. Authorization alone is not
// enough for a subscription service (an authorized user with no active plan can
// only get previews) — the app checks `canPlay` before offering in-app playback.
export function makeSubscriptionStatus(p = {}) {
  const active = !!p.active;
  return {
    active,
    canPlay: p.canPlay != null ? !!p.canPlay : active,
    // "active" | "expired" | "none" | "unknown" | "not-configured"
    state: str(p.state) || (active ? "active" : "unknown"),
    reason: str(p.reason) || null,
  };
}

export function isPlaybackOwner(provider) {
  return !!(provider && provider.capabilities &&
    (provider.capabilities.has ? provider.capabilities.has(CAP.OWNS_PLAYBACK) : arr(provider.capabilities).includes(CAP.OWNS_PLAYBACK)));
}

// ── Provider registry + aggregated search ─────────────────────────────────────
export function createMusicProviderRegistry(providers = []) {
  const list = providers.filter(Boolean);
  const byId = new Map(list.map((p) => [p.id, p]));
  const has = (p, cap) => !!(p && p.capabilities && (p.capabilities.has ? p.capabilities.has(cap) : arr(p.capabilities).includes(cap)));
  return {
    all: () => list.slice(),
    get: (id) => byId.get(id) || null,
    withCapability: (cap) => list.filter((p) => has(p, cap)),
    // Every registered playback-owning provider (Apple Music, later Spotify, …).
    playbackOwners: () => list.filter((p) => has(p, CAP.OWNS_PLAYBACK)),
    // Which provider owns transport right now — chosen by a config value so a
    // second streamer is "write the adapter + flip the config", never a code
    // change here (requirement #5). Falls back to the sole owner when the config
    // is unset/stale, and to null when none is registered.
    activePlaybackProvider: (activeId) => {
      const owners = list.filter((p) => has(p, CAP.OWNS_PLAYBACK));
      if (activeId) { const p = byId.get(activeId); if (p && has(p, CAP.OWNS_PLAYBACK)) return p; }
      return owners.length === 1 ? owners[0] : null;
    },
    /**
     * Query every SEARCH-capable, available provider and merge normalized
     * results. Each provider is isolated: a throw/timeout/unavailable one
     * contributes nothing and is reported in `providerStatuses`, never breaking
     * the others. Returns { query, items, providerStatuses }.
     */
    async search(query, opts = {}) {
      const q = str(query).trim();
      const targets = list.filter((p) => has(p, CAP.SEARCH) && (opts.providerId ? p.id === opts.providerId : true));
      if (!q || !targets.length) return { query: q, items: [], providerStatuses: targets.map((p) => ({ provider: p.id, ok: true, count: 0 })) };
      const settled = await Promise.allSettled(targets.map(async (p) => {
        if (p.isAvailable && !(await safe(() => p.isAvailable(), false))) throw new Error("provider unavailable");
        const items = await p.search(q, { limit: opts.limit || 25, page: opts.page || 1, signal: opts.signal });
        return { provider: p.id, items: arr(items) };
      }));
      const items = [];
      const providerStatuses = settled.map((r, i) => {
        const pid = targets[i].id;
        if (r.status === "fulfilled") { items.push(...r.value.items); return { provider: pid, ok: true, count: r.value.items.length }; }
        return { provider: pid, ok: false, count: 0, error: String(r.reason && r.reason.message || r.reason) };
      });
      return { query: q, items, providerStatuses };
    },
  };
}

async function safe(fn, fallback) { try { return await fn(); } catch { return fallback; } }
