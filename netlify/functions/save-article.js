const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(200);
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));

  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }

  const { url, title, publication, text, author, date } = body;
  if (!url) return cors(json(400, { error: "url is required" }));

  const stateId = await getUserStateId(serviceKey, userId);
  if (!stateId) return cors(json(404, { error: "User group not found." }));

  const currentState = await loadState(serviceKey, stateId);
  const articles = Array.isArray(currentState?.savedArticles) ? currentState.savedArticles : [];

  const existing = articles.find((a) => a.url === url);
  if (existing) return cors(json(200, { ok: true, already_saved: true, id: existing.id }));

  const id = crypto.randomUUID();
  articles.push({
    id,
    url,
    title: title || url,
    publication: publication || detectPublication(url),
    savedAt: new Date().toISOString(),
    author: author || null,
    date: date || null,
    text: text || null
  });

  const newState = {
    ...(currentState || {}),
    savedArticles: articles,
    stateUpdatedAt: new Date().toISOString()
  };
  await saveState(serviceKey, stateId, newState);

  return cors(json(200, { ok: true, already_saved: false, id }));
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

async function getUserStateId(serviceKey, userId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${encodeURIComponent(userId)}&select=group_id&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, accept: "application/json" } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.group_id || null;
  } catch { return null; }
}

async function loadState(serviceKey, stateId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(stateId)}&select=state`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, accept: "application/json" }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.state || null;
}

async function saveState(serviceKey, stateId, newState) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: stateId, state: newState, updated_at: new Date().toISOString() })
  });
}

function detectPublication(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("nytimes.com")) return "nyt";
    if (h.includes("economist.com")) return "economist";
    if (h.includes("startribune.com")) return "startribune";
  } catch { /* ignore */ }
  return "other";
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}

function cors(response) {
  return {
    ...response,
    headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" }
  };
}
