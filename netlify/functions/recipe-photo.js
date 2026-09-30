const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method not allowed" };

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return { statusCode: 503, body: "Not configured" };

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const queryToken  = (event.queryStringParameters || {})._token || "";
  const accessToken = headerToken || queryToken;

  if (!accessToken) return { statusCode: 401, body: "Not authenticated" };
  if (!await verifySession(accessToken, serviceKey)) return { statusCode: 401, body: "Invalid session" };

  const path = (event.queryStringParameters || {}).path || "";
  if (!path) return { statusCode: 400, body: "path required" };
  // The sign call uses the service-role key, so a "../" segment would let a caller
  // sign objects in ANY bucket. Only plain relative segments are allowed.
  if (!isSafeObjectPath(path)) return { statusCode: 400, body: "invalid path" };
  const safePath = path.split("/").map(encodeURIComponent).join("/");

  try {
    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/recipe-photos/${safePath}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    if (!signRes.ok) {
      const text = await signRes.text();
      return { statusCode: 502, body: text || "Failed to generate signed URL" };
    }
    const { signedURL } = await signRes.json();
    return {
      statusCode: 302,
      headers: {
        Location: SUPABASE_URL + signedURL,
        "Cache-Control": "private, max-age=3000"
      },
      body: ""
    };
  } catch (err) {
    return { statusCode: 500, body: err.message || "Internal error" };
  }
};

function isSafeObjectPath(path) {
  if (typeof path !== "string" || path.length > 512) return false;
  if (path.startsWith("/") || /[\\%?#\0]/.test(path)) return false;
  return path.split("/").every((seg) => seg && seg !== "." && seg !== ".." && /^[\w.\-]+$/.test(seg));
}

exports._test = { isSafeObjectPath };

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}
