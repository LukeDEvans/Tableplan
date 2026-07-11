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

  const { publication, cookieValue } = body;
  if (!["nyt", "economist"].includes(publication)) return cors(json(400, { error: "Invalid publication." }));
  if (!cookieValue || typeof cookieValue !== "string") return cors(json(400, { error: "Missing cookie value." }));

  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) return cors(json(404, { error: "User group not found." }));

  try {
    await updateSection(serviceKey, groupId, "media", (state) => {
      const articleSync = { ...(state.articleSync || {}) };
      if (publication === "nyt") articleSync.nytCookie = cookieValue.trim();
      if (publication === "economist") articleSync.economistCookie = cookieValue.trim();
      return { ...state, articleSync };
    });
  } catch (err) {
    return cors(json(500, { error: "Could not save the cookie: " + err.message }));
  }

  return cors(json(200, { ok: true, publication }));
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
