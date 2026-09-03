// article-body.js — PURE helpers for on-demand article-body acquisition (Phase 3).
// The Article record is METADATA only (publications.js): the body lives in the
// content store, fetched on demand through the existing `fetch-article` Netlify
// function. These helpers shape that request from a canonical article and
// normalize the response — no network here (the caller owns the fetch + the
// content store), and NO body is ever written back onto the metadata record.

const str = (x) => (x == null ? "" : String(x)).trim();

// Build the `fetch-article` request for a canonical article. Prefer the canonical
// URL (tracking already stripped) over the raw url; carry the publication name so
// the extractor can apply per-publication rules (matches the savedArticles path).
export function bodyFetchRequest(article, { pubsById } = {}) {
  const url = str(article?.canonicalUrl) || str(article?.url);
  if (!url) return { ok: false, error: "This article has no URL to fetch." };
  const pub = article?.publicationId && pubsById ? pubsById[article.publicationId] : null;
  const publication = str(pub?.name) || str(article?.category) || "";
  return { ok: true, url, publication };
}

// Normalize a `fetch-article` response into a stable outcome. The extractor
// returns body HTML plus refreshed metadata; a missing/blank body is a failure
// (paywall/hard-fetch) the caller surfaces with an "Open in browser" fallback.
export function normalizeFetchedBody(res) {
  const text = typeof res?.text === "string" ? res.text : "";
  if (!text.trim()) {
    return { ok: false, text: "", error: str(res?.error) || "Could not extract article text." };
  }
  return {
    ok: true,
    text,
    title: str(res?.title),
    author: str(res?.author),
    date: str(res?.date),
  };
}

// Non-destructive metadata refresh from a fetched body. Returns { article, changed }
// — a NEW metadata object (never mutated in place) with title/author/publishedAt
// filled ONLY where the fetch genuinely improves them, and NEVER a body field.
// Rules: never replace a real title with the fetched one unless the current title
// is empty or is just the URL; only fill author/publishedAt when currently empty.
export function mergeFetchedMetadata(article, fetched) {
  const base = article || {};
  const next = { ...base };
  let changed = false;
  const curTitle = str(base.title);
  const isPlaceholderTitle = !curTitle || curTitle === str(base.url) || curTitle === str(base.canonicalUrl);
  if (fetched?.title && isPlaceholderTitle && fetched.title !== curTitle) { next.title = fetched.title; changed = true; }
  if (fetched?.author && !str(base.author)) { next.author = fetched.author; changed = true; }
  if (fetched?.date && !str(base.publishedAt)) { next.publishedAt = fetched.date; changed = true; }
  // Defensive: a fetched body must never leak onto the metadata record.
  if ("text" in next) { delete next.text; }
  if ("body" in next) { delete next.body; }
  return { article: next, changed };
}
