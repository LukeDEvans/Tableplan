// One way out of the app to a streaming service (STREAMING_HANDOFF_DESIGN.md
// §4.1). Every hand-off — a Watch card, Discover, a game in Scores, the dock's
// game card — goes through openOutLink(), so the iPhone app tries the service's
// own app first and only then the website.
//
// It never plays anything and never loads a service inside this app: the
// service's own app (or website) does the signing in and the playback.
//
// OUT_TARGETS is the one list of places we hand off to. Each has:
//   app — links that open the installed app's home, tried in order (custom
//         schemes; see LinkOutPlugin.swift `allowedSchemes`). UNVERIFIED until
//         tapped on the phone from Settings › Admin › Link test (step 1).
//   web — the website, used when the app isn't installed and on the web app.
// Pure apart from openOutLink, whose side effects are all injected.

export const OUT_TARGETS = {
  netflix:   { label: "Netflix",       app: ["nflx://"],           web: "https://www.netflix.com/" },
  disney:    { label: "Disney+",       app: ["disneyplus://"],     web: "https://www.disneyplus.com/" },
  max:       { label: "HBO Max",       app: ["hbomax://"],         web: "https://play.hbomax.com/" },
  hulu:      { label: "Hulu",          app: ["hulu://"],           web: "https://www.hulu.com/" },
  prime:     { label: "Prime Video",   app: ["aiv://"],            web: "https://www.amazon.com/gp/video/storefront" },
  paramount: { label: "Paramount+",    app: ["pplus://"],          web: "https://www.paramountplus.com/" },
  appletv:   { label: "Apple TV",      app: ["videos://"],         web: "https://tv.apple.com/" },
  peacock:   { label: "Peacock",       app: ["peacock://"],        web: "https://www.peacocktv.com/" },
  espn:      { label: "ESPN",          app: ["sportscenter://"],   web: "https://www.espn.com/watch/" },
  xfinity:   { label: "Xfinity Stream", app: ["xfinitystream://"], web: "https://www.xfinity.com/stream/live" },
  foxone:    { label: "Fox One",       app: ["foxone://"],         web: "https://www.foxone.com/" },
  nfl:       { label: "NFL",           app: ["nflmobile://"],      web: "https://www.nfl.com/plus/" },
  nba:       { label: "NBA",           app: ["gametime://"],       web: "https://www.nba.com/watch" },
  nhl:       { label: "NHL",           app: ["nhl://"],            web: "https://www.nhl.com/" },
  mlb:       { label: "MLB",           app: ["mlbatbat://"],       web: "https://www.mlb.com/tv" },
  fanduel:   { label: "FanDuel Sports Network", app: ["fsapp://"], web: "https://www.fanduelsportsnetwork.com/" },
  youtube:   { label: "YouTube",       app: ["youtube://"],        web: "https://www.youtube.com/" },
};

export function outTarget(id) {
  return Object.prototype.hasOwnProperty.call(OUT_TARGETS, id) ? OUT_TARGETS[id] : null;
}

const isHttps = (u) => /^https:\/\//i.test(String(u || ""));

/**
 * What to try for a title on a service: its exact title/episode links first
 * (universal links — open the app ON the title), then the app's home, then the
 * website. `links` = { video, title, search } (any may be missing).
 */
export function titleHandoff(providerId, links = {}) {
  const t = outTarget(providerId);
  const exact = [links.video, links.title].filter(isHttps);
  const search = isHttps(links.search) ? links.search : "";
  // A search page is usually not a universal link, so it's tried as the web
  // fallback rather than ahead of the app's home.
  return {
    appUrls: [...new Set([...exact, ...(t ? t.app : [])])],
    webUrl: exact[0] || search || (t ? t.web : ""),
    label: t ? t.label : "",
    exact: exact.length > 0,
  };
}

/** The app (or site) for a target, e.g. a network for a live game. */
export function targetHandoff(id) {
  const t = outTarget(id);
  return t ? { appUrls: [...t.app], webUrl: t.web, label: t.label, exact: false } : null;
}

/**
 * Open a hand-off. deps:
 *   linkOut    — the native LinkOut plugin, or null (web / an older app build)
 *   windowOpen — (url) => void, the web path
 * Resolves "app" | "web" | "none".
 */
export async function openOutLink(spec, { linkOut = null, windowOpen } = {}) {
  const appUrls = (spec && Array.isArray(spec.appUrls) ? spec.appUrls : []).filter(Boolean).slice(0, 4);
  const webUrl = spec && isHttps(spec.webUrl) ? spec.webUrl : "";
  if (linkOut && typeof linkOut.open === "function") {
    try {
      const r = await linkOut.open({ appUrls, webUrl });
      return r && r.opened ? r.opened : "none";
    } catch { /* fall through to the web path */ }
  }
  // Web app, or an app build from before the plugin: the website (on the
  // iPhone a universal-link https URL may still open the app from Safari).
  const url = webUrl || appUrls.find(isHttps) || "";
  if (!url || typeof windowOpen !== "function") return "none";
  windowOpen(url);
  return "web";
}

/** Every custom scheme the catalog uses — checked against the Swift allow-list. */
export function catalogSchemes() {
  const out = new Set();
  for (const t of Object.values(OUT_TARGETS)) for (const u of t.app) {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
    if (m && m[1].toLowerCase() !== "https") out.add(m[1].toLowerCase());
  }
  return [...out];
}

// ── Markup ───────────────────────────────────────────────────────────────────
// A hand-off button carries its links in data attributes; one app-wide click
// listener (app.js "Link out") opens it, so any page can render one.
export function linkOutAttrs(spec, esc) {
  const apps = (spec?.appUrls || []).filter(Boolean).join(" ");
  return `data-link-out="1" data-out-app="${esc(apps)}" data-out-web="${esc(spec?.webUrl || "")}" data-out-label="${esc(spec?.label || "")}"${spec?.note ? ` data-out-note="${esc(spec.note)}"` : ""}`;
}

/** Read a hand-off back from an element rendered with linkOutAttrs. */
export function linkOutFromElement(el) {
  const d = el?.dataset || {};
  return {
    appUrls: String(d.outApp || "").split(/\s+/).filter(Boolean),
    webUrl: d.outWeb || "",
    label: d.outLabel || "",
    note: d.outNote || "",
  };
}
