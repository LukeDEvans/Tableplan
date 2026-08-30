// fetch-article — authenticated server-side article extractor (fallback used by
// the in-app "Fetch Article" button when the extension's rendered-DOM text
// isn't available).
//
// Thin handler: verify the session, fetch the page through the shared
// SSRF-guarded fetcher (_import-fetch), and run the deterministic article
// extractor (_article-extract). Extraction failures stay SOFT (HTTP 200 with an
// { error } message) because the client treats a missing body as "paywalled /
// needs JS", not a hard error.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const { safeFetch } = require("./_import-fetch.js");
const { extractArticleFromHtml } = require("./_article-extract.js");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));

  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON." })); }

  const { url, publication } = body;
  if (!url || !url.startsWith("http")) return cors(json(400, { error: "A valid URL is required." }));

  try {
    const fetched = await safeFetch(url);
    if (!fetched.ok) {
      return cors(json(200, { error: `Could not fetch article (HTTP ${fetched.status}).` }));
    }
    const result = extractArticleFromHtml(fetched.body, publication || "other");
    if (!result.text) {
      return cors(json(200, { error: "Could not extract article text. The article may be paywalled or require JavaScript to render." }));
    }
    return cors(json(200, result));
  } catch (e) {
    // Includes SSRF/size/type rejections from safeFetch — surface as a soft error.
    return cors(json(200, { error: e.message || "Failed to fetch the article." }));
  }
};

async function getUserId(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function cors(response) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization"
    }
  };
}
