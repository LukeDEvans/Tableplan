const test = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("../grocery-catalog");

test("comma ordering and descriptors merge unsalted butter", () => {
  const first = catalog.normalizeGroceryItemName("butter, unsalted");
  const second = catalog.normalizeGroceryItemName("Unsalted Butter");
  assert.equal(first.canonicalName, "unsalted butter");
  assert.equal(first.canonicalName, second.canonicalName);
  assert.equal(first.displayName, "Unsalted Butter");
});

test("synonyms merge chickpeas and garbanzo beans", () => {
  assert.equal(catalog.normalizeGroceryItemName("chickpeas").canonicalName, "garbanzo beans");
  assert.equal(catalog.normalizeGroceryItemName("garbanzo beans").canonicalName, "garbanzo beans");
});

test("synonyms merge scallions and green onions", () => {
  assert.equal(catalog.normalizeGroceryItemName("scallions").canonicalName, "green onions");
  assert.equal(catalog.normalizeGroceryItemName("green onions").canonicalName, "green onions");
});

test("plural, punctuation, and capitalization differences normalize", () => {
  const variants = ["Apple", "apples", "APPLE", "apples,"];
  assert.deepEqual(new Set(variants.map((value) => catalog.normalizeGroceryItemName(value).canonicalName)), new Set(["apple"]));
  assert.equal(catalog.normalizeGroceryItemName("tomatoes").canonicalName, "tomato");
  assert.equal(catalog.normalizeGroceryItemName("potatoes").canonicalName, "potato");
});

test("prep words become notes while shopping descriptors remain", () => {
  const tomato = catalog.normalizeGroceryItemName("tomatoes, diced, for serving");
  assert.equal(tomato.canonicalName, "tomato");
  assert.deepEqual(tomato.notes.sort(), ["diced", "for serving"]);
  assert.equal(catalog.normalizeGroceryItemName("salted butter").canonicalName, "salted butter");
  assert.equal(catalog.normalizeGroceryItemName("whole milk").canonicalName, "whole milk");
});

test("olive oil variants merge while preserving extra virgin as a note", () => {
  const oil = catalog.normalizeGroceryItemName("olive oil, extra virgin");
  assert.equal(oil.canonicalName, "olive oil");
  assert.deepEqual(oil.notes, ["extra virgin"]);
});

test("compatible quantities add and incompatible units remain visible", () => {
  const merged = catalog.mergeGroceryRows([
    { item: "unsalted butter", amount: "2", unit: "Tbsp", quantity: "2 Tbsp", sourceRecipeId: "recipe-1" },
    { item: "butter, unsalted", amount: "1", unit: "Tbsp", quantity: "1 Tbsp", sourceRecipeId: "recipe-2" },
    { item: "unsalted butter", amount: "1", unit: "stick", quantity: "1 stick", prep: "melted" }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].canonicalName, "unsalted butter");
  assert.equal(merged[0].displayName, "Unsalted Butter");
  assert.equal(merged[0].quantity, "3 Tbsp + 1 stick");
  assert.deepEqual(new Set(merged[0].rawNames), new Set(["unsalted butter", "butter, unsalted"]));
  assert.deepEqual(new Set(merged[0].sourceRecipeIds), new Set(["recipe-1", "recipe-2"]));
  assert.deepEqual(merged[0].notes, ["melted"]);
});

test("user merge mappings are reused", () => {
  const aliases = { "garbanzo beans": ["ceci beans"] };
  assert.equal(catalog.normalizeGroceryItemName("ceci beans", { aliases }).canonicalName, "garbanzo beans");
  const merged = catalog.mergeGroceryRows([
    { item: "ceci beans", amount: "1", unit: "can", quantity: "1 can" },
    { item: "chickpeas", amount: "2", unit: "can", quantity: "2 can" }
  ], { aliases });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, "3 can");
});

test("user split preferences override automatic synonyms", () => {
  const splitPreferences = { scallion: "scallion" };
  assert.equal(catalog.normalizeGroceryItemName("scallions", { splitPreferences }).canonicalName, "scallion");
  assert.equal(catalog.normalizeGroceryItemName("green onions", { splitPreferences }).canonicalName, "green onions");
});

test("catalog contains several hundred categorized ingredients", () => {
  const entries = catalog.catalogEntries();
  assert.ok(entries.length >= 250);
  assert.ok(entries.some((entry) => entry.category === "Produce" && entry.subcategory === "Fruits" && entry.name === "apple"));
  assert.ok(entries.some((entry) => entry.category === "Dairy" && entry.subcategory === "Butter" && entry.name === "unsalted butter"));
});
