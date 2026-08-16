import { describe, it, expect } from "vitest";
import {
  routeCost, bestOrder, suggestReorder, detectTightConnections,
  detectOverpacked, detectCalendarConflicts, evaluateDay,
} from "../travel-optimize.js";

// A tiny distance table (minutes). Symmetric.
const DIST = {
  "Hotel|Museum": 10, "Hotel|Bazaar": 30, "Hotel|Park": 12,
  "Museum|Bazaar": 8, "Museum|Park": 25, "Bazaar|Park": 20,
};
function dist(a, b) {
  if (a === b) return 0;
  return DIST[`${a}|${b}`] ?? DIST[`${b}|${a}`] ?? null;
}

const stop = (id, title, location, extra = {}) => ({ kind: "stop", id, title, location, movable: true, time: null, ...extra });

describe("routeCost", () => {
  it("sums known segments, skips unknowns", () => {
    expect(routeCost(["Hotel", "Museum", "Bazaar"], dist)).toBe(18);
    expect(routeCost(["Hotel", "Nowhere", "Bazaar"], dist)).toBe(0); // both segments unknown
  });
});

describe("bestOrder", () => {
  it("finds the shortest ordering between anchors", () => {
    const items = [stop("b", "Bazaar", "Bazaar"), stop("m", "Museum", "Museum"), stop("p", "Park", "Park")];
    const best = bestOrder(items, "Hotel", null, dist);
    // From Hotel: Museum(10) → Bazaar(8) → Park(20) = 38 beats naive.
    expect(best[0].location).toBe("Museum");
  });
});

describe("suggestReorder", () => {
  it("proposes a reorder that saves time, without mutating", () => {
    const timeline = [
      stop("hotel", "Hotel", "Hotel", { movable: false, time: "09:00" }), // fixed anchor
      stop("b", "Bazaar", "Bazaar"),
      stop("m", "Museum", "Museum"),
    ];
    const snap = JSON.stringify(timeline);
    const s = suggestReorder(timeline, dist, { minSaveMin: 1 });
    expect(s).toBeTruthy();
    expect(s.type).toBe("reorder");
    expect(s.suggested[0].title).toBe("Museum"); // Museum before Bazaar from the hotel
    expect(s.savedMin).toBeGreaterThan(0);
    expect(s.apply).toEqual([
      { id: "m", dayOrder: 0 },
      { id: "b", dayOrder: 1 },
    ]);
    expect(JSON.stringify(timeline)).toBe(snap);
  });

  it("returns null when already optimal", () => {
    const timeline = [
      stop("hotel", "Hotel", "Hotel", { movable: false, time: "09:00" }),
      stop("m", "Museum", "Museum"),
      stop("b", "Bazaar", "Bazaar"),
    ];
    expect(suggestReorder(timeline, dist, { minSaveMin: 1 })).toBeNull();
  });

  it("returns null with fewer than two movable located stops", () => {
    expect(suggestReorder([stop("m", "Museum", "Museum")], dist)).toBeNull();
    expect(suggestReorder([stop("m", "Museum", ""), stop("b", "Bazaar", "")], dist)).toBeNull();
  });

  it("ignores timed stops as movable", () => {
    const timeline = [stop("m", "Museum", "Museum", { time: "10:00" }), stop("b", "Bazaar", "Bazaar", { time: "11:00" })];
    expect(suggestReorder(timeline, dist)).toBeNull();
  });
});

describe("detectTightConnections", () => {
  it("flags a transition whose buffer fails", () => {
    const timeline = [
      { kind: "transition", fromStop: { title: "A" }, toStop: { title: "B" }, routing: { buffer: { ok: false, gapMin: 10, needMin: 30 } } },
    ];
    const out = detectTightConnections(timeline);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("tight");
  });
});

describe("detectOverpacked", () => {
  it("flags a very dense day", () => {
    const timeline = Array.from({ length: 8 }, (_, i) => stop("s" + i, "S" + i, "L" + i));
    expect(detectOverpacked(timeline).type).toBe("overpacked");
  });
  it("stays quiet on a comfortable day", () => {
    const timeline = Array.from({ length: 4 }, (_, i) => stop("s" + i, "S" + i, "L" + i));
    expect(detectOverpacked(timeline)).toBeNull();
  });
});

describe("detectCalendarConflicts", () => {
  it("flags an overlapping household event", () => {
    const timeline = [stop("a", "Activity", "X", { time: "14:00", endTime: "16:00" })];
    const events = [{ title: "Dentist", start: "15:00", end: "15:30" }];
    const out = detectCalendarConflicts(timeline, events);
    expect(out).toHaveLength(1);
    expect(out[0].eventTitle).toBe("Dentist");
  });
  it("no conflict when times don't overlap", () => {
    const timeline = [stop("a", "Activity", "X", { time: "09:00", endTime: "10:00" })];
    expect(detectCalendarConflicts(timeline, [{ title: "Lunch", start: "12:00", end: "13:00" }])).toHaveLength(0);
  });
});

describe("evaluateDay", () => {
  it("aggregates suggestions", () => {
    const timeline = [
      stop("hotel", "Hotel", "Hotel", { movable: false, time: "09:00" }),
      stop("b", "Bazaar", "Bazaar"),
      stop("m", "Museum", "Museum"),
    ];
    const out = evaluateDay(timeline, { distanceFn: dist, events: [] });
    expect(out.some(s => s.type === "reorder")).toBe(true);
  });
  it("returns [] for a quiet, optimal day", () => {
    const timeline = [stop("m", "Museum", "Museum", { time: "10:00" })];
    expect(evaluateDay(timeline, { distanceFn: dist })).toEqual([]);
  });
});
