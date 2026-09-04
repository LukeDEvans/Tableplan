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
  { id: "document-scan",   label: "Document text extraction (scan)", module: "document-scan.js",
    consumers: ["receipts", "recipes", "bookings", "articles (extractor ready, UI pending)"], status: "stable",
    description: "One vision-extraction seam: image/PDF → raw output → a domain parser. The image-source sibling of `import` (URL source) — the natural iOS ingestion path (Web Share Target is iOS-absent). Domains own only their prompt + normalizer." },
  { id: "local-ocr",       label: "On-device text recognition", module: "document-scan.js (provider slot)",
    consumers: ["future: receipts", "future: recipes"], status: "planned",
    description: "Optional on-device OCR provider behind the scan seam (browser TextDetector where supported; a native VisionKit/ML-Kit shell later). No reliable iOS-PWA local OCR exists today, so cloud vision stays the accurate default; this slot keeps that swap domain-agnostic." },
  { id: "providers",       label: "Capability-typed providers", module: "media-provider.js",
    consumers: ["media", "music", "radio", "watch"], status: "stable",
    description: "Provider registry with capability flags — the extension boundary (no plugin system)." },
  { id: "reorder",         label: "Reorderable-list interaction", module: "sortable.js + sortable-core.js",
    consumers: ["tasks", "media queue", "grocery", "watch", "playlists", "17 sites"], status: "stable",
    description: "makeSortable(): one pointer+touch+auto-scroll+keyboard list-reorder primitive. Distinct from drop-onto-target (native drag-drop)." },
  { id: "media-playback",  label: "Media playback", module: "playback-coordinator.js + playback-engine.js",
    consumers: ["media", "music", "radio", "podcasts", "future: TTS"], status: "stable",
    description: "Capability-chosen playback target + one audio engine; history + progress." },
  { id: "tts",             label: "Text-to-speech", module: "tts-provider.js + voice-service.js",
    consumers: ["read/listen", "briefings"], status: "emerging",
    description: "Provider-abstracted TTS (Kokoro/cloud) feeding the shared playback path." },
  { id: "projections",     label: "Deterministic Today projections", module: "today-projection.js",
    consumers: ["home", "future: AI"], status: "emerging",
    description: "Pure projectToday(state, now): calendar/media/weather projectors composed; extensible via an extra seam." },
  { id: "diagnostics",     label: "Developer diagnostics", module: "diagnostics.js",
    consumers: ["developers", "future: AI"], status: "emerging",
    description: "Read-only snapshot of sync/hydration/account/providers/caches/errors via a dev console hook." },
  { id: "operations",      label: "Async-operation status", module: "async-operation.js",
    consumers: ["diagnostics", "future: AI"], status: "emerging",
    description: "A status contract for long-running work (import/scan/tts/sync) — observable, not a job engine (jobs stay §8)." },
  { id: "search",          label: "Local search index", module: "search-index.js",
    consumers: ["cross-domain search", "future: AI retrieval"], status: "emerging",
    description: "Projection-backed, rebuildable, invalidatable, account-scoped in-memory index — no external engine." },
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
