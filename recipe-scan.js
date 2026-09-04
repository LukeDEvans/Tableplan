// recipe-scan.js — recipe domain adapter over the shared document-scan seam.
// Owns the recipe PROMPT + normalization; the vision plumbing lives in
// document-scan.js.
const { scanDocument, parseJsonFromText } = require("./document-scan");

async function scanRecipeFromImages(images, options = {}) {
  const { rawText } = await scanDocument({
    items: images,
    prompt: recipeScanPrompt(),
    options: {
      ...options,
      maxItems: 6,
      noun: "image",
      label: "Recipe scan",
      envModelVar: "ANTHROPIC_RECIPE_SCAN_MODEL",
      missingKeyMessage: "Recipe scanning needs ANTHROPIC_API_KEY set on the server.",
    },
  });
  return normalizeScannedRecipe(parseRecipeJson(rawText));
}

function recipeScanPrompt() {
  return [
    "Extract the cookbook recipe from these image(s).",
    "Return only valid JSON. Do not include markdown.",
    "If a field is not visible, use an empty string, empty array, or servings 1.",
    "Split ingredients into amount, quantity, item, and prep.",
    "Use quantity abbreviations when obvious: tsp, Tbsp, C, oz, lb, g, kg, ml, L.",
    "A capital T means tablespoon/Tbsp, not teaspoon.",
    "Convert pounds to lb.",
    "Split instructions into separate steps.",
    "Use this JSON shape exactly:",
    JSON.stringify({
      name: "",
      prepTime: "",
      cookTime: "",
      servings: 1,
      sourceUrl: "",
      ingredients: [{ amount: "", quantity: "", item: "", prep: "" }],
      steps: [""],
      nutrition: [{ nutrient: "", amount: "" }],
      notes: ""
    })
  ].join("\n");
}

function parseRecipeJson(text) {
  return parseJsonFromText(text, "The scan did not return recipe text.");
}

function normalizeScannedRecipe(recipe) {
  const steps = Array.isArray(recipe.steps)
    ? recipe.steps.map((step) => String(step || "").trim()).filter(Boolean).join("\n")
    : String(recipe.steps || "").trim();
  return {
    name: String(recipe.name || "").trim(),
    prepTime: String(recipe.prepTime || "").trim(),
    cookTime: String(recipe.cookTime || "").trim(),
    time: "",
    servings: Math.max(1, Number(recipe.servings) || 1),
    folderId: "",
    sourceUrl: String(recipe.sourceUrl || "").trim(),
    ingredients: normalizeScannedIngredients(recipe.ingredients),
    steps,
    tags: [],
    nutrition: normalizeScannedNutrition(recipe.nutrition),
    cookLog: []
  };
}

function normalizeScannedIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map((ingredient) => {
      if (typeof ingredient === "string") return { amount: "", quantity: "", item: ingredient.trim(), prep: "" };
      return {
        amount: String(ingredient?.amount || ingredient?.number || "").trim(),
        quantity: String(ingredient?.quantity || ingredient?.unit || "").trim(),
        item: String(ingredient?.item || ingredient?.name || "").trim(),
        prep: String(ingredient?.prep || "").trim()
      };
    })
    .filter((ingredient) => ingredient.item);
}

function normalizeScannedNutrition(nutrition) {
  if (!Array.isArray(nutrition)) return [];
  return nutrition
    .map((fact) => ({
      nutrient: String(fact?.nutrient || fact?.name || "").trim(),
      amount: String(fact?.amount || fact?.value || "").trim()
    }))
    .filter((fact) => fact.nutrient || fact.amount);
}

module.exports = { scanRecipeFromImages };
