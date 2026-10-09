// TheSportsDB adapter — the standby provider (SPORTS_SCORES_DESIGN.md §4).
//
// Off unless THESPORTSDB_KEY is set (a paid key: the free key returns only three
// events a day). It serves schedules and final scores for the leagues below, so
// the Scores view keeps working if ESPN's feed goes away. It has no in-game
// clock (`live: false`), no team lists and no team schedules; the view says so
// rather than pretending.
//
// League ids: only NFL (4391) has been checked against a live response. The
// rest are from TheSportsDB's league list and need a look the first time this
// provider is switched on.

const BASE = "https://www.thesportsdb.com/api/v1/json";

const LEAGUE_IDS = {
  nfl: 4391, nba: 4387, nhl: 4380, mlb: 4424, wnba: 4516,
  ncaaf: 4479, ncaam: 4607,
  mls: 4346, eredivisie: 4337,
  "premier-league": 4328, bundesliga: 4331, "serie-a": 4332, "ligue-1": 4334, "la-liga": 4335,
  "champions-league": 4480, "europa-league": 4481,
  "nations-league": 4490, "world-cup": 4429,
};

const FINAL = new Set(["FT", "AOT", "AET", "PEN", "AP", "MATCH FINISHED", "FINAL"]);
const CALLED_OFF = new Set(["CANC", "ABD", "AWD", "WO"]);
const NOT_STARTED = new Set(["", "NS", "TBD", "NOT STARTED"]);

function stateOf(ev) {
  const s = String(ev.strStatus || "").trim().toUpperCase();
  if (String(ev.strPostponed || "").toLowerCase() === "yes" || s === "PST" || s === "POSTPONED") return "postponed";
  if (CALLED_OFF.has(s)) return "canceled";
  if (FINAL.has(s)) return "final";
  if (NOT_STARTED.has(s)) return "pre";
  return "live";
}

function parseSide(ev, which) {
  const name = ev[`str${which}Team`];
  if (!name) return null;
  const id = ev[`id${which}Team`];
  return {
    team: { name, short: name, abbr: "", logo: ev[`str${which}TeamBadge`] || "", refs: id ? { thesportsdb: String(id) } : {} },
    score: ev[`int${which}Score`],
  };
}

export function parseEvent(ev, leagueKey) {
  if (!ev?.idEvent) return null;
  const home = parseSide(ev, "Home");
  const away = parseSide(ev, "Away");
  if (!home || !away) return null;
  const state = stateOf(ev);
  // strTimestamp is UTC without a zone suffix.
  const stamp = ev.strTimestamp ? `${String(ev.strTimestamp).replace(/Z$/, "")}Z` : `${ev.dateEvent}T${ev.strTime || "00:00:00"}Z`;
  const status = String(ev.strStatus || "").trim().toUpperCase();
  if (state === "final" && home.score != null && away.score != null) {
    home.winner = Number(home.score) > Number(away.score);
    away.winner = Number(away.score) > Number(home.score);
  }
  return {
    id: `thesportsdb:${ev.idEvent}`,
    league: leagueKey,
    start: stamp,
    state,
    detail: state === "final" ? (status === "AOT" ? "Final/OT" : status === "AET" ? "AET" : status === "PEN" || status === "AP" ? "Pens" : "Final") : state === "live" ? status : "",
    note: ev.strGroup || "",
    venue: ev.strVenue || "",
    broadcasts: [],
    home,
    away,
  };
}

export function parseEvents(json, leagueKey) {
  if (!json || !("events" in json)) throw new Error("TheSportsDB: unexpected events shape");
  return (Array.isArray(json.events) ? json.events : []).map((e) => parseEvent(e, leagueKey)).filter(Boolean);
}

const nextDay = (dateKey) => { const d = new Date(`${dateKey}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// TheSportsDB files events under their UTC date, so an evening game in the U.S.
// is on tomorrow's list. A "day" here runs 09:00 UTC to 09:00 UTC, which keeps a
// North American evening and a European afternoon on the day a viewer expects.
export function inSportsDay(startIso, dateKey) {
  const t = Date.parse(startIso);
  const from = Date.parse(`${dateKey}T09:00:00Z`);
  return t >= from && t < from + 86_400_000;
}

export const thesportsdb = {
  id: "thesportsdb",
  label: "TheSportsDB",
  live: false,
  enabled: (env = process.env) => !!String(env.THESPORTSDB_KEY || "").trim(),
  supports: (leagueKey) => !!LEAGUE_IDS[leagueKey],

  async scoreboard(leagueKey, dateKey, { fetchJson, env = process.env }) {
    const key = encodeURIComponent(String(env.THESPORTSDB_KEY || "").trim());
    const url = (d) => `${BASE}/${key}/eventsday.php?d=${d}&l=${LEAGUE_IDS[leagueKey]}`;
    const [a, b] = await Promise.all([fetchJson(url(dateKey)), fetchJson(url(nextDay(dateKey)))]);
    return [...parseEvents(a, leagueKey), ...parseEvents(b, leagueKey)].filter((g) => inSportsDay(g.start, dateKey));
  },
  // teams() and teamGames() are not offered: the view falls back to following a
  // team from one of its games and hides the "next game" line.
};

export const _test = { LEAGUE_IDS, stateOf };
