import { describe, it, expect } from "vitest";
import { ingredientGroups, findIngredientConflicts, mergeMemberDiets, normalizeMemberDiets, foodRestrictionsContext, isEmptyDiet } from "../food-restrictions.js";

describe("ingredient matching", () => {
  const g = (t) => ingredientGroups(t);
  it("finds the obvious", () => {
    expect(g("2 tbsp peanut butter")).toContain("peanuts");
    expect(g("shrimp, peeled")).toContain("shellfish");
    expect(g("large eggs")).toContain("eggs");
    expect(g("spaghetti")).toContain("wheat");
    expect(g("soy sauce")).toEqual(expect.arrayContaining(["soy", "wheat"]));
    expect(g("bacon")).toEqual(expect.arrayContaining(["meat", "pork"]));
  });
  it("doesn't trip on look-alikes", () => {
    expect(g("eggplant")).not.toContain("eggs");
    expect(g("ground nutmeg")).not.toContain("tree-nuts");
    expect(g("butternut squash")).toEqual([]);
    expect(g("peanut butter")).not.toContain("milk");
    expect(g("coconut milk")).not.toContain("milk");
    expect(g("almond milk")).toEqual(["tree-nuts"]);
    expect(g("gluten-free pasta")).not.toContain("wheat");
    expect(g("corn tortillas")).not.toContain("wheat");
    expect(g("vegetable broth")).not.toContain("meat");
    expect(g("turkey bacon")).not.toContain("pork");
  });
});

describe("conflicts", () => {
  const members = [{ id: "m1", label: "Luke" }, { id: "m2", label: "Kid" }];
  const diets = {
    m1: { diets: ["vegetarian"], allergies: [], updatedAt: "2026-10-13T00:00:00Z" },
    m2: { diets: [], allergies: ["peanuts", "milk"], updatedAt: "2026-10-13T00:00:00Z" },
  };
  it("names the person, the restriction and the ingredients", () => {
    const c = findIngredientConflicts(["chicken thighs", "peanut butter", "butter", "rice"], diets, members);
    expect(c).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Luke", kind: "diet", id: "vegetarian", ingredients: ["chicken thighs"] }),
      expect.objectContaining({ label: "Kid", kind: "allergy", id: "peanuts", ingredients: ["peanut butter"] }),
      expect.objectContaining({ label: "Kid", kind: "allergy", id: "milk", ingredients: ["butter"] }),
    ]));
    expect(c).toHaveLength(3);
  });
  it("nothing for a safe recipe or no restrictions", () => {
    expect(findIngredientConflicts(["rice", "black beans"], diets, members)).toEqual([]);
    expect(findIngredientConflicts(["shrimp"], {}, members)).toEqual([]);
  });
});

describe("storage", () => {
  it("normalizes away unknown ids and junk", () => {
    expect(normalizeMemberDiets({ m1: { diets: ["vegan", "carnivore"], allergies: ["sesame", 3], other: " x " } }))
      .toEqual({ m1: { diets: ["vegan"], allergies: ["sesame"], other: "x", updatedAt: "" } });
    expect(normalizeMemberDiets(null)).toEqual({});
    expect(isEmptyDiet({ diets: [], allergies: [], other: "" })).toBe(true);
  });
  it("merges per member by updatedAt and keeps a newer clear", () => {
    const a = { m1: { diets: [], allergies: [], updatedAt: "2026-10-13T02:00:00Z" }, m2: { diets: ["vegan"], allergies: [], updatedAt: "2026-10-13T01:00:00Z" } };
    const b = { m1: { diets: ["vegan"], allergies: ["soy"], updatedAt: "2026-10-13T01:00:00Z" }, m3: { diets: [], allergies: ["fish"], updatedAt: "2026-10-12T00:00:00Z" } };
    const m = mergeMemberDiets(a, b);
    expect(m.m1.allergies).toEqual([]);
    expect(m.m2.diets).toEqual(["vegan"]);
    expect(m.m3.allergies).toEqual(["fish"]);
    expect(mergeMemberDiets(b, a)).toEqual(m);
  });
  it("assistant line lists only people with something set", () => {
    const line = foodRestrictionsContext(
      { m1: { diets: ["gluten-free"], allergies: ["shellfish"], other: "no mushrooms" }, m2: { diets: [], allergies: [] } },
      [{ id: "m1", label: "Luke" }, { id: "m2", label: "Kid" }]);
    expect(line).toContain("Luke: allergic to shellfish; gluten-free; notes: no mushrooms");
    expect(line).not.toContain("Kid");
    expect(foodRestrictionsContext({}, [])).toBe("");
  });
});
