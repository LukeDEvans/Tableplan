import { describe, it, expect } from "vitest";
import { holidayTheme, nextHoliday, nthWeekday, teamTheme, rankedGamedayTeams, gamedayTheme, nextGamedayCheckMs, dynamicTheme, isPlaying, cleanGamedayTeams } from "../theme-dynamic.js";
import { cleanTeam } from "../sports-model.js";
import { cleanDisplayPrefs, normalizeDisplayPrefs } from "../theme.js";
import { cleanViewDisplayPrefs, displayPrefsForView } from "../views.js";

const team = (scope, name, short) => cleanTeam({ name, short }, scope);
const vikings = team("nfl", "Minnesota Vikings", "Vikings");
const twins = team("mlb", "Minnesota Twins", "Twins");
const wild = team("nhl", "Minnesota Wild", "Wild");
const gophers = team("college", "Minnesota Golden Gophers", "Minnesota");
const packers = team("nfl", "Green Bay Packers", "Packers");
const blues = team("nhl", "St. Louis Blues", "Blues");
const game = (home, away, state, start) => ({ id: `${home.key}-${away.key}`, state, start, home: { team: home }, away: { team: away } });

describe("holidays", () => {
  it("finds Thanksgiving as the 4th Thursday of November", () => {
    expect(nthWeekday(2026, 10, 4, 4).getDate()).toBe(26);
    expect(nthWeekday(2027, 10, 4, 4).getDate()).toBe(25);
  });
  it("is the holiday only on the day itself", () => {
    expect(holidayTheme(new Date(2026, 9, 31, 8))).toBe("halloween");
    expect(holidayTheme(new Date(2026, 9, 30, 23))).toBe("");
    expect(holidayTheme(new Date(2026, 10, 26, 0, 1))).toBe("thanksgiving");
    expect(holidayTheme(new Date(2026, 10, 4))).toBe("");
  });
  it("names the next holiday, wrapping into next year", () => {
    expect(nextHoliday(new Date(2026, 10, 4)).theme).toBe("thanksgiving");
    expect(nextHoliday(new Date(2026, 11, 1)).theme).toBe("halloween");
  });
});

describe("team themes", () => {
  it("maps favorites to their team's theme, by scope", () => {
    expect(teamTheme(vikings)).toBe("vikings");
    expect(teamTheme(gophers)).toBe("gophers");
    expect(teamTheme(team("wnba", "Minnesota Lynx", "Lynx"))).toBe("wolves");
    expect(teamTheme(team("soccer", "AFC Ajax", "Ajax"))).toBe("ajax");
    expect(teamTheme(packers)).toBe("");
    // "Wild" in another scope is not the Minnesota Wild
    expect(teamTheme(team("soccer", "Wild", "Wild"))).toBe("");
  });
  it("only counts teams the person switched on, in favorites order", () => {
    const ranked = rankedGamedayTeams([twins, wild, vikings, packers], [vikings.key, wild.key, packers.key]);
    expect(ranked.map((r) => r.theme)).toEqual(["wild", "vikings"]);
  });
});

describe("game days", () => {
  const now = Date.parse("2026-11-08T19:00:00Z");
  const ranked = rankedGamedayTeams([vikings, wild, twins], [vikings.key, wild.key]);
  it("shows the higher-ranked team when two play at once", () => {
    const games = [game(wild, blues, "live", "2026-11-08T18:00:00Z"), game(vikings, packers, "live", "2026-11-08T18:00:00Z")];
    expect(gamedayTheme(games, ranked, now).theme).toBe("vikings");
  });
  it("ignores a favorite that wasn't switched on", () => {
    const games = [game(twins, packers, "live", "2026-11-08T18:00:00Z")];
    expect(gamedayTheme(games, ranked, now)).toBeNull();
  });
  it("is off before the start and after the final", () => {
    expect(gamedayTheme([game(vikings, packers, "pre", "2026-11-08T20:00:00Z")], ranked, now)).toBeNull();
    expect(gamedayTheme([game(vikings, packers, "final", "2026-11-08T16:00:00Z")], ranked, now)).toBeNull();
  });
  it("counts a game that should have started though the feed still says pre", () => {
    expect(isPlaying({ state: "pre", start: "2026-11-08T18:50:00Z" }, now)).toBe(true);
    expect(isPlaying({ state: "pre", start: "2026-11-08T17:00:00Z" }, now)).toBe(false);
  });
  it("checks every minute during a game, else at the next start, else not at all", () => {
    expect(nextGamedayCheckMs([game(wild, blues, "live", "2026-11-08T18:00:00Z")], ranked, now)).toBe(60_000);
    expect(nextGamedayCheckMs([game(vikings, packers, "pre", "2026-11-08T21:00:00Z")], ranked, now)).toBe(2 * 3_600_000 + 5_000);
    expect(nextGamedayCheckMs([game(twins, packers, "pre", "2026-11-08T21:00:00Z")], ranked, now)).toBeNull();
  });
});

describe("dynamicTheme", () => {
  const thanksgivingGame = new Date(2026, 10, 26, 13);
  const games = [game(vikings, packers, "live", new Date(2026, 10, 26, 12).toISOString())];
  const ranked = rankedGamedayTeams([vikings], [vikings.key]);
  it("game beats holiday beats the chosen theme", () => {
    expect(dynamicTheme({ theme: "classic", holidays: true, gameday: true }, { now: thanksgivingGame, games, ranked }).theme).toBe("vikings");
    expect(dynamicTheme({ theme: "classic", holidays: true, gameday: false }, { now: thanksgivingGame, games, ranked }).theme).toBe("thanksgiving");
    expect(dynamicTheme({ theme: "household", holidays: false, gameday: false }, { now: thanksgivingGame, games, ranked }).theme).toBe("household");
  });
});

describe("stored prefs", () => {
  it("keeps a view's name and switches; trims the name", () => {
    expect(cleanDisplayPrefs({ name: "  The   Evanses ", holidays: true, gameday: false, gamedayTeams: ["nfl:minnesota-vikings", "bad key!", "nfl:minnesota-vikings"] }))
      .toEqual({ name: "The Evanses", holidays: true, gameday: false, gamedayTeams: ["nfl:minnesota-vikings"] });
    expect(normalizeDisplayPrefs({}).holidays).toBe(false);
    expect(normalizeDisplayPrefs({ name: "x".repeat(80) }).name).toHaveLength(40);
    expect(cleanGamedayTeams("nope")).toEqual([]);
  });
  it("gives secondary views their own name and switches, but the person's teams", () => {
    const viewPrefs = cleanViewDisplayPrefs({ business: { name: "Urban Greens", gameday: true, junk: 1 } }, { modes: ["light"], themes: ["urbangreens"] });
    expect(viewPrefs).toEqual({ business: { name: "Urban Greens", gameday: true } });
    const p = displayPrefsForView("business", { base: normalizeDisplayPrefs({ gamedayTeams: ["nfl:minnesota-vikings"] }), viewPrefs, available: ["household", "personal", "business"] });
    expect(p).toMatchObject({ name: "Urban Greens", gameday: true, holidays: false, gamedayTeams: ["nfl:minnesota-vikings"], theme: "urbangreens" });
  });
});
