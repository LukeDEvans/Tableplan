"use strict";

const {
  structureIngredient,
  calculateIngredientNutrition,
  sumNutrition,
  applySavedCorrection
} = require("./nutrition-domain");

const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

async function estimateRecipeNutrition(payload = {}, options = {}) {
  const apiKey = options.apiKey || process.env.USDA_FDC_API_KEY || process.env.USDA_API_KEY || "";
  const ingredients = (Array.isArray(payload.ingredients) ? payload.ingredients : []).map(structureIngredient);
  const corrections = payload.corrections && typeof payload.corrections === "object" ? payload.corrections : {};
  const matches = [];
  const uncached = [];
  for (const ingredient of ingredients) {
    if (!ingredient.normalizedName) {
      matches.push(unmatchedIngredient(ingredient, "Ingredient name is missing."));
      continue;
    }
    const saved = applySavedCorrection(ingredient, corrections);
    let candidates = [];
    if (apiKey) {
      try {
        candidates = await searchFoods(ingredient.normalizedName, apiKey, options.fetchImpl);
      } catch (error) {
        if (!saved) throw error;
      }
    }
    const reviewCandidates = saved && !candidates.some((candidate) => String(candidate.fdcId) === String(saved.fdcId))
      ? [saved, ...candidates]
      : candidates;
    const selected = saved
      ? reviewCandidates.find((candidate) => String(candidate.fdcId) === String(saved.fdcId)) || saved
      : candidates[0];
    if (!selected) {
      uncached.push(ingredient.ingredientName || ingredient.rawLine);
      matches.push({ ...unmatchedIngredient(ingredient, "No USDA match found."), candidates: [] });
      continue;
    }
    matches.push({
      ...calculateIngredientNutrition(ingredient, selected),
      candidates: reviewCandidates,
      savedCorrectionUsed: Boolean(saved)
    });
  }
  if (!apiKey && uncached.length) {
    throw new Error(`Nutrition estimates require USDA_FDC_API_KEY for uncached ingredients: ${uncached.join(", ")}.`);
  }
  return {
    matches,
    ...sumNutrition(matches, payload.servings),
    source: "USDA FoodData Central",
    confidenceScore: averageConfidence(matches),
    lastCalculatedAt: new Date().toISOString(),
    disclaimer: "Estimated from ingredient data; actual values vary."
  };
}

async function searchFoods(query, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(`${USDA_BASE_URL}/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      pageSize: 8,
      dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"]
    })
  });
  if (!response.ok) throw new Error(`USDA FoodData Central returned ${response.status}.`);
  const payload = await response.json();
  return (payload.foods || []).map((food, index) => ({
    fdcId: String(food.fdcId || ""),
    description: food.description || "",
    brandOwner: food.brandOwner || food.brandName || "",
    dataType: food.dataType || "",
    servingSize: food.servingSize || null,
    servingSizeUnit: food.servingSizeUnit || "",
    householdServingFullText: food.householdServingFullText || "",
    foodNutrients: food.foodNutrients || [],
    source: "USDA FoodData Central",
    confidenceScore: Math.max(0.45, 0.95 - index * 0.07)
  }));
}

function unmatchedIngredient(ingredient, note) {
  return {
    ...ingredient,
    fdcId: "",
    matchedFood: "",
    source: "",
    grams: null,
    conversionConfidenceScore: 0,
    confidenceScore: 0,
    conversionNote: note,
    nutrients: {},
    candidates: []
  };
}

function averageConfidence(matches) {
  const scored = matches.filter((match) => match.fdcId);
  if (!scored.length) return 0;
  return scored.reduce((sum, match) => sum + (Number(match.confidenceScore) || 0), 0) / scored.length;
}

module.exports = {
  estimateRecipeNutrition,
  searchFoods
};
