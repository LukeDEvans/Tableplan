// ScoreProvider registry — external score repositories as pluggable providers
// (design §10), mirroring the proven MusicProvider registry on the listening
// side: aggregated + ISOLATED search (one bad provider never breaks the others),
// injected HTTP so providers are testable and a Netlify proxy can slot in later,
// and capability flags. The core domain never learns where a score came from.
//
// The cardinal rule (§10): a source is "structured/machine-readable" ONLY if it
// explicitly exposes a usable structured representation (MusicXML/MEI). A site
// calling itself "interactive" does not count. Structured results flow into the
// existing import pipeline (importMusicXmlFile); non-structured results (PDF/scan)
// are bound for OMR. Real providers (PDMX/Mutopia/IMSLP) implement this interface;
// none are bundled here (they need live integration + licensing review).
//
// Pure and DOM-free.
//
// ScoreProvider:
//   id, label, capabilities: Set<SCORE_CAP>
//   isAvailable(): Promise<bool>
//   search(query, {limit,page,signal}): Promise<ScoreResult[]>
//   getItem(ref, {signal}): Promise<ScoreResult>                (if GET_ITEM)
//   fetchStructured(ref, {signal}): Promise<{name, bytes, format}> (if STRUCTURED)

export const SCORE_CAP = Object.freeze({
  SEARCH: "search",
  GET_ITEM: "get_item",
  STRUCTURED: "structured",   // exposes MusicXML/MEI bytes (the real bar for "machine-readable")
  LICENSE: "license",
  PAGINATION: "pagination",
});

const str = (v, d = "") => (v == null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);

/** Only these formats count as a usable structured representation. */
export function isStructuredFormat(format) {
  const f = String(format || "").toLowerCase();
  return f === "musicxml" || f === "mxl" || f === "mei";
}

/** Normalize a provider's search hit. `structured` is DERIVED from the format —
 * a provider cannot claim structured-ness with a PDF. */
export function makeScoreResult(p = {}) {
  const format = str(p.format) || "unknown";
  return {
    provider: str(p.provider),
    externalId: str(p.externalId),
    title: str(p.title) || "Untitled",
    composer: str(p.composer),
    format,                                  // "musicxml" | "mxl" | "mei" | "pdf" | "scan" | "unknown"
    structured: isStructuredFormat(format),  // the honest flag callers key on
    license: p.license || null,
    sourceUrl: str(p.sourceUrl) || null,
    provenance: p.provenance && typeof p.provenance === "object" ? p.provenance : {},
  };
}

const has = (p, cap) => !!(p && p.capabilities && (p.capabilities.has ? p.capabilities.has(cap) : arr(p.capabilities).includes(cap)));
async function safe(fn, fallback) { try { return await fn(); } catch { return fallback; } }

export function createScoreProviderRegistry(providers = []) {
  const list = providers.filter(Boolean);
  const byId = new Map(list.map((p) => [p.id, p]));
  return {
    all: () => list.slice(),
    get: (id) => byId.get(id) || null,
    withCapability: (cap) => list.filter((p) => has(p, cap)),
    /** Providers that can actually hand over structured bytes (prefer these). */
    structuredProviders: () => list.filter((p) => has(p, SCORE_CAP.STRUCTURED)),

    /**
     * Aggregated, isolated search across SEARCH-capable available providers.
     * Returns { query, results, providerStatuses }. Structured results are
     * sorted first (prefer MusicXML over a scan needing OMR).
     */
    async search(query, opts = {}) {
      const q = str(query).trim();
      const targets = list.filter((p) => has(p, SCORE_CAP.SEARCH) && (opts.providerId ? p.id === opts.providerId : true));
      if (!q || !targets.length) return { query: q, results: [], providerStatuses: targets.map((p) => ({ provider: p.id, ok: true, count: 0 })) };

      const settled = await Promise.allSettled(targets.map(async (p) => {
        if (p.isAvailable && !(await safe(() => p.isAvailable(), false))) throw new Error("provider unavailable");
        const hits = await p.search(q, { limit: opts.limit || 25, page: opts.page || 1, signal: opts.signal });
        return { provider: p.id, results: arr(hits).map((h) => makeScoreResult({ ...h, provider: h.provider || p.id })) };
      }));

      const results = [];
      const providerStatuses = settled.map((r, i) => {
        const pid = targets[i].id;
        if (r.status === "fulfilled") { results.push(...r.value.results); return { provider: pid, ok: true, count: r.value.results.length }; }
        return { provider: pid, ok: false, count: 0, error: String((r.reason && r.reason.message) || r.reason) };
      });
      // Prefer structured (importable) results first; stable otherwise.
      results.sort((a, b) => (b.structured ? 1 : 0) - (a.structured ? 1 : 0));
      return { query: q, results, providerStatuses };
    },
  };
}
