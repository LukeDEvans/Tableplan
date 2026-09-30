// Production proxy for generic iCal / Amion subscriptions, so the Plan calendar's
// external calendars refresh on the deployed site (not just the local dev server).
// Mirrors server.js's /api/ics-proxy and reuses the SAME parser (calendar/ics.mjs)
// so ICS + Amion feeds parse identically everywhere.
//
// This proxy will fetch any public https URL, so it is (a) session-gated — only an
// authenticated user (i.e. the app's owner) can call it — and (b) fetched through
// the shared SSRF-guarded safeFetch (_import-fetch.js: DNS-resolved blocked-IP
// checks on every redirect hop, timeout, size cap) — SRV-10 / CAL-5.
import { createRequire } from "node:module";
import { parsePlanIcs } from "../../calendar/ics.mjs";

const require = createRequire(import.meta.url);
const { safeFetch, statusForImportError } = require("./_import-fetch.js");

// Test seam only: lets tests inject fetchImpl / lookupImpl into safeFetch.
let testDeps = {};
export function _setTestDeps(deps) { testDeps = deps || {}; }

export const ICS_FETCH_OPTIONS = {
  accept: "text/calendar,text/plain,*/*;q=0.8",
  userAgent: "Mozilla/5.0 EatPlanSync/1.0",
  maxBytes: 10_000_000,
  timeoutMs: 15000,
  allowedContentTypes: [
    "text/calendar", "text/plain", "application/octet-stream", "text/html",
    "application/ics", "text/x-vcalendar",
  ],
};

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

  try {
    const res = await safeFetch(calUrl, { ...ICS_FETCH_OPTIONS, ...testDeps });
    if (!res.ok) return jsonResponse(res.status >= 400 ? res.status : 502, { error: `Calendar returned ${res.status}.` });
    // Convert Z/TZID times into the viewer's zone (the function itself runs in UTC).
    // parsePlanIcs validates the name via Intl and falls back when it's unusable.
    const tz = String(event.queryStringParameters?.tz || "").slice(0, 64);
    return jsonResponse(200, { events: parsePlanIcs(res.body, { timeZone: tz }) });
  } catch (error) {
    if (error && (error.isImportFetchError || error.isImportUrlError)) {
      return jsonResponse(statusForImportError(error), { error: error.message || "Calendar fetch refused." });
    }
    return jsonResponse(500, { error: error.message || "Calendar sync failed." });
  }
};

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    return res.ok;
  } catch { return false; }
}
