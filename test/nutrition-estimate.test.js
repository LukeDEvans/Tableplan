const test = require("node:test");
const assert = require("node:assert/strict");

const domain = require("../nutrition-domain");
const { estimateRecipeNutrition } = require("../nutrition-provider");

const appleFood = {
  fdcId: "171688",
  description: "Apples, raw, with skin",
  servingSize: 100,
  servingSizeUnit: "g",
  foodNutrients: [
    { nutrientId: 1008, value: 52 },
    { nutrientId: 1003, value: 0.26 },
    { nutrientId: 1005, value: 13.81 },
    { nutrientId: 1004, value: 0.17 },
    { nutrientId: 1079, value: 2.4 },
    { nutrientId: 2000, value: 10.39 },
    { nutrientId: 1093, value: 1 },
    { nutrientId: 1258, value: 0.028 }
  ],
  confidenceScore: 0.95
};

test("unit conversion handles exact mass units and flags uncertain volume units", () => {
  assert.equal(Math.round(domain.convertToGrams(2, "lb").grams), 907);
  assert.equal(domain.convertToGrams(1, "kg").grams, 1000);
  assert.equal(Math.round(domain.convertToGrams(2, "oz").grams), 57);
  const cup = domain.convertToGrams(1, "cup");
  assert.equal(cup.grams, 240);
  assert.ok(cup.confidenceScore < 0.5);
});

test("serving calculation divides full recipe totals", () => {
  const ingredient = domain.structureIngredient({ amount: "200", quantity: "g", item: "apples", prep: "" });
  const match = domain.calculateIngredientNutrition(ingredient, appleFood);
  const estimate = domain.sumNutrition([match], 4);
  assert.equal(estimate.totals.calories, 104);
  assert.equal(estimate.perServing.calories, 26);
  assert.equal(estimate.servings, 4);
});

test("ingredient matching uses the top USDA result", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ foods: [appleFood] })
  });
  const result = await estimateRecipeNutrition({
    ingredients: [{ amount: "100", quantity: "g", item: "apple", prep: "" }],
    servings: 1
  }, { apiKey: "test", fetchImpl });
  assert.equal(result.matches[0].fdcId, appleFood.fdcId);
  assert.equal(result.perServing.calories, 52);
});

test("saved ingredient corrections are reused without a USDA key", async () => {
  const result = await estimateRecipeNutrition({
    ingredients: [{ amount: "100", quantity: "g", item: "apple", prep: "" }],
    servings: 1,
    corrections: { apple: appleFood }
  }, { apiKey: "" });
  assert.equal(result.matches[0].fdcId, appleFood.fdcId);
  assert.equal(result.matches[0].savedCorrectionUsed, true);
});

test("missing and ambiguous ingredients remain reviewable", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ foods: [] })
  });
  const result = await estimateRecipeNutrition({
    ingredients: [
      { amount: "", quantity: "", item: "mystery ingredient", prep: "" },
      { amount: "1", quantity: "cup", item: "unknown blend", prep: "optional" }
    ],
    servings: 2
  }, { apiKey: "test", fetchImpl });
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].fdcId, "");
  assert.equal(result.matches[1].optional, true);
  assert.equal(result.confidenceScore, 0);
});

// REC-12: metric / larger US volume units convert (≈1 g/ml, low confidence).
test("unit conversion handles ml / l / pt / qt / gal at ~1 g per ml", () => {
  assert.equal(domain.convertToGrams(250, "ml").grams, 250);
  assert.equal(domain.convertToGrams(2, "milliliters").grams, 2);
  assert.equal(domain.convertToGrams(1.5, "L").grams, 1500);
  assert.equal(Math.round(domain.convertToGrams(1, "pint").grams), 473);
  assert.equal(Math.round(domain.convertToGrams(1, "qt").grams), 946);
  assert.equal(Math.round(domain.convertToGrams(1, "gallon").grams), 3785);
  assert.ok(domain.convertToGrams(1, "l").confidenceScore < 0.5);
});

// REC-12: USDA lookups run concurrently (bounded) and a per-ingredient failure is unmatched.
test("USDA lookups are concurrent with a cap of 4", async () => {
  let active = 0;
  let peak = 0;
  const fetchImpl = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { ok: true, json: async () => ({ foods: [appleFood] }) };
  };
  const ingredients = Array.from({ length: 9 }, (_, i) => ({ amount: "100", quantity: "g", item: `apple ${i}`, prep: "" }));
  const result = await estimateRecipeNutrition({ ingredients, servings: 1 }, { apiKey: "test", fetchImpl });
  assert.equal(result.matches.length, 9);
  assert.equal(peak, 4);
  assert.deepEqual(result.matches.map((m) => m.ingredientName || m.rawLine).length, 9);
});

test("a single failed USDA lookup marks that ingredient unmatched instead of failing all", async () => {
  const fetchImpl = async (_url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.includes("banana")) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ foods: [appleFood] }) };
  };
  const result = await estimateRecipeNutrition({
    ingredients: [
      { amount: "100", quantity: "g", item: "apple", prep: "" },
      { amount: "100", quantity: "g", item: "banana", prep: "" }
    ],
    servings: 1
  }, { apiKey: "test", fetchImpl });
  assert.equal(result.matches[0].fdcId, appleFood.fdcId);
  assert.equal(result.matches[1].fdcId, "");
  assert.match(result.matches[1].conversionNote, /lookup failed/i);
  assert.equal(result.perServing.calories, 52);
});

test("when every USDA lookup fails the estimate still fails", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(
    estimateRecipeNutrition({ ingredients: [{ amount: "1", quantity: "g", item: "apple", prep: "" }], servings: 1 }, { apiKey: "test", fetchImpl }),
    /429/
  );
});
