// news-device-signin.js — newspaper sign-ins checked on the phone itself, for News.
//
// News collects a paper's articles only while its reader is signed in to that
// paper (NEWS_PAGE_DESIGN.md §4). In a browser that is proven with a pasted
// session cookie the server tests. In the iPhone app the reader signs in to the
// paper inside the app (ArticleReader plugin → login sheet), and the session
// cookies stay in the app's own website data. This file works out, ON THE PHONE,
// whether each paper is signed in, so the app can report just the answer
// ("signed-in" | "unverified" | "none") to the server. No cookie value leaves the
// phone: the native side returns cookie NAMES only, and only the status is sent.
//
// Pure parts (statusFromSignals, pageLooksSignedOut, deviceSignInsNeedCheck) are
// unit-tested; checkDeviceSignIns talks to the plugin and is injected a reader.

const DAY_MS = 86_400_000;
export const DEVICE_RECHECK_MS = DAY_MS;

// How each paper's sign-in is recognised on the phone.
//   cookies   session cookie names that exist only while signed in
//   checkUrl  a subscriber-only page: signed-out readers are sent to a login page
//   signedOut markers of a signed-out page (the same ones the server check uses,
//             netlify/functions/_news-links.js checkPaperSignIn)
// Star Tribune has no known session cookie or subscriber page (as on the server),
// so it counts as "unverified" once the reader has been through its sign-in sheet.
export const DEVICE_SIGNIN_PAPERS = [
  {
    key: "nyt",
    cookieDomain: "nytimes.com",
    cookies: ["NYT-S"],
    checkUrl: "https://www.nytimes.com/saved",
    signedOut: /\/login\?|"isLoggedIn"\s*:\s*false|data-testid="login-button"/i
  },
  {
    key: "economist",
    cookieDomain: "economist.com",
    cookies: ["blaize_session"],
    checkUrl: "https://www.economist.com/for-you/bookmarks",
    signedOut: /"isLoggedIn"\s*:\s*false|"loggedIn"\s*:\s*false|myaccount\.economist\.com\/s\/login/i
  },
  {
    key: "startribune",
    cookieDomain: "startribune.com",
    cookies: [],
    checkUrl: "",
    signedOut: null
  }
];

const LOGIN_URL_RE = /\/(?:login|signin|sign-in|auth\/login)(?:[/?#]|$)|^https?:\/\/myaccount\./i;

// Runs INSIDE the paper's page (the plugin's invisible web view). Self-contained.
// Returns a JSON string { url, signedOut } once the page has finished loading, or
// "null" while it is still loading (the plugin then asks again). Only the answer
// crosses back to the app, never the page's HTML.
export function signInPageProbe(source, flags) {
  if (document.readyState !== "complete") return "null";
  var html = String((document.documentElement && document.documentElement.outerHTML) || "").slice(0, 400000);
  var signedOut = false;
  try { signedOut = !!source && new RegExp(source, flags || "").test(html); } catch (e) { signedOut = false; }
  return JSON.stringify({ url: String(location.href || ""), signedOut: signedOut });
}
export function signInPageProbeSource(paper) {
  const re = paper?.signedOut || null;
  return "(" + signInPageProbe.toString() + ")(" + JSON.stringify(re ? re.source : "") + "," + JSON.stringify(re ? re.flags : "") + ")";
}

// Did the subscriber page come back as a signed-out page? `page`: { loaded, url,
// signedOut, finalUrl }. true = signed out, false = signed in, null = can't tell.
export function pageLooksSignedOut(page) {
  if (!page || typeof page !== "object") return null;
  const urls = [page.finalUrl, page.url].filter((u) => typeof u === "string" && u);
  if (urls.some((u) => LOGIN_URL_RE.test(u))) return true; // sent to a sign-in page
  if (!page.loaded) return null;                            // never finished loading
  return page.signedOut === true;
}

// One paper's status from what the phone found.
//   cookieNames  names of the paper's unexpired cookies in the app (or null when
//                they couldn't be read)
//   page         the subscriber-page probe result (or null when not loaded)
//   marked       the reader has completed this paper's sign-in sheet on this phone
// Returns "signed-in" | "unverified" | "none", or undefined when nothing could be
// learned (the server then keeps what it had).
export function statusFromSignals(paper, { cookieNames = null, page = null, marked = false } = {}) {
  if (!paper) return undefined;
  const names = Array.isArray(cookieNames) ? cookieNames : null;
  if (names && paper.cookies.some((c) => names.includes(c))) return "signed-in";
  if (paper.checkUrl) {
    const out = pageLooksSignedOut(page);
    if (out === true) return "none";
    if (out === false) return "signed-in";
    return undefined; // page didn't load: no answer
  }
  // No way to check this paper (Star Tribune).
  if (!names) return undefined;
  return marked && names.length ? "unverified" : "none";
}

// Does the phone need to report again? True when any paper has never been
// reported from a phone, or its last report is over a day old.
export function deviceSignInsNeedCheck(signIns, nowMs = Date.now()) {
  return DEVICE_SIGNIN_PAPERS.some((p) => {
    const at = Date.parse(signIns?.[p.key]?.deviceAt || "");
    return Number.isNaN(at) || nowMs - at > DEVICE_RECHECK_MS;
  });
}

// Ask the plugin about every paper. `reader`: the ArticleReader plugin
// ({ cookieNames, extract }). `isMarked(key)`: see statusFromSignals.
// Returns { nyt, economist, startribune } with undefined left out.
export async function checkDeviceSignIns(reader, { isMarked = () => false, papers = DEVICE_SIGNIN_PAPERS } = {}) {
  const out = {};
  if (!reader || typeof reader.cookieNames !== "function") return out;
  await Promise.all(papers.map(async (paper) => {
    let cookieNames = null;
    try {
      const res = await reader.cookieNames({ domain: paper.cookieDomain });
      if (Array.isArray(res?.names)) cookieNames = res.names.map(String);
    } catch { /* an older build, or the store couldn't be read */ }
    let page = null;
    const hasCookie = cookieNames && paper.cookies.some((c) => cookieNames.includes(c));
    if (!hasCookie && paper.checkUrl && typeof reader.extract === "function") {
      try {
        const res = await reader.extract({ url: paper.checkUrl, script: signInPageProbeSource(paper), minChars: 1, timeoutMs: 15000 });
        let data = null;
        try { data = JSON.parse(res?.json || "null"); } catch { data = null; }
        // A page that never finished loading still tells us where it ended up.
        page = { loaded: !!data, url: data?.url || "", signedOut: data?.signedOut === true, finalUrl: typeof res?.finalUrl === "string" ? res.finalUrl : "" };
      } catch { page = null; }
    }
    const status = statusFromSignals(paper, { cookieNames, page, marked: !!isMarked(paper.key) });
    if (status) out[paper.key] = status;
  }));
  return out;
}
