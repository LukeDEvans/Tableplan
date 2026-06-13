const DEFAULT_SCAN_MODEL = "claude-haiku-4-5-20251001";

async function scanRecipeFromImages(images, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Recipe scanning needs ANTHROPIC_API_KEY set on the server.");
  }
  const cleanImages = validateImages(images);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || process.env.ANTHROPIC_RECIPE_SCAN_MODEL || DEFAULT_SCAN_MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: recipeScanPrompt() },
          ...cleanImages.map((image) => {
            const { media_type, data } = parseDataUrl(image);
            return { type: "image", source: { type: "base64", media_type, data } };
          })
        ]
      }]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Recipe scan failed with status ${response.status}`);
  }
  return normalizeScannedRecipe(parseRecipeJson(outputText(payload)));
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid image data URL.");
  return { media_type: match[1].toLowerCase(), data: match[2] };
}

function validateImages(images) {
  if (!Array.isArray(images) || !images.length) throw new Error("At least one image is required.");
  if (images.length > 6) throw new Error("Use up to 6 images for one recipe scan.");
  return images.map((image) => {
    const value = String(image || "");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
      throw new Error("Images must be PNG, JPEG, WEBP, or GIF data URLs.");
    }
    return value;
  });
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

function outputText(payload) {
  return (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}

function parseRecipeJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("The scan did not return recipe text.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The scan response could not be parsed.");
    return JSON.parse(match[0]);
  }
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
