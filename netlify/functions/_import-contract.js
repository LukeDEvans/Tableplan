// _import-contract.js — the small internal shape that extraction results share.
//
// This is an INGESTION/extraction contract, not a persistence model. Recipes and
// articles keep their existing, separate storage (eat_recipes table; media
// state-section savedArticles). The contract only standardizes how an extractor
// reports what it found, how complete it is, and where it came from, so a future
// gateway can branch on `status` without re-deriving confidence per call site.
//
//   {
//     type:       "recipe" | "article" | "unknown",
//     status:     "ready" | "needs-review" | "partial" | "failed",
//     confidence: 0.0–1.0,
//     data:       <domain-shaped object, unchanged>,
//     warnings:   string[],
//     source:     { url, canonicalUrl, ... }
//   }

const { canonicalizeUrl } = require("./_import-url.js");

const TYPE = Object.freeze({ RECIPE: "recipe", ARTICLE: "article", UNKNOWN: "unknown" });
const STATUS = Object.freeze({ READY: "ready", NEEDS_REVIEW: "needs-review", PARTIAL: "partial", FAILED: "failed" });

function makeSource(url, extra = {}) {
  return { url: url || "", canonicalUrl: url ? canonicalizeUrl(url) : "", ...extra };
}

function makeResult({ type = TYPE.UNKNOWN, status = STATUS.FAILED, confidence = 0, data = null, warnings = [], source = {} }) {
  return { type, status, confidence, data, warnings, source };
}

// Recipe scoring from field presence only (deterministic, no AI):
//   ready         name + ≥1 ingredient + steps
//   needs-review  name + (ingredients XOR steps)  — usable but incomplete
//   partial       name only, or ingredients only
//   failed        no name and no ingredients
function scoreRecipe(recipe) {
  const warnings = [];
  const name = (recipe && recipe.name || "").trim();
  const ingredients = Array.isArray(recipe && recipe.ingredients) ? recipe.ingredients.filter((i) => i && (i.item || "").trim()) : [];
  const steps = (recipe && recipe.steps || "").trim();

  if (!name) warnings.push("missing title");
  if (!ingredients.length) warnings.push("no ingredients found");
  if (!steps) warnings.push("no instructions found");
  if (!(recipe && (recipe.time || recipe.cookTime || recipe.prepTime))) warnings.push("no cooking time");
  if (!(recipe && recipe.servings) || recipe.servings === 1) warnings.push("servings defaulted");

  if (name && ingredients.length && steps) return { status: STATUS.READY, confidence: 0.95, warnings };
  if (name && (ingredients.length || steps)) return { status: STATUS.NEEDS_REVIEW, confidence: 0.6, warnings };
  if (name || ingredients.length) return { status: STATUS.PARTIAL, confidence: 0.35, warnings };
  return { status: STATUS.FAILED, confidence: 0, warnings };
}

// Article scoring:
//   ready         body text + author + date
//   needs-review  body text but missing author or date
//   partial       title only / very short text
//   failed        no usable body
function scoreArticle(article) {
  const warnings = [];
  const title = (article && article.title || "").trim();
  const text = (article && article.text || "").trim();
  const author = (article && article.author || "").trim();
  const date = (article && article.date || "").trim();

  if (!title) warnings.push("missing title");
  if (!author) warnings.push("no author found");
  if (!date) warnings.push("no date found");

  if (!text || text.length < 200) {
    warnings.push(text ? "very little article text" : "no article text found");
    return { status: title ? STATUS.PARTIAL : STATUS.FAILED, confidence: title ? 0.3 : 0, warnings };
  }
  if (author && date) return { status: STATUS.READY, confidence: 0.9, warnings };
  return { status: STATUS.NEEDS_REVIEW, confidence: 0.65, warnings };
}

function recipeResult(recipe, url, extraSource = {}) {
  const scored = scoreRecipe(recipe);
  return makeResult({ type: TYPE.RECIPE, data: recipe, source: makeSource(url, extraSource), ...scored });
}

function articleResult(article, url, extraSource = {}) {
  const scored = scoreArticle(article);
  return makeResult({ type: TYPE.ARTICLE, data: article, source: makeSource(url, extraSource), ...scored });
}

module.exports = {
  TYPE,
  STATUS,
  makeSource,
  makeResult,
  scoreRecipe,
  scoreArticle,
  recipeResult,
  articleResult,
};
