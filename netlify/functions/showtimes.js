exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });
  const apiKey = String(process.env.SERPAPI_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "SERPAPI_KEY is not configured." });
  const title = String(event.queryStringParameters?.title || "").trim();
  if (!title) return jsonResponse(400, { error: "Missing title." });
  const location = String(event.queryStringParameters?.location || "").trim();
  try {
    const params = new URLSearchParams({ engine: "google", q: `${title} showtimes`, hl: "en", gl: "us", api_key: apiKey });
    if (location) params.set("location", location);
    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await res.json();
    if (!res.ok) return jsonResponse(res.status, { error: data.error || "SerpAPI error." });
    return jsonResponse(200, { showtimes: data.showtimes || [] });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Showtimes request failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}
