// Share-sheet receipts: screenshots of an online order (Amazon order details,
// "Your Orders", other stores' order history) shared from the iPhone's share
// sheet straight into Finance. RECEIPTS.md → "Share sheet".
//
// Two actions:
//   mint  — Authorization: Bearer <Supabase access token>. Returns a long-lived
//           share token for this user. The iPhone app stores it in the keychain
//           group it shares with its Share Extension.
//   share — Authorization: Bearer <share token>. Body { images: [data URLs] }
//           or { text, kind: "summary" } (the text of an order-summary PDF,
//           extracted on the phone). Extracts the order(s), stores them in the household's
//           finreceipts_ inbox (source "share"); Finance imports them into the
//           one receipts list like email / extension receipts.
//
// Why a separate token: the Share Extension runs outside the app and can't
// safely use the app's Supabase session (refreshing it there would rotate the
// refresh token out from under the app). The share token is an HMAC-signed
// { userId, exp } (the same signer as the OAuth state, its own purpose), so no
// new table or env var. It can do exactly one thing: add receipts to the
// inbox of the household the user currently belongs to. To revoke every
// token, bump SHARE_TOKEN_PURPOSE.
const { createOAuthState, verifyOAuthState } = require("./_oauth-state.js");
const { getUserIdFromToken, getUserGroupId } = require("./_state-sections.js");
const { loadFinanceCategories } = require("./_finance-categories.js");
const { orderScreenshotPrompt, receiptsFromModel, modelText, receiptFingerprint, saveImportedReceipt } = require("./_receipt-extract.js");

const SHARE_TOKEN_PURPOSE = "receipt-share-v1";
const SHARE_TOKEN_TTL_MS = 365 * 24 * 3600 * 1000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64 = 5000000; // all images together, under Netlify's 6 MB body cap

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(503, { error: "Not configured." }));

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return cors(json(401, { error: "Not signed in." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }
  const action = body.action || "share";

  try {
    if (action === "mint") {
      const userId = await getUserIdFromToken(bearer, serviceKey);
      if (!userId) return cors(json(401, { error: "Invalid session." }));
      const now = Date.now();
      const token = createOAuthState(userId, serviceKey, { purpose: SHARE_TOKEN_PURPOSE, ttlMs: SHARE_TOKEN_TTL_MS, now });
      return cors(json(200, { token, expiresAt: new Date(now + SHARE_TOKEN_TTL_MS).toISOString() }));
    }

    if (action !== "share") return cors(json(400, { error: `Unknown action: ${action}` }));

    const claim = verifyOAuthState(bearer, serviceKey, { purpose: SHARE_TOKEN_PURPOSE });
    if (!claim) return cors(json(401, { error: "Open the Live app once to reconnect sharing." }));
    const groupId = await getUserGroupId(serviceKey, claim.userId);
    if (!groupId) return cors(json(403, { error: "No household group." }));

    const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    if (!anthropicKey) return cors(json(503, { error: "Extraction is not configured." }));

    const rawImages = Array.isArray(body.images) ? body.images : [];
    if (rawImages.length > MAX_IMAGES) return cors(json(400, { error: `Share up to ${MAX_IMAGES} screenshots at a time.` }));
    const parts = rawImages.map((img) => String(img || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/));
    if (parts.some((m) => !m)) return cors(json(400, { error: "Images must be base64 data URLs." }));
    if (parts.reduce((n, m) => n + m[2].length, 0) > MAX_IMAGE_BASE64) return cors(json(413, { error: "Screenshots too large." }));
    const text = String(body.text || "").slice(0, 40000);
    if (!parts.length && text.length < 40) {
      return cors(json(400, { error: "Share a screenshot of the order or its order summary." }));
    }
    const source = body.kind === "summary" && text.length >= 40 && !parts.length ? "summary" : "screenshots";

    const categories = await loadFinanceCategories(serviceKey, groupId);
    if (!categories.length) return cors(json(409, { error: "Set up budget categories in Finance first." }));

    const today = new Date().toISOString().slice(0, 10);
    const content = [
      { type: "text", text: `${orderScreenshotPrompt(categories, { source })}\n\nToday is ${today}.` },
      ...parts.map((m) => ({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } })),
      ...(text.length >= 40 ? [{ type: "text", text: `${source === "summary" ? "ORDER SUMMARY TEXT" : "SHARED TEXT"}:\n${text}` }] : [])
    ];
    // Netlify cuts a synchronous function off at 10 s (Free plan) with an HTML
    // 502. Stop the read just short of that so the share sheet gets a clear
    // message instead.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(process.env.SHARE_RECEIPT_AI_TIMEOUT_MS) || 9000);
    let ai;
    try {
      ai = await fetch("https://api.anthropic.com/v1/messages", {
        signal: ctrl.signal,
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_RECEIPT_SCAN_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          temperature: 0,
          messages: [{ role: "user", content }]
        })
      });
    } catch (e) {
      if (e?.name === "AbortError") return cors(json(504, { error: source === "summary" ? "That took too long. Try again, or share screenshots instead." : "That took too long. Try fewer screenshots." }));
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!ai.ok) return cors(json(502, { error: `Couldn't read the ${source === "summary" ? "order summary" : "screenshot"} (${ai.status}).` }));

    const receipts = receiptsFromModel(await modelText(ai), categories);
    for (const receipt of receipts) {
      // Same id for the same order (merchant + date + total), so sharing it
      // again — or sharing the detail page after the list page — replaces the
      // inbox entry instead of adding a duplicate.
      receipt.id = `shr_${receiptFingerprint(receipt)}`;
      receipt.source = "share";
      await saveImportedReceipt(serviceKey, groupId, receipt);
    }
    return cors(json(200, {
      ok: true,
      receipts: receipts.map((r) => ({ merchant: r.merchant, date: r.date, total: r.total, items: r.items.length }))
    }));
  } catch (e) {
    console.error("[share-receipt]", action, e?.name || "error");
    return cors(json(500, { error: "Something went wrong." }));
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}

module.exports.SHARE_TOKEN_PURPOSE = SHARE_TOKEN_PURPOSE;
