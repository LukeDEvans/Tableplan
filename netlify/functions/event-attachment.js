// Uploads a calendar-event attachment to Supabase storage (bucket
// "event-files", created on first use) and returns its public URL.
// Client sends JSON { name, type, data(base64) }, capped at ~4MB binary —
// well inside Netlify's request limit once base64-encoded.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const BUCKET = "event-files";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(503, { error: "Not configured." }));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));
  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }
  const { name, type, data } = body;
  if (!name || !data) return cors(json(400, { error: "name and data required" }));
  if (data.length > 6000000) return cors(json(413, { error: "Attachment too large (4MB max)." }));

  const buffer = Buffer.from(data, "base64");
  const safeName = String(name).replace(/[^a-z0-9._-]/gi, "_").slice(0, 120);
  const path = `${userId}/${Date.now()}-${safeName}`;

  await ensureBucket(serviceKey);
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "content-type": type || "application/octet-stream",
      "cache-control": "31536000",
      "x-upsert": "true"
    },
    body: buffer
  });
  if (!up.ok) {
    const detail = await up.text().catch(() => "");
    return cors(json(502, { error: `Upload failed: ${detail.slice(0, 200)}` }));
  }

  return cors(json(200, { path, url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` }));
};

async function ensureBucket(serviceKey) {
  // Idempotent: 409 means it already exists
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 4194304 })
  }).catch(() => {});
}

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
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}
