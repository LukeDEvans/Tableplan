// Production proxy for generic iCal / Amion subscriptions, so the Plan calendar's
// external calendars refresh on the deployed site (not just the local dev server).
// Mirrors server.js's /api/ics-proxy and reuses the SAME parser (calendar/ics.mjs)
// so ICS + Amion feeds parse identically everywhere.
//
// This proxy will fetch any public https URL, so it is (a) session-gated — only an
// authenticated user (i.e. the app's owner) can call it — and (b) blocked from
// private / loopback / link-local hosts to prevent SSRF into internal networks.
import { parsePlanIcs } from "../../calendar/ics.mjs";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

export const handler = async (event) => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  const calUrl = String(event.queryStringParameters?.url || "").trim();
  if (!calUrl) return jsonResponse(400, { error: "Missing url." });
  let parsed;
  try { parsed = new URL(calUrl); } catch { return jsonResponse(400, { error: "Invalid URL." }); }
  if (parsed.protocol !== "https:") return jsonResponse(400, { error: "Only https URLs are supported." });
  if (isBlockedHost(parsed.hostname)) return jsonResponse(400, { error: "That host is not allowed." });

  try {
    const res = await fetch(calUrl, { headers: { accept: "text/calendar,text/plain,*/*;q=0.8", "user-agent": "Mozilla/5.0 EatPlanSync/1.0" } });
    if (!res.ok) return jsonResponse(res.status, { error: `Calendar returned ${res.status}.` });
    return jsonResponse(200, { events: parsePlanIcs(await res.text()) });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Calendar sync failed." });
  }
};

// Block SSRF to private / loopback / link-local hosts (literal IPs and obvious names).
function isBlockedHost(host) {
  const h = String(host || "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    return res.ok;
  } catch { return false; }
}
