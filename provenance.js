// provenance.js — a small, consistent way to record WHERE a record came from and
// its lifecycle, so data is explainable to a person and legible to a future AI
// agent WITHOUT bloating every object (ARCHITECTURE.md §25: attach provenance only
// where it earns its place).
//
// Attach a `provenance` field to a record when it ENTERS Live from a source —
// imported (URL/share/extension), fetched from a capability provider, generated
// (TTS/AI), or derived from other records. Records the user obviously authored in a
// domain they own (a task they typed, a budget line) do not need it; their origin
// is implicit. The shape rides the normal sync path (it's part of the record, so it
// is unioned-by-id and merged like any other field — no new merge rule needed).
//
// It answers: where did this come from? imported/generated/manual/derived? has the
// user changed it? is it current (last observed)? can it be refreshed/regenerated?
// is it safe to delete locally?

export const ORIGIN = {
  MANUAL: "manual",       // user typed it here
  IMPORTED: "imported",   // came in through the import gateway / share / extension
  PROVIDER: "provider",   // fetched from a capability provider (tmdb, simplefin, feed…)
  GENERATED: "generated", // produced by the app (TTS audio, AI summary)
  DERIVED: "derived",     // computed from other canonical records
};
const ORIGINS = new Set(Object.values(ORIGIN));

const nowIso = () => new Date().toISOString();

// Build a provenance stamp. `refreshable` defaults to true for imported/provider
// origins (the source can be re-fetched) and false otherwise, unless set explicitly.
export function makeProvenance({
  origin,
  source = null,        // importer/provider id: "import-gateway", "gmail", "tmdb", "simplefin"
  sourceUrl = null,     // the external URL/reference, if any
  providerId = null,    // capability provider id, when fetched via a provider
  importedAt = null,    // when it entered Live (defaults now)
  observedAt = null,    // when the source was last seen/confirmed (defaults importedAt)
  refreshable = null,   // can the source be re-fetched? (defaults by origin)
  transformedBy = null, // pipeline/step that shaped it, if any
  userModified = false, // has the user edited it since ingress?
} = {}) {
  const o = ORIGINS.has(origin) ? origin : ORIGIN.MANUAL;
  const at = importedAt || nowIso();
  return {
    origin: o,
    source: source || null,
    sourceUrl: sourceUrl || null,
    providerId: providerId || null,
    importedAt: at,
    observedAt: observedAt || at,
    refreshable: refreshable == null ? (o === ORIGIN.IMPORTED || o === ORIGIN.PROVIDER) : !!refreshable,
    transformedBy: transformedBy || null,
    userModified: !!userModified,
  };
}

// The user edited an imported/generated record — its local copy now diverges from
// the source, so a future refresh must not silently overwrite it.
export function markUserModified(prov) {
  return prov && typeof prov === "object" ? { ...prov, userModified: true } : prov;
}

// A re-fetch/observation confirmed the source is still present at time `at`.
export function markObserved(prov, at = nowIso()) {
  return prov && typeof prov === "object" ? { ...prov, observedAt: at } : prov;
}

// Answer the lifecycle questions for a record's provenance, with sensible defaults
// for legacy records that predate provenance (origin "unknown").
export function describeProvenance(prov) {
  const p = prov && typeof prov === "object" ? prov : null;
  const refreshable = !!p?.refreshable;
  const userModified = !!p?.userModified;
  return {
    origin: p?.origin || "unknown",
    fromSource: p?.source || null,
    sourceUrl: p?.sourceUrl || null,
    provider: p?.providerId || null,
    importedAt: p?.importedAt || null,
    lastObserved: p?.observedAt || p?.importedAt || null,
    userModified,
    refreshable,
    // Safe to drop the local copy without losing unique user work: it can be
    // re-fetched AND the user hasn't edited it since it arrived.
    safelyRegenerable: refreshable && !userModified,
  };
}
