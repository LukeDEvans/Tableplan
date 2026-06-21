const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  const apiKey = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "Google Maps is not configured." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const base = "https://www.google.com/maps/embed/v1/";
  let mapUrl;
  if (body.type === "directions" && body.origin && body.destination) {
    const p = new URLSearchParams({ key: apiKey, origin: body.origin, destination: body.destination, mode: body.mode || "walking" });
    if (Array.isArray(body.waypoints) && body.waypoints.length) p.set("waypoints", body.waypoints.join("|"));
    mapUrl = base + "directions?" + p.toString();
  } else if ((body.type === "place" || body.type === "search") && body.query) {
    mapUrl = base + body.type + "?" + new URLSearchParams({ key: apiKey, q: body.query }).toString();
  } else {
    return jsonResponse(400, { error: "Invalid map params." });
  }

  return jsonResponse(200, { url: mapUrl });
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
