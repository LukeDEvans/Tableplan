import { describe, it, expect } from "vitest";
import { stampTick, stampTab, touchItem, mergeWatchItem, mergeWatchItems } from "../watch-merge.js";

const show = (over = {}) => ({ id: "w1", type: "tv", title: "House of the Dragon", status: "want", seasonProgress: {}, categories: [], ...over });
const clone = (x) => JSON.parse(JSON.stringify(x));

describe("watch-merge: per-tick merge (decision 5)", () => {
  it("two people ticking different episodes both stick, whichever side is 'newer'", () => {
    const start = show();
    const phone = clone(start), laptop = clone(start);
    stampTick(phone, 3, 6, true, "2026-10-31T10:00:00Z");
    stampTick(laptop, 3, 7, true, "2026-10-31T10:05:00Z");
    for (const [a, b] of [[phone, laptop], [laptop, phone]]) {
      const m = mergeWatchItem(clone(a), clone(b));
      expect(m.seasonProgress[3].episodes).toEqual({ 6: true, 7: true });
    }
  });

  it("the later untick beats an earlier tick of the same episode, on either side", () => {
    const a = show(), b = show();
    stampTick(a, 1, 2, true, "2026-10-31T09:00:00Z");
    stampTick(b, 1, 2, false, "2026-10-31T09:30:00Z");
    expect(mergeWatchItem(clone(a), clone(b)).seasonProgress[1].episodes[2]).toBe(false);
    expect(mergeWatchItem(clone(b), clone(a)).seasonProgress[1].episodes[2]).toBe(false);
  });

  it("a stamped tick beats an unstamped one from an older client", () => {
    const old = show({ seasonProgress: { 1: { episodes: { 1: false } } } });
    const now = show();
    stampTick(now, 1, 1, true, "2026-10-31T09:00:00Z");
    expect(mergeWatchItem(clone(old), clone(now)).seasonProgress[1].episodes[1]).toBe(true);
  });

  it("without stamps it behaves as before: the newer side's ticks win, the other side's extra ticks are kept", () => {
    const newer = show({ seasonProgress: { 1: { episodes: { 1: true, 2: false } } } });
    const older = show({ seasonProgress: { 1: { episodes: { 2: true, 3: true } } } });
    expect(mergeWatchItem(newer, older).seasonProgress[1].episodes).toEqual({ 1: true, 2: false, 3: true });
  });

  it("tabs are decided one by one by their own time", () => {
    const start = show({ categories: ["date"] });
    const a = clone(start), b = clone(start);
    stampTab(a, "date", false, "2026-10-31T10:00:00Z"); // phone takes it out of Date night
    stampTab(b, "kids", true, "2026-10-31T09:00:00Z");  // laptop adds it to Kids, earlier
    for (const [x, y] of [[a, b], [b, a]]) {
      expect(mergeWatchItem(clone(x), clone(y)).categories.sort()).toEqual(["kids"]);
    }
  });

  it("unstamped tabs keep the newer side's list (the old rule)", () => {
    expect(mergeWatchItem(show({ categories: ["a"] }), show({ categories: ["b"] })).categories).toEqual(["a"]);
  });

  it("status / rating come from the copy changed last when both are stamped", () => {
    const a = show(), b = show();
    a.status = "watched"; a.rating = 4; touchItem(a, "2026-10-31T08:00:00Z");
    b.title = "House of the Dragon"; touchItem(b, "2026-10-31T09:00:00Z");
    const m = mergeWatchItem(clone(a), clone(b));
    expect(m.status).toBe("want");
    expect(m.updatedAt).toBe("2026-10-31T09:00:00Z");
  });

  it("keeps the latest of each stamp", () => {
    const a = show({ tickAt: { "1:1": "2026-10-31T01:00:00Z" }, tabsAt: { x: "2026-10-31T05:00:00Z" } });
    const b = show({ tickAt: { "1:1": "2026-10-31T02:00:00Z", "1:2": "2026-10-31T03:00:00Z" } });
    const m = mergeWatchItem(a, b);
    expect(m.tickAt).toEqual({ "1:1": "2026-10-31T02:00:00Z", "1:2": "2026-10-31T03:00:00Z" });
    expect(m.tabsAt).toEqual({ x: "2026-10-31T05:00:00Z" });
  });
});

describe("watch-merge: lists", () => {
  it("unions ids, merges shared shows, drops tombstoned ids", () => {
    const a = [show({ id: "a" }), show({ id: "both" })];
    const b = [show({ id: "b" }), show({ id: "both" }), show({ id: "gone" })];
    stampTick(a[1], 1, 1, true, "2026-10-31T01:00:00Z");
    stampTick(b[1], 1, 2, true, "2026-10-31T01:00:00Z");
    const out = mergeWatchItems(a, b, new Set(["gone"]));
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b", "both"]);
    expect(out.find((x) => x.id === "both").seasonProgress[1].episodes).toEqual({ 1: true, 2: true });
  });

  it("never passes on episode lists (device data, watch-episodes.js)", () => {
    const out = mergeWatchItems([show({ id: "x", episodeData: { 1: [{ episodeNumber: 1 }] } })], [show({ id: "y", episodeData: {} })]);
    expect(out.every((x) => !("episodeData" in x))).toBe(true);
  });

  it("handles missing lists", () => {
    expect(mergeWatchItems(undefined, undefined)).toEqual([]);
    expect(mergeWatchItems([show()], null)).toHaveLength(1);
  });
});
