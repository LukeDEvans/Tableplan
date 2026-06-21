"use strict";

const nutrientDefinitions = [
  { key: "calories", label: "Calories", unit: "kcal", ids: [1008] },
  { key: "protein", label: "Protein", unit: "g", ids: [1003] },
  { key: "carbs", label: "Carbohydrates", unit: "g", ids: [1005] },
  { key: "fat", label: "Fat", unit: "g", ids: [1004] },
  { key: "fiber", label: "Fiber", unit: "g", ids: [1079] },
  { key: "sugar", label: "Sugar", unit: "g", ids: [2000, 1063] },
  { key: "sodium", label: "Sodium", unit: "mg", ids: [1093] },
  { key: "saturatedFat", label: "Saturated fat", unit: "g", ids: [1258] }
];

const unitAliases = {
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  t: "tbsp",
  cup: "cup",
  cups: "cup",
  c: "cup",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  lb: "lb",
  gram: "g",
  grams: "g",
  g: "g",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  each: "each",
  count: "each"
};

function parseAmount(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "pinch" || text.toLowerCase() === "to taste") return null;
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeUnit(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  return unitAliases[key] || key;
}

function normalizeIngredientName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(optional|divided|plus more|for serving|to taste)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ingredientRawLine(ingredient) {
  return [
    ingredient.amount || ingredient.number || "",
    ingredient.quantity || ingredient.unit || "",
    ingredient.item || ingredient.name || "",
    ingredient.prep || ingredient.preparationNote || ""
  ].filter(Boolean).join(" ").trim();
}

function structureIngredient(ingredient) {
  const rawLine = typeof ingredient === "string" ? ingredient : ingredientRawLine(ingredient || {});
  const item = typeof ingredient === "string" ? rawLine : String(ingredient?.item || ingredient?.name || "").trim();
  const preparationNote = typeof ingredient === "string" ? "" : String(ingredient?.prep || ingredient?.preparationNote || "").trim();
  const optional = /\boptional\b/i.test(`${rawLine} ${preparationNote}`);
return {
    rawLine,
    ingredientName: item,
    normalizedName: normalizeIngredientName(item),
    quantity: parseAmount(typeof ingredient === "string" ? "" : ingredient?.amount ?? ingredient?.number),
    unit: normalizeUnit(typeof ingredient === "string" ? "" : ingredient?.quantity ?? ingredient?.unit),
    preparationNote,
    optional,
    required: !optional
  };
}

function convertToGrams(quantity, unit, food = {}) {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) {
return { grams: null, confidenceScore: 0.2, note: "Quantity could not be converted." };
  }
  const normalizedUnit = normalizeUnit(unit);
  const exact = {
    g: 1,
    kg: 1000,
    oz: 28.349523125,
    lb: 453.59237
  };
  if (exact[normalizedUnit]) {
return { grams: amount * exact[normalizedUnit], confidenceScore: 1, note: "" };
  }

  const servingSize = Number(food.servingSize);
  const servingUnit = normalizeUnit(food.servingSizeUnit);
  if (Number.isFinite(servingSize) && servingSize > 0 && servingUnit === "g") {
    const household = String(food.householdServingFullText || "").toLowerCase();
    if (normalizedUnit === "each" || household.includes(normalizedUnit)) {
return { grams: amount * servingSize, confidenceScore: 0.82, note: "Converted using the USDA serving size." };
    }
  }

  const volumeFallback = { tsp: 5, tbsp: 15, cup: 240, each: 100 };
  if (volumeFallback[normalizedUnit]) {
return {
      grams: amount * volumeFallback[normalizedUnit],
      confidenceScore: normalizedUnit === "each" ? 0.35 : 0.45,
      note: "Estimated with a general volume or item conversion; review this match."
    };
  }
  if (!normalizedUnit) {
return { grams: amount * 100, confidenceScore: 0.25, note: "No unit was provided; estimated as 100 g per item." };
  }
return { grams: null, confidenceScore: 0.15, note: `The unit "${normalizedUnit}" could not be converted to grams.` };
}

function foodNutrientsPer100g(food = {}) {
  const values = {};
  nutrientDefinitions.forEach((definition) => {
    const nutrient = (food.foodNutrients || []).find((entry) => {
      const id = Number(entry.nutrientId || entry.nutrient?.id);
      return definition.ids.includes(id);
    });
    values[definition.key] = Number(nutrient?.value ?? nutrient?.amount) || 0;
  });
  return values;
}

function calculateIngredientNutrition(structuredIngredient, food) {
  const conversion = convertToGrams(structuredIngredient.quantity, structuredIngredient.unit, food);
  const per100g = foodNutrientsPer100g(food);
  const multiplier = conversion.grams === null ? 0 : conversion.grams / 100;
  const nutrients = {};
  nutrientDefinitions.forEach(({ key }) => {
    nutrients[key] = per100g[key] * multiplier;
  });
return {
    ...structuredIngredient,
    fdcId: String(food.fdcId || ""),
    matchedFood: food.description || food.matchedFood || "",
    source: food.source || "USDA FoodData Central",
    grams: conversion.grams,
    conversionConfidenceScore: conversion.confidenceScore,
    confidenceScore: Math.min(
      Number(food.confidenceScore ?? 0.75),
      conversion.confidenceScore
    ),
    conversionNote: conversion.note,
    nutrients
  };
}

function sumNutrition(matches, servings = 1) {
  const totals = Object.fromEntries(nutrientDefinitions.map(({ key }) => [key, 0]));
  matches.forEach((match) => {
    nutrientDefinitions.forEach(({ key }) => {
      totals[key] += Number(match?.nutrients?.[key]) || 0;
    });
  });
  const servingCount = Math.max(1, Number(servings) || 1);
  const perServing = {};
  nutrientDefinitions.forEach(({ key }) => {
    perServing[key] = totals[key] / servingCount;
  });
return { totals, perServing, servings: servingCount };
}

function nutritionFactsFromEstimate(estimate) {
  if (!estimate?.perServing) return [];
  return nutrientDefinitions.map((definition) => ({
    nutrient: definition.label,
    amount: `${formatNutrientValue(estimate.perServing[definition.key], definition.key)} ${definition.unit}`.trim()
  }));
}

function formatNutrientValue(value, key) {
  const number = Number(value) || 0;
  if (key === "calories" || key === "sodium") return String(Math.round(number));
  return number < 10 ? number.toFixed(1).replace(/\.0$/, "") : String(Math.round(number));
}

function correctionKey(name) {
  return normalizeIngredientName(name);
}

function applySavedCorrection(ingredient, corrections = {}) {
  return corrections[correctionKey(ingredient.normalizedName || ingredient.ingredientName)] || null;
}

module.exports = {
  nutrientDefinitions,
  parseAmount,
  normalizeUnit,
  normalizeIngredientName,
  structureIngredient,
  convertToGrams,
  foodNutrientsPer100g,
  calculateIngredientNutrition,
  sumNutrition,
  nutritionFactsFromEstimate,
  correctionKey,
  applySavedCorrection
};
