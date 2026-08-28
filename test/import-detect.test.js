import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { detectContentType } = require("../netlify/functions/_import-detect.js");

const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

describe("detectContentType", () => {
  it("honors an explicit hint over page signals", () => {
    const html = jsonLd({ "@type": "Recipe", name: "X" });
    expect(detectContentType({ html, hint: "article" })).toMatchObject({ type: "article", reason: "hint" });
  });
  it("detects a recipe from JSON-LD @type", () => {
    expect(detectContentType({ html: jsonLd({ "@type": "Recipe", name: "X" }) })).toMatchObject({ type: "recipe", reason: "jsonld:Recipe" });
  });
  it("detects a recipe nested in @graph", () => {
    const html = jsonLd({ "@graph": [{ "@type": "WebPage" }, { "@type": "Recipe", name: "X" }] });
    expect(detectContentType({ html })).toMatchObject({ type: "recipe" });
  });
  it("detects an article from JSON-LD NewsArticle/BlogPosting", () => {
    expect(detectContentType({ html: jsonLd({ "@type": "NewsArticle", headline: "X" }) })).toMatchObject({ type: "article", reason: "jsonld:Article" });
    expect(detectContentType({ html: jsonLd({ "@type": "BlogPosting" }) })).toMatchObject({ type: "article" });
  });
  it("falls back to og:type", () => {
    expect(detectContentType({ html: `<meta property="og:type" content="article">` })).toMatchObject({ type: "article", reason: "og:type" });
    expect(detectContentType({ html: `<meta property="og:type" content="recipe">` })).toMatchObject({ type: "recipe", reason: "og:type" });
  });
  it("detects a recipe from microdata and DOM signals", () => {
    expect(detectContentType({ html: `<div itemtype="https://schema.org/Recipe">` })).toMatchObject({ type: "recipe", reason: "microdata" });
    expect(detectContentType({ html: `<li class="recipeIngredient">2 eggs</li>` })).toMatchObject({ type: "recipe", reason: "dom" });
  });
  it("uses the URL path as a weak heuristic", () => {
    expect(detectContentType({ html: "<p>hello</p>", url: "https://site.com/recipes/cake" })).toMatchObject({ type: "recipe", reason: "url" });
  });
  it("defaults to article when there is body content but no signal", () => {
    expect(detectContentType({ html: "<p>just an essay</p>" })).toMatchObject({ type: "article", reason: "default-article" });
    expect(detectContentType({ text: "some shared text" })).toMatchObject({ type: "article" });
  });
  it("returns unknown when there's nothing to go on", () => {
    expect(detectContentType({})).toMatchObject({ type: "unknown", confidence: 0 });
  });
});
