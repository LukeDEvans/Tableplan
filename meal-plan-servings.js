"use strict";

const nutrientKeys = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium", "saturatedFat"];

function recipeDefaultServings(recipe) {
  return Math.max(0.01, Number(recipe?.defaultServings ?? recipe?.servings) || 1);
}

function createMealPlanRecipe(recipe, overrides = {}) {
  const defaultServings = recipeDefaultServings(recipe);
return {
    id: String(overrides.id || `meal-plan-recipe-${Date.now()}`),
    recipeId: String(recipe?.id || overrides.recipeId || ""),
    date: String(overrides.date || ""),
    mealType: String(overrides.mealType || ""),
    plannedServings: Math.max(0.01, Number(overrides.plannedServings) || defaultServings),
    notes: String(overrides.notes || "")
  };
}

function isMealPlanRecipe(entry) {
  return Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && entry.recipeId);
}

function normalizeMealPlanRecipe(entry, recipe = null) {
  if (!isMealPlanRecipe(entry)) return entry;
  const defaultServings = recipeDefaultServings(recipe);
return {
    id: String(entry.id || `meal-plan-recipe-${Date.now()}`),
    recipeId: String(entry.recipeId || ""),
    date: String(entry.date || ""),
    mealType: String(entry.mealType || ""),
    plannedServings: Math.max(0.01, Number(entry.plannedServings) || defaultServings),
    notes: String(entry.notes || "")
  };
}

function plannedServings(entry, recipe) {
  return isMealPlanRecipe(entry)
    ? Math.max(0.01, Number(entry.plannedServings) || recipeDefaultServings(recipe))
    : recipeDefaultServings(recipe);
}

function scalingFactor(entry, recipe) {
  return plannedServings(entry, recipe) / recipeDefaultServings(recipe);
}

function scaleIngredient(ingredient, entry, recipe) {
  const factor = scalingFactor(entry, recipe);
  const amount = Number(ingredient?.amount);
return {
    ...ingredient,
    amount: Number.isFinite(amount) ? amount * factor : ingredient?.amount
  };
}

function scaleNutritionForPlan(entry, recipe) {
  const perServing = recipe?.nutritionEstimate?.perServing || {};
  const servings = plannedServings(entry, recipe);
  return Object.fromEntries(nutrientKeys.map((key) => [key, (Number(perServing[key]) || 0) * servings]));
}

function sumMealPlanNutrition(entries, recipeLookup) {
  const totals = Object.fromEntries(nutrientKeys.map((key) => [key, 0]));
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const recipeId = isMealPlanRecipe(entry) ? entry.recipeId : String(entry || "");
    const recipe = recipeLookup(recipeId);
    if (!recipe) return;
    const scaled = scaleNutritionForPlan(entry, recipe);
    nutrientKeys.forEach((key) => {
      totals[key] += scaled[key];
    });
  });
  return totals;
}

export {
  nutrientKeys,
  recipeDefaultServings,
  createMealPlanRecipe,
  isMealPlanRecipe,
  normalizeMealPlanRecipe,
  plannedServings,
  scalingFactor,
  scaleIngredient,
  scaleNutritionForPlan,
  sumMealPlanNutrition
};
