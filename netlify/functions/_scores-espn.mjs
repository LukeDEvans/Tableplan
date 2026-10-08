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

  // A team's recent results and upcoming fixtures. `ref` is this provider's id
  // for the team. Soccer serves results and fixtures as two lists.
  async teamGames(leagueKey, ref, { fetchJson }) {
    if (!/^\d{1,9}$/.test(String(ref))) throw new Error("ESPN: bad team id");
    const url = `${BASE}/${PATHS[leagueKey]}/teams/${ref}/schedule`;
    if (!isSoccer(leagueKey)) return parseSchedule(await fetchJson(url), leagueKey);
    const [results, fixtures] = await Promise.allSettled([fetchJson(url), fetchJson(`${url}?fixture=true`)]);
    if (results.status === "rejected" && fixtures.status === "rejected") throw results.reason;
    return [results, fixtures].flatMap((r) => (r.status === "fulfilled" ? parseSchedule(r.value, leagueKey) : []));
  },
};

export const _test = { PATHS, stateOf };
