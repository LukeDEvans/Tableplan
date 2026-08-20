// Canonical Media envelope — the thin, provider-independent shape that Search,
// Discover, Continue, History and the Playback Coordinator consume, so none of
// them ever switch on a provider or a media type. It does NOT replace the
// existing per-type records (watchItem, podcast, music canonical, radio station,
// article) — those stay authoritative; a source ADAPTS itself into this envelope
// (like media-history.js's makeHistoryEntry, but richer). Pure, DOM-free.
//
// Four separated concerns (design §6): CONTENT (what it is) · PROVIDER (where
// it's from) · PLAYBACK TARGET (how to play it) · USER STATE (what you've done).

export const MEDIA_KIND = Object.freeze({
  VIDEO: "video", MUSIC: "music", PODCAST: "podcast", RADIO: "radio", ARTICLE: "article",
});

// How a target is realized. Ranked best→worst by the coordinator (design §8).
export const PLAYBACK_MODE = Object.freeze({
  NATIVE: "native",       // our own engine / a fully in-app player (Jellyfin, IA, streams)
  EMBEDDED: "embedded",   // provider's embeddable player (YouTube IFrame)
  WEB: "web",             // provider's web experience, in-app, where legitimately allowed
  DEEPLINK: "deeplink",   // open the exact title in the provider's native app
  BROWSER: "browser",     // open in the browser (last resort)
});

const str = (v, d = "") => (v == null ? d : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// A reference to this content ON a provider — identity + how to reach it. Never
// carries credentials (auth lives in the provider adapter, design §15).
export function makeProviderRef(p = {}) {
  return {
    providerId: str(p.providerId),
    externalId: str(p.externalId),         // the provider's id for this content
    uri: str(p.uri) || null,               // playable/stream uri where the provider exposes one
    deepLink: str(p.deepLink) || null,     // app/web link to the exact title
    // Was this ref confirmed available to the user (connected + in catalog)? The
    // coordinator/search treat null as "unknown", true as "your services".
    available: p.available == null ? null : !!p.available,
  };
}

// Progress is per-kind: don't force video into audio semantics (design §12).
export function makeProgress(p = {}) {
  return {
    kind: str(p.kind) || "position",       // "position" | "percent" | "episodic" | "live" | "completed"
    position: num(p.position),             // seconds (position kind)
    duration: num(p.duration),
    percent: num(p.percent),               // 0..1 (percent kind)
    completed: !!p.completed,
    season: num(p.season), episode: num(p.episode), // episodic kind
  };
}

export function makeUserState(p = {}) {
  return {
    saved: !!p.saved,                      // Watch-Later / Listen-Later
    favorite: !!p.favorite,
    status: str(p.status) || null,         // e.g. "want" | "watched" | null
    progress: p.progress ? makeProgress(p.progress) : null,
    lastAt: num(p.lastAt),                 // ms; feeds Continue/History ordering
  };
}

// The canonical item every surface consumes. `source` keeps the native record so
// a surface can still open/act on the original (provenance, no data duplication).
export function makeMediaItem(p = {}) {
  return {
    kind: Object.values(MEDIA_KIND).includes(p.kind) ? p.kind : str(p.kind) || MEDIA_KIND.VIDEO,
    id: str(p.id),
    title: str(p.title) || "Untitled",
    subtitle: str(p.subtitle) || "",
    artworkUrl: str(p.artworkUrl) || "",
    year: str(p.year) || "",
    providerRefs: arr(p.providerRefs).map(makeProviderRef).filter((r) => r.providerId),
    userState: makeUserState(p.userState || {}),
    meta: (p.meta && typeof p.meta === "object") ? p.meta : {},
    source: p.source != null ? p.source : null, // the native record (watchItem, episode, …)
  };
}

// A concrete way to play — produced by the coordinator from provider capabilities.
export function makePlaybackTarget(p = {}) {
  return {
    providerId: str(p.providerId),
    mode: Object.values(PLAYBACK_MODE).includes(p.mode) ? p.mode : PLAYBACK_MODE.BROWSER,
    uri: str(p.uri) || null,
    label: str(p.label) || "",             // "Play on Max" / "Open Netflix"
  };
}

/** Stable identity for de-dupe across surfaces (kind + id). */
export function mediaKey(item) { return `${str(item?.kind)}:${str(item?.id)}`; }

/** A trustworthy cross-provider identity for VIDEO, when one exists: the TMDB id
 *  (from the tmdb providerRef or meta.tmdbId). Used to merge the same title's
 *  availability across providers; null when no reliable identity is known. */
export function tmdbIdOf(item) {
  if (!item) return null;
  if (item.meta && item.meta.tmdbId) return String(item.meta.tmdbId);
  const ref = (item.providerRefs || []).find((r) => r.providerId === "tmdb" && r.externalId);
  return ref ? String(ref.externalId) : null;
}

/** Content identity for aggregation: the TMDB id if known, else kind:id. */
export function contentKey(item) {
  const t = tmdbIdOf(item);
  return t ? `tmdb:${t}` : mediaKey(item);
}

/** Is this target an in-app playback (vs a handoff)? */
export function isInApp(mode) {
  return mode === PLAYBACK_MODE.NATIVE || mode === PLAYBACK_MODE.EMBEDDED || mode === PLAYBACK_MODE.WEB;
}
