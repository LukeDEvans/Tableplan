// _import-url.js — pure URL helpers shared by the content-import functions.
//
// Two concerns, both DOM-free and dependency-free so they unit-test cleanly:
//   1. SSRF guard — classify a URL/host/IP as public-fetchable or blocked. Used
//      by _import-fetch.js before AND after DNS resolution and on every redirect.
//   2. Canonicalization — a conservative dedup key (strip fragments, default
//      ports, trailing slash, and a small allow-list of tracking params) while
//      preserving the original source URL and any content-bearing query params.
//
// Deliberately small: it protects the import fetchers, not a general proxy.

const net = require("net");

// A typed error so callers can map a reason to an HTTP status without string-matching.
function importUrlError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.isImportUrlError = true;
  return e;
}

// ── IPv4 ────────────────────────────────────────────────────────────────────
function ipv4ToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}

function ipv4Blocked(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → fail closed
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  };
  return (
    inRange("0.0.0.0", 8) ||       // "this" network / 0.0.0.0
    inRange("10.0.0.0", 8) ||      // private
    inRange("100.64.0.0", 10) ||   // CGNAT (100.64/10)
    inRange("127.0.0.0", 8) ||     // loopback
    inRange("169.254.0.0", 16) ||  // link-local (incl. cloud metadata 169.254.169.254)
    inRange("172.16.0.0", 12) ||   // private
    inRange("192.0.0.0", 24) ||    // IETF protocol assignments
    inRange("192.168.0.0", 16) ||  // private
    inRange("198.18.0.0", 15) ||   // benchmarking
    inRange("224.0.0.0", 4) ||     // multicast
    inRange("240.0.0.0", 4)        // reserved (incl. 255.255.255.255)
  );
}

// ── IPv6 ──────────────────────────────────────────────────────────────────
// Pragmatic classification of the security-relevant ranges (loopback,
// unspecified, ULA, link-local, multicast, and IPv4-mapped/compatible) without
// a full 128-bit expander — enough to fail closed on anything internal.
function ipv6Blocked(ip) {
  const raw = String(ip).split("%")[0].toLowerCase(); // drop any zone id
  if (raw === "::1" || raw === "::") return true;      // loopback / unspecified
  const v4 = raw.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/); // ::ffff:a.b.c.d etc.
  if (v4) return ipv4Blocked(v4[1]);
  const firstGroup = raw.startsWith("::") ? 0 : parseInt(raw.split(":")[0] || "0", 16);
  if (Number.isNaN(firstGroup)) return true;           // fail closed
  const hi = (firstGroup >> 8) & 0xff;
  if (hi === 0xff) return true;                          // ff00::/8 multicast
  if (hi === 0xfc || hi === 0xfd) return true;           // fc00::/7 unique-local
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true; // fe80::/10 link-local
  return false;
}

function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) return ipv6Blocked(ip);
  return true; // not an IP literal → fail closed (callers only pass IPs here)
}

function isBlockedHostname(host) {
  const h = String(host || "").trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost") return true;
  if (/\.(local|internal|localhost|lan|home|corp|intranet)$/.test(h)) return true;
  if (net.isIP(h)) return isBlockedIp(h);  // IP literal used as the hostname
  if (!h.includes(".")) return true;       // single-label (internal) hostnames
  return false;
}

const ALLOWED_PORTS = new Set(["", "80", "443"]);

// Pre-connect check: scheme, port, embedded credentials, and hostname. IP-level
// checks against resolved addresses happen in _import-fetch (post-DNS).
function assertAllowedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw importUrlError("invalid-url", "Invalid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw importUrlError("bad-scheme", `Unsupported scheme: ${u.protocol}`);
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    throw importUrlError("bad-port", `Unsupported port: ${u.port}`);
  }
  if (u.username || u.password) {
    throw importUrlError("credentials-in-url", "URLs with embedded credentials are not allowed.");
  }
  if (isBlockedHostname(u.hostname)) {
    throw importUrlError("blocked-host", `Blocked or private host: ${u.hostname}`);
  }
  return u;
}

// ── Canonicalization (dedup key) ───────────────────────────────────────────
// Only well-known analytics/click params are removed. Content-bearing params
// (?id=, ?p=, ?recipe=, ?q=…) are preserved, as is their order.
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
  "mc_cid", "mc_eid", "igshid", "igsh", "mkt_tok", "vero_id", "vero_conv",
  "oly_enc_id", "oly_anon_id", "_hsenc", "_hsmi", "hsctatracking",
  "ref_src", "ref_url", "spm", "cmpid", "campaign_id", "s_kwcid", "ns_campaign",
]);
function isTrackingParam(key) {
  const k = String(key).toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

function canonicalizeUrl(raw) {
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
// defend against an accidentally doubled URL ("https://a…https://a…"). Shared by
// the recipe function, the in-app importer, and the extension (currently
// duplicated in each — consolidated here for the import path).
function normalizeImportUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}

module.exports = {
  importUrlError,
  ipv4Blocked,
  ipv6Blocked,
  isBlockedIp,
  isBlockedHostname,
  assertAllowedUrl,
  canonicalizeUrl,
  isTrackingParam,
  normalizeImportUrlInput,
};
