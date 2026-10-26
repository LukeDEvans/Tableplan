// Scan and go (RECEIPTS.md): the finished receipt reads for the caller's household.
// POST { since? } (Authorization: Bearer <session>) → { scans: [{ id, at, status,
// receipt?, verdict?, error? }], latest }. Only results written after `since` (the
// `latest` the device got last time), so the usual answer is empty. The app imports
// "done" ones into the one receipts list. The app asks only when it has a receipt
// out being read, or once a session (bounded in groceries-ui.js).
const { getUserIdFromToken, getUserGroupId } = require("./_state-sections.js");
const { loadScanResults } = require("./_receipt-scans.js");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(503, { error: "Not configured." }));
  const accessToken = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  const userId = accessToken ? await getUserIdFromToken(accessToken, serviceKey) : null;
  if (!userId) return cors(json(401, { error: "Not signed in." }));
  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) return cors(json(200, { scans: [], latest: "" }));
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* no since → everything recent */ }
  const since = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(String(body.since || "")) ? new Date(body.since).toISOString() : "";
  try {
    return cors(json(200, await loadScanResults(serviceKey, groupId, since)));
  } catch (error) {
    return cors(json(502, { error: error.message || "Couldn't load receipt results." }));
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}
