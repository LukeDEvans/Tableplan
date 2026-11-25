import { describe, it, expect } from "vitest";
import {
  parseSeriesPart, seriesKey, seriesIdFor, normalizeFeedUrl, normalizeTitle, groupUpcomingByFeed,
  upcomingIsFresh, activeUpcoming, heldSeriesForShow, heldEpisodeIds, upcomingLabel, stripEpisodeNumber,
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

// The real first early-access sighting, 2026-11-25: the feed numbers its titles,
// Apple doesn't, and Apple lists only the next part (its date = when it goes free).
describe("Captain Cook, as seen 2026-11-25", () => {
  const T0 = Date.parse("2026-11-25T16:00:00Z");
  const FETCHED = "2026-11-25T09:23:10Z";
  const show = { id: "trih", url: FEED, episodes: [
    { id: "c1", title: "725. The Death of Captain Cook: At World’s End (Part 1)", pubDate: "Mon, 23 Nov 2026 00:05:00 -0000" },
    { id: "lb4", title: "724. The Charge of the Light Brigade: Into The Valley of Death (Part 4)", pubDate: "Thu, 19 Nov 2026 00:05:00 -0000" },
  ] };
  const rows = [{ feed_url: FEED, title: "The Death of Captain Cook: Massacre on the Beach (Part 2)", expected_at: "2026-11-26T00:00:00Z", fetched_at: FETCHED, first_seen_at: FETCHED }];

  it("drops the feed's episode number", () => {
    expect(stripEpisodeNumber("725. The Death of Captain Cook (Part 1)")).toBe("The Death of Captain Cook (Part 1)");
    expect(stripEpisodeNumber("#12 Title")).toBe("Title");
    expect(stripEpisodeNumber("Ep 7: Title")).toBe("Title");
    expect(stripEpisodeNumber("1066: The Year")).toBe("1066: The Year");
    expect(parseSeriesPart(show.episodes[0].title).seriesName).toBe("The Death of Captain Cook");
    expect(upcomingLabel(show.episodes[0].title)).toBe("Part 1 · At World’s End");
  });
  it("holds Part 1 while Part 2 is announced", () => {
    expect([...heldEpisodeIds([show], groupUpcomingByFeed(rows), { now: T0 })]).toEqual(["c1"]);
    expect(activeUpcoming(rows, show.episodes, T0).map((u) => u.title)).toEqual([rows[0].title]);
  });
  it("keeps holding after Part 2 lands, until the next check", () => {
    const later = Date.parse("2026-11-26T03:00:00Z");
    const withP2 = { ...show, episodes: [...show.episodes, { id: "c2", title: "726. The Death of Captain Cook: Massacre on the Beach (Part 2)", pubDate: "Thu, 26 Nov 2026 00:05:00 -0000" }] };
    expect(activeUpcoming(rows, withP2.episodes, later)).toEqual([]); // nothing left to show
    expect([...heldEpisodeIds([withP2], groupUpcomingByFeed(rows), { now: later })].sort()).toEqual(["c1", "c2"]);
    const [g] = heldSeriesForShow(withP2, rows, { now: later });
    expect(g.coming).toEqual([]);
    // Next morning's check: Apple announces nothing more → the job writes no rows → released.
    expect(heldEpisodeIds([withP2], groupUpcomingByFeed([]), { now: later }).size).toBe(0);
    // …or it announces Part 3 → still held.
    const p3 = [{ ...rows[0], title: "The Death of Captain Cook: Part Three (Part 3)", expected_at: "2026-11-30T00:00:00Z", fetched_at: "2026-11-26T09:23:00Z" }];
    expect(heldEpisodeIds([withP2], groupUpcomingByFeed(p3), { now: Date.parse("2026-11-26T10:00:00Z") }).size).toBe(2);
  });
});

describe("Apple adapter on the real early-access lockup", () => {
  it("lists it with its free date", () => {
    const real = { adamId: "1000802944463", showTitle: "The Rest Is History", showAdamId: "1537788786", $kind: "LegacyEpisodeLockup", id: "1000802944463",
      title: "The Death of Captain Cook: Massacre on the Beach (Part 2)", releaseDate: "2026-11-26T00:00:00Z", episodeType: "full",
      entitlementState: "unentitled", hasFreeVersion: false, subscriptionName: "The Rest is History Club", caption: "Nov 26" };
    const data = serializedData(page([real]));
    expect(upcomingFromPage(data, "1537788786", Date.parse("2026-11-25T09:23:00Z")).upcoming)
      .toEqual([{ title: real.title, expectedAt: "2026-11-26T00:00:00.000Z" }]);
  });
});

