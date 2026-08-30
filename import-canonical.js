// import-canonical.js — browser-safe canonical-URL helpers, shared by the client
// (article/recipe dedup) and mirrored by the server's _import-url.js.
//
// These are the URL-only, dependency-free half of the import URL utilities: no
// Node `net`, no DNS — just `URL`/`URLSearchParams`/strings — so the client
// bundle can use them. The server keeps a CJS copy in netlify/functions/
// _import-url.js (which also owns the net-dependent SSRF checks); a cross-check
// test (test/import-canonical.test.js) asserts the two stay identical.
//
// canonicalizeUrl is a CONSERVATIVE dedup key: strip the fragment, default port,
// a trailing slash, and a small allow-list of tracking params (utm_*, fbclid,
// gclid, …). Content-bearing params (?id=, ?p=, ?q=…) and their order are kept,
// so two links that differ only by tracking/formatting dedupe, but genuinely
// different content never collapses.

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
  "mc_cid", "mc_eid", "igshid", "igsh", "mkt_tok", "vero_id", "vero_conv",
  "oly_enc_id", "oly_anon_id", "_hsenc", "_hsmi", "hsctatracking",
  "ref_src", "ref_url", "spm", "cmpid", "campaign_id", "s_kwcid", "ns_campaign",
]);

export function isTrackingParam(key) {
  const k = String(key).toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

export function canonicalizeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return String(raw || "").trim(); }
  if (u.protocol !== "http:" && u.protocol !== "https:") return String(raw).trim();
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams.entries()) {
    if (!isTrackingParam(k)) kept.append(k, v);
  }
  u.search = kept.toString();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, ""); // keep root "/"
  return u.toString();
}

// Extract the first http(s) URL from a possibly-messy pasted/shared string, and
// defend against an accidentally doubled URL ("https://a…https://a…").
export function normalizeImportUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}
