const { scanReceiptFromImages } = require("../../receipt-scan");
const { getGroupIdForUser, loadFinanceCategories } = require("./_finance-categories.js");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

// Netlify ends a synchronous function at 30 s with a bare 504. Stop waiting on
// the AI a few seconds before that so the app can show a real message.
const FUNCTION_BUDGET_MS = 26000;
const MIN_SCAN_MS = 8000;

exports.handler = async (event) => {
  const startedAt = Date.now();
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  const userId = await verifySession(accessToken, serviceKey);
  if (!userId) return jsonResponse(401, { error: "Invalid session." });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }
  try {
    // Budget categories let the same read serve Finance (one receipts list):
    // each line gets a budget category. No categories → the scan works as before.
    const categories = await loadFinanceCategories(serviceKey, await getGroupIdForUser(serviceKey, userId));
    const timeoutMs = Math.max(MIN_SCAN_MS, FUNCTION_BUDGET_MS - (Date.now() - startedAt));
    const result = await scanReceiptFromImages(payload.images || [], { categories, timeoutMs });
    return jsonResponse(200, { receipt: result.receipt, rawText: result.rawText, model: result.model });
  } catch (error) {
    if (error?.code === "SCAN_TIMEOUT") return jsonResponse(504, { error: error.message });
    return jsonResponse(500, { error: error.message || "Receipt scan failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id || null;
  } catch { return null; }
}
