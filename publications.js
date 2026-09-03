// publications.js — the canonical Publications domain model (Phase 1 foundation).
// Pure, DOM-free, no persistence: shapes + identity/dedup + reconcile for
// Publication → Feed → canonical Article. NO RSS fetching, NO scheduling, NO UI —
// this is only the domain foundation the later RSS/Publications phases build on.
//
// Invariants (audit + PUBLICATIONS_MEDIA_ARCHITECTURE_AUDIT.md):
//   - ONE canonical Article per real-world article (manual save + RSS converge here).
//   - A Publication owns MANY Feeds; MANY Feeds may discover ONE Article.
//   - Article metadata only — NO body/audio here (content store, on demand, later).
//   - Notification state, playlist membership, reading/listening progress, and
//     consumption are SEPARATE concerns, never collapsed onto the Article.
//   - Identity is deterministic; prefer a possible duplicate over a false merge.

import { canonicalizeUrl } from "./import-canonical.js";
import { makeProvenance, ORIGIN } from "./provenance.js";

const str = (x) => (x == null ? "" : String(x)).trim();
const nowIso = () => new Date().toISOString();

// ── Identity ─────────────────────────────────────────────────────────────────
// TWO distinct identities (audit §17-19):
//  • SOURCE identity: a GUID is unique only WITHIN its feed, so re-polling is
//    idempotent per feed via `sourceKey(feedId, guid)`. Never assume a GUID is
//    globally unique across every feed on the internet.
//  • CANONICAL identity: cross-feed dedup of the real-world article, by canonical
//    URL (conservative — reuses import-canonical), else a title+date fallback.

export function sourceKey(feedId, guid) {
  const g = str(guid);
  return g ? `${str(feedId)} ${g}` : "";
}

const normalizeTitle = (t) => str(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const dateStamp = (d) => str(d).slice(0, 10); // YYYY-MM-DD if present

// The cross-feed canonical dedup key. A real URL wins (conservative canonicalize);
// otherwise a title+date fallback so URL-less items still dedupe conservatively.
// Returns "" only when there's nothing to key on (caller then keeps it distinct).
export function canonicalKey(article) {
  const url = str(article?.canonicalUrl) || str(article?.url);
  if (url) return `u ${canonicalizeUrl(url)}`;
  const t = normalizeTitle(article?.title);
  if (t) return `t ${t} ${dateStamp(article?.publishedAt)}`;
  return "";
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export function makePublication(p = {}) {
  return {
    id: str(p.id),
    name: str(p.name),
    key: str(p.key) || normalizeTitle(p.name),
    enabled: p.enabled !== false,
    feedIds: Array.isArray(p.feedIds) ? p.feedIds.map(str).filter(Boolean) : [],
    provenance: p.provenance || makeProvenance({ origin: ORIGIN.MANUAL }),
  };
}

// Feed carries exactly what future RSS ingestion needs — nothing more. No polling
// logic here; these fields are populated by the later fetch phase.
export function makeFeed(f = {}) {
  return {
    id: str(f.id),
    publicationId: str(f.publicationId),
    url: str(f.url),
    title: str(f.title),
    enabled: f.enabled !== false,
    etag: f.etag == null ? null : str(f.etag),
    lastModified: f.lastModified == null ? null : str(f.lastModified),
    lastFetchedAt: f.lastFetchedAt == null ? null : str(f.lastFetchedAt),
    lastSuccessAt: f.lastSuccessAt == null ? null : str(f.lastSuccessAt),
    nextFetchAt: f.nextFetchAt == null ? null : str(f.nextFetchAt),
    errorCount: Number.isInteger(f.errorCount) ? f.errorCount : 0,
    lastError: f.lastError == null ? null : str(f.lastError),
    provenance: f.provenance || makeProvenance({ origin: ORIGIN.MANUAL }),
  };
}

// Canonical Article — METADATA only. No body/audio. Reading/listening/consumption/
// notification/playlist are separate concerns, not fields here.
export function makeArticle(a = {}) {
  const url = str(a.url);
  const discoveredAt = str(a.discoveredAt) || nowIso();
  return {
    id: str(a.id),
    publicationId: str(a.publicationId) || null,
    feedIds: Array.isArray(a.feedIds) ? [...new Set(a.feedIds.map(str).filter(Boolean))] : [],
    guid: a.guid == null ? null : str(a.guid),
    url: url || null,
    canonicalUrl: str(a.canonicalUrl) || (url ? canonicalizeUrl(url) : null),
    title: str(a.title),
    author: a.author == null ? null : str(a.author),
    publishedAt: a.publishedAt == null ? null : str(a.publishedAt),
    updatedAt: a.updatedAt == null ? null : str(a.updatedAt),
    description: a.description == null ? null : str(a.description),
    imageUrl: a.imageUrl == null ? null : str(a.imageUrl),
    category: a.category == null ? null : str(a.category),
    discoveredAt,
    provenance: a.provenance || makeProvenance({ origin: ORIGIN.PROVIDER, source: "rss", sourceUrl: url || null }),
  };
}

// ── Reconcile (update-not-duplicate) ─────────────────────────────────────────
// Rediscovering the same real-world article UPDATES it in place (audit §25):
// preserve id / original publishedAt / discoveredAt / provenance and UNION feedIds;
// refresh mutable metadata (title/author/description/image/category/url) and set
// updatedAt only when something mutable actually changed. Reading/listening
// progress, playlist membership, and consumption are NOT on the Article, so they
// are structurally impossible to reset here.
const MUTABLE = ["title", "author", "description", "imageUrl", "category", "url", "canonicalUrl"];

export function reconcileArticle(existing, incoming) {
  if (!existing) return makeArticle(incoming);
  const merged = { ...existing };
  merged.feedIds = [...new Set([...(existing.feedIds || []), ...(incoming.feedIds || []).map(str)].filter(Boolean))];
  if (incoming.guid != null && str(incoming.guid)) merged.guid = str(incoming.guid);
  if (incoming.publicationId && !merged.publicationId) merged.publicationId = str(incoming.publicationId);
  let changed = false;
  for (const k of MUTABLE) {
    const v = incoming[k];
    if (v != null && str(v) && str(v) !== str(existing[k])) { merged[k] = str(v); changed = true; }
  }
  // publishedAt is PRESERVED (original); discoveredAt PRESERVED; only updatedAt moves.
  if (changed) merged.updatedAt = str(incoming.updatedAt) || nowIso();
  return merged;
}

// Ingest a batch into an existing article list, deduping by canonical identity and
// reconciling in place. Pure: returns { articles, added, updated } — never mutates
// input. Deterministic + idempotent (re-ingesting the same batch changes nothing
// beyond a possible updatedAt when metadata genuinely changed).
export function ingestArticles(existingList, incomingList) {
  const articles = (existingList || []).map((a) => ({ ...a }));
  const byKey = new Map();
  articles.forEach((a, i) => { const k = canonicalKey(a); if (k) byKey.set(k, i); });
  let added = 0, updated = 0;
  for (const raw of incomingList || []) {
    const incoming = makeArticle(raw);
    const key = canonicalKey(incoming);
    const idx = key ? byKey.get(key) : undefined;
    if (idx == null) {
      articles.push(incoming);
      if (key) byKey.set(key, articles.length - 1);
      added++;
    } else {
      const before = articles[idx];
      const after = reconcileArticle(before, incoming);
      articles[idx] = after;
      if (after.updatedAt !== before.updatedAt || (after.feedIds || []).length !== (before.feedIds || []).length) updated++;
    }
  }
  return { articles, added, updated };
}

// ── Legacy reconciliation: savedArticles → canonical Article ─────────────────
// Deterministic, idempotent, NON-destructive mapping (audit §32). The manual
// savedArticles store is NOT removed here — this only produces the canonical form
// so a later phase can migrate once every consumer is ready. Body text is dropped
// (metadata only; the body is content-store territory).
export function savedArticleToArticle(saved) {
  const url = str(saved?.url);
  return makeArticle({
    id: str(saved?.id),
    publicationId: null,
    feedIds: [],
    guid: null,
    url: url || null,
    canonicalUrl: str(saved?.canonicalUrl) || (url ? canonicalizeUrl(url) : null),
    title: str(saved?.title),
    author: saved?.author == null ? null : str(saved.author),
    publishedAt: str(saved?.date) || str(saved?.savedAt) || null,
    updatedAt: str(saved?.savedAt) || null,
    description: null,
    imageUrl: null,
    category: str(saved?.publication) || null,
    discoveredAt: str(saved?.savedAt) || nowIso(),
    provenance: saved?.provenance || makeProvenance({ origin: ORIGIN.IMPORTED, source: "manual", sourceUrl: url || null }),
  });
}
