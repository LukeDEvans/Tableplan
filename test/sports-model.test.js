// The app's own sports model (sports-model.js, SPORTS_SCORES_DESIGN.md): the
// canonical game shape, team identity across providers, per-user preferences,
// and how a day's games are arranged for the Scores view.
import { describe, it, expect } from "vitest";
import {
  LEAGUES, LEAGUE_BY_KEY, cleanTeam, cleanGame, cleanGames, sameTeam, compareGames, normName,
  normalizeSportsPrefs, isLeagueOn, enabledLeagueKeys, leaguesToRequest, addFavorite, removeFavorite,
  isFavorite, setLeagueOn, moveLeague, arrangeScores, shiftDateKey, dateStrip, dayLabel, isDateKey,
  formatStart, statusText, resultLine, fixtureLine, nextRefreshMs, scoreboardCacheSeconds, LIVE_POLL_MS, MAX_FAVORITE_TEAMS,
  cleanStandings, standingsColumns, standingsLegend, orderStandingsGroups, arrangeTeamSchedule, teamRecordFrom, STANDING_STAT_KEYS
} from "../sports-model.js";
import { seasonRow, teamRef, scheduleToken } from "../scores-ui.js";

const team = (name, extra = {}) => ({ name, short: extra.short || name, abbr: extra.abbr || name.slice(0, 3), refs: extra.refs || {}, ...extra });
const game = (id, league, home, away, extra = {}) => ({
  id, league, start: "2026-10-07T23:30:00Z", state: "pre",
  home: { team: team(home), ...(extra.homeSide || {}) }, away: { team: team(away), ...(extra.awaySide || {}) }, ...extra
});

describe("league catalog", () => {
  it("keys are unique and every league has what the view needs", () => {
    expect(new Set(LEAGUES.map((l) => l.key)).size).toBe(LEAGUES.length);
    for (const l of LEAGUES) expect(l.label && l.short && l.sport && l.scope && l.group, l.key).toBeTruthy();
  });
  it("the leagues Luke follows are on by default", () => {
    for (const k of ["nfl", "nba", "nhl", "mls", "eredivisie", "ncaaf", "ncaam", "ncaah", "nations-league", "world-cup"]) {
      expect(LEAGUE_BY_KEY[k].on, k).toBe(true);
    }
    expect(LEAGUE_BY_KEY["premier-league"].on).toBe(false);
    expect(LEAGUE_BY_KEY["conference-league"]).toMatchObject({ on: true, sport: "soccer", scope: "soccer" });
  });
});

describe("cleanTeam / cleanGame", () => {
  it("keeps only https images and 6-digit colors, and builds a provider-free key", () => {
    const t = cleanTeam({ name: "Ajax Amsterdam", short: "Ajax", abbr: "aja", logo: "http://x/a.png", logoDark: "https://x/d.png", color: "D2122E", refs: { espn: 139, "BAD KEY": 1 } }, "soccer");
    expect(t).toMatchObject({ key: "soccer:ajax-amsterdam", scope: "soccer", abbr: "AJA", logo: "", logoDark: "https://x/d.png", color: "#d2122e", refs: { espn: "139" } });
    expect(cleanTeam({ name: "" }, "nfl")).toBeNull();
  });
  it("drops a game with an unknown league, no id, a bad date or a missing side", () => {
    expect(cleanGame(game("a", "nfl", "A", "B"))).not.toBeNull();
    expect(cleanGame(game("a", "cricket", "A", "B"))).toBeNull();
    expect(cleanGame(game("", "nfl", "A", "B"))).toBeNull();
    expect(cleanGame({ ...game("a", "nfl", "A", "B"), start: "soon" })).toBeNull();
    expect(cleanGame({ ...game("a", "nfl", "A", "B"), away: {} })).toBeNull();
  });
  it("a game that hasn't started, or was called off, carries no score", () => {
    const pre = cleanGame(game("a", "nhl", "A", "B", { homeSide: { score: "0", winner: true }, awaySide: { score: "0" } }));
    expect(pre.home.score).toBeNull();
    expect(pre.home.winner).toBe(false);
    const off = cleanGame(game("b", "nhl", "A", "B", { state: "postponed", homeSide: { score: "0" } }));
    expect(off.home.score).toBeNull();
    const fin = cleanGame(game("c", "nhl", "A", "B", { state: "final", detail: "Final/OT", homeSide: { score: "4", winner: true }, awaySide: { score: 3 } }));
    expect([fin.home.score, fin.away.score, fin.home.winner, fin.detail, fin.sport]).toEqual([4, 3, true, "Final/OT", "hockey"]);
  });
  it("refuses a non-https game link and caps broadcasts", () => {
    const g = cleanGame(game("a", "nfl", "A", "B", { link: "javascript:alert(1)", broadcasts: ["FOX", "", "CBS", "NBC", "ESPN", "ABC"] }));
    expect(g.link).toBe("");
    expect(g.broadcasts).toEqual(["FOX", "CBS", "NBC", "ESPN"]);
  });
  it("cleanGames drops duplicates by id", () => {
    expect(cleanGames([game("a", "nfl", "A", "B"), game("a", "nfl", "A", "B"), null]).length).toBe(1);
  });
});

describe("sameTeam — a favorite outlives its provider", () => {
  const ajaxEspn = cleanTeam({ name: "Ajax Amsterdam", short: "Ajax", refs: { espn: "139" } }, "soccer");
  it("the provider's id decides when both sides have one", () => {
    expect(sameTeam(ajaxEspn, cleanTeam({ name: "AFC Ajax", refs: { espn: "139" } }, "soccer"))).toBe(true);
    // Two schools with the same short name are different teams.
    const miamiFl = cleanTeam({ name: "Miami Hurricanes", short: "Miami", refs: { espn: "2390" } }, "college");
    const miamiOh = cleanTeam({ name: "Miami RedHawks", short: "Miami", refs: { espn: "193" } }, "college");
    expect(sameTeam(miamiFl, miamiOh)).toBe(false);
  });
  it("falls back to the name when the other side comes from a different provider", () => {
    expect(sameTeam(ajaxEspn, cleanTeam({ name: "Ajax", refs: { thesportsdb: "133772" } }, "soccer"))).toBe(true);
    expect(sameTeam(ajaxEspn, cleanTeam({ name: "PSV Eindhoven", refs: { thesportsdb: "1" } }, "soccer"))).toBe(false);
  });
  it("never matches across scopes (the NHL Jets are not the NFL Jets)", () => {
    expect(sameTeam(cleanTeam({ name: "Jets" }, "nhl"), cleanTeam({ name: "Jets" }, "nfl"))).toBe(false);
  });
  it("names compare without accents, case or punctuation", () => {
    expect(normName("São Paulo F.C.")).toBe("sao paulo f c");
    expect(sameTeam(cleanTeam({ name: "Türkiye" }, "soccer"), cleanTeam({ name: "turkiye" }, "soccer"))).toBe(true);
  });
});

describe("preferences", () => {
  it("defaults: nothing chosen means the catalog defaults, ranked college teams, no favorites", () => {
    const p = normalizeSportsPrefs(undefined);
    expect(p).toEqual({ teams: [], leagues: {}, leagueOrder: [], collegeScope: "ranked" });
    expect(isLeagueOn(p, "nfl")).toBe(true);
    expect(isLeagueOn(p, "mlb")).toBe(false);
  });
  it("drops junk and duplicate teams, unknown leagues", () => {
    const p = normalizeSportsPrefs({
      teams: [{ name: "Minnesota Vikings", scope: "nfl", league: "nfl", refs: { espn: "16" } }, { name: "Minnesota Vikings", scope: "nfl", refs: { espn: "16" } }, { scope: "nfl" }, null],
      leagues: { nfl: false, bogus: true, nba: "yes" }, leagueOrder: ["nhl", "bogus", "nhl"], collegeScope: "everything"
    });
    expect(p.teams.map((t) => t.key)).toEqual(["nfl:minnesota-vikings"]);
    expect(p.leagues).toEqual({ nfl: false });
    expect(p.leagueOrder).toEqual(["nhl"]);
    expect(p.collegeScope).toBe("ranked");
  });
  it("a favorite's home league is kept only when it fits the team's scope", () => {
    expect(normalizeSportsPrefs({ teams: [{ name: "Netherlands", scope: "soccer", league: "nfl" }] }).teams[0].league).toBe("");
  });
  it("add / remove a favorite; adding twice is a no-op; the list is capped", () => {
    const vikings = cleanTeam({ name: "Minnesota Vikings", refs: { espn: "16" } }, "nfl");
    let p = addFavorite(undefined, vikings, "nfl", "2026-10-07T00:00:00Z");
    p = addFavorite(p, vikings, "nfl");
    expect(p.teams).toHaveLength(1);
    expect(p.teams[0]).toMatchObject({ league: "nfl", addedAt: "2026-10-07T00:00:00Z" });
    expect(isFavorite(p, vikings)).toBe(true);
    expect(removeFavorite(p, vikings).teams).toEqual([]);
    let many = normalizeSportsPrefs();
    for (let i = 0; i < MAX_FAVORITE_TEAMS + 5; i++) many = addFavorite(many, cleanTeam({ name: `Team ${i}` }, "soccer"), "mls");
    expect(many.teams).toHaveLength(MAX_FAVORITE_TEAMS);
  });
  it("switching a league records only that choice; ordering moves among the leagues that are on", () => {
    let p = setLeagueOn(undefined, "mlb", true);
    expect(p.leagues).toEqual({ mlb: true });
    expect(enabledLeagueKeys(p)).toContain("mlb");
    p = setLeagueOn(p, "nba", false);
    expect(enabledLeagueKeys(p).slice(0, 3)).toEqual(["nfl", "nhl", "mls"]);
    p = moveLeague(p, "nhl", -1);
    expect(enabledLeagueKeys(p).slice(0, 3)).toEqual(["nhl", "nfl", "mls"]);
    expect(enabledLeagueKeys(moveLeague(p, "nhl", -1))[0]).toBe("nhl"); // already first
  });
  it("a favorite's home league is requested even when that league is switched off", () => {
    const p = addFavorite(setLeagueOn(undefined, "premier-league", false), cleanTeam({ name: "Arsenal" }, "soccer"), "premier-league");
    expect(enabledLeagueKeys(p)).not.toContain("premier-league");
    expect(leaguesToRequest(p)).toContain("premier-league");
  });
});

describe("arrangeScores", () => {
  const games = cleanGames([
    game("nfl1", "nfl", "Minnesota Vikings", "Chicago Bears", { start: "2026-10-11T17:00:00Z" }),
    game("nfl2", "nfl", "Dallas Cowboys", "New York Giants", { state: "final", start: "2026-10-11T17:00:00Z", homeSide: { score: 20 }, awaySide: { score: 17 } }),
    game("nfl3", "nfl", "Buffalo Bills", "Miami Dolphins", { state: "live", detail: "4:10 - 2nd", start: "2026-10-11T20:25:00Z", homeSide: { score: 7 }, awaySide: { score: 3 } }),
    game("cfb1", "ncaaf", "Georgia Bulldogs", "Vanderbilt Commodores", { homeSide: { rank: 2 } }),
    game("cfb2", "ncaaf", "Minnesota Golden Gophers", "Rutgers Scarlet Knights"),
    game("cfb3", "ncaaf", "Akron Zips", "Kent State Golden Flashes"),
    game("mlb1", "mlb", "Minnesota Twins", "Detroit Tigers"),
  ]);
  const prefs = addFavorite(addFavorite(undefined, cleanTeam({ name: "Minnesota Vikings" }, "nfl"), "nfl"), cleanTeam({ name: "Netherlands" }, "soccer"), "nations-league");

  it("live games lead a league, then upcoming, then finished", () => {
    const nfl = arrangeScores(games, prefs).sections.find((s) => s.league.key === "nfl");
    expect(nfl.games.map((t) => t.game.id)).toEqual(["nfl3", "nfl1", "nfl2"]);
    expect(nfl.live).toBe(1);
  });
  it("My Teams holds every game with a favorite; a favorite with no game is idle", () => {
    const a = arrangeScores(games, prefs);
    expect(a.myTeams.map((t) => t.game.id)).toEqual(["nfl1"]);
    expect(a.myTeams[0].fav).toEqual({ home: true, away: false });
    expect(a.idle.map((t) => t.name)).toEqual(["Netherlands"]);
    expect(a.liveCount).toBe(1);
  });
  it("college leagues show ranked teams and favorites, and count what's left out", () => {
    const base = arrangeScores(games, prefs).sections.find((s) => s.league.key === "ncaaf");
    expect(base.games.map((t) => t.game.id)).toEqual(["cfb1"]);
    expect(base.hidden).toBe(2);
    const withGophers = addFavorite(prefs, cleanTeam({ name: "Minnesota Golden Gophers" }, "college"), "ncaaf");
    expect(arrangeScores(games, withGophers).sections.find((s) => s.league.key === "ncaaf").games.map((t) => t.game.id).sort()).toEqual(["cfb1", "cfb2"]);
    const all = arrangeScores(games, { ...prefs, collegeScope: "all" }).sections.find((s) => s.league.key === "ncaaf");
    expect(all.games).toHaveLength(3);
    expect(all.hidden).toBe(0);
    const forNow = arrangeScores(games, prefs, { showAll: ["ncaaf"] }).sections.find((s) => s.league.key === "ncaaf");
    expect([forNow.games.length, forNow.hidden]).toEqual([3, 0]);
  });
  it("a league that is switched off has no section; leagues follow the user's order", () => {
    const a = arrangeScores(games, prefs);
    expect(a.sections.map((s) => s.league.key)).toEqual(["nfl", "ncaaf"]);
    const reordered = arrangeScores(games, { ...prefs, leagueOrder: ["ncaaf"], leagues: { mlb: true } });
    expect(reordered.sections.map((s) => s.league.key)).toEqual(["ncaaf", "nfl", "mlb"]);
  });
  it("compareGames is a total order", () => {
    const sorted = [...games].sort(compareGames).map((g) => g.id);
    expect(sorted[0]).toBe("nfl3");
    expect(sorted.at(-1)).toBe("nfl2");
  });
});

describe("dates and status text", () => {
  it("date keys shift across month ends and build the strip", () => {
    expect(shiftDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(dateStrip("2026-10-07", 1, 2)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(isDateKey("2026-10-07")).toBe(true);
    expect(isDateKey("2026-13-40")).toBe(false);
    expect(isDateKey("20261007")).toBe(false);
  });
  it("labels a day relative to today", () => {
    expect(dayLabel("2026-10-07", "2026-10-07")).toEqual({ dow: "Today", date: "Oct 7", long: "Today" });
    expect(dayLabel("2026-10-06", "2026-10-07").long).toBe("Yesterday");
    expect(dayLabel("2026-10-11", "2026-10-07")).toEqual({ dow: "Sun", date: "Oct 11", long: "Sun, Oct 11" });
  });
  const fmt = { now: new Date("2026-10-07T20:00:00Z"), timeZone: "America/Chicago", locale: "en-US" };
  it("a start today is a time; another day carries the date", () => {
    expect(formatStart("2026-10-07T23:30:00Z", fmt)).toBe("6:30 PM");
    expect(formatStart("2026-10-11T17:00:00Z", fmt)).toBe("Sun, Oct 11, 12:00 PM");
    // 02:00 UTC is still the 7th in Chicago.
    expect(formatStart("2026-10-08T02:00:00Z", fmt)).toBe("9:00 PM");
    expect(formatStart("nope", fmt)).toBe("");
  });
  it("statusText covers every state", () => {
    const g = (state, detail = "") => cleanGame(game("x", "nhl", "A", "B", { state, detail }));
    expect(statusText(g("pre"), fmt)).toBe("6:30 PM");
    expect(statusText(g("pre", "TBD"), fmt)).toBe("TBD");
    expect(statusText(g("live", "5:32 - 3rd"), fmt)).toBe("5:32 - 3rd");
    expect(statusText(g("live"), fmt)).toBe("Live");
    expect(statusText(g("final"), fmt)).toBe("Final");
    expect(statusText(g("final", "Final/OT"), fmt)).toBe("Final/OT");
    expect(statusText(g("postponed"), fmt)).toBe("Postponed");
    expect(statusText(g("canceled"), fmt)).toBe("Canceled");
    expect(statusText(g("delayed"), fmt)).toBe("Delayed");
  });
  it("result and fixture lines read from the favorite's side", () => {
    const vikings = cleanTeam({ name: "Minnesota Vikings", abbr: "MIN" }, "nfl");
    const won = cleanGame({ ...game("a", "nfl", "Minnesota Vikings", "Green Bay Packers", { state: "final" }), home: { team: team("Minnesota Vikings", { abbr: "MIN" }), score: 39, winner: true }, away: { team: team("Green Bay Packers", { abbr: "GB" }), score: 22 } });
    expect(resultLine(won, vikings)).toBe("W 39–22 vs GB");
    const lost = cleanGame({ ...game("b", "nfl", "Chicago Bears", "Minnesota Vikings", { state: "final" }), home: { team: team("Chicago Bears", { abbr: "CHI" }), score: 24 }, away: { team: team("Minnesota Vikings", { abbr: "MIN" }), score: 10 } });
    expect(resultLine(lost, vikings)).toBe("L 10–24 at CHI");
    const next = cleanGame({ ...game("c", "nfl", "Chicago Bears", "Minnesota Vikings"), start: "2026-10-18T17:00:00Z", home: { team: team("Chicago Bears", { abbr: "CHI" }) }, away: { team: team("Minnesota Vikings", { abbr: "MIN" }) } });
    expect(fixtureLine(next, vikings, fmt)).toBe("at CHI · Sun, Oct 18, 12:00 PM");
    expect(resultLine(next, vikings)).toBe("");
  });
});

describe("refresh timing", () => {
  const NOW = Date.parse("2026-10-07T20:00:00Z");
  const at = (mins, state = "pre") => cleanGame(game(`g${mins}${state}`, "nba", "A", "B", { state, start: new Date(NOW + mins * 60_000).toISOString() }));
  it("polls while a game is live, or should have started", () => {
    expect(nextRefreshMs([at(-30, "live")], NOW)).toBe(LIVE_POLL_MS);
    expect(nextRefreshMs([at(-5)], NOW)).toBe(LIVE_POLL_MS);
  });
  it("waits for the next kick-off when it is within half an hour", () => {
    expect(nextRefreshMs([at(10), at(25)], NOW)).toBe(10 * 60_000 + 5_000);
  });
  it("does not refresh for a finished day, a far-off game or a stale 'not started'", () => {
    expect(nextRefreshMs([at(-200, "final"), at(120), at(-90)], NOW)).toBeNull();
    expect(nextRefreshMs([], NOW)).toBeNull();
  });
  it("cache: seconds while live, a minute near a start, hours once a day is settled", () => {
    expect(scoreboardCacheSeconds([at(-30, "live")], "2026-10-07", NOW)).toBe(20);
    expect(scoreboardCacheSeconds([at(60)], "2026-10-07", NOW)).toBe(60);
    expect(scoreboardCacheSeconds([at(-200, "final")], "2026-10-07", NOW)).toBe(300);
    expect(scoreboardCacheSeconds([at(-200, "final")], "2026-10-01", NOW)).toBe(6 * 3600);
    expect(scoreboardCacheSeconds([], "2026-10-12", NOW)).toBe(300);
  });
});

describe("league tables", () => {
  const row = (name, rank, stats, note) => ({ team: { name, refs: { espn: String(rank) } }, rank, stats, note });
  const raw = { league: "eredivisie", season: "2026-27", groups: [
    { name: "", rows: [
      row("AZ Alkmaar", 1, { pts: "15", gp: "5", gd: "+11", bogus: "x", w: "-" }, { text: "Champions League", color: "81D6AC" }),
      row("Ajax Amsterdam", 2, { pts: "12" }, { text: "Champions League", color: "#81d6ac" }),
      row("PEC Zwolle", 17, { pts: "2" }, { text: "Relegation", color: "#FF7F84" }),
      { team: {}, rank: 3, stats: {} },
    ] },
    { name: "Empty", rows: [] },
  ] };
  it("keeps only the app's stat keys, drops unusable rows and empty groups", () => {
    const t = cleanStandings(raw);
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0].rows.map((r) => r.team.name)).toEqual(["AZ Alkmaar", "Ajax Amsterdam", "PEC Zwolle"]);
    expect(t.groups[0].rows[0].stats).toEqual({ pts: "15", gp: "5", gd: "+11", w: "–" });
    expect(t.groups[0].rows[0].note).toEqual({ text: "Champions League", color: "#81d6ac" });
    expect(cleanStandings({ league: "cricket", groups: [] })).toBeNull();
    for (const k of Object.keys(t.groups[0].rows[0].stats)) expect(STANDING_STAT_KEYS).toContain(k);
  });
  it("the legend lists each note once, in table order", () => {
    expect(standingsLegend(cleanStandings(raw))).toEqual([{ text: "Champions League", color: "#81d6ac" }, { text: "Relegation", color: "#ff7f84" }]);
  });
  it("columns by sport; college shows conference and overall records; the phone set is short", () => {
    const keys = (l, wide) => standingsColumns(l).filter((c) => wide || !c.wide).map((c) => c.label);
    expect(keys("eredivisie")).toEqual(["GP", "W-D-L", "GD", "PTS"]);
    expect(keys("nhl")).toEqual(["GP", "W", "L", "OTL", "PTS"]);
    expect(keys("nfl")).toEqual(["W", "L", "PCT", "STRK"]);
    expect(keys("nba")).toEqual(["W", "L", "PCT", "GB"]);
    expect(keys("ncaaf")).toEqual(["CONF", "OVR"]);
    expect(keys("conference-league", true)).toContain("GF");
    expect(standingsColumns("cricket")).toEqual([]);
  });
  it("groups with a favorite come first", () => {
    const t = cleanStandings({ league: "nfl", groups: [
      { name: "AFC East", rows: [row("Buffalo Bills", 1, {})] },
      { name: "NFC North", rows: [row("Minnesota Vikings", 1, {})] },
    ] });
    const prefs = addFavorite(undefined, cleanTeam({ name: "Minnesota Vikings" }, "nfl"), "nfl");
    expect(orderStandingsGroups(t, prefs).map((g) => g.name)).toEqual(["NFC North", "AFC East"]);
    expect(orderStandingsGroups(t, undefined).map((g) => g.name)).toEqual(["AFC East", "NFC North"]);
  });
});

describe("a team's season", () => {
  const NOW = Date.parse("2026-10-15T12:00:00Z");
  const ID = { "Ajax Amsterdam": "139", "PSV Eindhoven": "148", "Hajduk Split": "4009" };
  const g = (id, start, state, hs, as, home = "Ajax Amsterdam", away = "PSV Eindhoven", league = "eredivisie") => cleanGame({
    id, league, start, state, home: { team: { name: home, refs: { espn: ID[home] } }, score: hs, winner: state === "final" && hs > as }, away: { team: { name: away, refs: { espn: ID[away] } }, score: as, winner: state === "final" && as > hs }
  });
  const games = [
    g("c", "2026-10-22T19:00:00Z", "pre"), g("a", "2026-09-19T18:00:00Z", "final", 2, 2),
    g("b", "2026-10-15T16:45:00Z", "final", 0, 2, "Hajduk Split", "Ajax Amsterdam", "conference-league"),
    g("d", "2026-10-01T18:00:00Z", "pre"), // never updated: in the past
  ];
  it("orders by date, splits played from upcoming, groups by month", () => {
    const s = arrangeTeamSchedule(games, { now: NOW, timeZone: "UTC" });
    expect(s.results.map((x) => x.id)).toEqual(["a", "d", "b"]);
    expect(s.upcoming.map((x) => x.id)).toEqual(["c"]);
    expect(s.next.id).toBe("c");
    expect(s.months.map((m) => [m.label, m.games.length])).toEqual([["September 2026", 1], ["October 2026", 3]]);
  });
  it("record from the team's side; soccer as W-D-L", () => {
    const ajax = cleanTeam({ name: "Ajax Amsterdam", refs: { espn: "139" } }, "soccer");
    expect(teamRecordFrom(games, ajax)).toBe("1-1-0");
    expect(teamRecordFrom([], ajax)).toBe("");
  });
  it("a row from the team's side: opponent, venue, result", () => {
    const ajax = cleanTeam({ name: "Ajax Amsterdam", refs: { espn: "139" } }, "soccer");
    expect(seasonRow(games[2], ajax)).toMatchObject({ home: false, outcome: "W", score: "2–0", opponent: { name: "Hajduk Split" } });
    expect(seasonRow(games[1], ajax)).toMatchObject({ home: true, outcome: "D", score: "2–2" });
    expect(seasonRow(games[0], ajax)).toMatchObject({ outcome: "", score: "" });
  });
  it("team and schedule tokens", () => {
    expect(teamRef({ refs: { espn: "16" } })).toBe("espn:16");
    expect(teamRef({ refs: {} })).toBe("");
    expect(scheduleToken({ league: "nfl", refs: { espn: "16" } })).toBe("nfl:espn:16");
    expect(scheduleToken({ refs: { espn: "16" } })).toBe("");
  });
});
