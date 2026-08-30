import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { runImport } = require("../netlify/functions/_import-gateway.js");

const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const RECIPE_HTML = jsonLd({
  "@type": "Recipe", name: "Banana Bread",
  recipeIngredient: ["2 cups flour", "3 bananas", "1 cup sugar"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mash" }, { "@type": "HowToStep", text: "Bake" }],
  totalTime: "PT60M", recipeYield: "1 loaf",
});
const P = (s) => `<p>${s} ${"and more words to comfortably clear the forty character block minimum.".padEnd(60, " ")}</p>`;
const ARTICLE_HTML = `<html><head>
  <meta property="og:title" content="The Future of Urban Gardening">
  <meta name="author" content="Jane Doe">
  <meta property="article:published_time" content="2026-01-15">
  </head><body><article>
  ${P("Urban gardening has grown across cities worldwide over the past decade.")}
  ${P("Rooftop plots now supply fresh produce to neighborhoods that lacked access.")}
  ${P("Experts expect the trend to accelerate as climate pressures increase steadily.")}
  </article></body></html>`;

const okFetch = (body) => async (url) => ({ ok: true, status: 200, finalUrl: url, contentType: "text/html", body });

describe("runImport — URL fetch path", () => {
  it("detects and extracts a recipe URL as a ready recipe", async () => {
    const r = await runImport({ source: { url: "https://site.com/banana" } }, { safeFetch: okFetch(RECIPE_HTML) });
    expect(r.type).toBe("recipe");
    expect(r.status).toBe("ready");
    expect(r.data.name).toBe("Banana Bread");
    expect(r.detection.reason).toBe("jsonld:Recipe");
    expect(r.source.canonicalUrl).toBe("https://site.com/banana");
  });

  it("detects and extracts an article URL", async () => {
    const r = await runImport({ source: { url: "https://news.com/gardens" } }, { safeFetch: okFetch(ARTICLE_HTML) });
    expect(r.type).toBe("article");
    expect(["ready", "needs-review"]).toContain(r.status);
    expect(r.data.title).toBe("The Future of Urban Gardening");
    expect(r.data.text).toContain("Urban gardening");
  });

  it("reclassifies: a /recipes/ URL that is really an article returns an article", async () => {
    const r = await runImport({ source: { url: "https://site.com/recipes/oops" } }, { safeFetch: okFetch(ARTICLE_HTML) });
    expect(r.detection.type).toBe("recipe"); // guessed from the URL
    expect(r.type).toBe("article");          // but extraction picked the better core
  });

  it("returns failed on a non-ok fetch", async () => {
    const r = await runImport({ source: { url: "https://site.com/x" } }, { safeFetch: async () => ({ ok: false, status: 403 }) });
    expect(r).toMatchObject({ type: "unknown", status: "failed" });
    expect(r.warnings[0]).toMatch(/403/);
  });

  it("propagates a safeFetch SSRF/typed error (handler maps it)", async () => {
    const boom = Object.assign(new Error("Blocked host"), { isImportFetchError: true, code: "blocked-host" });
    await expect(runImport({ source: { url: "http://localhost/x" } }, { safeFetch: async () => { throw boom; } })).rejects.toBe(boom);
  });
});

describe("runImport — supplied (rendered) content path", () => {
  it("uses extractedContent.text without fetching", async () => {
    const spy = vi.fn();
    const r = await runImport({
      source: { url: "https://paywalled.com/a", sourceClient: "extension" },
      hints: { contentType: "article" },
      extractedContent: { text: "word ".repeat(80), metadata: { title: "Rendered", author: "A", date: "2026-02-02" } },
    }, { safeFetch: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(r.type).toBe("article");
    expect(r.status).toBe("ready");
    expect(r.data.title).toBe("Rendered");
  });

  it("extracts a recipe from supplied html", async () => {
    const spy = vi.fn();
    const r = await runImport({ source: { url: "https://x.com/r" }, extractedContent: { html: RECIPE_HTML } }, { safeFetch: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(r.type).toBe("recipe");
    expect(r.data.name).toBe("Banana Bread");
  });

  // The unified extension action ("Add to Tableplan") sends BOTH the raw page
  // html (for recipe structured-data detection) AND cleaned article text (empty
  // on non-article pages) in one call. These pin that combined-payload contract.
  it("recipe page: html + empty text → recipe, still no fetch", async () => {
    const spy = vi.fn();
    const r = await runImport({
      source: { url: "https://x.com/r", sourceClient: "extension" },
      extractedContent: { html: RECIPE_HTML, text: "", metadata: { title: "Banana Bread", publication: "other" } },
    }, { safeFetch: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(r.type).toBe("recipe");
    expect(r.data.name).toBe("Banana Bread");
  });

  it("article page: article html + cleaned text → article using the rendered text", async () => {
    const spy = vi.fn();
    const cleaned = "Urban gardening has grown across cities worldwide over the past decade, and it keeps expanding well past the two hundred character floor the scorer needs to call this a ready article with real body text.";
    const r = await runImport({
      source: { url: "https://paywalled.com/a", sourceClient: "extension" },
      extractedContent: { html: ARTICLE_HTML, text: cleaned, metadata: { title: "Rendered Title", author: "Jane Doe", date: "2026-01-15", publication: "nyt" } },
    }, { safeFetch: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(r.type).toBe("article");
    expect(r.status).toBe("ready");
    expect(r.data.title).toBe("Rendered Title");
    expect(r.data.text).toBe(cleaned); // the rendered text wins over an HTML re-scan
  });
});

describe("runImport — nothing to import", () => {
  it("fails when neither URL nor content is provided", async () => {
    const r = await runImport({ source: {} }, { safeFetch: async () => { throw new Error("should not fetch"); } });
    expect(r).toMatchObject({ type: "unknown", status: "failed" });
  });
});
