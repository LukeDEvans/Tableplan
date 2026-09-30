import { describe, it, expect } from "vitest";
import { changedSectionRowIds, resumeCheckDue } from "../state-sync.js";

describe("changedSectionRowIds — which rows to download on resume", () => {
  const seen = { "g:eat": "t1", "u-1:media": "t2" };
  it("returns nothing when every stamp matches (the common, cheap case)", () => {
    expect(changedSectionRowIds([{ id: "g:eat", updated_at: "t1" }, { id: "u-1:media", updated_at: "t2" }], seen)).toEqual([]);
  });
  it("returns only rows whose stamp moved (e.g. the mail sweep saved a newsletter)", () => {
    expect(changedSectionRowIds([{ id: "g:eat", updated_at: "t1" }, { id: "u-1:media", updated_at: "t3" }], seen)).toEqual(["u-1:media"]);
  });
  it("treats a row never seen this session as changed", () => {
    expect(changedSectionRowIds([{ id: "u-1:travel", updated_at: "t9" }], seen)).toEqual(["u-1:travel"]);
  });
  it("ignores malformed rows and empty input", () => {
    expect(changedSectionRowIds([null, { id: "x" }, { updated_at: "t" }], seen)).toEqual([]);
    expect(changedSectionRowIds(null, seen)).toEqual([]);
  });
});

describe("resumeCheckDue — the throttle that keeps this from becoming a poll", () => {
  const MIN = 120000;
  it("runs the first time", () => {
    expect(resumeCheckDue({ now: 1000, lastCheckAt: 0, inFlight: false, minIntervalMs: MIN })).toBe(true);
  });
  it("never runs while a check is in flight", () => {
    expect(resumeCheckDue({ now: 10 * MIN, lastCheckAt: 0, inFlight: true, minIntervalMs: MIN })).toBe(false);
  });
  it("is capped to once per interval", () => {
    expect(resumeCheckDue({ now: 1000 + MIN - 1, lastCheckAt: 1000, inFlight: false, minIntervalMs: MIN })).toBe(false);
    expect(resumeCheckDue({ now: 1000 + MIN, lastCheckAt: 1000, inFlight: false, minIntervalMs: MIN })).toBe(true);
  });
});
