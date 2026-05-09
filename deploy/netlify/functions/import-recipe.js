exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const sourceUrl = normalizeRecipeUrlInput(event.queryStringParameters?.url);
  if (!sourceUrl) return jsonResponse(400, { error: "Missing recipe URL." });

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return jsonResponse(400, { error: "Invalid recipe URL." });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return jsonResponse(400, { error: "Recipe URL must start with http or https." });
  }

  try {
    const fetched = await fetch(sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 TableplanRecipeImporter/1.0"
      }
    });

    if (!fetched.ok) {
      return jsonResponse(fetched.status, { error: `Recipe page returned ${fetched.status}.` });
    }

    const html = await fetched.text();
    const recipe = parseRecipeHtml(html, sourceUrl);
    if (!recipe.name && !recipe.ingredients.length) {
      return jsonResponse(422, { error: "No recipe data found on that page." });
    }

    return jsonResponse(200, { recipe });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Recipe import failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function normalizeRecipeUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}

function parseRecipeHtml(html, sourceUrl) {
  const jsonRecipes = findJsonLdBlocks(html)
    .flatMap(parseJsonLd)
    .map(findRecipeNode)
    .filter(Boolean);
  const recipe = jsonRecipes[0];
  if (!recipe) return parseRecipeText(htmlToText(html), sourceUrl);

  return {
    name: textValue(recipe.name) || findTitle(html),
    time: readableDuration(textValue(recipe.totalTime || recipe.cookTime || recipe.prepTime)),
    servings: parseServings(recipe.recipeYield),
    folderId: "",
    sourceUrl,
    ingredients: arrayValue(recipe.recipeIngredient).map((line) => parseIngredientLine(String(line))),
    steps: instructionsToText(recipe.recipeInstructions)
  };
}

function findJsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) blocks.push(decodeHtml(match[1].trim()));
  return blocks;
}

function parseJsonLd(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  const type = arrayValue(node["@type"]).map((item) => String(item).toLowerCase());
  if (type.includes("recipe")) return node;
  if (Array.isArray(node["@graph"])) return node["@graph"].map(findRecipeNode).find(Boolean) || null;
  return null;
}

function parseRecipeText(text, sourceUrl = "") {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines[0] || "";
  const ingredientsStart = lines.findIndex((line) => /^ingredients:?$/i.test(line));
  const instructionsStart = lines.findIndex((line) => /^(instructions|directions|preparation|method):?$/i.test(line));
  let ingredientLines = [];
  let instructionLines = [];

  if (ingredientsStart >= 0) {
    const end = instructionsStart > ingredientsStart ? instructionsStart : lines.length;
    ingredientLines = lines.slice(ingredientsStart + 1, end);
    instructionLines = instructionsStart >= 0 ? lines.slice(instructionsStart + 1) : [];
  } else {
    ingredientLines = lines.slice(1).filter(looksLikeIngredient);
    instructionLines = lines.slice(1).filter((line) => !looksLikeIngredient(line));
  }

  return {
    name,
    time: "",
    servings: 1,
    folderId: "",
    sourceUrl,
    ingredients: ingredientLines.map(parseIngredientLine),
    steps: instructionLines.join("\n")
  };
}

function instructionsToText(instructions) {
  return arrayValue(instructions).map((step) => {
    if (typeof step === "string") return step;
    return step.text || step.name || "";
  }).filter(Boolean).join("\n");
}

function parseIngredientLine(line) {
  const normalizedLine = line.trim()
    .replace(/^[-*]\s*/, "")
    .replace(/⅛/g, "1/8")
    .replace(/¼/g, "1/4")
    .replace(/⅓/g, "1/3")
    .replace(/½/g, "1/2")
    .replace(/⅔/g, "2/3")
    .replace(/¾/g, "3/4");
  const prepMatch = normalizedLine.match(/\(([^)]+)\)$/);
  const prepText = prepMatch ? prepMatch[1].toLowerCase() : "";
  const lineWithoutPrep = prepMatch ? normalizedLine.slice(0, prepMatch.index).trim() : normalizedLine;
  const parts = lineWithoutPrep.split(/\s+/);
  const amountOptions = ["pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/4", "2 1/2", "2 3/4", "3", "3 1/4", "3 1/2", "3 3/4", "4", "4 1/4", "4 1/2", "4 3/4", "5", "5 1/4", "5 1/2", "5 3/4", "6", "6 1/4", "6 1/2", "6 3/4", "7", "7 1/4", "7 1/2", "7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4", "9 1/2", "9 3/4", "10", "10 1/4", "10 1/2", "10 3/4", "11", "11 1/4", "11 1/2", "11 3/4", "12", "12 1/4", "12 1/2", "12 3/4", "13", "13 1/4", "13 1/2", "13 3/4", "14", "14 1/4", "14 1/2", "14 3/4", "15", "15 1/4", "15 1/2", "15 3/4", "16"];
  const amount = takeIngredientAmount(parts, amountOptions);
  let quantity = "";
  const unit = parts[0]?.toLowerCase();
  const unitMap = { cup: "C", cups: "C", tablespoon: "Tbsp", tablespoons: "Tbsp", tbsp: "Tbsp", teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", pound: "lb", pounds: "lb", lb: "lb", ounce: "oz", ounces: "oz", oz: "oz", cans: "can", can: "can", cloves: "clove", clove: "clove", slices: "slice", slice: "slice" };
  if (unitMap[unit]) quantity = unitMap[parts.shift().toLowerCase()];
  const prepOptions = ["chopped", "diced", "minced", "sliced", "grated", "zested", "juiced", "peeled", "crushed", "rinsed", "drained", "cooked", "uncooked", "melted", "softened"];
  const prep = prepOptions.includes(prepText) ? prepText : "";
  const item = prep && prepMatch ? parts.join(" ") : [parts.join(" "), prepText && !prep ? `(${prepText})` : ""].filter(Boolean).join(" ");
  return { amount, quantity, item, prep };
}

function takeIngredientAmount(parts, options) {
  const mixedAmount = `${parts[0] || ""} ${parts[1] || ""}`.trim();
  if (options.includes(mixedAmount)) {
    parts.shift();
    parts.shift();
    return mixedAmount;
  }
  return options.includes(parts[0]) ? parts.shift() : "";
}

function htmlToText(html) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim());
}

function findTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decodeHtml((h1 || title || "").replace(/<[^>]+>/g, "")).trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readableDuration(value) {
  if (!/^P(T|\d)/i.test(value)) return value;
  const hours = Number(value.match(/(\d+)H/i)?.[1] || 0);
  const minutes = Number(value.match(/(\d+)M/i)?.[1] || 0);
  return [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" ");
}

function arrayValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value ? String(value) : "";
}

function parseServings(value) {
  const text = textValue(value);
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function looksLikeIngredient(line) {
  return /^(\d|pinch|⅛|¼|⅓|½|⅔|¾)/i.test(line) || /\b(cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|ounce|ounces|oz|pound|pounds|lb|can|clove|slice)\b/i.test(line);
}
