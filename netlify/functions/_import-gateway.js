// _import-gateway.js — the deterministic import orchestration.
//
// One entry point, `runImport(input, deps)`, that the /import handler wraps with
// auth. It is stateless EXTRACTION only — it never persists. The caller takes
// result.data and saves it through the existing domain path (recipe → eat_recipes,
// article → media.savedArticles). This keeps the two storage models separate, as
// the architecture requires.
//
// Flow:
//   input.extractedContent?  → use the supplied rendered html/text (extension /
//                              "import visible page"; no server fetch)
//   else                     → safeFetch(source.url) (SSRF-guarded)
//   → detectContentType (pick which core to try first)
//   → extract with that core; if it isn't "ready", also try the other core and
//     keep whichever scored higher (graceful reclassification)
//   → return the import-result contract, annotated with the detection reason.
//
// `deps.safeFetch` is injectable so the whole flow unit-tests without a network.

const { safeFetch: defaultSafeFetch } = require("./_import-fetch.js");
const { extractRecipeFromHtml, extractRecipeFromText } = require("./_recipe-extract.js");
const { extractArticleFromHtml } = require("./_article-extract.js");
const { recipeResult, articleResult, makeResult, makeSource, TYPE, STATUS } = require("./_import-contract.js");
const { detectContentType } = require("./_import-detect.js");
const { normalizeImportUrlInput } = require("./_import-url.js");

const RANK = { [STATUS.READY]: 3, [STATUS.NEEDS_REVIEW]: 2, [STATUS.PARTIAL]: 1, [STATUS.FAILED]: 0 };
const rank = (r) => RANK[r.status] ?? 0;

function tryRecipe(html, text, sourceUrl, canonicalFrom) {
  const recipe = html ? extractRecipeFromHtml(html, sourceUrl) : extractRecipeFromText(text || "", sourceUrl);
  return recipeResult(recipe, canonicalFrom);
}

function tryArticle(html, text, sourceUrl, canonicalFrom, extracted) {
  const md = (extracted && extracted.metadata) || {};
  let article;
  if (extracted && extracted.text) {
    // Rendered-DOM text supplied by a client (extension / visible page).
    article = { title: md.title || "", text: extracted.text, author: md.author || "", date: md.date || "", publication: md.publication || "" };
  } else {
    article = extractArticleFromHtml(html || "", md.publication || "other");
    // Let explicit client metadata fill gaps the HTML scan missed.
    if (md.title && !article.title) article.title = md.title;
    if (md.author && !article.author) article.author = md.author;
    if (md.date && !article.date) article.date = md.date;
  }
  return articleResult(article, canonicalFrom);
}

async function runImport(input = {}, deps = {}) {
  const doFetch = deps.safeFetch || defaultSafeFetch;
  const source = input.source || {};
  const rawUrl = source.url || "";
  const url = normalizeImportUrlInput(rawUrl);
  const extracted = input.extractedContent || null;
  const hint = input.hints && input.hints.contentType;

  let html = (extracted && extracted.html) || "";
  let text = (extracted && extracted.text) || "";
  let effectiveUrl = url;
  // The URL to attribute in the result (prefer the caller's raw url for source.url).
  const attributeUrl = rawUrl || url;

  // Fetch only when the client didn't already supply page content.
  if (!html && !text) {
    if (!url) {
      return makeResult({ type: TYPE.UNKNOWN, status: STATUS.FAILED, warnings: ["No URL or content provided."], source: makeSource(attributeUrl) });
    }
    const fetched = await doFetch(url); // typed errors propagate → handler maps to HTTP status
    if (!fetched.ok) {
      return makeResult({ type: TYPE.UNKNOWN, status: STATUS.FAILED, warnings: [`Source returned HTTP ${fetched.status}.`], source: makeSource(attributeUrl) });
    }
    html = fetched.body;
    effectiveUrl = fetched.finalUrl || url;
  }

  const detected = detectContentType({ html, text, url: effectiveUrl, metadata: extracted && extracted.metadata, hint });
  const order = detected.type === "article" ? ["article", "recipe"] : ["recipe", "article"];

  let best = null;
  for (const kind of order) {
    const result = kind === "recipe"
      ? tryRecipe(html, text, effectiveUrl, attributeUrl)
      : tryArticle(html, text, effectiveUrl, attributeUrl, extracted);
    if (!best || rank(result) > rank(best)) best = result;
    if (result.status === STATUS.READY) break;
  }

  best.detection = { type: detected.type, confidence: detected.confidence, reason: detected.reason };
  return best;
}

module.exports = { runImport };
