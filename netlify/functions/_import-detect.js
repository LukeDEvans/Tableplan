// _import-detect.js — pure content-type detection for the import gateway.
//
// Given a page's html/text/url/metadata (fetched server-side, or supplied by the
// extension for a rendered page), guess whether it's a recipe or an article
// BEFORE running a full extractor. Deterministic and DOM-free (regex/JSON scan
// only) so it unit-tests cleanly. The gateway still verifies the guess by
// extracting and falling back to the other type if the guess doesn't pan out —
// detection just picks the order to try.
//
// Signal priority (strongest first):
//   1. explicit caller hint
//   2. JSON-LD @type (Recipe vs Article/NewsArticle/BlogPosting)
//   3. og:type
//   4. Recipe microdata (itemtype schema.org/Recipe)
//   5. Recipe DOM signals (recipeIngredient, common recipe-plugin classes)
//   6. URL path heuristic (/recipe…)
//   7. default: article if there's any body, else unknown

const { findJsonLdBlocks, parseJsonLd } = require("./_recipe-extract.js");

const ARTICLE_LD_TYPES = new Set([
  "article", "newsarticle", "blogposting", "reportagenewsarticle",
  "reviewnewsarticle", "opinionnewsarticle", "backgroundnewsarticle", "liveblogposting",
]);

function collectLdTypes(node, out) {
  if (!node || typeof node !== "object") return;
  const t = node["@type"];
  if (t) (Array.isArray(t) ? t : [t]).forEach((x) => out.add(String(x).toLowerCase()));
  if (Array.isArray(node["@graph"])) node["@graph"].forEach((n) => collectLdTypes(n, out));
}

function jsonLdTypes(html) {
  const out = new Set();
  for (const block of findJsonLdBlocks(html)) {
    for (const node of parseJsonLd(block)) collectLdTypes(node, out);
  }
  return out;
}

function metaContent(html, prop) {
  const re1 = new RegExp(`property=["']${prop}["']\\s+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`content=["']([^"']+)["']\\s+property=["']${prop}["']`, "i");
  return (html.match(re1) || html.match(re2))?.[1] || "";
}

function detectContentType(input = {}) {
  const html = input.html || "";
  const text = input.text || "";
  const url = input.url || "";
  const metadata = input.metadata || {};
  const hint = String(input.hint || input.hints?.contentType || "").toLowerCase();

  if (hint === "recipe" || hint === "article") {
    return { type: hint, confidence: 1, reason: "hint" };
  }

  const ld = jsonLdTypes(html);
  if (ld.has("recipe")) return { type: "recipe", confidence: 0.95, reason: "jsonld:Recipe" };
  for (const t of ld) if (ARTICLE_LD_TYPES.has(t)) return { type: "article", confidence: 0.9, reason: "jsonld:Article" };

  const og = (metaContent(html, "og:type") || metadata.ogType || "").toLowerCase();
  if (og.includes("recipe")) return { type: "recipe", confidence: 0.8, reason: "og:type" };
  if (og.includes("article")) return { type: "article", confidence: 0.7, reason: "og:type" };

  if (/itemtype=["'][^"']*schema\.org\/Recipe/i.test(html)) {
    return { type: "recipe", confidence: 0.7, reason: "microdata" };
  }
  if (/recipeingredient|wprm-recipe|tasty-recipes|mv-recipe-card|class=["'][^"']*\brecipe\b/i.test(html)) {
    return { type: "recipe", confidence: 0.5, reason: "dom" };
  }
  if (/\/recipes?\//i.test(url)) return { type: "recipe", confidence: 0.4, reason: "url" };

  if (html || text) return { type: "article", confidence: 0.3, reason: "default-article" };
  return { type: "unknown", confidence: 0, reason: "none" };
}

module.exports = { detectContentType, jsonLdTypes };
