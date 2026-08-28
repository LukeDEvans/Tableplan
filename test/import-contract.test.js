import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { scoreRecipe, scoreArticle, recipeResult, articleResult, makeResult, TYPE, STATUS } =
  require("../netlify/functions/_import-contract.js");

const recipe = (over = {}) => ({ name: "Cake", ingredients: [{ item: "flour" }], steps: "Bake", time: "1 hr", servings: 8, ...over });

describe("scoreRecipe", () => {
  it("ready: name + ingredients + steps", () => {
    expect(scoreRecipe(recipe())).toMatchObject({ status: STATUS.READY });
    expect(scoreRecipe(recipe()).confidence).toBeGreaterThan(0.9);
  });
  it("needs-review: name + ingredients but no steps", () => {
    expect(scoreRecipe(recipe({ steps: "" }))).toMatchObject({ status: STATUS.NEEDS_REVIEW });
  });
  it("needs-review: name + steps but no ingredients", () => {
    expect(scoreRecipe(recipe({ ingredients: [] }))).toMatchObject({ status: STATUS.NEEDS_REVIEW });
  });
  it("partial: name only", () => {
    expect(scoreRecipe(recipe({ ingredients: [], steps: "" }))).toMatchObject({ status: STATUS.PARTIAL });
  });
  it("failed: nothing usable", () => {
    expect(scoreRecipe({ name: "", ingredients: [], steps: "" })).toMatchObject({ status: STATUS.FAILED, confidence: 0 });
  });
  it("ignores blank ingredient rows when scoring", () => {
    expect(scoreRecipe(recipe({ ingredients: [{ item: "" }, { item: "  " }] }))).toMatchObject({ status: STATUS.NEEDS_REVIEW });
  });
  it("emits warnings for missing fields", () => {
    const w = scoreRecipe(recipe({ time: "", servings: 1 })).warnings;
    expect(w).toContain("no cooking time");
    expect(w).toContain("servings defaulted");
  });
});

describe("scoreArticle", () => {
  const long = "word ".repeat(60); // > 200 chars
  it("ready: body + author + date", () => {
    expect(scoreArticle({ title: "T", text: long, author: "A", date: "2026-01-01" })).toMatchObject({ status: STATUS.READY });
  });
  it("needs-review: body but missing author/date", () => {
    expect(scoreArticle({ title: "T", text: long, author: "", date: "" })).toMatchObject({ status: STATUS.NEEDS_REVIEW });
  });
  it("partial: title only / too little text", () => {
    expect(scoreArticle({ title: "T", text: "short" })).toMatchObject({ status: STATUS.PARTIAL });
  });
  it("failed: no text and no title", () => {
    expect(scoreArticle({ title: "", text: "" })).toMatchObject({ status: STATUS.FAILED, confidence: 0 });
  });
});

describe("result builders", () => {
  it("recipeResult carries type, data, and a canonical source", () => {
    const r = recipeResult(recipe(), "https://ex.com/cake?utm_source=n#x");
    expect(r.type).toBe(TYPE.RECIPE);
    expect(r.status).toBe(STATUS.READY);
    expect(r.source).toMatchObject({ url: "https://ex.com/cake?utm_source=n#x", canonicalUrl: "https://ex.com/cake" });
    expect(r.data.name).toBe("Cake");
  });
  it("articleResult carries type article", () => {
    expect(articleResult({ title: "T", text: "x".repeat(300), author: "A", date: "d" }, "https://ex.com/a").type).toBe(TYPE.ARTICLE);
  });
  it("makeResult supports an unknown/unsupported result", () => {
    const u = makeResult({ type: TYPE.UNKNOWN, status: STATUS.FAILED });
    expect(u).toMatchObject({ type: "unknown", status: "failed", confidence: 0 });
  });
});
