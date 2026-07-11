const { getUserIdFromToken, getUserGroupId, updateSection } = require("./_state-sections.js");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));

  const userId = await getUserIdFromToken(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* ignore */ }

  const incoming = body.articles;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return cors(json(400, { error: "No articles provided." }));
  }

  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) return cors(json(404, { error: "User group not found." }));

  let imported = 0;
  try {
    await updateSection(serviceKey, groupId, "media", (state) => {
      const existing = Array.isArray(state.savedArticles) ? state.savedArticles : [];
      const existingUrls = new Set(existing.map((a) => a.url));
      const now = new Date().toISOString();
      const next = [...existing];
      imported = 0;

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

      if (imported === 0) return null; // nothing new — skip the write
      return { ...state, savedArticles: next };
    });
  } catch (err) {
    return cors(json(500, { error: "Could not save the articles: " + err.message }));
  }

  return cors(json(200, { ok: true, imported, total: incoming.length }));
};

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
