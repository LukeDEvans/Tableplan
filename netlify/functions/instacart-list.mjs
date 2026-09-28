// instacart-list — server-side wrapper for Instacart Developer Platform
// "Create shopping list page" (POST /idp/v1/products/products_link).
//
// The Instacart API key lives ONLY here (Netlify env INSTACART_API_KEY); the
// browser never sees it (ARCHITECTURE §7). Request/response only: one vendor
// call per user tap, no retries, no polling, no state writes — the client
// records the sent_to_instacart state itself from the response.
//
// Env:
//   INSTACART_API_KEY   (required) — Instacart Developer Platform key
//   INSTACART_ENV       "production" → https://connect.instacart.com
//                       anything else → https://connect.dev.instacart.tools (dev)
//   INSTACART_API_BASE_URL (optional) explicit override of the base URL
import {
  sanitizeInstacartLineItems,
  normalizeInstacartResponse,
  INSTACART_MAX_LINE_ITEMS
} from "../../instacart.js";

const DEFAULT_SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEV_BASE_URL = "https://connect.dev.instacart.tools";
const PROD_BASE_URL = "https://connect.instacart.com";
const VENDOR_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 200 * 1024;

const ALLOWED_ORIGINS = new Set([
  "https://effervescent-malabi-e0af55.netlify.app",
  "http://localhost:4174",
  "http://127.0.0.1:4174"
]);

export function instacartBaseUrl(env = process.env) {
  const override = String(env.INSTACART_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (override) return override;
  return String(env.INSTACART_ENV || "").trim().toLowerCase() === "production" ? PROD_BASE_URL : DEV_BASE_URL;
}

export const handler = async (event, _context, deps = {}) => {
  const fetchImpl = deps.fetch || fetch;
  const env = deps.env || process.env;
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);
  const respond = (statusCode, body) => ({
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body)
  });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed." });

  const auth = await authorizeRequest(event, env, fetchImpl);
  if (!auth.ok) return respond(auth.statusCode, { error: auth.error });

  const apiKey = String(env.INSTACART_API_KEY || "").trim();
  if (!apiKey) return respond(503, { error: "Instacart is not configured yet." });

  if (String(event.body || "").length > MAX_BODY_BYTES) return respond(413, { error: "Shopping list is too large." });
  let payload;
  try { payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}")); }
  catch { return respond(400, { error: "Invalid request body." }); }

  const lineItems = sanitizeInstacartLineItems(payload?.lineItems);
  if (!lineItems.length) return respond(400, { error: "No items to send." });
  const title = String(payload?.title || "Shopping list").replace(/\s+/g, " ").trim().slice(0, 120) || "Shopping list";
  const droppedByCap = Array.isArray(payload?.lineItems) && payload.lineItems.length > INSTACART_MAX_LINE_ITEMS
    ? payload.lineItems.slice(INSTACART_MAX_LINE_ITEMS).map((i) => String(i?.name || "").trim()).filter(Boolean)
    : [];

  let vendorResponse;
  try {
    vendorResponse = await fetchImpl(`${instacartBaseUrl(env)}/idp/v1/products/products_link`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ title, link_type: "shopping_list", line_items: lineItems }),
      signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS)
    });
  } catch (error) {
    console.error("[instacart-list] vendor request failed:", error?.name || "", error?.message || "");
    return respond(502, { error: "Couldn't reach Instacart. Try again in a moment." });
  }

  let body = null;
  try { body = await vendorResponse.json(); } catch { body = null; }
  if (!vendorResponse.ok) {
    console.error("[instacart-list] vendor error", vendorResponse.status, JSON.stringify(body || {}).slice(0, 500));
    // Surface vendor-reported item problems rather than swallowing them.
    const { unmatched } = normalizeInstacartResponse(body || {}, lineItems);
    const message = vendorErrorMessage(body) || `Instacart rejected the list (${vendorResponse.status}).`;
    return respond(vendorResponse.status === 401 || vendorResponse.status === 403 ? 502 : 422, { error: message, unmatched });
  }

  const { url, unmatched } = normalizeInstacartResponse(body || {}, lineItems);
  if (!url) return respond(502, { error: "Instacart didn't return a shopping list link." });
  return respond(200, { url, unmatched: [...unmatched, ...droppedByCap], sentCount: lineItems.length });
};

function vendorErrorMessage(body) {
  const candidates = [body?.error?.message, body?.message, Array.isArray(body?.errors) ? body.errors.map((e) => e?.message || e).join("; ") : ""];
  const text = candidates.map((c) => String(c || "").trim()).find(Boolean) || "";
  return text.slice(0, 300);
}

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(String(origin || "")) ? String(origin) : "";
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    vary: "Origin"
  };
}

async function authorizeRequest(event, env, fetchImpl) {
  const token = String(event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, statusCode: 401, error: "Sign in before sending to Instacart." };
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) return { ok: false, statusCode: 503, error: "Instacart authentication is not configured." };
  const supabaseUrl = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${token}` }
    });
    if (!response.ok) return { ok: false, statusCode: 401, error: "Your sign-in session could not be verified." };
    return { ok: true, user: await response.json() };
  } catch {
    return { ok: false, statusCode: 503, error: "Sign-in verification is unavailable." };
  }
}
