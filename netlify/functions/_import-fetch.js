// _import-fetch.js — the one guarded entry point for fetching public import URLs.
//
// Every server-side import fetch (recipes, articles, later PDFs) should go
// through safeFetch so SSRF and resource-exhaustion protections live in exactly
// one place. It is NOT a general HTTP client — only point it at user-supplied
// import URLs.
//
// Protections:
//   • SSRF: scheme/port/host allow-listing (_import-url.assertAllowedUrl) plus
//     DNS resolution + blocked-IP checks on the initial host AND every redirect
//     target. Redirects are followed manually so each hop is re-validated.
//   • Resource limits: total timeout (AbortController), max redirect count, and
//     a streamed max-response-size cap that aborts an oversized download instead
//     of buffering it whole.
//   • Content-type allow-list so callers never treat a binary/HTML-less 200 as
//     parseable text.
//   • Clean request context: only a User-Agent + Accept are sent. The user's
//     Supabase/session credentials are NEVER forwarded to the third-party site.
//
// DNS-rebinding residual: global fetch re-resolves DNS when it connects, so a
// host that resolves to a public IP during our check and a private IP a
// millisecond later at connect time is not fully closed by resolve-then-fetch.
// Pinning the connection to the vetted IP would require a custom undici
// dispatcher and would break TLS SNI/cert validation; given these endpoints are
// already session-authenticated (abuse is limited to signed-in users) this
// residual is accepted and documented rather than over-engineered.

const dnsPromises = require("dns").promises;
const net = require("net");
const { assertAllowedUrl, isBlockedIp } = require("./_import-url.js");

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

const DEFAULTS = {
  timeoutMs: 10000,        // total budget for the whole fetch (incl. redirects)
  maxBytes: 3_000_000,     // ~3 MB — generous for an article/recipe page, bounded
  maxRedirects: 4,
  userAgent: "Mozilla/5.0 (compatible; TableplanImporter/1.0)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  // Text/markup only by default; PDF/binary importers pass their own list.
  allowedContentTypes: [
    "text/html", "application/xhtml+xml", "application/xml", "text/xml",
    "text/plain", "application/ld+json", "application/json",
  ],
};

function fetchError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.isImportFetchError = true;
  return e;
}

// Resolve a hostname and reject if it (or any of its addresses) is private/
// internal. IP literals are checked directly (no DNS).
async function assertHostResolvesPublic(hostname, lookup) {
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw fetchError("blocked-ip", `Blocked address: ${hostname}`);
    return;
  }
  let addrs;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw fetchError("dns", `Could not resolve host: ${hostname}`);
  }
  if (!addrs || !addrs.length) throw fetchError("dns", `Could not resolve host: ${hostname}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw fetchError("blocked-ip", `Host resolves to a blocked address: ${a.address}`);
  }
}

// Read the body with a hard byte cap, aborting an oversized stream mid-download
// rather than buffering it all into memory.
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    if (bytes > maxBytes) throw fetchError("too-large", "Response exceeded the maximum size.");
    return { text, bytes };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw fetchError("too-large", "Response exceeded the maximum size.");
    }
    chunks.push(Buffer.from(value));
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes: total };
}

// Fetch a public import URL safely. Returns
//   { ok, status, finalUrl, contentType, bytes, body }
// or throws a typed error (`err.code`) that callers can map to an HTTP status.
async function safeFetch(rawUrl, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const doFetch = opt.fetchImpl || fetch;
  const lookup = opt.lookupImpl || dnsPromises.lookup;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opt.timeoutMs);

  try {
    let current = assertAllowedUrl(rawUrl);
    await assertHostResolvesPublic(current.hostname, lookup);

    let res;
    for (let hop = 0; ; hop++) {
      try {
        res = await doFetch(current.toString(), {
          redirect: "manual",
          signal: controller.signal,
          // Fresh, minimal headers only — no cookies, no Authorization, nothing
          // from the originating request is forwarded to the target site.
          headers: { "user-agent": opt.userAgent, accept: opt.accept },
        });
      } catch (e) {
        if (e && e.name === "AbortError") throw fetchError("timeout", "The request timed out.");
        throw fetchError("network", e && e.message ? e.message : "Network error.");
      }

      if (REDIRECT_CODES.has(res.status)) {
        if (hop >= opt.maxRedirects) throw fetchError("too-many-redirects", "Too many redirects.");
        const location = res.headers.get("location");
        if (!location) throw fetchError("bad-redirect", "Redirect response had no Location.");
        let next;
        try { next = new URL(location, current); } catch { throw fetchError("bad-redirect", "Invalid redirect target."); }
        current = assertAllowedUrl(next.toString());          // re-validate scheme/port/host
        await assertHostResolvesPublic(current.hostname, lookup); // re-validate resolved IPs
        try { if (res.body && res.body.cancel) await res.body.cancel(); } catch { /* ignore */ }
        continue;
      }
      break;
    }

    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    // Only enforce the allow-list when the server actually declared a type.
    if (contentType && opt.allowedContentTypes && !opt.allowedContentTypes.includes(contentType)) {
      throw fetchError("bad-content-type", `Unsupported content type: ${contentType}`);
    }
    const declaredLen = Number(res.headers.get("content-length") || 0);
    if (declaredLen && declaredLen > opt.maxBytes) {
      throw fetchError("too-large", "Response too large.");
    }

    const { text, bytes } = await readCapped(res, opt.maxBytes);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      finalUrl: current.toString(),
      contentType,
      bytes,
      body: text,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Map a typed import error to an HTTP status for the function handlers.
function statusForImportError(err) {
  switch (err && err.code) {
    case "invalid-url":
    case "bad-scheme":
    case "bad-port":
    case "credentials-in-url":
    case "blocked-host":
    case "blocked-ip":
      return 400; // caller asked for something we won't fetch
    case "too-large":
    case "too-many-redirects":
    case "bad-content-type":
    case "bad-redirect":
      return 422; // fetched, but unusable
    case "timeout":
      return 504;
    case "dns":
    case "network":
      return 502;
    default:
      return 500;
  }
}

module.exports = { safeFetch, statusForImportError, fetchError, DEFAULTS };
