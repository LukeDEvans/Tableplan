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

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }

  const { url, title, publication, text, author, date } = body;
  if (!url) return cors(json(400, { error: "url is required" }));

  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) return cors(json(404, { error: "User group not found." }));

  const id = crypto.randomUUID();
  let alreadySaved = false;
  let existingId = null;

  try {
    await updateSection(serviceKey, groupId, "media", (state) => {
      const articles = Array.isArray(state.savedArticles) ? state.savedArticles : [];
      const existing = articles.find((a) => a.url === url);
      if (existing) {
        alreadySaved = true;
        existingId = existing.id;
        return null; // no write needed
      }
      return {
        ...state,
        savedArticles: [...articles, {
          id,
          url,
          title: title || url,
          publication: publication || detectPublication(url),
          savedAt: new Date().toISOString(),
          author: author || null,
          date: date || null,
          text: text || null
        }]
      };
    });
  } catch (err) {
    return cors(json(500, { error: "Could not save the article: " + err.message }));
  }

  return cors(json(200, { ok: true, already_saved: alreadySaved, id: alreadySaved ? existingId : id }));
};

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
