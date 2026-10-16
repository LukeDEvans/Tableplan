// recipe-website-photo — find recipe pages' own photos (RECIPE_PHOTOS_DESIGN.md §4.5).
//
// POST { urls: ["https://…", …] }  (at most MAX_URLS per call)
//   → { photos: { "<url>": "<https photo URL>" | "" } }
//
// Used by the one-time website-photo backfill and by "remove my photo" (the
// recipe falls back to its website's photo). Returns URLs only: nothing is
// downloaded beyond the page itself, nothing is stored, and Supabase is touched
// only to verify the session. Every page fetch goes through safeFetch (SSRF +
// size + time limits); a page that fails just maps to "".
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const { safeFetch: defaultSafeFetch } = require("./_import-fetch.js");
const { websitePhotoFromHtml } = require("./_recipe-photo.js");

const MAX_URLS = 6;          // all fetched in parallel, so a call stays well under 10 s
const PAGE_TIMEOUT_MS = 6000;
const PAGE_MAX_BYTES = 2_500_000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(503, { error: "Service not configured." }));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));
  if (!await verifySession(accessToken, serviceKey)) return cors(json(401, { error: "Invalid session." }));

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON." })); }
  const urls = cleanUrls(body.urls);
  if (!urls.length) return cors(json(400, { error: "urls required" }));

  const photos = await lookupWebsitePhotos(urls);
  return cors(json(200, { photos }));
};

function cleanUrls(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const url = String(raw || "").trim();
    if (!/^https?:\/\//i.test(url) || url.length > 2000 || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

async function lookupWebsitePhotos(urls, deps = {}) {
  const doFetch = deps.safeFetch || defaultSafeFetch;
  const entries = await Promise.all(urls.map(async (url) => {
    try {
      const page = await doFetch(url, { timeoutMs: PAGE_TIMEOUT_MS, maxBytes: PAGE_MAX_BYTES });
      if (!page || !page.ok) return [url, ""];
      return [url, websitePhotoFromHtml(page.body || "", page.finalUrl || url)];
    } catch {
      return [url, ""];
    }
  }));
  return Object.fromEntries(entries);
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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

exports._test = { cleanUrls, lookupWebsitePhotos, MAX_URLS };
