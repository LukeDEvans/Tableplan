import { describe, it, expect } from "vitest";
import * as catalog from "../grocery-catalog.js";

describe("grocery-catalog normalization (regression)", () => {
  it("keeps the documented identities stable", () => {
    expect(catalog.normalizeGroceryItemName("butter, unsalted").canonicalName).toBe("unsalted butter");
    expect(catalog.normalizeGroceryItemName("chickpeas").canonicalName).toBe("garbanzo beans");
    expect(catalog.normalizeGroceryItemName("scallions").canonicalName).toBe("green onions");
    expect(catalog.normalizeGroceryItemName("tomatoes").canonicalName).toBe("tomato");
    const tomato = catalog.normalizeGroceryItemName("tomatoes, diced, for serving");
    expect(tomato.canonicalName).toBe("tomato");
    expect([...tomato.notes].sort()).toEqual(["diced", "for serving"]);
    expect(catalog.normalizeGroceryItemName("olive oil, extra virgin").notes).toEqual(["extra virgin"]);
  });

  it("precompiled prep patterns give the same result on repeated calls (no lastIndex leak)", () => {
    for (let i = 0; i < 3; i += 1) {
      const a = catalog.normalizeGroceryItemName("onion, chopped");
      expect(a.canonicalName).toBe("onion");
      expect(a.notes).toEqual(["chopped"]);
    }
  });

  it("aliases resolve, first-listed group wins, and in-place alias edits are seen", () => {
    const aliases = { "garbanzo beans": ["ceci beans"] };
    expect(catalog.normalizeGroceryItemName("ceci beans", { aliases }).canonicalName).toBe("garbanzo beans");
    expect(catalog.normalizeGroceryItemName("pulses", { aliases }).canonicalName).toBe("pulse");
    aliases["garbanzo beans"].push("pulses");
    expect(catalog.normalizeGroceryItemName("pulses", { aliases }).canonicalName).toBe("garbanzo beans");
    const both = { first: ["kale"], second: ["kale"] };
    expect(catalog.normalizeGroceryItemName("kale", { aliases: both }).canonicalName).toBe("first");
  });

  it("split preferences still override synonyms", () => {
    const splitPreferences = { scallion: "scallion" };
    expect(catalog.normalizeGroceryItemName("scallions", { splitPreferences }).canonicalName).toBe("scallion");
  });

  it("singularizeWord leaves invariant plurals alone (GRO-19)", () => {
    expect(catalog.singularizeWord("grits")).toBe("grits");
    expect(catalog.singularizeWord("bitters")).toBe("bitters");
    expect(catalog.singularizeWord("apples")).toBe("apple");
    expect(catalog.singularizeWord("cherries")).toBe("cherry");
  });
});

describe("mergeGroceryRows unit normalization (GRO-7)", () => {
  it("sums unit spellings that mean the same thing", () => {
    const merged = catalog.mergeGroceryRows([
      { item: "milk", amount: "1", unit: "cup" },
      { item: "milk", amount: "2", unit: "cups" },
      { item: "milk", amount: "1", unit: "Cup" }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe("4 cup");
  });

  it("keeps tbsp and tsp apart (including T vs t) and keeps incompatible units visible", () => {
    const merged = catalog.mergeGroceryRows([
      { item: "unsalted butter", amount: "2", unit: "Tbsp" },
      { item: "butter, unsalted", amount: "1", unit: "tablespoon" },
      { item: "unsalted butter", amount: "1", unit: "T" },
      { item: "unsalted butter", amount: "1", unit: "tsp" },
      { item: "unsalted butter", amount: "1", unit: "t" },
      { item: "unsalted butter", amount: "1", unit: "stick" }
    ]);
    expect(merged[0].quantity).toBe("4 Tbsp + 2 tsp + 1 stick");
  });

  it("groceryUnitKey maps aliases and plurals", () => {
    expect(catalog.groceryUnitKey("Pounds")).toBe("lb");
    expect(catalog.groceryUnitKey("oz.")).toBe("oz");
    expect(catalog.groceryUnitKey("cans")).toBe("can");
    expect(catalog.groceryUnitKey("")).toBe("");
  });
});
