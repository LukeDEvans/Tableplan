// ESPN adapter for the scores function (SPORTS_SCORES_DESIGN.md §4).
//
// The ONLY file that knows ESPN's URLs and JSON. It turns ESPN's site API into
// the app's own Game/Team shapes (sports-model.js); nothing ESPN-specific leaves
// here except an opaque team id under `refs.espn`. The API is public but
// unofficial and undocumented: every field is read defensively, and a league
// ESPN stops serving simply fails over to the next provider in the chain
// (_scores-providers.mjs).

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

// Our league key → ESPN's sport/league path.
const PATHS = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
  mlb: "baseball/mlb",
  wnba: "basketball/wnba",
  ncaaf: "football/college-football",
  ncaam: "basketball/mens-college-basketball",
  ncaaw: "basketball/womens-college-basketball",
  ncaah: "hockey/mens-college-hockey",
  mls: "soccer/usa.1",
  nwsl: "soccer/usa.nwsl",
  eredivisie: "soccer/ned.1",
  "knvb-beker": "soccer/ned.cup",
  "premier-league": "soccer/eng.1",
  "la-liga": "soccer/esp.1",
  bundesliga: "soccer/ger.1",
  "serie-a": "soccer/ita.1",
  "ligue-1": "soccer/fra.1",
  "liga-mx": "soccer/mex.1",
  "champions-league": "soccer/uefa.champions",
  "europa-league": "soccer/uefa.europa",
  "conference-league": "soccer/uefa.europa.conf",
  "nations-league": "soccer/uefa.nations",
  "world-cup": "soccer/fifa.world",
  "womens-world-cup": "soccer/fifa.wwc",
  "wcq-uefa": "soccer/fifa.worldq.uefa",
  "wcq-concacaf": "soccer/fifa.worldq.concacaf",
  euro: "soccer/uefa.euro",
  "concacaf-nations": "soccer/concacaf.nations.league",
  "gold-cup": "soccer/concacaf.gold",
  "copa-america": "soccer/conmebol.america",
  friendlies: "soccer/fifa.friendly",
};

// The college scoreboards default to ranked teams only; `groups` asks for the
// whole division (80 = FBS, 50 = Division I) so favorites outside the Top 25 are
// there. The client decides what to show.
const SCOREBOARD_PARAMS = {
  ncaaf: { groups: "80", limit: "300" },
  ncaam: { groups: "50", limit: "400" },
  ncaaw: { groups: "50", limit: "400" },
  ncaah: { limit: "200" },
};

const isSoccer = (leagueKey) => (PATHS[leagueKey] || "").startsWith("soccer/");
const STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports";
// ESPN's soccer slug ("ned.1") → our league key, for a team schedule that spans
// competitions (soccer/all/teams/{id}/schedule).
const KEY_BY_SOCCER_SLUG = Object.fromEntries(Object.entries(PATHS).filter(([, p]) => p.startsWith("soccer/")).map(([k, p]) => [p.slice(7), k]));

// Which season ESPN calls "now" isn't always the current one (its NHL table
// defaulted to the finished 2025-26 season in October 2026), so tables and team
// schedules name the season. ESPN numbers a season by:
//   end   — the year it ends (NHL, NBA, college basketball and hockey)
//   fall  — the year it starts, autumn sports (NFL, college football)
//   year  — the calendar year (MLS, MLB, WNBA, NWSL)
//   start — the year it starts, European club soccer
// International soccer leaves it to ESPN. Between seasons, the last one shows.
const SEASON_STYLE = {
  nhl: "end", nba: "end", ncaam: "end", ncaaw: "end", ncaah: "end",
  nfl: "fall", ncaaf: "fall",
  mls: "year", mlb: "year", wnba: "year", nwsl: "year",
  eredivisie: "start", "knvb-beker": "start", "premier-league": "start", "la-liga": "start", bundesliga: "start",
  "serie-a": "start", "ligue-1": "start", "liga-mx": "start", "champions-league": "start", "europa-league": "start", "conference-league": "start",
};
export function espnSeason(leagueKey, dateKey) {
  const [y, m] = String(dateKey).split("-").map(Number);
  switch (SEASON_STYLE[leagueKey]) {
    case "end": return m >= 9 ? y + 1 : y;
    case "fall": return m <= 6 ? y - 1 : y;
    case "year": return m <= 2 ? y - 1 : y;
    case "start": return m >= 7 ? y : y - 1;
    default: return null;
  }
}

// How a league's table is split: NFL, NHL and MLB by division, NBA by conference;
// the rest as ESPN groups them (conferences, groups, one table).
const STANDINGS_PARAMS = {
  nfl: { level: "3" }, nhl: { level: "3" }, mlb: { level: "3" }, nba: { level: "2" },
  ncaaf: { group: "80" }, ncaam: { group: "50" }, ncaaw: { group: "50" },
};
const US_SEASON_TYPES = (leagueKey) => !isSoccer(leagueKey);
const qs = (params) => new URLSearchParams(params).toString();

function stateOf(type) {
  const name = String(type?.name || "").toUpperCase();
  if (name.includes("POSTPONED")) return "postponed";
  if (name.includes("CANCEL") || name.includes("ABANDON")) return "canceled";
  if (name.includes("DELAY") || name.includes("SUSPEND")) return "delayed";
  if (type?.state === "in") return "live";
  if (type?.state === "post") return "final";
  return "pre";
}

// A score arrives as "24" on the scoreboard and { value, displayValue } on a
// team schedule.
const scoreOf = (s) => (s && typeof s === "object" ? (s.value ?? s.displayValue) : s);

function logoOf(team, dark) {
  const logos = Array.isArray(team?.logos) ? team.logos : [];
  const has = (l, word) => Array.isArray(l?.rel) && l.rel.includes(word);
  if (dark) return team?.logoDark || logos.find((l) => has(l, "dark") && !has(l, "scoreboard"))?.href || "";
  return team?.logo || logos.find((l) => has(l, "default"))?.href || logos[0]?.href || "";
}

function parseTeam(team) {
  if (!team?.id) return null;
  return {
    name: team.displayName || team.name || team.location || "",
    short: team.shortDisplayName || team.location || team.name || "",
    abbr: team.abbreviation || "",
    logo: logoOf(team, false),
    logoDark: logoOf(team, true),
    color: team.color || "",
    refs: { espn: String(team.id) },
  };
}

function parseSide(c) {
  const team = parseTeam(c?.team);
  if (!team) return null;
  const records = Array.isArray(c.records) ? c.records : Array.isArray(c.record) ? c.record : [];
  const total = records.find((r) => r?.type === "total") || records[0];
  const rank = Number(c.curatedRank?.current);
  return {
    team,
    score: scoreOf(c.score),
    pens: c.shootoutScore ?? null,
    record: total?.summary || total?.displayValue || "",
    rank: rank >= 1 && rank <= 25 ? rank : null, // ESPN marks unranked as 99
    winner: c.winner === true,
  };
}

function broadcastsOf(comp) {
  const out = [];
  for (const b of Array.isArray(comp?.broadcasts) ? comp.broadcasts : []) {
    for (const n of Array.isArray(b?.names) ? b.names : []) out.push(n);
    if (b?.media?.shortName) out.push(b.media.shortName);
  }
  if (!out.length) for (const g of Array.isArray(comp?.geoBroadcasts) ? comp.geoBroadcasts : []) if (g?.media?.shortName) out.push(g.media.shortName);
  return [...new Set(out.filter(Boolean))];
}

function linkOf(event) {
  const links = Array.isArray(event?.links) ? event.links : [];
  const rel = (l, word) => Array.isArray(l?.rel) && l.rel.includes(word);
  const pick = links.find((l) => rel(l, "desktop") && (rel(l, "summary") || rel(l, "live"))) || links.find((l) => rel(l, "desktop")) || links[0];
  return pick?.href || "";
}

// One ESPN event → one raw game in the app's shape (cleanGame validates it).
export function parseEvent(event, leagueKey) {
  const comp = event?.competitions?.[0];
  if (!event?.id || !comp) return null;
  const sides = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = parseSide(sides.find((c) => c?.homeAway === "home"));
  const away = parseSide(sides.find((c) => c?.homeAway === "away"));
  if (!home || !away) return null;
  const type = comp.status?.type || event.status?.type || {};
  const state = stateOf(type);
  const sit = comp.situation || {};
  const possession = sit.possession ? (String(sit.possession) === home.team.refs.espn ? "home" : String(sit.possession) === away.team.refs.espn ? "away" : "") : "";
  return {
    id: `espn:${event.id}`,
    league: leagueKey,
    start: event.date || comp.date || comp.startDate,
    state,
    // Before kick-off the client formats the time itself, in the viewer's zone.
    detail: state === "pre" ? (comp.timeValid === false ? "TBD" : "") : (type.shortDetail || type.description || ""),
    note: comp.group?.name || comp.notes?.[0]?.headline || comp.series?.summary || "",
    venue: comp.venue?.fullName || event.venue?.displayName || "",
    broadcasts: broadcastsOf(comp),
    situation: state === "live" ? (sit.shortDownDistanceText || sit.downDistanceText || "") : "",
    possession: state === "live" ? possession : "",
    neutral: comp.neutralSite === true,
    link: linkOf(event),
    home,
    away,
  };
}

export function parseScoreboard(json, leagueKey) {
  if (!json || !Array.isArray(json.events)) throw new Error("ESPN: unexpected scoreboard shape");
  return json.events.map((e) => parseEvent(e, leagueKey)).filter(Boolean);
}

export function parseTeams(json) {
  const teams = json?.sports?.[0]?.leagues?.[0]?.teams;
  if (!Array.isArray(teams)) throw new Error("ESPN: unexpected teams shape");
  return teams.map((t) => parseTeam(t?.team || t)).filter((t) => t && t.name);
}

export function parseSchedule(json, leagueKey) {
  if (!json || !Array.isArray(json.events)) throw new Error("ESPN: unexpected schedule shape");
  return json.events.map((e) => parseEvent(e, leagueKey)).filter(Boolean);
}

// ESPN stat → the app's stat key. Matched on `type` first (college tables repeat
// every stat under "vsconf_" types with the same names), then on `name`.
const STAT_KEY = {
  gamesplayed: "gp", wins: "w", losses: "l", ties: "t", otlosses: "otl", points: "pts",
  winpercent: "pct", gamesbehind: "gb", pointsfor: "gf", pointsagainst: "ga", pointdifferential: "gd",
  streak: "streak", playoffseed: "seed",
  total: "ovr", overall: "ovr", vsconf: "conf", "vs. conf.": "conf", home: "home", homerecord: "home",
  road: "away", awayrecord: "away", lasttengames: "l10", "last ten games": "l10",
};
function standingRow(entry) {
  const team = parseTeam(entry?.team);
  if (!team) return null;
  const stats = {};
  let rank = null;
  for (const st of Array.isArray(entry.stats) ? entry.stats : []) {
    const type = String(st?.type || "").toLowerCase();
    if (type.includes("_")) continue; // a split ("vsconf_wins"), not the team's own figure
    const key = STAT_KEY[type] || STAT_KEY[String(st?.name || "").toLowerCase()];
    const value = st?.summary ?? st?.displayValue;
    if (String(st?.name || "").toLowerCase() === "rank" && st?.value != null) rank = st.value;
    if (!key || value == null || value === "" || key in stats) continue;
    // NBA's "points" is points per game, not standings points.
    if (key === "pts" && type === "points" && /\./.test(String(value))) continue;
    stats[key] = value;
  }
  // Soccer gives no games-played in some tables: wins + draws + losses.
  if (!stats.gp && ["w", "t", "l"].every((k) => /^\d+$/.test(stats[k] || ""))) stats.gp = String(+stats.w + +stats.t + +stats.l);
  return {
    team,
    rank: entry.note?.rank ?? rank,
    note: entry.note?.description ? { text: entry.note.description, color: entry.note.color || "" } : null,
    stats,
  };
}
// Leaf groups (divisions inside conferences, or the league's own table), named.
function standingGroups(node, out = [], parentName = "") {
  if (!node || typeof node !== "object") return out;
  const entries = node.standings?.entries;
  if (Array.isArray(entries) && entries.length) {
    out.push({ name: node.name || parentName || "", rows: entries.map(standingRow).filter(Boolean) });
  }
  for (const child of Array.isArray(node.children) ? node.children : []) standingGroups(child, out, node.name);
  return out;
}
export function parseStandings(json, leagueKey) {
  if (!json || (!Array.isArray(json.children) && !json.standings)) throw new Error("ESPN: unexpected standings shape");
  const groups = standingGroups(json);
  // One table under one child named for the season ("2026-27"): call it the league.
  if (groups.length === 1 && (!groups[0].name || /^\d{4}/.test(groups[0].name))) groups[0].name = "";
  const block = (function first(n) { return n?.standings?.seasonDisplayName ? n.standings : (n?.children || []).map(first).find(Boolean); })(json);
  return { league: leagueKey, season: json.season?.displayName || block?.seasonDisplayName || "", groups };
}

// A team schedule spanning competitions: each event says which.
export function parseAllSchedule(json) {
  if (!json || !Array.isArray(json.events)) throw new Error("ESPN: unexpected schedule shape");
  return json.events.map((e) => {
    const key = KEY_BY_SOCCER_SLUG[e?.league?.slug] || KEY_BY_SOCCER_SLUG[String(e?.season?.slug || "")];
    return key ? parseEvent(e, key) : null;
  }).filter(Boolean);
}

export const espn = {
  id: "espn",
  label: "ESPN",
  live: true, // in-game clock and score
  enabled: () => true,
  supports: (leagueKey) => !!PATHS[leagueKey],

  async scoreboard(leagueKey, dateKey, { fetchJson }) {
    const params = { dates: dateKey.replace(/-/g, ""), ...(SCOREBOARD_PARAMS[leagueKey] || {}) };
    return parseScoreboard(await fetchJson(`${BASE}/${PATHS[leagueKey]}/scoreboard?${qs(params)}`), leagueKey);
  },

  async teams(leagueKey, { fetchJson }) {
    return parseTeams(await fetchJson(`${BASE}/${PATHS[leagueKey]}/teams?limit=1000`));
  },

  // Every game the team has this season. `ref` is this provider's id for it.
  // Soccer: every competition at once (league, cups, European, internationals),
  // results and fixtures being two lists. Elsewhere: regular season + playoffs.
  async teamGames(leagueKey, ref, { fetchJson, dateKey }) {
    if (!/^\d{1,9}$/.test(String(ref))) throw new Error("ESPN: bad team id");
    if (isSoccer(leagueKey)) {
      const url = `${BASE}/soccer/all/teams/${ref}/schedule`;
      const [results, fixtures] = await Promise.allSettled([fetchJson(url), fetchJson(`${url}?fixture=true`)]);
      if (results.status === "rejected" && fixtures.status === "rejected") throw results.reason;
      return [results, fixtures].flatMap((r) => (r.status === "fulfilled" ? parseAllSchedule(r.value) : []));
    }
    const season = espnSeason(leagueKey, dateKey || new Date().toISOString().slice(0, 10));
    const url = (type) => `${BASE}/${PATHS[leagueKey]}/teams/${ref}/schedule?${qs({ ...(season ? { season: String(season) } : {}), seasontype: type })}`;
    const [reg, post] = await Promise.allSettled([fetchJson(url("2")), fetchJson(url("3"))]);
    if (reg.status === "rejected") throw reg.reason;
    return [...parseSchedule(reg.value, leagueKey), ...(post.status === "fulfilled" && Array.isArray(post.value?.events) ? parseSchedule(post.value, leagueKey) : [])];
  },

  async standings(leagueKey, { fetchJson, dateKey }) {
    const season = espnSeason(leagueKey, dateKey || new Date().toISOString().slice(0, 10));
    const params = { ...(STANDINGS_PARAMS[leagueKey] || {}), ...(season ? { season: String(season) } : {}), ...(US_SEASON_TYPES(leagueKey) ? { seasontype: "2" } : {}) };
    const q = qs(params);
    return parseStandings(await fetchJson(`${STANDINGS_BASE}/${PATHS[leagueKey]}/standings${q ? `?${q}` : ""}`), leagueKey);
  },
};

export const _test = { PATHS, stateOf, KEY_BY_SOCCER_SLUG, SEASON_STYLE };
