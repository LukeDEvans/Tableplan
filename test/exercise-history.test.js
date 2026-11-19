import { describe, it, expect } from "vitest";
import {
  historySortOptions, resolveHistorySort, nextHistorySort, sortHistoryLogs, formatLogSpeed,
} from "../exercise-history.js";

const bike = (date, minutes, whole, decimal = "00", unit = "km") => ({
  id: date, date, timedHours: "0", timedMinutes: String(minutes), distanceWhole: String(whole), distanceDecimal: decimal, distanceUnit: unit,
});

describe("exercise history sorting", () => {
  it("offers sorts that fit each kind, Date first", () => {
    expect(historySortOptions("timed").map((o) => o.key)).toEqual(["date", "duration", "distance", "speed"]);
    expect(historySortOptions("reps").map((o) => o.key)).toEqual(["date", "sets", "heaviest"]);
    expect(historySortOptions("game").map((o) => o.key)).toEqual(["date", "rating", "name"]);
  });

  it("defaults to newest first and falls back when a sort doesn't fit the kind", () => {
    expect(resolveHistorySort("timed", null)).toEqual({ key: "date", dir: "desc" });
    expect(resolveHistorySort("reps", { key: "speed", dir: "asc" })).toEqual({ key: "date", dir: "desc" });
  });

  it("tapping the same sort flips it; another starts in its own order", () => {
    expect(nextHistorySort("timed", { key: "date", dir: "desc" }, "date")).toEqual({ key: "date", dir: "asc" });
    expect(nextHistorySort("timed", { key: "date", dir: "asc" }, "distance")).toEqual({ key: "distance", dir: "desc" });
    expect(nextHistorySort("game", null, "name")).toEqual({ key: "name", dir: "asc" });
  });

  it("sorts by date, newest first by default", () => {
    const logs = [bike("2026-10-22", 30, 15), bike("2026-11-09", 30, 16, "20"), bike("2026-07-21", 30, 16)];
    expect(sortHistoryLogs(logs, "timed").map((l) => l.date)).toEqual(["2026-11-09", "2026-10-22", "2026-07-21"]);
    expect(sortHistoryLogs(logs, "timed", { key: "date", dir: "asc" }).map((l) => l.date)).toEqual(["2026-07-21", "2026-10-22", "2026-11-09"]);
  });

  it("sorts by distance (miles converted), ties broken by newest date", () => {
    const logs = [bike("2026-07-28", 30, 16), bike("2026-10-22", 30, 15), bike("2026-11-02", 30, 16), bike("2026-11-09", 30, 16, "20"), bike("2026-11-05", 30, 11, "00", "mi")];
    expect(sortHistoryLogs(logs, "timed", { key: "distance", dir: "desc" }).map((l) => l.date))
      .toEqual(["2026-11-05", "2026-11-09", "2026-11-02", "2026-07-28", "2026-10-22"]);
  });

  it("sorts by speed and leaves entries without a value at the bottom either way", () => {
    const slow = bike("2026-11-01", 60, 20);
    const fast = bike("2026-11-02", 30, 16);
    const empty = { id: "x", date: "2026-11-03", time: "30 min" };
    expect(sortHistoryLogs([slow, empty, fast], "timed", { key: "speed", dir: "desc" })).toEqual([fast, slow, empty]);
    expect(sortHistoryLogs([slow, empty, fast], "timed", { key: "speed", dir: "asc" })).toEqual([slow, fast, empty]);
    expect(formatLogSpeed(fast)).toBe("32.0 km/h");
    expect(formatLogSpeed(bike("d", 60, 10, "00", "mi"))).toBe("10.0 mph");
    expect(formatLogSpeed(empty)).toBe("");
  });

  it("sorts lifts by heaviest weight (kg converted) and by sets done", () => {
    const a = { id: "a", date: "2026-11-01", repWeights: { "0-0": "100 lb" }, setCompletion: { "0-0": true } };
    const b = { id: "b", date: "2026-11-02", repWeights: { "0-0": "50 kg" }, setCompletion: { "0-0": true, "0-1": true } };
    expect(sortHistoryLogs([a, b], "reps", { key: "heaviest", dir: "desc" })).toEqual([b, a]);
    expect(sortHistoryLogs([b, a], "reps", { key: "sets", dir: "asc" })).toEqual([a, b]);
  });

  it("sorts games by rating and by event name", () => {
    const g1 = { id: "1", date: "2026-11-01", gameName: "Soccer", gameRating: "hard" };
    const g2 = { id: "2", date: "2026-11-02", gameName: "basketball", gameRating: "easy" };
    expect(sortHistoryLogs([g1, g2], "game", { key: "rating", dir: "desc" })).toEqual([g2, g1]);
    expect(sortHistoryLogs([g1, g2], "game", { key: "name", dir: "asc" })).toEqual([g2, g1]);
  });

  it("doesn't change the list it was given", () => {
    const logs = [bike("2026-10-22", 30, 15), bike("2026-11-09", 30, 16)];
    const copy = [...logs];
    sortHistoryLogs(logs, "timed");
    expect(logs).toEqual(copy);
  });
});
