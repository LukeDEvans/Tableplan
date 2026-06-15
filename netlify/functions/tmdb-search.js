const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "TMDB is not configured." });
  const query = String(event.queryStringParameters?.q || "").trim();
  if (!query) return jsonResponse(400, { error: "Missing search query." });
  try {
    const fetched = await fetch(
      `${TMDB_BASE_URL}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&language=en-US&page=1&include_adult=false`
    );
    if (!fetched.ok) return jsonResponse(fetched.status, { error: `TMDB returned ${fetched.status}.` });
    const data = await fetched.json();
    const results = (data.results || [])
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 8)
      .map((r) => ({
        tmdbId: r.id,
        type: r.media_type,
        title: r.media_type === "movie" ? (r.title || r.original_title || "") : (r.name || r.original_name || ""),
        year: r.media_type === "movie" ? (r.release_date || "").slice(0, 4) : (r.first_air_date || "").slice(0, 4),
        posterPath: r.poster_path || null,
        overview: r.overview || "",
        totalSeasons: r.media_type === "tv" ? (r.number_of_seasons || null) : null
      }));
    return jsonResponse(200, { results });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "TMDB search failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}
