// fetch-feed.js — the NETWORK BOUNDARY for RSS/Atom discovery (Phase 2A). Thin:
// auth-gates, fetches ONE feed URL through the shared SSRF-guarded safeFetch with
// optional conditional-GET validators, and returns the raw body + fetch metadata.
// It does NOT parse, normalize, dedupe, ingest, or schedule — the client does that
// deterministically with feed-parse.js + feed-ingest.js (pure). Keeping parsing off
// the server keeps this function trivial and the logic testable without a network.
//
// Reuses the SAME safeFetch as the import gateway (no second, weaker fetch): scheme/
// port/host allow-listing, DNS + blocked-IP checks on the initial host and EVERY
// redirect hop, a streamed size cap, and a timeout. A public feed URL therefore
// cannot become a path to internal infrastructure.
const { getUserIdFromToken } = require("./_state-sections.js");
const { safeFetch, statusForImportError } = require("./_import-fetch.js");

const FEED_CONTENT_TYPES = [
  "application/rss+xml", "application/atom+xml", "application/xml",
  "text/xml", "application/xhtml+xml", "text/html", "text/plain",
  "application/octet-stream",
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const accessToken = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  const userId = accessToken ? await getUserIdFromToken(accessToken, serviceKey) : null;
  if (!userId) return json(401, { error: "Not authenticated." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const { url, etag, lastModified } = body;
  if (!url) return json(400, { error: "url required" });

  let result;
  try {
    result = await safeFetch(url, {
      maxBytes: 5_000_000,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      allowedContentTypes: FEED_CONTENT_TYPES,
      conditional: { etag, lastModified }, // send If-None-Match / If-Modified-Since when known
    });
  } catch (e) {
    // Structured failure (never a thrown 500 for a bad feed) so the caller can
    // record backoff metadata. SSRF/oversize/timeout/bad-type map to a status.
    if (e && e.isImportFetchError) return json(200, { ok: false, status: statusForImportError(e), error: e.message });
    return json(200, { ok: false, status: 502, error: (e && e.message) || "Failed to fetch feed" });
  }

  // 304 (conditional hit) and HTTP error statuses are returned as-is — the client's
  // pure runFeedIngestion distinguishes not-modified / failure / success. The raw
  // body is returned unparsed.
  return json(200, {
    ok: !!result.ok,
    status: result.status,
    notModified: !!result.notModified,
    body: result.notModified ? "" : (result.body || ""),
    etag: result.etag || null,
    lastModified: result.lastModified || null,
    contentType: result.contentType || null,
    finalUrl: result.finalUrl || url,
  });
};

function json(statusCode, obj) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) };
}
