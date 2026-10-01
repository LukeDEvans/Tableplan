const { scanReceiptFromImages } = require("../../receipt-scan");
const { getGroupIdForUser, loadFinanceCategories } = require("./_finance-categories.js");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
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
    const result = await scanReceiptFromImages(payload.images || [], { categories });
    return jsonResponse(200, { receipt: result.receipt, rawText: result.rawText, model: result.model });
  } catch (error) {
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
