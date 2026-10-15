// The scores function and its data providers (SPORTS_SCORES_DESIGN.md §4).
//
// The CONTRACT block is the checklist for any provider: whatever it returns for
// a scoreboard must come out of cleanGames() as complete games in the app's own
// shape. A new adapter joins by adding a row to CONTRACT_CASES with a fixture of
// its real response.
import { describe, it, expect } from "vitest";
import { cleanGames, GAME_STATES, LEAGUE_BY_KEY, LEAGUES } from "../sports-model.js";
import { espn, parseScoreboard, parseTeams, parseSchedule, parseStandings, parseAllSchedule, espnSeason, _test as espnTest } from "../netlify/functions/_scores-espn.mjs";
import { thesportsdb, parseEvents, inSportsDay, _test as tsdbTest } from "../netlify/functions/_scores-thesportsdb.mjs";
import { PROVIDERS, providerChain, leagueScoreboard, leagueTeams, teamLastNext, leagueStandings, teamSeason } from "../netlify/functions/_scores-providers.mjs";
import { handler, parseLeagues, parseScheduleTeams } from "../netlify/functions/scores.mjs";
import {
  ESPN_SOCCER_SCOREBOARD, ESPN_NHL_SCOREBOARD, ESPN_NCAAF_SCOREBOARD, ESPN_NFL_SCHEDULE, ESPN_TEAMS, TSDB_EVENTSDAY, TSDB_EVENTSDAY_NEXT,
  ESPN_NFL_STANDINGS, ESPN_SOCCER_STANDINGS, ESPN_NCAAF_STANDINGS, ESPN_NBA_STANDINGS, ESPN_AJAX_RESULTS, ESPN_AJAX_FIXTURES
} from "./_scores-fixtures.js";
import { cleanStandings } from "../sports-model.js";

const CONTRACT_CASES = [
  ["espn soccer", () => parseScoreboard(ESPN_SOCCER_SCOREBOARD, "nations-league"), 4],
  ["espn hockey", () => parseScoreboard(ESPN_NHL_SCOREBOARD, "nhl"), 3],
  ["espn college football", () => parseScoreboard(ESPN_NCAAF_SCOREBOARD, "ncaaf"), 3],
  ["espn team schedule", () => parseSchedule(ESPN_NFL_SCHEDULE, "nfl"), 3],
  ["thesportsdb", () => parseEvents(TSDB_EVENTSDAY, "nfl"), 2],
  ["espn soccer, every competition", () => [...parseAllSchedule(ESPN_AJAX_RESULTS), ...parseAllSchedule(ESPN_AJAX_FIXTURES)], 4],
];

describe.each(CONTRACT_CASES)("provider contract: %s", (_name, parse, count) => {
  const games = cleanGames(parse());
  it("every event survives validation", () => expect(games).toHaveLength(count));
  it("each game is complete in the app's own shape", () => {
    for (const g of games) {
      expect(g.id).toMatch(/^[a-z0-9-]+:.+/); // provider-scoped id
      expect(LEAGUE_BY_KEY[g.league]).toBeTruthy();
      expect(GAME_STATES).toContain(g.state);
      expect(new Date(g.start).toISOString()).toBe(g.start);
      for (const side of [g.home, g.away]) {
        expect(side.team.name).toBeTruthy();
        expect(side.team.key.startsWith(`${LEAGUE_BY_KEY[g.league].scope}:`)).toBe(true);
        expect(Object.keys(side.team.refs).length).toBeGreaterThan(0);
        if (g.state === "pre") expect(side.score).toBeNull();
        if (g.state === "final" || g.state === "live") expect(Number.isInteger(side.score)).toBe(true);
        if (side.team.logo) expect(side.team.logo.startsWith("https://")).toBe(true);
      }
    }
  });
  it("carries nothing but the model's fields", () => {
    const keys = ["away", "broadcasts", "detail", "home", "id", "league", "link", "neutral", "note", "possession", "situation", "sport", "start", "state", "venue"];
    for (const g of games) expect(Object.keys(g).sort()).toEqual(keys);
  });
});

describe("espn adapter", () => {
  it("covers every league in the catalog", () => {
    expect(LEAGUES.filter((l) => !espn.supports(l.key)).map((l) => l.key)).toEqual([]);
    for (const k of Object.keys(espnTest.PATHS)) expect(LEAGUE_BY_KEY[k], k).toBeTruthy();
  });
  it("soccer: a live match, a scheduled one, penalties and a postponement", () => {
    const [live, pre, pens, off] = cleanGames(parseScoreboard(ESPN_SOCCER_SCOREBOARD, "nations-league"));
    expect(live).toMatchObject({ id: "espn:401861127", state: "live", detail: "39'", note: "Group C2", venue: "GSP Stadium", broadcasts: ["FS2"], link: "https://www.espn.com/soccer/match/_/gameId/401861127" });
    expect(live.home).toMatchObject({ score: 0, record: "1-1-1", team: { name: "Cyprus", abbr: "CYP", color: "#195ccd", refs: { espn: "445" }, key: "soccer:cyprus" } });
    expect(pre).toMatchObject({ state: "pre", detail: "", start: "2026-10-05T18:45:00.000Z" });
    expect(pre.home.score).toBeNull();
    expect(pens).toMatchObject({ state: "final", detail: "FT-Pens" });
    expect([pens.home.score, pens.home.pens, pens.away.pens, pens.away.winner]).toEqual([1, 3, 4, true]);
    expect(off.state).toBe("postponed");
    expect(off.home.score).toBeNull();
  });
  it("hockey: clock detail, records, a dark logo, local broadcasts de-duplicated", () => {
    const [pre, live, fin] = cleanGames(parseScoreboard(ESPN_NHL_SCOREBOARD, "nhl"));
    expect(pre.home.team).toMatchObject({ name: "Washington Capitals", short: "Capitals", abbr: "WSH", logoDark: "https://a.espncdn.com/i/teamlogos/nhl/500-dark/scoreboard/wsh.png" });
    expect(pre.away.record).toBe("2-1-0");
    expect(pre.broadcasts).toEqual(["TNT"]);
    expect(live).toMatchObject({ state: "live", detail: "5:32 - 3rd", broadcasts: ["ESPN+", "Altitude Sports"] });
    expect([live.home.score, live.away.score]).toEqual([2, 3]);
    expect(fin).toMatchObject({ state: "final", detail: "Final/OT" });
    expect(fin.home.winner).toBe(true);
  });
  it("college football: ranks (99 means unranked), and who has the ball", () => {
    const [uga, gophers, live] = cleanGames(parseScoreboard(ESPN_NCAAF_SCOREBOARD, "ncaaf"));
    expect([uga.home.rank, uga.away.rank]).toEqual([2, null]);
    expect(uga.home.team.key).toBe("college:georgia-bulldogs");
    expect(gophers.home.rank).toBeNull();
    expect(live).toMatchObject({ situation: "2nd & 7", possession: "home" });
  });
  it("team schedule: object scores, logos from the list, the TV channel", () => {
    const [done, next] = cleanGames(parseSchedule(ESPN_NFL_SCHEDULE, "nfl"));
    expect([done.home.score, done.away.score, done.home.winner]).toEqual([39, 22, true]);
    expect(done.home.team.logo).toBe("https://a.espncdn.com/i/teamlogos/nfl/500/min.png");
    expect(done.home.team.logoDark).toBe("https://a.espncdn.com/i/teamlogos/nfl/500-dark/min.png");
    expect(done.broadcasts).toEqual(["CBS"]);
    expect(next.state).toBe("pre");
    expect(next.home.score).toBeNull();
  });
  it("names the season ESPN would otherwise get wrong", () => {
    expect(espnSeason("nhl", "2026-10-15")).toBe(2027);   // 2026-27 is "2027"
    expect(espnSeason("nhl", "2027-04-20")).toBe(2027);
    expect(espnSeason("nhl", "2027-08-01")).toBe(2027);   // off-season: the last one
    expect(espnSeason("nba", "2026-10-15")).toBe(2027);
    expect(espnSeason("nfl", "2026-10-15")).toBe(2026);
    expect(espnSeason("nfl", "2027-01-20")).toBe(2026);   // playoffs
    expect(espnSeason("mls", "2026-10-15")).toBe(2026);
    expect(espnSeason("eredivisie", "2026-10-15")).toBe(2026);
    expect(espnSeason("conference-league", "2027-03-10")).toBe(2026);
    expect(espnSeason("nations-league", "2026-10-15")).toBeNull(); // left to ESPN
    for (const k of Object.keys(espnTest.SEASON_STYLE)) expect(LEAGUE_BY_KEY[k], k).toBeTruthy();
  });
  it("tables: divisions inside conferences, named; records and streaks; ESPN's '-' kept as a dash", () => {
    const t = cleanStandings(parseStandings(ESPN_NFL_STANDINGS, "nfl"));
    expect(t.groups.map((g) => g.name)).toEqual(["AFC East", "NFC North"]);
    expect(t.season).toBe("2026");
    const bills = t.groups[0].rows[0];
    expect(bills.team).toMatchObject({ name: "Buffalo Bills", abbr: "BUF", refs: { espn: "2" } });
    expect(bills.stats).toMatchObject({ w: "3", l: "1", t: "0", pct: ".750", gb: "–", streak: "L1", gf: "127", ga: "107", gd: "+20", seed: "4", ovr: "3-1", home: "2-0" });
    expect(bills.rank).toBe(1);
  });
  it("tables: soccer notes (qualification) and computed games played", () => {
    const t = cleanStandings(parseStandings(ESPN_SOCCER_STANDINGS, "conference-league"));
    expect(t.season).toBe("2026-27 UEFA Conference League");
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0].name).toBe("League Phase");
    const [ajax, pec] = t.groups[0].rows;
    expect(ajax).toMatchObject({ rank: 1, note: { text: "Qualifies for round of 16", color: "#81d6ac" }, stats: { gp: "1", w: "1", t: "0", l: "0", gd: "+2", pts: "3", gf: "2", ga: "0", ovr: "1-0-0" } });
    expect(pec.rank).toBe(9);
    expect(pec.stats.gp).toBe("1"); // 0 + 0 + 1
  });
  it("tables: college uses the team's own figures, not the conference-only copies", () => {
    const row = cleanStandings(parseStandings(ESPN_NCAAF_STANDINGS, "ncaaf")).groups[0].rows[0];
    expect(row.stats).toMatchObject({ w: "5", streak: "W4", ovr: "5-1", conf: "2-1" });
  });
  it("tables: NBA's points-per-game isn't taken as standings points", () => {
    const row = cleanStandings(parseStandings(ESPN_NBA_STANDINGS, "nba")).groups[0].rows[0];
    expect(row.stats.pts).toBeUndefined();
    expect(row.stats.pct).toBe(".000");
  });
  it("tables: asks for the right season and split", async () => {
    const urls = [];
    const fetchJson = async (u) => { urls.push(u); return ESPN_NFL_STANDINGS; };
    for (const k of ["nfl", "nhl", "nba", "ncaaf", "eredivisie", "nations-league"]) await espn.standings(k, { fetchJson, dateKey: "2026-10-15" });
    expect(urls).toEqual([
      "https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3&season=2026&seasontype=2",
      "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings?level=3&season=2027&seasontype=2",
      "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?level=2&season=2027&seasontype=2",
      "https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&season=2026&seasontype=2",
      "https://site.api.espn.com/apis/v2/sports/soccer/ned.1/standings?season=2026",
      "https://site.api.espn.com/apis/v2/sports/soccer/uefa.nations/standings",
    ]);
    expect(() => parseStandings({ code: 404 }, "nfl")).toThrow();
  });
  it("a soccer team's season spans competitions; one ESPN doesn't map to a league is left out", () => {
    const games = cleanGames([...parseAllSchedule(ESPN_AJAX_RESULTS), ...parseAllSchedule(ESPN_AJAX_FIXTURES)]);
    expect(games.map((g) => g.league)).toEqual(["eredivisie", "conference-league", "eredivisie", "conference-league"]);
    expect(games[1]).toMatchObject({ state: "final", away: { score: 2, winner: true, team: { name: "Ajax Amsterdam" } } });
    expect(espnTest.KEY_BY_SOCCER_SLUG["uefa.europa.conf"]).toBe("conference-league");
  });
  it("team list", () => {
    const teams = parseTeams(ESPN_TEAMS);
    expect(teams.map((t) => t.name)).toEqual(["Arizona Cardinals", "Albania"]);
    expect(teams[0]).toMatchObject({ short: "Cardinals", abbr: "ARI", refs: { espn: "22" }, logo: "https://a.espncdn.com/i/teamlogos/nfl/500/ari.png", logoDark: "https://a.espncdn.com/i/teamlogos/nfl/500-dark/ari.png" });
  });
  it("a response that isn't a scoreboard is an error, not an empty day", () => {
    expect(() => parseScoreboard({ code: 404 }, "nfl")).toThrow();
    expect(() => parseTeams({})).toThrow();
    expect(parseScoreboard({ events: [{ id: "1" }, null, { id: "2", competitions: [{ competitors: [] }] }] }, "nfl")).toEqual([]);
  });
  it("asks for the right URLs", async () => {
    const urls = [];
    const fetchJson = async (u) => { urls.push(u); return { events: [] }; };
    await espn.scoreboard("ncaaf", "2026-10-03", { fetchJson });
    await espn.scoreboard("eredivisie", "2026-10-03", { fetchJson });
    await espn.teamGames("nfl", "16", { fetchJson, dateKey: "2026-10-15" });
    await espn.teamGames("eredivisie", "139", { fetchJson, dateKey: "2026-10-15" });
    await espn.teamGames("nhl", "30", { fetchJson, dateKey: "2026-10-15" });
    await espn.scoreboard("conference-league", "2026-10-15", { fetchJson });
    expect(urls).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261003&groups=80&limit=300",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/ned.1/scoreboard?dates=20261003",
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/16/schedule?season=2026&seasontype=2",
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/16/schedule?season=2026&seasontype=3",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/139/schedule",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/139/schedule?fixture=true",
      "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/30/schedule?season=2027&seasontype=2",
      "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/30/schedule?season=2027&seasontype=3",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.europa.conf/scoreboard?dates=20261015",
    ]);
    await expect(espn.teamGames("nfl", "16/../x", { fetchJson })).rejects.toThrow();
  });
});

describe("thesportsdb adapter (standby)", () => {
  it("is off without a key", () => {
    expect(thesportsdb.enabled({})).toBe(false);
    expect(thesportsdb.enabled({ THESPORTSDB_KEY: "abc" })).toBe(true);
    for (const k of Object.keys(tsdbTest.LEAGUE_IDS)) expect(LEAGUE_BY_KEY[k], k).toBeTruthy();
  });
  it("final score with a winner; a UTC timestamp without a zone", () => {
    const [fin, pre] = cleanGames(parseEvents(TSDB_EVENTSDAY, "nfl"));
    expect(fin).toMatchObject({ id: "thesportsdb:2475423", state: "final", detail: "Final", start: "2026-10-04T13:30:00.000Z", venue: "Tottenham Hotspur Stadium" });
    expect([fin.home.score, fin.away.score, fin.away.winner]).toEqual([13, 30, true]);
    expect(fin.home.team).toMatchObject({ name: "Washington Commanders", refs: { thesportsdb: "134937" } });
    expect(pre.state).toBe("pre");
  });
  it("a day runs 09:00 UTC to 09:00 UTC, so a U.S. evening game stays on its day", async () => {
    expect(inSportsDay("2026-10-05T00:20:00Z", "2026-10-04")).toBe(true);
    expect(inSportsDay("2026-10-04T08:00:00Z", "2026-10-04")).toBe(false);
    const urls = [];
    const fetchJson = async (u) => { urls.push(u); return u.includes("d=2026-10-05") ? TSDB_EVENTSDAY_NEXT : TSDB_EVENTSDAY; };
    const games = cleanGames(await thesportsdb.scoreboard("nfl", "2026-10-04", { fetchJson, env: { THESPORTSDB_KEY: "k e y" } }));
    expect(games.map((g) => g.id)).toEqual(["thesportsdb:2475423", "thesportsdb:2475430", "thesportsdb:2475440"]);
    expect(urls[0]).toBe("https://www.thesportsdb.com/api/v1/json/k%20e%20y/eventsday.php?d=2026-10-04&l=4391");
  });
  it("a null events list is an empty day; a different shape is an error", () => {
    expect(parseEvents({ events: null }, "nfl")).toEqual([]);
    expect(() => parseEvents({ message: "nope" }, "nfl")).toThrow();
  });
});

// A stand-in provider, to show the chain needs nothing ESPN-shaped.
const fake = (id, impl = {}) => ({ id, label: id, live: false, enabled: () => true, supports: () => true, scoreboard: async () => [], ...impl });
const rawGame = (id, league = "nfl") => ({ id, league, start: "2026-10-04T17:00:00Z", state: "pre", home: { team: { name: "Home", refs: { x: "1" } } }, away: { team: { name: "Away", refs: { x: "2" } } } });

describe("provider chain", () => {
  it("order comes from SCORES_PROVIDERS; a provider that isn't enabled is skipped", () => {
    expect(providerChain({}).map((p) => p.id)).toEqual(["espn"]);
    expect(providerChain({ THESPORTSDB_KEY: "k" }).map((p) => p.id)).toEqual(["espn", "thesportsdb"]);
    expect(providerChain({ THESPORTSDB_KEY: "k", SCORES_PROVIDERS: "thesportsdb, espn, nope" }).map((p) => p.id)).toEqual(["thesportsdb", "espn"]);
    expect(providerChain({ THESPORTSDB_KEY: "k", SCORES_PROVIDERS: "thesportsdb" }).map((p) => p.id)).toEqual(["thesportsdb"]);
    expect(Object.keys(PROVIDERS)).toEqual(["espn", "thesportsdb"]);
  });
  it("fails over to the next provider and says who answered", async () => {
    const chain = [fake("a", { scoreboard: async () => { throw new Error("HTTP 403 from a"); } }), fake("b", { scoreboard: async () => [rawGame("b:1")] })];
    const r = await leagueScoreboard("nfl", "2026-10-04", { chain });
    expect(r).toMatchObject({ ok: true, provider: "b", tried: [{ provider: "a", error: "HTTP 403 from a" }] });
    expect(r.games.map((g) => g.id)).toEqual(["b:1"]);
  });
  it("an empty day from the first provider is an answer, not a failure", async () => {
    let asked = 0;
    const chain = [fake("a"), fake("b", { scoreboard: async () => { asked++; return []; } })];
    expect(await leagueScoreboard("nfl", "2026-10-04", { chain })).toMatchObject({ ok: true, provider: "a", games: [] });
    expect(asked).toBe(0);
  });
  it("skips a provider that doesn't cover the league; reports when nobody does", async () => {
    const chain = [fake("a", { supports: (k) => k === "nba" }), fake("b", { scoreboard: async () => { throw new Error("down"); } })];
    expect(await leagueScoreboard("nfl", "2026-10-04", { chain })).toMatchObject({ ok: false, error: "down", games: [] });
    expect(await leagueScoreboard("nfl", "2026-10-04", { chain: [chain[0]] })).toMatchObject({ ok: false, error: "No provider covers this league." });
  });
  it("team lists come from the first provider that offers them, sorted", async () => {
    const chain = [fake("a"), fake("b", { teams: async () => [{ name: "Zwolle", refs: { b: "2" } }, { name: "Ajax", refs: { b: "1" } }, {}] })];
    const r = await leagueTeams("eredivisie", { chain });
    expect(r.provider).toBe("b");
    expect(r.teams.map((t) => t.key)).toEqual(["soccer:ajax", "soccer:zwolle"]);
    expect((await leagueTeams("eredivisie", { chain: [fake("a")] })).ok).toBe(false);
  });
  it("tables and seasons come through the chain, and fail soft", async () => {
    const chain = [fake("a"), fake("b", { standings: async () => parseStandings(ESPN_SOCCER_STANDINGS, "eredivisie") })];
    expect(await leagueStandings("eredivisie", { chain })).toMatchObject({ ok: true, provider: "b", standings: { league: "eredivisie" } });
    expect(await leagueStandings("eredivisie", { chain: [fake("a")] })).toMatchObject({ ok: false, error: "No provider has this league's table." });
    const fetchJson = async (u) => (u.includes("fixture=true") ? ESPN_AJAX_FIXTURES : ESPN_AJAX_RESULTS);
    const season = await teamSeason("eredivisie", "espn", "139", { chain: [espn], fetchJson });
    expect(season.games).toHaveLength(4);
    expect(await teamSeason("eredivisie", "thesportsdb", "1", { chain: [espn], fetchJson })).toMatchObject({ ok: false, games: [] });
  });
  it("last and next game for a team; nothing when its provider has gone", async () => {
    const fetchJson = async () => ESPN_NFL_SCHEDULE;
    const now = Date.parse("2026-10-08T03:00:00Z");
    const r = await teamLastNext("nfl", "espn", "16", { chain: [espn], fetchJson }, now);
    expect(r.last.id).toBe("espn:401872927");
    expect(r.next.id).toBe("espn:401873014");
    expect(await teamLastNext("nfl", "espn", "16", { chain: [fake("other")], fetchJson }, now)).toEqual({ ok: false, last: null, next: null });
    const down = await teamLastNext("nfl", "espn", "16", { chain: [espn], fetchJson: async () => { throw new Error("boom"); } }, now);
    expect(down).toMatchObject({ ok: false, last: null, next: null });
  });
});

describe("scores function", () => {
  const NOW = Date.parse("2026-10-07T23:45:00Z");
  const call = (params, fetchJson, env = {}) => handler({ httpMethod: "GET", headers: {}, queryStringParameters: params }, null, { fetchJson, env, now: () => NOW });
  const espnFetch = async (url) => {
    if (url.includes("/hockey/nhl/scoreboard")) return ESPN_NHL_SCOREBOARD;
    if (url.includes("/soccer/uefa.nations/scoreboard")) return ESPN_SOCCER_SCOREBOARD;
    if (url.includes("/football/nfl/teams/16/schedule")) return ESPN_NFL_SCHEDULE;
    if (url.endsWith("/teams?limit=1000")) return ESPN_TEAMS;
    if (url.includes("/scoreboard")) return { events: [] };
    throw new Error("HTTP 404 from site.api.espn.com");
  };

  it("parses its parameters strictly", () => {
    expect(parseLeagues("nfl, nba,nfl,bogus")).toEqual(["nfl", "nba"]);
    expect(parseLeagues("")).toEqual(LEAGUES.filter((l) => l.on).map((l) => l.key));
    expect(parseScheduleTeams("nfl:espn:16, eredivisie:espn:139,bogus:espn:1,nfl:espn:../x,nfl:espn")).toEqual([
      { token: "nfl:espn:16", league: "nfl", provider: "espn", ref: "16" },
      { token: "eredivisie:espn:139", league: "eredivisie", provider: "espn", ref: "139" },
    ]);
  });
  it("scoreboard: merged games, per-league status, a short cache while a game is live", async () => {
    const res = await call({ date: "2026-10-07", leagues: "nhl,nations-league,nfl" }, espnFetch);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.v).toBe(1);
    expect(body.games).toHaveLength(7);
    expect(body.leagues).toEqual({
      nhl: { ok: true, provider: "espn", live: true, count: 3 },
      "nations-league": { ok: true, provider: "espn", live: true, count: 4 },
      nfl: { ok: true, provider: "espn", live: true, count: 0 },
    });
    expect(res.headers["cache-control"]).toBe("public, max-age=20");
    expect(res.headers["netlify-cdn-cache-control"]).toContain("max-age=20");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
  it("one league failing doesn't blank the rest, and the answer isn't kept long", async () => {
    const flaky = async (url) => { if (url.includes("/nhl/")) throw new Error("Timed out reaching site.api.espn.com"); return espnFetch(url); };
    const res = await call({ date: "2026-10-01", leagues: "nhl,nfl" }, flaky);
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.leagues.nhl).toEqual({ ok: false, error: "Timed out reaching site.api.espn.com" });
    expect(body.leagues.nfl.ok).toBe(true);
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
  });
  it("everything failing is a 502 the CDN won't cache", async () => {
    const res = await call({ date: "2026-10-07", leagues: "nhl,nfl" }, async () => { throw new Error("HTTP 403 from site.api.espn.com"); });
    expect(res.statusCode).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
  it("with the standby key set, a league ESPN refuses is served by TheSportsDB", async () => {
    const fetchJson = async (url) => {
      if (url.includes("espn.com")) throw new Error("HTTP 403 from site.api.espn.com");
      return url.includes("d=2026-10-05") ? TSDB_EVENTSDAY_NEXT : TSDB_EVENTSDAY;
    };
    const res = await call({ date: "2026-10-04", leagues: "nfl" }, fetchJson, { THESPORTSDB_KEY: "k" });
    const body = JSON.parse(res.body);
    expect(body.leagues.nfl).toEqual({ ok: true, provider: "thesportsdb", live: false, count: 3 });
    expect(body.games[0].home.team.refs).toEqual({ thesportsdb: "134937" });
  });
  it("rejects a bad date, an unknown league list, an unknown action, a non-GET", async () => {
    expect((await call({ date: "10/7/2026" }, espnFetch)).statusCode).toBe(400);
    expect((await call({ leagues: "cricket" }, espnFetch)).statusCode).toBe(400);
    expect((await call({ action: "odds" }, espnFetch)).statusCode).toBe(400);
    expect((await handler({ httpMethod: "POST", headers: {} }, null, { fetchJson: espnFetch, env: {} })).statusCode).toBe(405);
  });
  it("health: says whether each provider answers, and why not; never cached", async () => {
    const ok = JSON.parse((await call({ action: "health" }, espnFetch)).body);
    expect(ok.providers).toMatchObject([{ id: "espn", ok: true, league: "nfl", games: 0 }]);
    const res = await call({ action: "health" }, async () => { throw new Error("HTTP 403 from site.api.espn.com"); }, { THESPORTSDB_KEY: "k" });
    expect(JSON.parse(res.body).providers.map((p) => [p.id, p.ok, p.error])).toEqual([["espn", false, "HTTP 403 from site.api.espn.com"], ["thesportsdb", false, "HTTP 403 from site.api.espn.com"]]);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
  it("teams: a league's list, cached for a day", async () => {
    const res = await call({ action: "teams", league: "nfl" }, espnFetch);
    const body = JSON.parse(res.body);
    expect(body.teams.map((t) => t.key)).toEqual(["nfl:albania", "nfl:arizona-cardinals"]);
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect((await call({ action: "teams", league: "nope" }, espnFetch)).statusCode).toBe(400);
  });
  it("standings: the league's table, cached ten minutes; unknown league refused", async () => {
    const fetchJson = async (u) => { if (u.includes("/standings")) return ESPN_NFL_STANDINGS; throw new Error("HTTP 404"); };
    const res = await call({ action: "standings", league: "nfl" }, fetchJson);
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ v: 1, provider: "espn", league: "nfl", season: "2026" });
    expect(body.groups[0].rows[0].stats.w).toBe("3");
    expect(res.headers["cache-control"]).toBe("public, max-age=600");
    expect((await call({ action: "standings", league: "nope" }, fetchJson)).statusCode).toBe(400);
    expect((await call({ action: "standings", league: "nfl" }, async () => { throw new Error("HTTP 500"); })).statusCode).toBe(502);
  });
  it("team: a whole season; strict team parameter", async () => {
    const fetchJson = async (u) => (u.includes("fixture=true") ? ESPN_AJAX_FIXTURES : ESPN_AJAX_RESULTS);
    const res = await call({ action: "team", league: "eredivisie", team: "espn:139" }, fetchJson);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).games).toHaveLength(4);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    for (const team of ["", "espn", "espn:1:2", "ESPN:139", "espn:../x"]) expect((await call({ action: "team", league: "eredivisie", team }, fetchJson)).statusCode, team).toBe(400);
    expect((await call({ action: "team", league: "eredivisie", team: "espn:139" }, async () => { throw new Error("HTTP 500"); })).statusCode).toBe(502);
  });
  it("schedule: last and next game per team token", async () => {
    const res = await call({ action: "schedule", teams: "nfl:espn:16,nhl:espn:30" }, espnFetch);
    const body = JSON.parse(res.body);
    expect(body.teams["nfl:espn:16"].last.id).toBe("espn:401872927");
    expect(body.teams["nfl:espn:16"].next.id).toBe("espn:401873014");
    expect(body.teams["nhl:espn:30"]).toEqual({ last: null, next: null });
    expect(res.headers["cache-control"]).toBe("public, max-age=60"); // one team failed: retry soon
    expect((await call({ action: "schedule", teams: "junk" }, espnFetch)).statusCode).toBe(400);
  });
});
