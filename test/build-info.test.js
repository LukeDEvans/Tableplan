// Build stamp + reload prompt (ISSUES.md P1, 2026-10-06).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeBuild, formatBuild, isNewerBuild, versionCheckDue, VERSION_CHECK_MIN_MS, BUILD } from "../build-info.js";

const a = { commit: "aaaaaaa1111", builtAt: "2026-10-26T10:00:00Z" };
const b = { commit: "bbbbbbb2222", builtAt: "2026-10-27T10:00:00Z" };

describe("build info", () => {
  it("is unstamped outside a build", () => {
    expect(BUILD).toEqual({ commit: "dev", builtAt: "" });
    expect(formatBuild(BUILD)).toBe("local dev");
  });

  it("normalizes odd input", () => {
    expect(normalizeBuild(null)).toEqual({ commit: "dev", builtAt: "" });
    expect(normalizeBuild({ commit: "x", builtAt: "nope" })).toEqual({ commit: "x", builtAt: "" });
  });

  it("shows the short commit and time", () => {
    expect(formatBuild(a, "en-US")).toMatch(/^aaaaaaa · Oct 2[56]/);
    expect(formatBuild({ commit: "abcdef123" })).toBe("abcdef1");
  });

  it("asks to reload only for a later, different build", () => {
    expect(isNewerBuild(b, a)).toBe(true);
    expect(isNewerBuild(a, b)).toBe(false);
    expect(isNewerBuild(a, a)).toBe(false);
    expect(isNewerBuild({ ...b, commit: a.commit }, a)).toBe(false);
    expect(isNewerBuild(b, { commit: "dev" })).toBe(false); // local dev never prompts
    expect(isNewerBuild({ commit: "dev" }, a)).toBe(false);
    expect(isNewerBuild(null, a)).toBe(false);
  });

  it("checks at most every 30 minutes", () => {
    expect(VERSION_CHECK_MIN_MS).toBe(30 * 60 * 1000);
    expect(versionCheckDue(0, 1000)).toBe(true);
    expect(versionCheckDue(1000, 1000 + VERSION_CHECK_MIN_MS - 1)).toBe(false);
    expect(versionCheckDue(1000, 1000 + VERSION_CHECK_MIN_MS)).toBe(true);
  });

  it("the check reads the static version file, not Supabase, and skips the iPhone app", () => {
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    const fn = app.slice(app.indexOf("async function checkForNewerBuild"), app.indexOf("function reloadForNewerBuild"));
    expect(fn).toContain("/version.json");
    expect(fn).not.toMatch(/supabase|rest\/v1/i);
    expect(app).toMatch(/function wireNewerBuildCheck\(\) \{\s*if \(isNativeApp\(\)/);
    const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
    expect(sw).toContain('url.pathname === "/version.json") return false');
  });
});
