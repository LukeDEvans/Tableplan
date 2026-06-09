const TMDB_BASE_URL = "https://api.themoviedb.org/3";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });
  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "TMDB is not configured." });
  const id = String(event.queryStringParameters?.id || "").trim();
  const season = String(event.queryStringParameters?.season || "").trim();
  if (!id || !season) return jsonResponse(400, { error: "Missing id or season." });
  try {
    const fetched = await fetch(
      `${TMDB_BASE_URL}/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(season)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`
    );
    if (!fetched.ok) return jsonResponse(fetched.status, { error: `TMDB returned ${fetched.status}.` });
    const data = await fetched.json();
    const episodes = (data.episodes || []).map((ep) => ({
      episodeNumber: ep.episode_number,
      name: ep.name || `Episode ${ep.episode_number}`,
      airDate: ep.air_date || null
    }));
    return jsonResponse(200, { episodes });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "TMDB season request failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}
