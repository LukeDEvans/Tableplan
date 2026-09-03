import { describe, it, expect } from "vitest";
import { normalizeMediaProgress, getPosition, setPosition, clearPosition, resumePositionFor, pruneMediaProgress, resumableEntries } from "../media-progress.js";

describe("setPosition / getPosition (immutable)", () => {
  it("records position + duration and floors to whole seconds", () => {
    const m = setPosition({}, "trk1", { position: 123.9, duration: 300.4 });
    expect(getPosition(m, "trk1")).toMatchObject({ position: 123, duration: 300 });
    expect(getPosition(m, "trk1").lastPlayedAt).toBeTruthy();
  });
  it("does not mutate the input map", () => {
    const a = {};
    const b = setPosition(a, "x", { position: 60 });
    expect(a).toEqual({});
    expect(getPosition(b, "x").position).toBe(60);
  });
  it("a non-positive position clears the entry (nothing to resume)", () => {
    const m = setPosition(setPosition({}, "x", { position: 90 }), "x", { position: 0 });
    expect(getPosition(m, "x")).toBe(null);
  });
  it("missing key is a no-op; garbage map normalizes to {}", () => {
    expect(setPosition({}, "", { position: 5 })).toEqual({});
    expect(normalizeMediaProgress(null)).toEqual({});
    expect(normalizeMediaProgress([1, 2])).toEqual({});
  });
});

describe("clearPosition", () => {
  it("removes an entry immutably", () => {
    const m = setPosition({}, "x", { position: 90 });
    const m2 = clearPosition(m, "x");
    expect(getPosition(m2, "x")).toBe(null);
    expect(getPosition(m, "x").position).toBe(90); // original intact
  });
});

describe("resumePositionFor (threshold-guarded)", () => {
  it("resumes content genuinely partway through", () => {
    const m = setPosition({}, "book", { position: 1200, duration: 3600 });
    expect(resumePositionFor(m, "book")).toBe(1200);
  });
  it("does NOT resume a short/just-started position (< minPosition)", () => {
    const m = setPosition({}, "song", { position: 20, duration: 200 });
    expect(resumePositionFor(m, "song")).toBe(0);
  });
  it("does NOT resume an all-but-finished track (within tailGuard of the end)", () => {
    const m = setPosition({}, "song", { position: 195, duration: 200 });
    expect(resumePositionFor(m, "song")).toBe(0);
  });
  it("resumes long content with unknown duration when past minPosition", () => {
    const m = setPosition({}, "stream", { position: 300, duration: 0 });
    expect(resumePositionFor(m, "stream")).toBe(300);
  });
  it("no entry → 0", () => {
    expect(resumePositionFor({}, "nope")).toBe(0);
  });
});

describe("pruneMediaProgress", () => {
  it("keeps the most-recent N entries", () => {
    let m = {};
    for (let i = 0; i < 5; i++) m = setPosition(m, `k${i}`, { position: 100, duration: 1000, at: `2026-09-0${i + 1}T00:00:00Z` });
    const pruned = pruneMediaProgress(m, { cap: 2 });
    expect(Object.keys(pruned).sort()).toEqual(["k3", "k4"]); // newest two by lastPlayedAt
  });
});

describe("resumableEntries (projection consumer)", () => {
  it("returns only genuinely-resumable entries, newest first", () => {
    let m = {};
    m = setPosition(m, "a", { position: 1200, duration: 3600, at: "2026-09-01T00:00:00Z" });
    m = setPosition(m, "b", { position: 10, duration: 200, at: "2026-09-02T00:00:00Z" }); // too short → excluded
    m = setPosition(m, "c", { position: 500, duration: 2000, at: "2026-09-03T00:00:00Z" });
    const res = resumableEntries(m);
    expect(res.map((e) => e.id)).toEqual(["c", "a"]); // b excluded; newest first
  });
});
