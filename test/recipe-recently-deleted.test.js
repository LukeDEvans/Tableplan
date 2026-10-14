// Recently deleted recipes (SETTINGS_AUDIT.md; Luke, 2026-10-14): a deleted recipe is
// kept for 30 days, then purged for good.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isTrashExpired, TRASH_RETENTION_DAYS } from "../recipes-ui.js";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-14T12:00:00Z");
const at = (daysAgo) => ({ id: `t${daysAgo}`, deletedAt: new Date(now - daysAgo * DAY).toISOString() });

describe("recently deleted recipes", () => {
  it("keeps recipes for 30 days", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(isTrashExpired(at(0), now)).toBe(false);
    expect(isTrashExpired(at(29), now)).toBe(false);
    expect(isTrashExpired(at(30), now)).toBe(false);
    expect(isTrashExpired(at(31), now)).toBe(true);
  });

  it("never expires an entry without a usable date", () => {
    expect(isTrashExpired({ id: "x" }, now)).toBe(false);
    expect(isTrashExpired({ id: "x", deletedAt: "not a date" }, now)).toBe(false);
    expect(isTrashExpired(null, now)).toBe(false);
  });

  it("purges only when a recipe is deleted or the view opens, never at boot", () => {
    const recipes = readFileSync(new URL("../recipes-ui.js", import.meta.url), "utf8");
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    // deleteRecipeById purges after adding to the trash; the view purges on open.
    expect(/trashedRecipes\(\)\.unshift\([\s\S]{0,200}?\}\);\s*purgeExpiredTrash\(\);/.test(recipes)).toBe(true);
    expect(/function openTrashDialog[\s\S]{0,200}?purgeExpiredTrash\(\);/.test(app)).toBe(true);
    // Every other call is inside a function body (indented), not a top-level boot call.
    const topLevel = app.split("\n").filter((l) => /^purgeExpiredTrash\(/.test(l));
    expect(topLevel).toEqual([]);
  });
});
