// Display mode + theme resolution (theme.js, THEMES_DESIGN.md).
import { describe, it, expect } from "vitest";
import { cleanDisplayPrefs, normalizeDisplayPrefs, resolveTheme, seasonalTheme, seasonEnds, seasonalSummary, THEMES, THEME_GROUPS, THEME_CHOICES } from "../theme.js";

const oct = new Date(2026, 9, 13);
const nov1 = new Date(2026, 10, 1);
const nov30 = new Date(2026, 10, 30, 23, 59);
const dec1 = new Date(2026, 11, 1);
const sep30 = new Date(2026, 8, 30, 23, 59);

describe("seasonalTheme", () => {
  it("is Halloween for all of October, Thanksgiving for all of November (Luke, 2026-11-03)", () => {
    expect(seasonalTheme(new Date(2026, 9, 1))).toBe("halloween");
    expect(seasonalTheme(oct)).toBe("halloween");
    expect(seasonalTheme(new Date(2026, 9, 31, 23, 59))).toBe("halloween");
    expect(seasonalTheme(nov1)).toBe("thanksgiving");
    expect(seasonalTheme(nov30)).toBe("thanksgiving");
    expect(seasonalTheme(dec1)).toBe("classic");
    expect(seasonalTheme(sep30)).toBe("classic");
  });
  it("knows when the season ends", () => {
    const end = seasonEnds(oct);
    expect([end.getMonth(), end.getDate()]).toEqual([10, 1]);
    const tEnd = seasonEnds(nov1);
    expect([tEnd.getMonth(), tEnd.getDate()]).toEqual([11, 1]);
    expect(seasonEnds(dec1)).toBeNull();
  });
  it("the Display line names what comes next, not always Classic", () => {
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    expect(seasonalSummary(oct, fmt)).toBe("Halloween now, Thanksgiving from 11/1.");
    expect(seasonalSummary(nov1, fmt)).toBe("Thanksgiving now, Classic from 12/1.");
    expect(seasonalSummary(dec1, fmt)).toBe("Halloween in October, Thanksgiving in November, Classic the rest of the year.");
  });
});

describe("display prefs", () => {
  it("stores only explicit, valid choices", () => {
    expect(cleanDisplayPrefs({ mode: "dark", theme: "spooky", icon: "yes", extra: 1 })).toEqual({ mode: "dark" });
    expect(cleanDisplayPrefs(null)).toEqual({});
  });
  it("defaults to Classic (seasonal is opt-in) and the legacy household mode", () => {
    expect(normalizeDisplayPrefs({}, "dark")).toEqual({ mode: "dark", theme: "classic", icon: true, name: "", holidays: false, gameday: false, gamedayTeams: [] });
    expect(normalizeDisplayPrefs({}, undefined).mode).toBe("light");
  });
  it("a person's own mode beats the legacy household one", () => {
    expect(normalizeDisplayPrefs({ mode: "light" }, "dark").mode).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("resolves Auto from the device setting", () => {
    expect(resolveTheme({ mode: "auto" }, { systemDark: true }).scheme).toBe("dark");
    expect(resolveTheme({ mode: "auto" }, { systemDark: false }).scheme).toBe("light");
    expect(resolveTheme({ mode: "dark" }, { systemDark: false }).scheme).toBe("dark");
  });
  it("seasonal picks Halloween in October, Thanksgiving in November and Classic after", () => {
    expect(resolveTheme({ theme: "seasonal" }, { now: oct }).palette).toBe("halloween");
    expect(resolveTheme({ theme: "seasonal" }, { now: nov1 }).palette).toBe("thanksgiving");
    expect(resolveTheme({ theme: "seasonal" }, { now: dec1 }).palette).toBe("classic");
    expect(resolveTheme({ theme: "halloween" }, { now: nov1 }).palette).toBe("halloween");
    expect(resolveTheme({ theme: "thanksgiving", mode: "dark" }, { now: dec1 })).toMatchObject({ palette: "thanksgiving", scheme: "dark", icon: "" });
  });
  it("the icon follows the theme unless turned off", () => {
    expect(resolveTheme({ theme: "halloween" }, { now: oct }).icon).toBe("AppIconHalloween");
    expect(resolveTheme({ theme: "halloween", icon: false }, { now: oct }).icon).toBe("");
    expect(resolveTheme({ theme: "seasonal" }, { now: nov1 }).icon).toBe("");
    expect(resolveTheme({ theme: "seasonal" }, { now: dec1 }).icon).toBe("");
  });
  it("every theme has a theme-color for both modes", () => {
    for (const t of Object.values(THEMES)) {
      expect(t.themeColor.light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.themeColor.dark).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("Household and Urban Greens are pickable; Classic stays the default (Luke, 2026-10-20)", () => {
    for (const t of ["household", "urbangreens"]) {
      expect(cleanDisplayPrefs({ theme: t })).toEqual({ theme: t });
      expect(resolveTheme({ theme: t }, { now: oct }).palette).toBe(t);
      expect(resolveTheme({ theme: t, mode: "dark" }, { now: oct }).scheme).toBe("dark");
      expect(resolveTheme({ theme: t }, { now: oct }).icon).toBe("");
    }
    expect(normalizeDisplayPrefs({}).theme).toBe("classic");
    expect(resolveTheme({}, { now: nov1 }).palette).toBe("classic");
  });
  it("Display rows: General, Holiday, Business, Sports; every theme in exactly one (Luke, 2026-10-25)", () => {
    expect(THEME_GROUPS.map((g) => g.label)).toEqual(["General", "Holiday", "Business", "Sports"]);
    const listed = THEME_GROUPS.flatMap((g) => g.themes);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...Object.keys(THEMES), "seasonal"].sort());
    expect(THEME_CHOICES).toEqual(listed);
    expect(THEME_GROUPS.find((g) => g.key === "sports").themes).toEqual(["vikings", "wolves", "wild", "twins", "gophers", "ajax", "mnufc"]);
    expect(THEME_GROUPS.find((g) => g.key === "holiday").themes).toEqual(["halloween", "thanksgiving", "seasonal"]);
  });
  it("sports themes are pickable and resolve in both modes; Classic stays the default", () => {
    for (const t of THEME_GROUPS.find((g) => g.key === "sports").themes) {
      expect(cleanDisplayPrefs({ theme: t })).toEqual({ theme: t });
      expect(resolveTheme({ theme: t, mode: "dark" }, { now: oct })).toMatchObject({ palette: t, scheme: "dark", icon: "" });
    }
    expect(normalizeDisplayPrefs({}).theme).toBe("classic");
  });
});
