// Scores' tab row and day strip (Luke, 2026-11-20): scores-ui.js scoreTabs /
// stepTab / dayRange.
import { describe, it, expect } from "vitest";
import { scoreTabs, stepTab, dayRange } from "../scores-ui.js";
import { normalizeSportsPrefs, enabledLeagueKeys } from "../sports-model.js";

describe("scoreTabs", () => {
  it("★ (my teams) first, then the leagues shown, in the user's order", () => {
    const p = normalizeSportsPrefs({});
    const tabs = scoreTabs(p);
    expect(tabs[0]).toBe("mine");
    expect(tabs.slice(1)).toEqual(enabledLeagueKeys(p));
  });
});

describe("stepTab", () => {
  const tabs = ["mine", "nfl", "nhl"];
  it("a swipe left goes to the next tab, right to the previous", () => {
    expect(stepTab(tabs, "mine", 1)).toBe("nfl");
    expect(stepTab(tabs, "nhl", -1)).toBe("nfl");
  });
  it("stops at either end", () => {
    expect(stepTab(tabs, "mine", -1)).toBeNull();
    expect(stepTab(tabs, "nhl", 1)).toBeNull();
  });
  it("a tab no longer shown steps from ★", () => {
    expect(stepTab(tabs, "nba", 1)).toBe("nfl");
  });
});

describe("dayRange", () => {
  it("three weeks either side of today, in order", () => {
    const r = dayRange("2026-11-20", "2026-11-20");
    expect(r).toHaveLength(43);
    expect(r[0]).toBe("2026-10-30");
    expect(r[21]).toBe("2026-11-20");
    expect(r[42]).toBe("2026-12-11");
  });
  it("stretches to reach a day picked further out (a game on a team page)", () => {
    const r = dayRange("2026-11-20", "2027-01-10");
    expect(r[r.length - 1]).toBe("2027-01-10");
    expect(r[0]).toBe("2026-10-30");
    const back = dayRange("2026-11-20", "2026-09-07");
    expect(back[0]).toBe("2026-09-07");
  });
});
