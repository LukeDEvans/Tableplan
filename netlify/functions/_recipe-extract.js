// _recipe-extract.js — pure, deterministic recipe extraction.
//
// Moved verbatim from import-recipe.js so the extraction logic is reusable and
// fixture-testable, independent of Netlify request handling, auth, HTTP
// formatting, and Supabase writes. Behavior is intentionally unchanged.
//
// Deterministic-first order (no AI):
//   1. Schema.org / JSON-LD Recipe (incl. multiple blocks and @graph)
//   2. Schema.org Microdata (itemtype/itemprop) + RDFa (typeof/property) Recipe
//   3. existing HTML→text heuristic fallback (name / Ingredients: / Instructions:)
// AI is deliberately NOT added here (see CONTENT_IMPORT.md).
//
// extractRecipeFromHtml(html, sourceUrl) → normalized recipe object
// extractRecipeFromText(text, sourceUrl, fallbackName) → normalized recipe object
// Normalized shape: { name, prepTime, cookTime, time, servings, folderId,
//                     sourceUrl, ingredients:[{amount,quantity,item,prep}], steps }

function extractRecipeFromHtml(html, sourceUrl) {
  const jsonRecipes = findJsonLdBlocks(html)
    .flatMap(parseJsonLd)
    .map(findRecipeNode)
    .filter(Boolean);
  const recipe = jsonRecipes[0];
  if (!recipe) {
    // No JSON-LD → try Schema.org Microdata / RDFa before the text heuristic.
    const micro = extractRecipeFromMicrodata(html, sourceUrl);
    return micro || extractRecipeFromText(htmlToText(html), sourceUrl);
  }

  return {
    name: textValue(recipe.name) || findTitle(html),
    prepTime: readableDuration(textValue(recipe.prepTime)),
    cookTime: readableDuration(textValue(recipe.cookTime)),
    time: readableDuration(textValue(recipe.totalTime || recipe.cookTime || recipe.prepTime)),
    servings: parseServings(recipe.recipeYield),
    folderId: "",
    sourceUrl,
    ingredients: arrayValue(recipe.recipeIngredient).map((line) => parseIngredientLine(String(line))),
    steps: instructionsToText(recipe.recipeInstructions)
  };
}

// ── Microdata / RDFa Recipe extraction ───────────────────────────────────────
// A middle tier for pages that mark up a recipe with Schema.org Microdata
// (itemtype=".../Recipe" + itemprop="…") or RDFa (typeof="…Recipe" +
// property="…") instead of a JSON-LD block. Pure regex over the recipe scope —
// handles the common shapes: <meta content>, <time datetime>, and text-bearing
// leaf elements (<li>/<span>/<p>) for ingredients and steps. Returns null when
// no recipe scope or neither ingredients nor instructions are found, so the
// caller falls through to the plain-text heuristic.
const MICRODATA_VOID = new Set(["meta", "link", "img", "br", "hr", "input"]);

function extractRecipeFromMicrodata(html, sourceUrl) {
  const scope = findRecipeScope(html);
  if (!scope) return null;
  const ingredients = microTextValues(scope, "recipeIngredient");
  const legacyIngredients = ingredients.length ? ingredients : microTextValues(scope, "ingredients");
  const instructions = microTextValues(scope, "recipeInstructions");
  if (!legacyIngredients.length && !instructions.length) return null; // not really a recipe
  const steps = instructions
    .map(stripStepPrefix)
    .filter((s) => s && !isStepHeaderOnly(s))
    .join("\n");
  return {
    name: microFirstText(scope, "name") || findTitle(html),
    prepTime: readableDuration(microFirstAttr(scope, "prepTime")),
    cookTime: readableDuration(microFirstAttr(scope, "cookTime")),
    time: readableDuration(microFirstAttr(scope, "totalTime") || microFirstAttr(scope, "cookTime") || microFirstAttr(scope, "prepTime")),
    servings: parseServings(microFirstText(scope, "recipeYield")),
    folderId: "",
    sourceUrl,
    ingredients: legacyIngredients.map((line) => parseIngredientLine(line)),
    steps
  };
}

// From the recipe element's opening tag to end-of-document. Property extraction
// is recipe-specific enough (recipeIngredient/recipeInstructions/recipeYield)
// that not bounding the close tag is safe; `name` is taken as the first match
// after the scope start, which is the recipe's own name.
function findRecipeScope(html) {
  const md = html.search(/<[a-z][^>]*\bitemtype\s*=\s*["'][^"']*schema\.org\/Recipe\b[^"']*["']/i);
  if (md >= 0) return html.slice(md);
  const rdfa = html.search(/<[a-z][^>]*\btypeof\s*=\s*["'][^"']*\bRecipe\b[^"']*["']/i);
  if (rdfa >= 0) return html.slice(rdfa);
  return null;
}

// Every element in `scope` whose itemprop/property attribute lists `prop` as one
// of its (space-separated, optionally namespaced) tokens, as { attrVal, inner }.
function microProps(scope, prop) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const pa = attrs.match(/\b(?:itemprop|property)\s*=\s*["']([^"']*)["']/i);
    if (!pa) continue;
    const tokens = pa[1].split(/\s+/).map((t) => t.replace(/^[a-z][\w-]*:/i, "")); // drop "schema:" etc.
    if (!tokens.includes(prop)) continue;
    const attrVal =
      attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ||
      attrs.match(/\bdatetime\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    let inner = "";
    if (!MICRODATA_VOID.has(tag)) {
      const rest = scope.slice(re.lastIndex);
      const close = rest.match(new RegExp(`</${tag}\\s*>`, "i"));
      inner = decodeHtml((close ? rest.slice(0, close.index) : rest.slice(0, 400)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
    }
    out.push({ attrVal, inner });
  }
  return out;
}

function microTextValues(scope, prop) {
  return microProps(scope, prop).map((x) => (x.inner || x.attrVal).trim()).filter(Boolean);
}

function microFirstText(scope, prop) {
  return microTextValues(scope, prop)[0] || "";
}

// Duration-ish props prefer the machine value (meta content / time datetime).
function microFirstAttr(scope, prop) {
  const all = microProps(scope, prop);
  const withAttr = all.find((x) => x.attrVal);
  return (withAttr ? withAttr.attrVal : all[0]?.inner) || "";
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

function extractRecipeFromText(text, sourceUrl = "", fallbackName = "") {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^﻿/, "").trim()).filter(Boolean);
  const ingredientsStart = lines.findIndex((line) => /^ingredients:?$/i.test(line));
  const explicitInstructionsStart = lines.findIndex((line) => /^(instructions|directions|preparation|method):?$/i.test(line));
  const repeatedIngredientsStart = ingredientsStart >= 0
    ? lines.findIndex((line, index) => index > ingredientsStart && /^ingredients:?$/i.test(line))
    : -1;
  const instructionsStart = explicitInstructionsStart >= 0 ? explicitInstructionsStart : repeatedIngredientsStart;
  const name = fallbackName || findPlainTextRecipeName(lines, ingredientsStart) || "";
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
    prepTime: "",
    cookTime: "",
    servings: 1,
    folderId: "",
    sourceUrl,
    ingredients: ingredientLines.map(parseIngredientLine),
    steps: instructionLines.join("\n")
  };
}

function isStepHeaderOnly(line) {
  return /^(step\s*)?\d+[\s.):–\-]*$/i.test(line.trim());
}

function stripStepPrefix(step) {
  return String(step || "").trim().replace(/^(step\s*)?\d+[\).:\-]\s*/i, "").trim();
}

function instructionsToText(instructions) {
  return arrayValue(instructions).map((step) => {
    const text = typeof step === "string" ? step : (step.text || step.name || "");
    return text.trim();
  }).filter((text) => text && !isStepHeaderOnly(text))
    .map(stripStepPrefix)
    .filter(Boolean).join("\n");
}

function findPlainTextRecipeName(lines, ingredientsStart) {
  const nameCandidates = ingredientsStart >= 0 ? lines.slice(0, ingredientsStart) : lines;
  return nameCandidates.find((line) => !/^(prep|cook|total) time:/i.test(line) && !/^servings?:/i.test(line)) || lines[0] || "";
}

const IMPORT_AMOUNT_OPTIONS = ["pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/4", "2 1/2", "2 3/4", "3", "3 1/4", "3 1/2", "3 3/4", "4", "4 1/4", "4 1/2", "4 3/4", "5", "5 1/4", "5 1/2", "5 3/4", "6", "6 1/4", "6 1/2", "6 3/4", "7", "7 1/4", "7 1/2", "7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4", "9 1/2", "9 3/4", "10", "10 1/4", "10 1/2", "10 3/4", "11", "11 1/4", "11 1/2", "11 3/4", "12", "12 1/4", "12 1/2", "12 3/4", "13", "13 1/4", "13 1/2", "13 3/4", "14", "14 1/4", "14 1/2", "14 3/4", "15", "15 1/4", "15 1/2", "15 3/4", "16"];
const IMPORT_PREP_OPTIONS = ["beaten", "blanched", "boiled", "chopped", "coarsely chopped", "finely chopped", "roughly chopped", "cold", "cooked", "cooled", "cored", "crumbled", "crushed", "cubed", "deveined", "diced", "finely diced", "dissolved", "drained", "dried", "divided", "finely grated", "freshly grated", "grated", "ground", "halved", "juiced", "melted", "minced", "optional", "patted dry", "peeled", "pitted", "quartered", "refrigerated", "rinsed", "roasted", "room temperature", "seeded", "shredded", "sifted", "sliced", "thinly sliced", "roughly sliced", "softened", "squeezed", "steamed", "strained", "thawed", "toasted", "trimmed", "uncooked", "zested"];
const IMPORT_UNIT_MAP = { c: "C", cup: "C", cups: "C", tablespoon: "Tbsp", tablespoons: "Tbsp", tbsp: "Tbsp", teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", pound: "lb", pounds: "lb", lb: "lb", ounce: "oz", ounces: "oz", oz: "oz", cans: "can", can: "can", cloves: "clove", clove: "clove", slices: "slice", slice: "slice", bunch: "bunch", bunches: "bunch", package: "package", packages: "package", pkg: "package", g: "g", gram: "g", grams: "g", kg: "kg", ml: "ml", l: "L", liter: "L", liters: "L", qt: "qt", quart: "qt", pt: "pt", pint: "pt", stick: "stick", sticks: "stick", sprig: "sprig", sprigs: "sprig", head: "head", heads: "head", stalk: "stalk", stalks: "stalk" };

function parseIngredientLine(line) {
  let normalizedLine = line.trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/⅛/g, "1/8").replace(/¼/g, "1/4").replace(/⅓/g, "1/3")
    .replace(/½/g, "1/2").replace(/⅔/g, "2/3").replace(/¾/g, "3/4");

  normalizedLine = normalizedLine.replace(/^(\d[\d\s/]*)\s*\([\d.\s–\-]+\s*oz\)/i, "$1");

  const prepMatch = normalizedLine.match(/\(([^)]+)\)$/);
  const prepText = prepMatch ? prepMatch[1].toLowerCase().trim() : "";
  const lineWithoutTrailingPrep = prepMatch ? normalizedLine.slice(0, prepMatch.index).trim() : normalizedLine;
  const parts = lineWithoutTrailingPrep.split(/\s+/);
  const amount = takeIngredientAmount(parts, IMPORT_AMOUNT_OPTIONS);
  let quantity = "";
  const rawUnit = parts[0] || "";
  const mappedUnit = rawUnit === "T" ? "Tbsp" : rawUnit === "t" ? "tsp" : IMPORT_UNIT_MAP[rawUnit.toLowerCase()];
  if (mappedUnit) { quantity = mappedUnit; parts.shift(); }

  const trailingPrep = IMPORT_PREP_OPTIONS.includes(parts.at(-1)?.toLowerCase()) ? parts.pop().toLowerCase() : "";
  const prep = IMPORT_PREP_OPTIONS.includes(prepText) ? prepText : trailingPrep;
  const itemParts = parts.join(" ");
  const leftoverPrep = prepText && !prep ? `(${prepText})` : "";
  const item = [itemParts, leftoverPrep].filter(Boolean).join(" ");
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

module.exports = {
  extractRecipeFromHtml,
  extractRecipeFromText,
  extractRecipeFromMicrodata,
  // exported for targeted tests / reuse
  findJsonLdBlocks,
  parseJsonLd,
  findRecipeNode,
  findRecipeScope,
  parseIngredientLine,
  instructionsToText,
  readableDuration,
  parseServings,
  findTitle,
};
