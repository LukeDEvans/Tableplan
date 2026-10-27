// Recipe rows (ISSUES.md, 2026-10-16): opening the app must not re-upsert every recipe,
// only those whose row would actually change.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { recipesNeedingRowWrite } from "../recipes-ui.js";

const keyOf = (r) => JSON.stringify({ name: r.name, tags: r.tags });

describe("recipe row write-back", () => {
  it("writes nothing when every recipe matches its stored row", () => {
    const recipes = [{ id: "a", name: "Soup", tags: [] }, { id: "b", name: "Stew", tags: ["x"] }];
    const remote = new Map(recipes.map((r) => [r.id, keyOf(r)]));
    expect(recipesNeedingRowWrite(recipes, remote, keyOf)).toEqual([]);
  });

  it("writes only recipes that differ or have no row", () => {
    const recipes = [{ id: "a", name: "Soup", tags: ["new"] }, { id: "b", name: "Stew", tags: [] }, { id: "c", name: "New", tags: [] }];
    const remote = new Map([["a", keyOf({ name: "Soup", tags: [] })], ["b", keyOf(recipes[1])]]);
    expect(recipesNeedingRowWrite(recipes, remote, keyOf).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("falls back to writing everything without stored keys", () => {
    const recipes = [{ id: "a", name: "Soup", tags: [] }];
    expect(recipesNeedingRowWrite(recipes, undefined, keyOf)).toEqual(recipes);
    expect(recipesNeedingRowWrite(null, new Map(), keyOf)).toEqual([]);
  });

  it("hydration no longer writes every recipe back", () => {
    const src = readFileSync(new URL("../recipes-ui.js", import.meta.url), "utf8");
    const hydrate = src.slice(src.indexOf("async function hydrateRecipeRowsFromSupabase"), src.indexOf("async function loadFolderRowsFromSupabase"));
    expect(hydrate).toContain("writeChangedRecipeRowsToSupabase(recipes)");
    // The only full write left is the first-time seed when the table is empty.
    expect(hydrate.match(/writeAllRecipeRowsToSupabase\(\)/g) || []).toHaveLength(1);
  });
});
