const test = require("node:test");
const assert = require("node:assert/strict");
const mealPlan = require("../meal-plan-servings");

const recipe = {
  id: "lentil-soup",
  name: "Lentil Soup",
  servings: 4,
  ingredients: [{ amount: "2", quantity: "C", item: "lentils" }],
  nutritionEstimate: { perServing: { calories: 300, protein: 18, carbs: 45, fat: 6, fiber: 12, sugar: 4, sodium: 500, saturatedFat: 1 } }
};

test("adding a recipe defaults planned servings to recipe default servings", () => {
  const entry = mealPlan.createMealPlanRecipe(recipe, { id: "entry-1" });
  assert.equal(entry.plannedServings, 4);
});

test("editing planned servings persists without changing recipe default servings", () => {
  const entry = mealPlan.createMealPlanRecipe(recipe, { id: "entry-1", plannedServings: 8 });
  const storedEntry = JSON.parse(JSON.stringify(entry));
  const normalized = mealPlan.normalizeMealPlanRecipe(storedEntry, recipe);
  assert.equal(normalized.plannedServings, 8);
  assert.equal(recipe.servings, 4);
});

test("grocery scaling factor uses planned servings divided by recipe yield", () => {
  const entry = mealPlan.createMealPlanRecipe(recipe, { plannedServings: 8 });
  assert.equal(mealPlan.scalingFactor(entry, recipe), 2);
  assert.deepEqual(mealPlan.scaleIngredient(recipe.ingredients[0], entry, recipe), {
    amount: 4,
    quantity: "C",
    item: "lentils"
  });
});

test("meal-plan nutrition totals use planned servings", () => {
  const entry = mealPlan.createMealPlanRecipe(recipe, { plannedServings: 8 });
  const totals = mealPlan.sumMealPlanNutrition([entry], (id) => id === recipe.id ? recipe : null);
  assert.equal(totals.calories, 2400);
  assert.equal(totals.protein, 144);
});
