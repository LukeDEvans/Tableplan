import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import * as client from "../recipes-ui.js";
const require = createRequire(import.meta.url);
const server = require("../netlify/functions/_recipe-extract.js");

// REC-5: server (_recipe-extract.js) and client twin (recipes-ui.js) import parsing.
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const OPTIONS = ["pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/2", "3"];

describe.each([
  ["server", server.readableDuration],
  ["client", client.readableDuration],
])("readableDuration (%s)", (_name, readableDuration) => {
  it.each([
    ["PT15M", "15 min"],
    ["PT1H30M", "1 hr 30 min"],
    ["PT0.5H", "30 min"],
    ["PT1.5H", "1 hr 30 min"],
    ["PT90S", "2 min"],
    ["P1DT2H", "1 day 2 hr"],
    ["P2D", "2 days"],
    ["P0Y0M0DT0H35M0.000S", "35 min"],
    ["20 minutes", "20 minutes"],
  ])("%s → %s", (input, expected) => {
    expect(readableDuration(input)).toBe(expected);
  });
});

describe("server parseIngredientLine", () => {
  it("unicode mixed fractions", () => {
    expect(server.parseIngredientLine("1½ cups flour")).toMatchObject({ amount: "1 1/2", quantity: "C", item: "flour" });
    expect(server.parseIngredientLine("2¼ tsp yeast")).toMatchObject({ amount: "2 1/4", quantity: "tsp", item: "yeast" });
  });
  it("decimals and out-of-list numbers keep amount + unit", () => {
    expect(server.parseIngredientLine("1.5 cups milk")).toMatchObject({ amount: "1 1/2", quantity: "C", item: "milk" });
    expect(server.parseIngredientLine("400 g spaghetti")).toMatchObject({ amount: "400", quantity: "g", item: "spaghetti" });
    expect(server.parseIngredientLine("2.2 lb chicken thighs")).toMatchObject({ amount: "2.2", quantity: "lb", item: "chicken thighs" });
  });
});

describe("client ingredient helpers", () => {
  it("normalizeIngredientFractions splits mixed unicode fractions", () => {
    expect(client.normalizeIngredientFractions("1½ cups")).toBe("1 1/2 cups");
    expect(client.normalizeIngredientFractions("¾ cup")).toBe("3/4 cup");
  });
  it("takeIngredientAmount keeps decimals / large numbers", () => {
    const a = ["1.5", "cups", "milk"];
    expect(client.takeIngredientAmount(a, OPTIONS)).toBe("1 1/2");
    expect(a).toEqual(["cups", "milk"]);
    const b = ["400", "g", "pasta"];
    expect(client.takeIngredientAmount(b, OPTIONS)).toBe("400");
    const c = ["1", "1/2", "cups"];
    expect(client.takeIngredientAmount(c, OPTIONS)).toBe("1 1/2");
    const d = ["salt"];
    expect(client.takeIngredientAmount(d, OPTIONS)).toBe("");
  });
});

const sectioned = [
  { "@type": "HowToSection", name: "For the sauce", itemListElement: [
    { "@type": "HowToStep", text: "Simmer tomatoes." },
    { "@type": "HowToStep", text: "Season." },
  ] },
  { "@type": "HowToSection", name: "To finish", itemListElement: [{ "@type": "HowToStep", text: "Toss with pasta." }] },
];

describe("HowToSection instructions", () => {
  it("server keeps nested steps with the section name as a heading line", () => {
    const r = server.extractRecipeFromHtml(jsonLd({ "@type": "Recipe", name: "Pasta", recipeIngredient: ["1 lb pasta"], recipeInstructions: sectioned }), "u");
    expect(r.steps).toBe("For the sauce:\nSimmer tomatoes.\nSeason.\nTo finish:\nToss with pasta.");
  });
  it("client twin matches", () => {
    expect(client.instructionsToText(sectioned)).toBe("For the sauce:\nSimmer tomatoes.\nSeason.\nTo finish:\nToss with pasta.");
    expect(client.instructionsToText(["A", { text: "B" }])).toBe("A\nB");
  });
});

describe("server JSON-LD durations", () => {
  it("prep/cook/total run through readableDuration", () => {
    const r = server.extractRecipeFromHtml(jsonLd({ "@type": "Recipe", name: "X", recipeIngredient: ["1 egg"], prepTime: "PT0.25H", cookTime: "P1DT2H" }), "u");
    expect(r.prepTime).toBe("15 min");
    expect(r.cookTime).toBe("1 day 2 hr");
  });
});
