// Where to watch a game (STREAMING_HANDOFF_DESIGN.md §4.3). Turns the broadcaster
// names that come with every scoreboard game (`game.broadcasts`, e.g. "FOX",
// "ESPN+", "Prime Video") into hand-off targets from link-out.js.
//
// No new data source: rights change every season, so this never maps team →
// network; it only reads what the scoreboard says for that game.
//
// Live TV (Luke, 2026-10-26: Xfinity): when the person has a live TV service in
// their Streaming Services, games on a channel it carries open there first, with
// the network's own app second. Streaming-only names (ESPN+, Peacock, Prime
// Video…) always open their own app. Pure, DOM-free.

import { targetHandoff } from "./link-out.js";

// Live TV services a person can mark in Watch › Streaming Services.
export const LIVE_TV_SERVICES = ["xfinity"];

// Order matters: the first rule that matches a name wins. `cable` = a TV
// channel a live TV service carries (so it can open there); otherwise the name
// is a streaming service and only its own app makes sense.
const NETWORKS = [
  { re: /^espn\s*\+|^espn\s*unl|^espn\s*plus/i,                    app: "espn",      cable: false, label: "ESPN+" },
  { re: /^(espn|espn2|espnu|espnews|abc|sec\s*n|sec network|acc\s*n|acc network|longhorn)/i, app: "espn", cable: true },
  { re: /^peacock/i,                                                app: "peacock",   cable: false },
  { re: /^(nbc|nbcsn|usa\b|usa net|telemundo|universo|cnbc)/i,      app: "peacock",   cable: true },
  { re: /^paramount/i,                                              app: "paramount", cable: false },
  { re: /^(cbs|cbssn|cbs sports)/i,                                 app: "paramount", cable: true },
  { re: /^(fox|fs1|fs2|btn|big ten)/i,                              app: "foxone",    cable: true },
  { re: /^(tnt|tbs|trutv|hbo|max\b)/i,                              app: "max",       cable: true },
  { re: /^prime|^amazon/i,                                          app: "prime",     cable: false },
  { re: /^apple|^mls season pass/i,                                 app: "appletv",   cable: false },
  { re: /^netflix/i,                                                app: "netflix",   cable: false },
  { re: /^youtube/i,                                                app: "youtube",   cable: false },
  { re: /^nfl\s*(net|network)|^nfln/i,                              app: "nfl",       cable: true },
  { re: /^nfl\s*\+|^nfl\s*plus/i,                                   app: "nfl",       cable: false },
  { re: /^nba\s*tv/i,                                               app: "nba",       cable: true },
  { re: /^nba\s*league|^league pass/i,                              app: "nba",       cable: false },
  { re: /^nhl\s*(net|network)/i,                                    app: "nhl",       cable: true },
  { re: /^mlb\s*(net|network)/i,                                    app: "mlb",       cable: true },
  { re: /^(mlb\.?\s*tv|twins\.tv)/i,                                    app: "mlb",       cable: false },
  { re: /^(fdsn|fanduel|bally)/i,                                   app: "fanduel",   cable: true },
];

export function networkFor(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  const n = NETWORKS.find((r) => r.re.test(s));
  return n ? { name: s, app: n.app, cable: n.cable } : null;
}

/** A game is worth a Watch button while it's live or starts within the hour. */
export function inWatchWindow(game, now = Date.now(), leadMs = 60 * 60 * 1000) {
  if (!game) return false;
  if (game.state === "live") return true;
  if (game.state !== "pre") return false;
  const t = Date.parse(game.start);
  return Number.isFinite(t) && t - now <= leadMs && t - now > -6 * 60 * 60 * 1000;
}

/**
 * The buttons for a game, best first, at most `max`. Each option:
 *   { id, label, network, appUrls, webUrl, mine }
 * `services` = the person's Streaming Services ids (state.mediaServices).
 */
export function watchOptionsForGame(game, { services = [], max = 3 } = {}) {
  const have = new Set((Array.isArray(services) ? services : []).map(String));
  const liveTv = LIVE_TV_SERVICES.find((id) => have.has(id)) || null;
  const names = Array.isArray(game?.broadcasts) ? game.broadcasts : [];
  const out = [];
  const seen = new Set();
  const add = (id, network, rank) => {
    if (seen.has(id)) return;
    const h = targetHandoff(id);
    if (!h) return;
    seen.add(id);
    out.push({ id, label: h.label, network, appUrls: h.appUrls, webUrl: h.webUrl, mine: have.has(id), rank });
  };
  names.forEach((name, i) => {
    const net = networkFor(name);
    if (!net) return;
    // Live TV first for a channel it carries; the network's own app next.
    if (net.cable && liveTv) add(liveTv, net.name, i * 3);
    add(net.app, net.name, i * 3 + (have.has(net.app) ? 1 : 2));
  });
  // Live TV and services the person has come before the rest; otherwise keep
  // the scoreboard's order (its first broadcaster is the main one).
  return out
    .sort((a, b) => (Number(b.mine) - Number(a.mine)) || (a.rank - b.rank))
    .slice(0, Math.max(0, max))
    .map(({ rank, ...o }) => o);
}
