const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method not allowed" };

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return { statusCode: 503, body: "Not configured" };

  // Accept token from Authorization header (API callers) or _token query param (img src)
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const queryToken  = (event.queryStringParameters || {})._token || "";
  const accessToken = headerToken || queryToken;

  if (!accessToken) return { statusCode: 401, body: "Not authenticated" };
  if (!await verifySession(accessToken, serviceKey)) return { statusCode: 401, body: "Invalid session" };

  const apiKey = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) return { statusCode: 503, body: "Maps not configured" };

  // Forward all params to Google except _token
  const mvqs = event.multiValueQueryStringParameters || {};
  const parts = ["key=" + encodeURIComponent(apiKey)];
  for (const [k, vals] of Object.entries(mvqs)) {
    if (k === "_token") continue;
    for (const v of vals) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }

  const url = "https://maps.googleapis.com/maps/api/staticmap?" + parts.join("&");

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return { statusCode: 502, body: text || "Google Maps API error" };
    }
    const buf = await res.arrayBuffer();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/png",
        "Cache-Control": "private, max-age=3600",
      },
      body: Buffer.from(buf).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: err.message || "Internal error" };
  }
};

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}
