// One-time row resets (views.js applyRowReset): a reset row replaces a device's
// stale copy instead of being merged with it (Household Listen and Watch held a
// copy of Personal's, 2026-10-27; union merges would put it straight back).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyRowReset, rowResetKey, ROW_RESET_SECTIONS } from "../views.js";

const KEYS = ["podcasts", "podcastQueue", "podcastProgress", "mediaRowReset"];
const stale = { podcasts: [{ id: "a" }, { id: "b" }], podcastQueue: ["e1"], podcastProgress: { e1: 30 }, other: 1 };
const reset = { podcasts: [], podcastQueue: [], podcastProgress: {}, mediaRowReset: "r1" };

describe("views: applyRowReset", () => {
  it("a stale copy without the marker becomes the reset row", () => {
    const out = applyRowReset("media", KEYS, stale, reset);
    expect(out).toEqual({ podcasts: [], podcastQueue: [], podcastProgress: {}, mediaRowReset: "r1", other: 1 });
    expect(stale.podcasts).toHaveLength(2); // input untouched
  });
  it("keys the reset row lacks are removed from the copy", () => {
    const out = applyRowReset("media", KEYS, stale, { mediaRowReset: "r1" });
    expect(out).toEqual({ mediaRowReset: "r1", other: 1 });
  });
  it("a copy that already carries the marker merges normally (returned as is)", () => {
    const mine = { podcasts: [{ id: "new" }], mediaRowReset: "r1" };
    expect(applyRowReset("media", KEYS, mine, reset)).toBe(mine);
  });
  it("a later reset id replaces a copy carrying an earlier one", () => {
    const mine = { podcasts: [{ id: "x" }], mediaRowReset: "r1" };
    expect(applyRowReset("media", KEYS, mine, { ...reset, mediaRowReset: "r2" }).podcasts).toEqual([]);
  });
  it("rows without a marker, other sections and bad input change nothing", () => {
    expect(applyRowReset("media", KEYS, stale, { podcasts: [] })).toBe(stale);
    expect(applyRowReset("media", KEYS, stale, null)).toBe(stale);
    expect(applyRowReset("media", KEYS, stale, { mediaRowReset: "" })).toBe(stale);
    expect(applyRowReset("plan", ["planEvents", "planRowReset"], stale, { planRowReset: "r1" })).toBe(stale);
  });
  it("a missing local copy takes the reset row", () => {
    expect(applyRowReset("watch", ["watchItems", "watchRowReset"], undefined, { watchItems: [], watchRowReset: "r1" }))
      .toEqual({ watchItems: [], watchRowReset: "r1" });
  });
  it("merging the result with the reset row can't bring the old items back", () => {
    const out = applyRowReset("media", KEYS, stale, reset);
    const union = new Map([...(out.podcasts || []), ...reset.podcasts].map((p) => [p.id, p]));
    expect(union.size).toBe(0);
  });
});

describe("views: row resets are wired into every merge with a fetched row", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  it("each reset section keeps its marker in its saved keys", () => {
    const block = app.match(/const STATE_SECTIONS = \{([\s\S]*?)\n\};/)[1];
    for (const section of ROW_RESET_SECTIONS) {
      const line = block.match(new RegExp(`^\\s*${section}:\\s*\\[(.*)\\],?$`, "m"));
      expect(line, section).toBeTruthy();
      expect(line[1]).toContain(`"${rowResetKey(section)}"`);
    }
  });
  it("boot, refresh, save-conflict and other-scope writes all apply it", () => {
    expect(app).toMatch(/stateForMerge = applyRowReset\(section, STATE_SECTIONS\[section\], stateForMerge, sharedState\)/);
    const local = app.match(/applyRowReset\(section, keys, extractSectionData\(keys\), remoteData\)/g) || [];
    expect(local.length).toBe(2); // mergeRemoteSectionRow + writeSectionWithMerge
    expect(app).toMatch(/applyRowReset\(section, keys, data, remoteData\)/); // writeInactiveSection
  });
});
