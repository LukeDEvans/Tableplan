import { describe, it, expect } from "vitest";
import { formatBytes, formatDuration, normalizeProbe, estimateStorage, summarizeProbe, probeReportText, THUMB_BYTES } from "../photos/probe.js";

const sample = {
  access: "authorized", total: 30000, photos: 27500, videos: 2500, other: 0,
  screenshots: 3200, livePhotos: 9000, bursts: 120, favorites: 800, withLocation: 21000,
  videoSeconds: 3600 * 20 + 1800,
  bytesPhotos: 80 * 1024 ** 3, bytesVideos: 60 * 1024 ** 3, bytesScreenshots: 2 * 1024 ** 3,
  originalsLocal: 6000, originalsCloudOnly: 24000, originalsUnknown: 0, sizeUnknown: 0,
  oldest: "2012-06-03T12:00:00Z", newest: "2026-11-15T12:00:00Z",
  byYear: { 2012: 40, 2026: 5000, junk: 3 }, seconds: 41.6,
};

describe("photos probe report", () => {
  it("formats sizes and durations", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(140 * 1024 ** 3)).toBe("140 GB");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatDuration(3600 * 20 + 1800)).toBe("20 h 30 min");
    expect(formatDuration(90)).toBe("2 min");
  });

  it("never throws on a missing or broken result", () => {
    for (const bad of [undefined, null, "x", {}, { total: "abc", byYear: "no", bytesPhotos: NaN }]) {
      const out = summarizeProbe(bad);
      expect(out.probe.total).toBe(0);
      expect(out.groups.length).toBeGreaterThan(3);
    }
    expect(normalizeProbe({ total: -4, photos: 2.9 })).toMatchObject({ total: 0, photos: 2 });
  });

  it("drops year keys that aren't years", () => {
    expect(normalizeProbe(sample).byYear).toEqual({ 2012: 40, 2026: 5000 });
  });

  it("estimates what stage 1 would store", () => {
    const est = estimateStorage(sample);
    expect(est.thumbs).toBe(30000 * THUMB_BYTES);
    expect(est.originals).toBe(140 * 1024 ** 3);
    expect(est.fitsFree).toBe(true);
    expect(Math.round(est.shareOfFree * 100)).toBe(9);
  });

  it("warns when thumbnails alone pass the 7 GB line", () => {
    const big = summarizeProbe({ ...sample, total: 300000 });
    expect(big.estimate.fitsFree).toBe(false);
    expect(big.notes.join(" ")).toMatch(/7 GB/);
    expect(summarizeProbe(sample).notes.join(" ")).not.toMatch(/7 GB/);
  });

  it("says so when access is limited or sizes are missing", () => {
    expect(summarizeProbe({ ...sample, access: "limited" }).notes[0]).toMatch(/Full Access/);
    expect(summarizeProbe({ ...sample, sizeUnknown: 12 }).notes.join(" ")).toMatch(/12 items didn't report a size/);
    expect(summarizeProbe({ ...sample, originalsLocal: 0, originalsCloudOnly: 0, originalsUnknown: 30000 }).notes.join(" ")).toMatch(/didn't say which originals/);
  });

  it("builds the report rows and the copy text", () => {
    const { groups } = summarizeProbe(sample);
    const row = (title, label) => groups.find((g) => g.title === title).rows.find((r) => r.label === label).value;
    expect(row("Library", "Photos")).toBe("27,500");
    expect(row("Library", "Videos")).toBe("2,500 (20 h 30 min)");
    expect(row("Library", "From")).toBe("Jun 2012 to Nov 2026");
    expect(row("Size of the originals", "Total")).toBe("140 GB");
    expect(row("Where the originals are", "Only in iCloud")).toBe("24,000 (80%)");
    expect(row("Worth knowing", "Screenshots")).toBe("3,200 (2.0 GB)");
    expect(row("What Live would store now", "Thumbnails")).toBe("879 MB (9% of the free 10 GB)");
    expect(row("By year", "2026")).toBe("5,000");
    const text = probeReportText(sample, { when: "Nov 15" });
    expect(text.startsWith("Photos check (Nov 15)")).toBe(true);
    expect(text).toContain("Only in iCloud: 24,000 (80%)");
    expect(text).toContain("Counted in 42 seconds.");
  });
});
