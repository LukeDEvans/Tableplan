import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { extractRecipeFromHtml, extractRecipeFromText } = require("../netlify/functions/_recipe-extract.js");

const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

describe("extractRecipeFromHtml — JSON-LD", () => {
  it("extracts a valid Schema.org Recipe", () => {
    const html = jsonLd({
      "@type": "Recipe", name: "Chocolate Chip Cookies",
      recipeIngredient: ["2 cups flour", "1 cup sugar", "2 eggs"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Mix" }, { "@type": "HowToStep", text: "Bake" }],
      prepTime: "PT15M", cookTime: "PT30M", totalTime: "PT45M", recipeYield: "24 cookies",
    });
    const r = extractRecipeFromHtml(html, "https://ex.com/cookies");
    expect(r.name).toBe("Chocolate Chip Cookies");
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[0]).toMatchObject({ amount: "2", quantity: "C", item: "flour" });
    expect(r.steps).toBe("Mix\nBake");
    expect(r.prepTime).toBe("15 min");
    expect(r.cookTime).toBe("30 min");
    expect(r.time).toBe("45 min");
    expect(r.servings).toBe(24);
    expect(r.sourceUrl).toBe("https://ex.com/cookies");
  });

  it("finds the Recipe among multiple JSON-LD blocks", () => {
    const html =
      jsonLd({ "@type": "WebSite", name: "Not a recipe" }) +
      jsonLd({ "@type": "Recipe", name: "Soup", recipeIngredient: ["1 onion"], recipeInstructions: ["Boil"] });
    const r = extractRecipeFromHtml(html, "https://ex.com/soup");
    expect(r.name).toBe("Soup");
    expect(r.steps).toBe("Boil");
  });

  it("finds a Recipe nested in @graph", () => {
    const html = jsonLd({ "@graph": [
      { "@type": "Organization", name: "Site" },
      { "@type": "Recipe", name: "Bread", recipeIngredient: ["flour"], recipeInstructions: [{ text: "Bake" }] },
    ] });
    expect(extractRecipeFromHtml(html, "u").name).toBe("Bread");
  });

  it("handles a Recipe whose @type is an array", () => {
    const html = jsonLd({ "@type": ["Recipe", "NewsArticle"], name: "Combo", recipeIngredient: ["water"], recipeInstructions: ["Drink"] });
    expect(extractRecipeFromHtml(html, "u").name).toBe("Combo");
  });

  it("falls back gracefully on malformed JSON-LD (no throw)", () => {
    const html = `<script type="application/ld+json">{ not: valid json, }</script><title>Fallback Dish</title>`;
    const r = extractRecipeFromHtml(html, "u");
    expect(r).toBeTruthy();
    expect(r.name).toBe("Fallback Dish");
  });

  it("defaults missing optional fields", () => {
    const html = jsonLd({ "@type": "Recipe", name: "Bare", recipeIngredient: ["salt"], recipeInstructions: ["Add"] });
    const r = extractRecipeFromHtml(html, "u");
    expect(r.prepTime).toBe("");
    expect(r.cookTime).toBe("");
    expect(r.servings).toBe(1);
  });

  it("accepts string instructions and a single-string ingredient", () => {
    const html = jsonLd({ "@type": "Recipe", name: "One", recipeIngredient: "1 egg", recipeInstructions: "Fry it" });
    const r = extractRecipeFromHtml(html, "u");
    expect(r.ingredients).toHaveLength(1);
    expect(r.steps).toBe("Fry it");
  });

  it("strips step-number prefixes and header-only steps", () => {
    const html = jsonLd({ "@type": "Recipe", name: "Steps", recipeIngredient: ["x"], recipeInstructions: [{ text: "Step 1" }, { text: "1. Preheat" }, { text: "2) Bake" }] });
    const r = extractRecipeFromHtml(html, "u");
    expect(r.steps).toBe("Preheat\nBake"); // "Step 1" is header-only and dropped
  });
});

describe("extractRecipeFromHtml — fallback + edge cases", () => {
  it("returns an empty-ish recipe for a non-recipe page", () => {
    const r = extractRecipeFromHtml("<html><body><p>Hello world, no recipe here.</p></body></html>", "u");
    expect(r.ingredients).toHaveLength(0);
  });
  it("does not throw on empty input", () => {
    expect(() => extractRecipeFromHtml("", "u")).not.toThrow();
    expect(extractRecipeFromHtml("", "u").ingredients).toEqual([]);
  });
});

describe("extractRecipeFromText", () => {
  it("parses an Ingredients:/Instructions: text block", () => {
    const text = "Pancakes\nIngredients:\n1 cup flour\n2 eggs\nInstructions:\nMix everything\nCook on griddle";
    const r = extractRecipeFromText(text, "u");
    expect(r.name).toBe("Pancakes");
    expect(r.ingredients).toHaveLength(2);
    expect(r.steps).toBe("Mix everything\nCook on griddle");
  });
  it("uses a provided fallback name (Google Docs title path)", () => {
    const r = extractRecipeFromText("Ingredients:\n1 cup rice", "u", "Grandma's Rice");
    expect(r.name).toBe("Grandma's Rice");
  });
});
