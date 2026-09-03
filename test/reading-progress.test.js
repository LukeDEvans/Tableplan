import { describe, it, expect } from "vitest";
import {
  setReadingProgress, getReadingProgress, readingPercent,
  hasStarted, isFinished, clearReadingProgress, pruneReadingProgress,
} from "../reading-progress.js";

describe("setReadingProgress — immutable, clamped, id-guarded", () => {
  it("records percent/position/updatedAt without mutating the input map", () => {
    const before = {};
    const after = setReadingProgress(before, "a1", { percent: 0.5, position: 1200, updatedAt: "2026-09-03T00:00:00Z" });
    expect(before).toEqual({});                       // not mutated
    expect(after.a1).toEqual({ percent: 0.5, position: 1200, updatedAt: "2026-09-03T00:00:00Z" });
  });

  it("clamps percent to [0,1] and floors position at 0", () => {
    expect(setReadingProgress({}, "a", { percent: 2 }).a.percent).toBe(1);
    expect(setReadingProgress({}, "a", { percent: -3 }).a.percent).toBe(0);
    expect(setReadingProgress({}, "a", { percent: NaN }).a.percent).toBe(0);
    expect(setReadingProgress({}, "a", { position: -50 }).a.position).toBe(0);
    expect(setReadingProgress({}, "a", { position: 40.7 }).a.position).toBe(41);
  });

  it("stamps updatedAt when not supplied; an empty id is a no-op", () => {
    expect(setReadingProgress({}, "a", { percent: 0.1 }).a.updatedAt).toBeTruthy();
    expect(setReadingProgress({ x: 1 }, "", { percent: 0.1 })).toEqual({ x: 1 });
    expect(setReadingProgress({ x: 1 }, null, { percent: 0.1 })).toEqual({ x: 1 });
  });
});

describe("separation of concerns — reading is NOT consumption or listening", () => {
  it("the returned value is ONLY a reading map — no consumption/queue keys can appear", () => {
    const m = setReadingProgress({}, "a1", { percent: 0.4 });
    // Structurally impossible to write readArticleIds / mediaProgress / queue here.
    for (const k of ["readArticleIds", "articleReadDates", "mediaProgress", "podcastQueue", "consumed"]) {
      expect(k in m).toBe(false);
    }
    expect(Object.keys(m.a1).sort()).toEqual(["percent", "position", "updatedAt"]);
  });
});

describe("queries — percent / started / finished", () => {
  const m = setReadingProgress(setReadingProgress({}, "started", { percent: 0.3 }), "done", { percent: 0.98 });
  it("readingPercent defaults to 0 for an unopened article", () => {
    expect(readingPercent(m, "never")).toBe(0);
    expect(readingPercent(m, "started")).toBe(0.3);
  });
  it("hasStarted ignores a top-of-page open; isFinished only near the end", () => {
    expect(hasStarted(m, "never")).toBe(false);
    expect(hasStarted(setReadingProgress({}, "top", { percent: 0.01 }), "top")).toBe(false);
    expect(hasStarted(m, "started")).toBe(true);
    expect(isFinished(m, "started")).toBe(false);
    expect(isFinished(m, "done")).toBe(true);
  });
  it("getReadingProgress returns null for a missing/garbage entry", () => {
    expect(getReadingProgress(m, "never")).toBeNull();
    expect(getReadingProgress(null, "x")).toBeNull();
  });
});

describe("clear + prune — reread fresh, bounded growth", () => {
  it("clearReadingProgress drops one entry, leaving the rest and never mutating", () => {
    const m = setReadingProgress(setReadingProgress({}, "a", { percent: 0.5 }), "b", { percent: 0.5 });
    const c = clearReadingProgress(m, "a");
    expect("a" in m).toBe(true);      // original intact
    expect("a" in c).toBe(false);
    expect("b" in c).toBe(true);
    expect(clearReadingProgress({}, "missing")).toEqual({});
  });

  it("pruneReadingProgress keeps only live ids (array or Set)", () => {
    const m = { a: { percent: 0.1 }, b: { percent: 0.2 }, c: { percent: 0.3 } };
    expect(Object.keys(pruneReadingProgress(m, ["a", "c"])).sort()).toEqual(["a", "c"]);
    expect(Object.keys(pruneReadingProgress(m, new Set(["b"])))).toEqual(["b"]);
    expect(pruneReadingProgress(m, [])).toEqual({});
    expect(pruneReadingProgress(null, ["a"])).toEqual({});
  });
});
