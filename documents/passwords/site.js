// Which site a login belongs to (PASSWORDS_DESIGN.md §6).
//
// A login matches the REGISTRABLE DOMAIN of its site: a login for google.com fills on
// accounts.google.com, never on google.com.evil.io. Worked out with the Public Suffix
// List (tldts), private suffixes included, so two people's sites on github.io or a
// hosting service don't share logins. An IP address or a name with no public suffix
// (localhost) matches only itself. A login marked "this address only" (exactSite)
// matches only the exact host.
//
// Look-alike names: hosts are compared in their punycode form (what the URL parser
// gives), so "аpple.com" with a Cyrillic а is xn--pple-43d.com and never matches
// apple.com. displayHost shows that raw form for any non-ASCII name.

import { parse } from "tldts";

const OPTS = { allowPrivateDomains: true };

export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch { return null; }
}

// The key logins are grouped and matched by: the registrable domain, or the host
// itself when there isn't one (IPs, localhost, intranet names).
export function siteKey(url) {
  const host = hostOf(url);
  if (!host) return null;
  const p = parse(host, OPTS);
  if (p.isIp || !p.domain) return host;
  return p.domain;
}

// Does a login (its sites and exactSite flag) belong on `pageUrl`? http logins don't
// fill on… anything they couldn't before: a login saved for https only matches https
// pages; one saved for http matches both (the page upgraded).
export function loginMatches(login, pageUrl) {
  const pageHost = hostOf(pageUrl);
  if (!pageHost) return false;
  const pageSecure = pageUrl.startsWith("https:");
  return (login.sites || []).some((s) => {
    const host = hostOf(s);
    if (!host) return false;
    if (s.startsWith("https:") && !pageSecure) return false;
    return login.exactSite ? host === pageHost : siteKey(s) === siteKey(pageUrl);
  });
}

// How a site is shown in lists: the host without "www.", in its raw (punycode) form.
export function displayHost(url) {
  const host = hostOf(url);
  return host ? host.replace(/^www\./, "") : "";
}

// What a person typed in a site box → a web address (https:// added when missing), or
// null when it can't be one.
export function normalizeSiteInput(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname || u.username || u.password) return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost" && !/^\[/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
