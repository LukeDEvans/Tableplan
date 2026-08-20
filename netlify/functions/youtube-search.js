// YouTube search proxy — keeps the YouTube Data API v3 key server-side (like
// tmdb-search). Session-verified. Returns the raw YouTube `items` so the client
// media-provider-youtube.js maps them unchanged. If no key is configured it
// returns an empty result set (200) rather than an error, so Discover simply
// shows no YouTube results until YOUTUBE_API_KEY is set at deploy — no user-
// facing failure. No scraping, no restriction circumvention.

const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  const query = String(event.queryStringParameters?.q || "").trim();
  if (!query) return jsonResponse(400, { error: "Missing search query." });

  const apiKey = String(process.env.YOUTUBE_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(200, { items: [] }); // not configured → quietly empty

  const maxResults = Math.min(Math.max(parseInt(event.queryStringParameters?.maxResults, 10) || 12, 1), 25);
  try {
    const params = new URLSearchParams({
      part: "snippet", type: "video", safeSearch: "moderate",
      maxResults: String(maxResults), q: query, key: apiKey,
    });
    const fetched = await fetch(`${YT_SEARCH}?${params.toString()}`);
    if (!fetched.ok) return jsonResponse(fetched.status, { error: `YouTube returned ${fetched.status}.` });
    const data = await fetched.json();
    return jsonResponse(200, { items: Array.isArray(data.items) ? data.items : [] });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "YouTube search failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch { return false; }
}
