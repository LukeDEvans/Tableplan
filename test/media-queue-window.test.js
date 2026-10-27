// Queue windows stop at a month (Luke, 2026-10-26): episodes are kept 30 days, so
// "Past 2/3 months" couldn't work; stored values move to "month".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

describe("queue window options", () => {
  it("offers nothing past a month", () => {
    const block = app.slice(app.indexOf("const RECENT_WINDOW_OPTIONS = ["), app.indexOf("];", app.indexOf("const RECENT_WINDOW_OPTIONS = [")));
    const values = [...block.matchAll(/value: "([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual(["day", "week", "2weeks", "3weeks", "month"]);
  });
  it("moves a stored 2- or 3-month window to a month when state loads", () => {
    expect(app).toMatch(/for \(const key of \["podcastPlaylistWindow", "podcastRecentWindow"\]\) \{\s*if \(normalized\[key\] === "2months" \|\| normalized\[key\] === "3months"\) normalized\[key\] = "month";/);
  });
});
