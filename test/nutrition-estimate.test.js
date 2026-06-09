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
