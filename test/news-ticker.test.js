// The dock's headlines-and-scores strip (news-ticker.js): which days it covers
// around noon, which games make it (followed teams only), their order and
// wording, news before scores, and how long an item holds.
import { describe, it, expect } from "vitest";
import { tickerDays, msUntilWindowChange, favoriteGames, gameTicker, buildTickerItems, holdMsFor, TICKER_MAX_LEADS } from "../news-ticker.js";
import { recentLeads, arrangeFront } from "../news-ui.js";
import { cleanGames } from "../sports-model.js";

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);
const team = (name, abbr) => ({ name, short: name, abbr, refs: {} });
const vikings = team("Minnesota Vikings", "MIN");
const packers = team("Green Bay Packers", "GB");
const bears = team("Chicago Bears", "CHI");
const lions = team("Detroit Lions", "DET");
const wild = team("Minnesota Wild", "MIN");
const ajax = { ...team("Ajax", "AJX") };
const psv = { ...team("PSV", "PSV") };
const prefs = {
  teams: [
    { ...vikings, scope: "nfl", league: "nfl" },
    { ...wild, scope: "nhl", league: "nhl" },
    { ...ajax, scope: "soccer", league: "eredivisie" },
  ],
};
const game = (id, league, away, home, extra = {}) => ({
  id, league, start: "2026-10-14T23:00:00Z", state: "pre",
  away: { team: away, score: extra.awayScore ?? null }, home: { team: home, score: extra.homeScore ?? null }, ...extra,
});

describe("tickerDays", () => {
  it("before noon: yesterday and today", () => {
    expect(tickerDays(at(2026, 10, 14, 11, 59))).toEqual([{ key: "2026-10-13", rel: -1 }, { key: "2026-10-14", rel: 0 }]);
  });
  it("from noon: today and tomorrow", () => {
    expect(tickerDays(at(2026, 10, 14, 12, 0))).toEqual([{ key: "2026-10-14", rel: 0 }, { key: "2026-10-15", rel: 1 }]);
  });
  it("crosses month ends", () => {
    expect(tickerDays(at(2026, 11, 1, 8)).map((d) => d.key)).toEqual(["2026-10-31", "2026-11-01"]);
    expect(tickerDays(at(2026, 12, 31, 18)).map((d) => d.key)).toEqual(["2026-12-31", "2027-01-01"]);
  });
  it("re-checks at noon and at midnight", () => {
    expect(msUntilWindowChange(at(2026, 10, 14, 11, 0))).toBe(3_600_000 + 1_000);
    expect(msUntilWindowChange(at(2026, 10, 14, 23, 0))).toBe(3_600_000 + 1_000);
  });
});

describe("favoriteGames", () => {
  const today = "2026-10-14", yesterday = "2026-10-13", tomorrow = "2026-10-15";
  const byDay = {
    [yesterday]: cleanGames([
      game("y1", "nfl", vikings, packers, { state: "final", start: "2026-10-13T17:00:00Z", awayScore: 24, homeScore: 17, detail: "Final" }),
      game("y2", "nfl", bears, lions, { state: "final", start: "2026-10-13T17:00:00Z", awayScore: 3, homeScore: 9 }),
    ]),
    [today]: cleanGames([
      game("t-final", "nhl", wild, team("Chicago Blackhawks", "CHI"), { state: "final", start: "2026-10-14T16:00:00Z", awayScore: 2, homeScore: 1 }),
      game("t-pre", "eredivisie", psv, ajax, { start: "2026-10-14T23:30:00Z" }),
      game("t-live", "nfl", packers, vikings, { state: "live", start: "2026-10-14T20:00:00Z", awayScore: 7, homeScore: 10, detail: "3rd 5:21" }),
      game("t-other", "nfl", bears, lions, { state: "live" }),
    ]),
    [tomorrow]: cleanGames([game("tm1", "nhl", team("Dallas Stars", "DAL"), wild, { start: "2026-10-16T00:00:00Z" })]),
  };

  it("keeps only games with a followed team, today live → upcoming → final", () => {
    const out = favoriteGames(byDay, prefs, [{ key: yesterday, rel: -1 }, { key: today, rel: 0 }]);
    expect(out.map((e) => e.game.id)).toEqual(["y1", "t-live", "t-pre", "t-final"]);
    expect(out[0]).toMatchObject({ dateKey: yesterday, rel: -1, fav: { away: true, home: false } });
  });
  it("after noon brings tomorrow's games instead of yesterday's", () => {
    const out = favoriteGames(byDay, prefs, [{ key: today, rel: 0 }, { key: tomorrow, rel: 1 }]);
    expect(out.map((e) => e.game.id)).toEqual(["t-live", "t-pre", "t-final", "tm1"]);
  });
  it("nothing without favorites, and a failed day is just empty", () => {
    expect(favoriteGames(byDay, { teams: [] }, [{ key: today, rel: 0 }])).toEqual([]);
    expect(favoriteGames({ [today]: null }, prefs, [{ key: today, rel: 0 }])).toEqual([]);
  });
  it("a game listed on two days shows once", () => {
    const dup = { [today]: byDay[today], [tomorrow]: byDay[today] };
    const out = favoriteGames(dup, prefs, [{ key: today, rel: 0 }, { key: tomorrow, rel: 1 }]);
    expect(out.filter((e) => e.game.id === "t-live")).toHaveLength(1);
  });
});

describe("gameTicker", () => {
  const [final, live, soccer, pre] = cleanGames([
    game("a", "nfl", vikings, packers, { state: "final", awayScore: 24, homeScore: 17 }),
    game("b", "nfl", packers, vikings, { state: "live", awayScore: 7, homeScore: 10, detail: "3rd 5:21" }),
    game("c", "eredivisie", psv, ajax, {}),
    game("d", "nhl", team("Dallas Stars", "DAL"), wild, { detail: "TBD" }),
  ]);
  it("a result: visitor first, scores, the followed side marked", () => {
    const t = gameTicker({ game: final, rel: 0, fav: { away: true, home: false } });
    expect(t.league).toBe("NFL");
    expect(t.sides).toEqual([{ abbr: "MIN", logo: "", logoDark: "", score: 24, fav: true }, { abbr: "GB", logo: "", logoDark: "", score: 17, fav: false }]);
    expect(t.status).toBe("Final");
    expect(t.joiner).toBe("");
  });
  it("yesterday's result says so", () => {
    expect(gameTicker({ game: final, rel: -1, fav: {} }).status).toBe("Yesterday · Final");
  });
  it("a live game carries its clock and the live flag", () => {
    const t = gameTicker({ game: live, rel: 0, fav: { home: true } });
    expect(t.status).toBe("3rd 5:21");
    expect(t.live).toBe(true);
  });
  it("soccer lists the home side first; upcoming games show the start", () => {
    const t = gameTicker({ game: soccer, rel: 1, fav: { home: true } }, { locale: "en-US" });
    expect(t.sides.map((s) => s.abbr)).toEqual(["AJX", "PSV"]);
    expect(t.joiner).toBe("v");
    expect(t.status).toMatch(/^Tomorrow \d{1,2}:\d{2}\s?[AP]M$/);
  });
  it("an unset time keeps the feed's wording", () => {
    expect(gameTicker({ game: pre, rel: 0, fav: {} }).status).toBe("TBD");
    expect(gameTicker({ game: pre, rel: 0, fav: {} }).joiner).toBe("at");
  });
  it("carries each side's logos", () => {
    const [g] = cleanGames([game("l", "nfl", { ...vikings, logo: "https://x.test/min.png", logoDark: "https://x.test/min-d.png" }, packers)]);
    const t = gameTicker({ game: g, rel: 0, fav: {} });
    expect(t.sides[0]).toMatchObject({ logo: "https://x.test/min.png", logoDark: "https://x.test/min-d.png" });
    expect(t.sides[1]).toMatchObject({ logo: "", logoDark: "" });
  });
  it("reads well aloud", () => {
    expect(gameTicker({ game: final, rel: 0, fav: {} }).label).toBe("Minnesota Vikings at Green Bay Packers, 24 to 17, Final");
  });
});

describe("buildTickerItems", () => {
  const leads = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `Story ${i}`, section: i === 0 ? "world" : "more" }));
  const games = favoriteGames({ d: cleanGames([game("g1", "nfl", vikings, packers)]) }, prefs, [{ key: "d", rel: 0 }]);
  it("news first, then scores, with stable keys", () => {
    const items = buildTickerItems({ leads, games });
    expect(items.filter((i) => i.kind === "news")).toHaveLength(TICKER_MAX_LEADS);
    expect(items.at(-1)).toMatchObject({ kind: "game", key: "g:g1", id: "g1", dateKey: "d" });
    expect(items.findIndex((i) => i.kind === "game")).toBe(TICKER_MAX_LEADS);
    expect(items[0]).toMatchObject({ key: "n:s0", tag: "World", text: "Story 0" });
    expect(items[1].tag).toBe("News");
  });
  it("skips stories without a title; empty when there's nothing", () => {
    expect(buildTickerItems({ leads: [{ id: "x" }] })).toEqual([]);
    expect(buildTickerItems()).toEqual([]);
  });
});

describe("recentLeads (news-ui.js)", () => {
  const now = Date.parse("2026-10-14T18:00:00Z");
  const list = [
    { id: "a", url: "u", lead: "2026-10-14T11:00:00Z" },
    { id: "b", url: "u", lead: "2026-10-14T15:00:00Z" },
    { id: "c", url: "u", lead: "2026-10-12T15:00:00Z" }, // older than 36 h
    { id: "d", url: "u" },
  ];
  it("recent leads only, newest lead first", () => {
    expect(recentLeads(list, now).map((a) => a.id)).toEqual(["b", "a"]);
  });
  it("the Front page still puts them on top", () => {
    const { lead, rest } = arrangeFront(list, now);
    expect([lead.id, ...rest.map((a) => a.id)]).toEqual(["b", "a", "c", "d"]);
  });
});

describe("holdMsFor", () => {
  it("a fitting item holds a few seconds; a long one long enough to scroll through", () => {
    expect(holdMsFor(0)).toBe(5_500);
    expect(holdMsFor(240)).toBe(1_400 + 5_000 + 1_600);
  });
});
