// Server functions pick "the user's group" one way, ordered by when they joined
// (ISSUES.md P2, 2026-10-20). An unordered `limit=1` would make the pick arbitrary
// as soon as someone has a second membership.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import groupLookup from "../netlify/functions/_group-lookup.js";

const { userGroupQuery } = groupLookup;
const dir = new URL("../netlify/functions/", import.meta.url);

describe("server group lookup", () => {
  it("orders by join time and takes one", () => {
    expect(userGroupQuery("a b")).toBe("live_group_members?user_id=eq.a%20b&select=group_id&order=joined_at.asc,group_id.asc&limit=1");
    expect(userGroupQuery("u", "group_id,role")).toContain("select=group_id,role&order=joined_at.asc");
  });

  it("no function looks up a user's group without that order", () => {
    const offenders = [];
    for (const name of readdirSync(dir)) {
      if (!/\.(m?js)$/.test(name) || name === "_group-lookup.js") continue;
      const src = readFileSync(new URL(name, dir), "utf8");
      for (const m of src.matchAll(/live_group_members\?user_id=eq\.[^`"']*/g)) {
        if (/limit=1/.test(m[0]) && !/order=/.test(m[0])) offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("background jobs pick the household's first admin, not an arbitrary one", () => {
    const offenders = [];
    for (const name of readdirSync(dir)) {
      if (!/\.(m?js)$/.test(name)) continue;
      const src = readFileSync(new URL(name, dir), "utf8");
      for (const m of src.matchAll(/live_group_members\?[^`"']*role=eq\.admin[^`"']*/g)) {
        if (/limit=1/.test(m[0]) && !/order=/.test(m[0])) offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
