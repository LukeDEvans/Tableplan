// Scores (Luke, 2026-11-21): the league filter, the box score, the football field
// spot, and the live details the ESPN adapter keeps from the scoreboard it already
// fetches (no extra requests).
import { describe, it, expect } from "vitest";
import { filterOptions, applyGameFilter, periodLabels, boxScore, fieldSpot } from "../scores-ui.js";
import { cleanGame, cleanStandings } from "../sports-model.js";
import { parseEvent, parseStandings } from "../netlify/functions/_scores-espn.mjs";

const team = (name, abbr, id, scope = "nfl") => ({ name, short: name.split(" ").pop(), abbr, refs: { espn: id }, scope });
const VIK = team("Minnesota Vikings", "MIN", "16"), GB = team("Green Bay Packers", "GB", "9"), BUF = team("Buffalo Bills", "BUF", "2"), NE = team("New England Patriots", "NE", "17");
const game = (id, away, home, extra = {}) => cleanGame({ id, league: "nfl", start: "2026-11-22T18:00:00Z", state: "live", away: { team: away, score: 7, ...extra.away }, home: { team: home, score: 10, ...extra.home }, ...extra.game });
const TABLE = cleanStandings({ league: "nfl", groups: [
  { name: "NFC North", parent: "National Football Conference", rows: [{ team: VIK }, { team: GB }] },
  { name: "AFC East", parent: "American Football Conference", rows: [{ team: BUF }, { team: NE }] },
] });

describe("filterOptions", () => {
  it("All games first; conferences, then divisions from the table", () => {
    expect(filterOptions("nfl", TABLE).map((o) => o.id)).toEqual(["all", "c:National Football Conference", "c:American Football Conference", "g:NFC North", "g:AFC East"]);
  });
  it("college adds Top 25", () => {
    expect(filterOptions("ncaaf", null).map((o) => o.id)).toEqual(["all", "top25"]);
  });
  it("a league with one table has only All games", () => {
    expect(filterOptions("eredivisie", cleanStandings({ league: "eredivisie", groups: [{ name: "", rows: [{ team: team("AFC Ajax", "AJA", "139", "soccer") }] }] })).map((o) => o.id)).toEqual(["all"]);
  });
});

describe("applyGameFilter", () => {
  const items = [game("a", GB, VIK), game("b", NE, BUF), game("c", BUF, VIK)].map((g) => ({ game: g }));
  it("All games keeps everything", () => expect(applyGameFilter(items, "all", TABLE)).toHaveLength(3));
  it("a division keeps games with either side in it", () => {
    expect(applyGameFilter(items, "g:NFC North", TABLE).map((i) => i.game.id)).toEqual(["a", "c"]);
  });
  it("a conference keeps games with either side in any of its divisions", () => {
    expect(applyGameFilter(items, "c:American Football Conference", TABLE).map((i) => i.game.id)).toEqual(["b", "c"]);
  });
  it("Top 25 keeps games with a ranked side", () => {
    const ranked = [{ game: game("r", GB, VIK, { home: { rank: 12 } }) }, { game: game("u", NE, BUF) }];
    expect(applyGameFilter(ranked, "top25", null).map((i) => i.game.id)).toEqual(["r"]);
  });
  it("before the table arrives, a group filter keeps everything", () => {
    expect(applyGameFilter(items, "g:NFC North", null)).toHaveLength(3);
  });
});

describe("box score", () => {
  it("regulation columns always show; overtime added when played", () => {
    expect(periodLabels({ league: "nfl", sport: "football" }, 2)).toEqual(["1", "2", "3", "4"]);
    expect(periodLabels({ league: "nfl", sport: "football" }, 5)).toEqual(["1", "2", "3", "4", "OT"]);
    expect(periodLabels({ league: "ncaam", sport: "basketball" }, 3)).toEqual(["1", "2", "OT"]);
    expect(periodLabels({ league: "nhl", sport: "hockey" }, 5)).toEqual(["1", "2", "3", "OT", "SO"]);
    expect(periodLabels({ league: "mlb", sport: "baseball" }, 3)).toHaveLength(9);
    expect(periodLabels({ league: "mls", sport: "soccer" }, 2)).toEqual(["1H", "2H"]);
  });
  it("one row per side, blanks for periods not played", () => {
    const g = game("a", GB, VIK, { away: { lines: [0, 7] }, home: { lines: [3, 7] } });
    expect(boxScore(g)).toEqual({ labels: ["1", "2", "3", "4"], away: [0, 7, null, null], home: [3, 7, null, null] });
  });
  it("nothing before kick-off or without lines", () => {
    expect(boxScore(game("a", GB, VIK))).toBeNull();
  });
});

describe("fieldSpot", () => {
  const live = (spot, possession, distance = 10) => game("a", GB, VIK, { game: { possession, live: { spot, down: 1, distance } } });
  it("the away team's goal line is the left end; home territory counts back from 100", () => {
    expect(fieldSpot(live("MIN 34", "away", 7))).toEqual({ x: 66, dir: 1, firstDown: 73 });
    expect(fieldSpot(live("GB 20", "home", 10))).toEqual({ x: 20, dir: -1, firstDown: 10 });
    expect(fieldSpot(live("50", "away")).x).toBe(50);
  });
  it("no line to gain past the goal line (goal to go)", () => {
    expect(fieldSpot(live("MIN 5", "away", 5)).firstDown).toBeNull();
  });
  it("an unknown team or no possession draws nothing", () => {
    expect(fieldSpot(live("CHI 30", "away"))).toBeNull();
    expect(fieldSpot(live("MIN 30", ""))).toBeNull();
  });
});

describe("ESPN adapter: live details from the scoreboard", () => {
  const espnTeam = (id, abbr, name) => ({ id, abbreviation: abbr, displayName: name, shortDisplayName: name.split(" ").pop() });
  const event = (comp, leagueKey = "nfl") => cleanGame(parseEvent({ id: "1", date: "2026-11-22T18:00Z", competitions: [{ status: { type: { state: "in", name: "STATUS_IN_PROGRESS", shortDetail: "3rd 5:21" } }, ...comp }] }, leagueKey));
  const sides = [
    { id: "16", homeAway: "home", score: "10", linescores: [{ value: 3 }, { value: 7 }], team: espnTeam("16", "MIN", "Minnesota Vikings") },
    { id: "9", homeAway: "away", score: "7", linescores: [{ value: 0 }, { value: 7 }], team: espnTeam("9", "GB", "Green Bay Packers") },
  ];
  it("football: lines, down, distance, the spot (from the text when there's no possessionText), last play", () => {
    const g = event({ competitors: sides, situation: { down: 2, distance: 7, downDistanceText: "2nd & 7 at MIN 34", possession: "9", isRedZone: false, lastPlay: { text: "Pass for 6 yards" } } });
    expect(g.home.lines).toEqual([3, 7]);
    expect(g.live).toEqual({ down: 2, distance: 7, spot: "MIN 34", redZone: false, lastPlay: "Pass for 6 yards" });
    expect(g.possession).toBe("away");
  });
  it("baseball: count, outs, runners, batter and pitcher", () => {
    const g = event({ competitors: sides, situation: { balls: 2, strikes: 1, outs: 1, onFirst: true, onSecond: false, onThird: true, batter: { athlete: { shortName: "B. Buxton" } }, pitcher: { athlete: { shortName: "G. Cole" } } } }, "mlb");
    expect(g.live).toMatchObject({ balls: 2, strikes: 1, outs: 1, bases: [true, false, true], batter: "B. Buxton", pitcher: "G. Cole" });
  });
  it("soccer: goals and red cards, by side", () => {
    const g = event({ competitors: sides, details: [
      { scoringPlay: true, clock: { displayValue: "23'" }, team: { id: "16" }, athletesInvolved: [{ shortName: "A. Scorer" }] },
      { scoringPlay: true, penaltyKick: true, clock: { displayValue: "61'" }, team: { id: "9" }, athletesInvolved: [{ shortName: "B. Taker" }] },
      { redCard: true, clock: { displayValue: "70'" }, team: { id: "9" }, athletesInvolved: [{ shortName: "C. Off" }] },
      { yellowCard: true, clock: { displayValue: "71'" }, team: { id: "9" } },
    ] }, "mls");
    expect(g.live.events).toEqual([
      { minute: "23'", side: "home", who: "A. Scorer", kind: "goal" },
      { minute: "61'", side: "away", who: "B. Taker", kind: "pen" },
      { minute: "70'", side: "away", who: "C. Off", kind: "red" },
    ]);
  });
  it("nothing extra for a game with no situation", () => {
    expect(event({ competitors: sides }).live).toBeNull();
  });
});

describe("ESPN standings: a division knows its conference", () => {
  it("parent is the conference for divisions, empty for a conference-level table", () => {
    const row = (id) => ({ team: { id, displayName: `Team ${id}`, abbreviation: `T${id}` }, stats: [] });
    const nfl = parseStandings({ name: "National Football League", children: [
      { name: "American Football Conference", children: [{ name: "AFC East", standings: { entries: [row("2")] } }] },
    ] }, "nfl");
    expect(nfl.groups[0]).toMatchObject({ name: "AFC East", parent: "American Football Conference" });
    const nba = parseStandings({ name: "NBA", children: [{ name: "Eastern Conference", standings: { entries: [row("1")] } }] }, "nba");
    expect(nba.groups[0]).toMatchObject({ name: "Eastern Conference", parent: "" });
  });
});
