const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

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
  try { body = JSON.parse(event.body || "{}"); } catch { /* ignore */ }

  const incoming = body.articles;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return cors(json(400, { error: "No articles provided." }));
  }

  const stateId = await getUserStateId(serviceKey, userId);
  if (!stateId) return cors(json(404, { error: "User group not found." }));

  const currentState = await loadState(serviceKey, stateId);
  const existing = Array.isArray(currentState?.savedArticles) ? currentState.savedArticles : [];
  const existingUrls = new Set(existing.map((a) => a.url));

  const now = new Date().toISOString();
  let imported = 0;
  const next = [...existing];

  for (const a of incoming) {
    if (!a.url || typeof a.url !== "string") continue;
    const url = a.url.split("?")[0].split("#")[0].replace(/\/$/, "");
    if (existingUrls.has(url)) continue;
    existingUrls.add(url);
    next.push({
      id: crypto.randomUUID(),
      url,
      title: String(a.title || url),
      publication: String(a.publication || "other"),
      savedAt: now,
      author: null,
      date: null,
      text: null
    });
    imported++;
  }

  if (imported > 0) {
    const newState = {
      ...(currentState || {}),
      savedArticles: next,
      stateUpdatedAt: now
    };
    await saveState(serviceKey, stateId, newState);
  }

  return cors(json(200, { ok: true, imported, total: incoming.length }));
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: stateId, state: newState, updated_at: new Date().toISOString() })
  });
  if (!res.ok) throw new Error(`State save failed (${res.status})`);
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
