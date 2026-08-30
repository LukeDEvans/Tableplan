import { describe, it, expect } from "vitest";
import { deriveMediaTierCount } from "../media-tier.js";

describe("deriveMediaTierCount", () => {
  it("keeps the stored count when it already covers every assignment", () => {
    expect(deriveMediaTierCount(3, { a: 1, b: 2, c: 3 }, {})).toBe(3);
  });

  it("self-heals a count that is smaller than the highest assigned tier", () => {
    // The real-world bug: stored count 3 but shows ranked up to tier 7.
    const showTiers = { s1: 2, s2: 6, s3: 5, s4: 2, s5: 3, s6: 2, s7: 4, s8: 3, s9: 7 };
    expect(deriveMediaTierCount(3, showTiers, { nyt: 1, email: 1 })).toBe(7);
  });

  it("also considers publication tiers", () => {
    expect(deriveMediaTierCount(2, { s1: 1 }, { nyt: 5 })).toBe(5);
  });

  it("defaults to 3 when nothing is stored, and never goes below 1", () => {
    expect(deriveMediaTierCount(undefined, {}, {})).toBe(3); // missing → default 3
    expect(deriveMediaTierCount(0, {}, {})).toBe(1);         // nonsensical 0 tiers → floored to 1
    expect(deriveMediaTierCount(1, {}, {})).toBe(1);
  });

  it("ignores garbage tier values and non-object maps", () => {
    expect(deriveMediaTierCount(3, { a: "x", b: -1, c: 0, d: 2.5, e: null }, null)).toBe(3);
    expect(deriveMediaTierCount(3, [1, 2, 3], undefined)).toBe(3); // arrays are not tier maps
  });

  it("caps a corrupt runaway assignment instead of spawning thousands of tiers", () => {
    expect(deriveMediaTierCount(3, { a: 99999 }, {})).toBe(12);
  });
});
