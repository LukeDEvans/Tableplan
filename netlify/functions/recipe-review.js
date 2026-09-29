// recipe-review.js — the Recipe Box review queue (see _recipe-review.js).
//
// POST { action: "list" }                         → { items }
// POST { action: "add", recipe, source }          → { ok, id, items }
// POST { action: "remove", ids: [id] }            → { ok, items }
//
// Auth: the caller's Supabase access token (Bearer). The queue row is service-only
// and per-user; the client reads it on demand (opening the Recipe Box / its bell),
// never on a timer.
const { SUPABASE_URL, serviceHeaders, getUserIdFromToken, updateRawRow } = require("./_state-sections.js");
const Review = require("./_recipe-review.js");
const { randomUUID } = require("node:crypto");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(500, { error: "Server is missing its Supabase key." }));
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));

  const userId = await getUserIdFromToken(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }
  const rowId = Review.reviewRowId(userId);

  try {
    if (body.action === "list") {
      return cors(json(200, { items: await loadItems(serviceKey, rowId) }));
    }

    if (body.action === "add") {
      const item = Review.normalizeQueueItem({ recipe: body.recipe, source: body.source }, { createId: () => randomUUID() });
      let items = null;
      let rejected = false;
      await updateRawRow(serviceKey, rowId, (state) => {
        const next = Review.addToQueue(state, item);
        if (!next) { rejected = true; return null; }
        items = next.items;
        return next;
      });
      if (rejected) return cors(json(400, { error: "Nothing to review — the recipe has no name, ingredients, or steps." }));
      return cors(json(200, { ok: true, id: item.id, items }));
    }

    if (body.action === "remove") {
      const ids = Array.isArray(body.ids) ? body.ids.slice(0, Review.MAX_ITEMS) : [body.id];
      let items = null;
      await updateRawRow(serviceKey, rowId, (state) => {
        const next = Review.removeFromQueue(state, ids);
        items = next ? next.items : Review.queueItems(state);
        return next;
      });
      return cors(json(200, { ok: true, items: items || [] }));
    }
  } catch (err) {
    return cors(json(500, { error: `Recipe review queue failed: ${err.message}` }));
  }

  return cors(json(400, { error: "Unknown action." }));
};

async function loadItems(serviceKey, rowId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(rowId)}&select=state`,
    { headers: serviceHeaders(serviceKey), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`load failed (${res.status})`);
  const rows = await res.json();
  return Review.queueItems(rows[0]?.state);
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
