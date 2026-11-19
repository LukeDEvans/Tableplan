import { describe, it, expect } from "vitest";
import {
  parseSeriesPart, seriesKey, seriesIdFor, normalizeFeedUrl, normalizeTitle, groupUpcomingByFeed,
  upcomingIsFresh, activeUpcoming, heldSeriesForShow, heldEpisodeIds, upcomingLabel,
  UPCOMING_STALE_MS, UPCOMING_UNDATED_MAX_MS,
} from "../podcast-upcoming.js";
import { upcomingFromPage, serializedData, findAppleId } from "../supabase/functions/podcast-upcoming/apple.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-26T15:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const FEED = "https://feeds.megaphone.fm/GLT4787413333";

// The real titles of The Rest Is History's November 2026 series.
const LB = [
  "The Charge of the Light Brigade: Outbreak of The Crimean War (Part 1)",
  "The Charge of the Light Brigade: The Tsar’s Terrible Siege (Part 2)",
  "The Charge of the Light Brigade: Crushing the Russians (Part 3)",
  "The Charge of the Light Brigade: Into The Valley of Death (Part 4)",
];
const ep = (id, title) => ({ id, title, pubDate: iso(NOW - DAY) });
const row = (title, { expected = NOW + 3 * DAY, fetched = NOW - 2 * 60 * 60 * 1000, first, feed = FEED } = {}) => ({
  feed_url: feed, title, expected_at: expected === null ? null : iso(expected), fetched_at: iso(fetched),
  first_seen_at: first ? iso(first) : iso(fetched),
});

describe("series key", () => {
  it("groups parts whose subtitles differ (the old hold's bug)", () => {
    const keys = new Set(LB.map((t) => seriesKey(parseSeriesPart(t).seriesName)));
    expect(keys.size).toBe(1);
    expect(parseSeriesPart(LB[1])).toEqual({ seriesName: "The Charge of the Light Brigade", part: 2, total: null });
  });
  it("handles other numbering styles", () => {
    expect(parseSeriesPart("The Rise of the Nazis (Part 1)")).toMatchObject({ seriesName: "The Rise of the Nazis", part: 1 });
    expect(parseSeriesPart("Watergate: Part 3 of 6")).toEqual({ seriesName: "Watergate", part: 3, total: 6 });
    expect(parseSeriesPart("Pt. 2/4 – Nixon")).toMatchObject({ seriesName: "Nixon", part: 2, total: 4 });
    expect(parseSeriesPart("Part 2: The Fall")).toMatchObject({ seriesName: "The Fall", part: 2 });
    expect(parseSeriesPart("The Squire: The Most Important Man in History")).toBeNull();
    expect(parseSeriesPart("")).toBeNull();
  });
  it("ignores case, curly quotes and spacing", () => {
    expect(seriesKey("The Tsar’s  Siege")).toBe(seriesKey("the tsar's siege"));
    expect(seriesIdFor("s1", "The Charge")).toBe("s1::the charge");
  });
  it("compares feed URLs in one form", () => {
    expect(normalizeFeedUrl("http://Feeds.Megaphone.fm/GLT4787413333/")).toBe(normalizeFeedUrl(FEED));
    expect(normalizeTitle("A — B")).toBe("a - b");
  });
});

describe("upcoming label", () => {
  it("shortens a part title to its part and subtitle", () => {
    expect(upcomingLabel(LB[2])).toBe("Part 3 · Crushing the Russians");
    expect(upcomingLabel("The Rise of the Nazis (Part 2)")).toBe("Part 2 · The Rise of the Nazis");
    expect(upcomingLabel("A one-off episode")).toBe("A one-off episode");
  });
});

describe("upcoming rows", () => {
  it("are acted on only while fresh", () => {
    expect(upcomingIsFresh([row("x", { fetched: NOW - DAY })], NOW)).toBe(true);
    expect(upcomingIsFresh([row("x", { fetched: NOW - UPCOMING_STALE_MS - 1 })], NOW)).toBe(false);
    expect(activeUpcoming([row(LB[3], { fetched: NOW - 4 * DAY })], [], NOW)).toEqual([]);
  });
  it("drop once the episode is in the feed, or long past their date", () => {
    const rows = [row(LB[2]), row(LB[3], { expected: NOW + DAY }), row("Old (Part 9)", { expected: NOW - 4 * DAY })];
    const out = activeUpcoming(rows, [ep("e3", "The Charge of the Light Brigade: Crushing the Russians (Part 3)")], NOW);
    expect(out.map((u) => u.title)).toEqual([LB[3]]);
  });
  it("matches a released title despite different quote marks", () => {
    const out = activeUpcoming([row(LB[1])], [ep("e2", LB[1].replace("’", "'"))], NOW);
    expect(out).toEqual([]);
  });
  it("trust an undated row for 21 days only", () => {
    expect(activeUpcoming([row("A (Part 2)", { expected: null, first: NOW - 5 * DAY })], [], NOW)).toHaveLength(1);
    expect(activeUpcoming([row("A (Part 2)", { expected: null, first: NOW - UPCOMING_UNDATED_MAX_MS - DAY })], [], NOW)).toHaveLength(0);
  });
  it("sort soonest first, undated last", () => {
    const out = activeUpcoming([row("C (Part 3)", { expected: null }), row("B (Part 2)", { expected: NOW + 5 * DAY }), row("A (Part 1)", { expected: NOW + DAY })], [], NOW);
    expect(out.map((u) => u.title)).toEqual(["A (Part 1)", "B (Part 2)", "C (Part 3)"]);
  });
});

describe("series hold", () => {
  const show = { id: "trih", url: FEED, episodes: [ep("e1", LB[0]), ep("e2", LB[1]), ep("bonus", "The Squire: The Most Important Man in History"), ep("other", "Revolution in the Soviet Empire: Revenge of the Red Army (Part 2)")] };
  const rows = [row(LB[2]), row(LB[3], { expected: NOW + 6 * DAY })];

  it("holds the released parts while a later part is still coming", () => {
    const held = heldEpisodeIds([show], groupUpcomingByFeed(rows), { now: NOW });
    expect([...held].sort()).toEqual(["e1", "e2"]);
    const [g] = heldSeriesForShow(show, rows, { now: NOW });
    expect(g.name).toBe("The Charge of the Light Brigade");
    expect(g.eps.map((e) => e.part)).toEqual([1, 2]);
    expect(g.coming).toHaveLength(2);
  });
  it("releases the whole series when the last part arrives", () => {
    const done = { ...show, episodes: [...show.episodes, ep("e3", LB[2]), ep("e4", LB[3])] };
    expect(heldEpisodeIds([done], groupUpcomingByFeed(rows), { now: NOW }).size).toBe(0);
  });
  it("holds nothing when the Apple data is stale (Luke, 2026-11-19)", () => {
    const stale = rows.map((r) => ({ ...r, fetched_at: iso(NOW - 4 * DAY) }));
    expect(heldEpisodeIds([show], groupUpcomingByFeed(stale), { now: NOW }).size).toBe(0);
  });
  it("holds nothing for a show with no upcoming rows, or with no rows at all", () => {
    expect(heldEpisodeIds([show], groupUpcomingByFeed([row(LB[2], { feed: "https://other/feed" })]), { now: NOW }).size).toBe(0);
    expect(heldEpisodeIds([show], new Map(), { now: NOW }).size).toBe(0);
  });
  it("respects Release now", () => {
    const released = { [seriesIdFor("trih", "The Charge of the Light Brigade")]: true };
    expect(heldEpisodeIds([show], groupUpcomingByFeed(rows), { now: NOW, released }).size).toBe(0);
  });
  it("matches the feed URL loosely", () => {
    const loose = rows.map((r) => ({ ...r, feed_url: "http://feeds.megaphone.fm/GLT4787413333/" }));
    expect(heldEpisodeIds([show], groupUpcomingByFeed(loose), { now: NOW }).size).toBe(2);
  });
});

// A page shaped like Apple's (fields as seen 2026-11-19), with an early-access
// part added the way it is expected to look.
const lockup = (o) => ({ $kind: "LegacyEpisodeLockup", showAdamId: "1537788786", entitlementState: "free", hasFreeVersion: true, episodeType: "full", ...o });
const page = (items) => `<html><script type="application/json" id="serialized-server-data">${JSON.stringify([{ data: { shelves: [{ items }] } }])}</script></html>`;

describe("Apple adapter", () => {
  it("reads the embedded episode data", () => {
    const data = serializedData(page([lockup({ id: "1", title: LB[3], releaseDate: iso(NOW - DAY) })]));
    expect(upcomingFromPage(data, "1537788786", NOW)).toMatchObject({ upcoming: [], lockups: 1 });
  });
  it("counts a future-dated episode as upcoming, with its date", () => {
    const data = serializedData(page([lockup({ id: "5", title: "Next: Part One (Part 1)", releaseDate: iso(NOW + 4 * DAY) })]));
    const { upcoming, candidates } = upcomingFromPage(data, "1537788786", NOW);
    expect(upcoming).toEqual([{ title: "Next: Part One (Part 1)", expectedAt: iso(NOW + 4 * DAY) }]);
    expect(candidates[0]).toMatchObject({ id: "5", episodeType: "full" });
  });
  it("does not count an already-out subscriber-only episode, but logs its shape", () => {
    // First run, 2026-11-19: a show's subscriber-only episodes (out, never free)
    // became 13 false "Coming soon" rows under the earlier, looser rule.
    const data = serializedData(page([lockup({ id: "6", title: "Next (Part 2)", hasFreeVersion: false, entitlementState: "unentitled", releaseDate: iso(NOW - DAY) })]));
    const { upcoming, candidates } = upcomingFromPage(data, "1537788786", NOW);
    expect(upcoming).toEqual([]);
    expect(candidates).toHaveLength(1);
  });
  it("prefers a future free-date field", () => {
    const data = serializedData(page([lockup({ id: "7", title: "Next (Part 3)", hasFreeVersion: false, releaseDate: iso(NOW - DAY), freeReleaseDate: iso(NOW + 9 * DAY) })]));
    expect(upcomingFromPage(data, "1537788786", NOW).upcoming[0].expectedAt).toBe(iso(NOW + 9 * DAY));
  });
  it("never counts Club bonus episodes, trailers or other shows' items", () => {
    const data = serializedData(page([
      lockup({ id: "b", title: "The Squire", episodeType: "bonus", hasFreeVersion: false, entitlementState: "unentitled" }),
      lockup({ id: "t", title: "Trailer", episodeType: "trailer", releaseDate: iso(NOW + DAY) }),
      lockup({ id: "o", title: "Other show (Part 1)", showAdamId: "999", releaseDate: iso(NOW + DAY) }),
      { $kind: "Lockup", title: "Recommended show", releaseDate: iso(NOW + DAY) },
    ]));
    expect(upcomingFromPage(data, "1537788786", NOW).upcoming).toEqual([]);
  });
  it("returns null for a page without the data", () => {
    expect(serializedData("<html></html>")).toBeNull();
  });
  it("finds the Apple id only on an exact feed match", async () => {
    const fake = async () => ({ ok: true, json: async () => ({ results: [
      { collectionId: 1, feedUrl: "https://feeds.example.com/other" },
      { collectionId: 1537788786, feedUrl: "http://feeds.megaphone.fm/GLT4787413333/" },
    ] }) });
    expect(await findAppleId(FEED, "The Rest Is History", fake)).toBe("1537788786");
    expect(await findAppleId("https://nope/feed", "The Rest Is History", fake)).toBeNull();
  });
});
