// feed-ingest.js — PURE, network-free ingestion orchestrator (Phase 2A). Turns a
// parsed feed + a fetch RESULT into canonical Article changes, converging through
// the Phase-1 reconciliation (publications.js `ingestArticles`). No network here:
// the caller fetches via the `fetch-feed` function (SSRF-guarded) and passes the
// response in, so all logic is deterministic and testable without a network.
//
// It owns ONLY discovery→ingestion. It does NOT do: article-body extraction, TTS,
// playback, notifications, reading/consumption, retention, or SCHEDULING (feed
// backoff/next-fetch is a future phase — this only records observable fetch metadata).

import { parseFeed } from "./feed-parse.js";
import { makeArticle, ingestArticles, canonicalKey } from "./publications.js";
import { makeProvenance, ORIGIN } from "./provenance.js";

// Parse a feed date (RFC 822/2822, ISO 8601, Atom) to an ISO string, or null.
// NEVER substitutes "now" for a bad/missing date — a null publish date is honest,
// and reconciliation preserves an existing publishedAt anyway.
export function parseFeedDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// A parsed feed item → a canonical-Article candidate (the shape makeArticle accepts).
// The link is the URL (canonicalization + identity happen in publications.js). The
// RSS description/excerpt is METADATA only — never treated as the article body.
export function normalizeFeedItem(item, { feedId = null, publicationId = null } = {}) {
  const link = String(item?.link || "").trim();
  return {
    publicationId: publicationId || null,
    feedIds: feedId ? [feedId] : [],
    guid: item?.guid || null,
    url: link || null,
    title: String(item?.title || "").trim(),
    author: item?.author ? String(item.author).trim() : null,
    publishedAt: parseFeedDate(item?.published),
    updatedAt: parseFeedDate(item?.updated),
    description: item?.description ? String(item.description).trim() : null, // excerpt, NOT body
    imageUrl: item?.imageUrl ? String(item.imageUrl).trim() : null,         // reference only, not mirrored
    category: item?.category ? String(item.category).trim() : null,
    provenance: makeProvenance({ origin: ORIGIN.PROVIDER, source: "rss", sourceUrl: link || null, providerId: feedId }),
  };
}

// Feed metadata bookkeeping after a fetch. Pure — returns the fields the caller
// should persist onto the Feed record. NO next-fetch/backoff scheduling is computed
// here (that belongs to a future scheduler); only observable fetch state.
function feedUpdateOk(feed, response, { success }) {
  const now = new Date().toISOString();
  const base = {
    lastFetchedAt: now,
    etag: response?.etag ?? feed?.etag ?? null,
    lastModified: response?.lastModified ?? feed?.lastModified ?? null,
  };
  if (success) return { ...base, lastSuccessAt: now, errorCount: 0, lastError: null };
  return { ...base, errorCount: (Number(feed?.errorCount) || 0) + 1, lastError: response?.error || "fetch failed" };
}

const result = (over = {}) => ({
  status: null, notModified: false, added: 0, updated: 0, deduped: 0,
  articles: [], warnings: [], failure: null, feedUpdate: null, ...over,
});

// Fetch this Feed now and ingest what it contains (§29). `response` is the fetch
// result: { status, notModified, body, etag, lastModified, error }. `existingList`
// is the current canonical Article list for this account/group. Deterministic and
// idempotent (re-running with the same body changes nothing beyond a real update).
export function runFeedIngestion({ feed = {}, response = {}, existingList = [] } = {}) {
  const articles = existingList;
  const status = response.status ?? null;

  // 304 / conditional not-modified — a SUCCESS, not a failure; nothing to ingest.
  if (response.notModified || status === 304) {
    return result({ status: status ?? 304, notModified: true, articles, feedUpdate: feedUpdateOk(feed, response, { success: true }) });
  }
  // Transport/network error, or an HTTP error status — an explicit failure that
  // must NOT mutate articles or masquerade as an empty successful feed (§16).
  if (response.error || (typeof status === "number" && status >= 400)) {
    return result({ status, articles, failure: { status, message: response.error || `HTTP ${status}` }, feedUpdate: feedUpdateOk(feed, response, { success: false }) });
  }

  const parsed = parseFeed(response.body || "");
  if (!parsed.ok) {
    // Malformed feed XML is a failure, not an empty success (§18).
    return result({ status, articles, failure: { message: parsed.error || "malformed feed" }, feedUpdate: feedUpdateOk(feed, response, { success: false }) });
  }

  const warnings = [];
  const candidates = [];
  for (const item of parsed.items) {
    const cand = makeArticle(normalizeFeedItem(item, { feedId: feed.id || null, publicationId: feed.publicationId || null }));
    // Skip identity-less items (no URL AND no title): they cannot dedupe, so
    // ingesting them would break idempotency. One bad item never fails the feed.
    if (!canonicalKey(cand)) { warnings.push("skipped item with no identity (no url/title)"); continue; }
    candidates.push(cand);
  }
  const ing = ingestArticles(articles, candidates);
  return result({
    status: status ?? 200,
    added: ing.added,
    updated: ing.updated,
    deduped: candidates.length - ing.added,
    articles: ing.articles,
    warnings,
    feedUpdate: { ...feedUpdateOk(feed, response, { success: true }), title: parsed.feed?.title || feed?.title || null },
  });
}
