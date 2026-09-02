// platform-capabilities.js — a small, honest CATALOG of Live's cross-cutting
// platform capabilities: the reusable mechanisms that many domains build on, each
// pointing at its ONE canonical module (ARCHITECTURE.md §4). This is NOT a second
// provider registry and NOT a plugin system — provider/capability *discovery* stays
// in media-provider.js (MEDIA_CAP/PROVIDER_CATALOG). This catalog answers "what can
// the platform do, and where does it live?" for three real consumers: the developer
// diagnostics surface, a future AI agent reasoning about the app, and onboarding.
//
// Adding a row here is the lightweight way to declare "this is now a platform
// capability with multiple consumers" — the §25 test (≥2 genuine consumers) applies.

// status: "stable" (established), "emerging" (real but still consolidating),
// "planned" (designed, slice pending — implementation gated per the completion matrix).
export const PLATFORM_CAPABILITIES = [
  { id: "persistence",     label: "Local-first persistence", module: "app.js (state + mirror), content-store/",
    consumers: ["every domain"], status: "stable",
    description: "In-memory state truth, a local mirror, out-of-band content store for large/binary data." },
  { id: "sync",            label: "Cross-device sync", module: "state-sync.js + app.js mergeStates",
    consumers: ["every synced domain"], status: "stable",
    description: "Section-granular CAS writes; unionById + tombstones + deep-merge; empty-never-erases." },
  { id: "account-boundary",label: "Account boundary + lifecycle", module: "auth-account-reset.js",
    consumers: ["auth", "sync", "persistence"], status: "stable",
    description: "In-tab and cross-tab account-transition detection + coordinated local reset." },
  { id: "provenance",      label: "Provenance / lifecycle", module: "provenance.js",
    consumers: ["import", "media", "future: search", "future: AI"], status: "emerging",
    description: "Origin/source/refreshable/userModified stamp attached at data ingress." },
  { id: "import",          label: "Unified import ingestion", module: "netlify/functions/_import-*",
    consumers: ["recipes", "articles", "chrome-extension", "web-share"], status: "stable",
    description: "One SSRF-guarded gateway: acquire → detect → extract → contract, many acquisition clients." },
  { id: "providers",       label: "Capability-typed providers", module: "media-provider.js",
    consumers: ["media", "music", "radio", "watch"], status: "stable",
    description: "Provider registry with capability flags — the extension boundary (no plugin system)." },
  { id: "media-playback",  label: "Media playback", module: "playback-coordinator.js + playback-engine.js",
    consumers: ["media", "music", "radio", "podcasts", "future: TTS"], status: "stable",
    description: "Capability-chosen playback target + one audio engine; history + progress." },
  { id: "tts",             label: "Text-to-speech", module: "tts-provider.js + voice-service.js",
    consumers: ["read/listen", "briefings"], status: "emerging",
    description: "Provider-abstracted TTS (Kokoro/cloud) feeding the shared playback path." },
  { id: "projections",     label: "Deterministic Today projections", module: "today-projection.js",
    consumers: ["home", "future: AI"], status: "planned",
    description: "Pure projectToday(state, now) per-domain, composed into a Today view (slice 8)." },
  { id: "diagnostics",     label: "Developer diagnostics", module: "diagnostics.js",
    consumers: ["developers", "future: AI"], status: "planned",
    description: "Read-only snapshot of sync/hydration/account/providers/caches/errors (slice 7)." },
  { id: "search",          label: "Local search index", module: "search-index.js",
    consumers: ["cross-domain search", "future: AI retrieval"], status: "planned",
    description: "Projection-backed, rebuildable, account-scoped local index — no external engine (slice 10)." },
];

const byId = new Map(PLATFORM_CAPABILITIES.map((c) => [c.id, c]));

export function capabilityById(id) {
  return byId.get(id) || null;
}

// Snapshot for diagnostics / AI / onboarding. `available` lets a caller mark which
// capabilities are actually live in the current runtime (e.g. providers configured).
export function describeCapabilities(available = null) {
  return PLATFORM_CAPABILITIES.map((c) => ({
    ...c,
    available: available ? !!available[c.id] : (c.status !== "planned"),
  }));
}
