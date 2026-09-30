"use strict";

let _nutritionDomain = null;
async function getNutritionDomain() {
  if (!_nutritionDomain) _nutritionDomain = await import("./nutrition-domain.js");
  return _nutritionDomain;
}

const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const USDA_CONCURRENCY = 4;

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function estimateRecipeNutrition(payload = {}, options = {}) {
  const { structureIngredient, calculateIngredientNutrition, sumNutrition, applySavedCorrection } = await getNutritionDomain();
  const apiKey = options.apiKey || process.env.USDA_FDC_API_KEY || process.env.USDA_API_KEY || "";
  const ingredients = (Array.isArray(payload.ingredients) ? payload.ingredients : []).map(structureIngredient);
  const corrections = payload.corrections && typeof payload.corrections === "object" ? payload.corrections : {};
  // Look up ingredients concurrently (bounded) instead of one USDA request at a time.
  // A per-ingredient lookup failure marks that ingredient unmatched rather than failing
  // the whole estimate. Order of `matches` follows `ingredients`.
  const results = await mapWithConcurrency(ingredients, USDA_CONCURRENCY, async (ingredient) => {
    if (!ingredient.normalizedName) {
      return { match: unmatchedIngredient(ingredient, "Ingredient name is missing.") };
    }
    const saved = applySavedCorrection(ingredient, corrections);
    let candidates = [];
    let lookupFailed = false;
    let lookupError = null;
    if (apiKey) {
      try {
        candidates = await searchFoods(ingredient.normalizedName, apiKey, options.fetchImpl);
      } catch (error) {
        lookupFailed = true;
        lookupError = error;
      }
    }
    const reviewCandidates = saved && !candidates.some((candidate) => String(candidate.fdcId) === String(saved.fdcId))
      ? [saved, ...candidates]
      : candidates;
    const selected = saved
      ? reviewCandidates.find((candidate) => String(candidate.fdcId) === String(saved.fdcId)) || saved
      : candidates[0];
    if (!selected) {
      const note = lookupFailed ? "USDA lookup failed for this ingredient." : "No USDA match found.";
      return {
        lookupError,
        uncached: ingredient.ingredientName || ingredient.rawLine,
        match: { ...unmatchedIngredient(ingredient, note), candidates: [] }
      };
    }
    return {
      match: {
        ...calculateIngredientNutrition(ingredient, selected),
        candidates: reviewCandidates,
        savedCorrectionUsed: Boolean(saved)
      }
    };
  });
  // Every attempted lookup failed and nothing matched (USDA down / rate-limited): fail
  // the estimate rather than returning an all-zero one.
  const attempted = results.filter((result) => result.match.normalizedName);
  const failed = results.filter((result) => result.lookupError);
  if (failed.length && failed.length === attempted.length) throw failed[0].lookupError;
  const matches = results.map((result) => result.match);
  const uncached = results.map((result) => result.uncached).filter(Boolean);
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
