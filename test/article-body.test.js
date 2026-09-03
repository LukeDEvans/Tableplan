import { describe, it, expect } from "vitest";
import { bodyFetchRequest, normalizeFetchedBody, mergeFetchedMetadata } from "../article-body.js";

describe("bodyFetchRequest — request shaping", () => {
  it("prefers canonicalUrl and resolves the publication name from pubsById", () => {
    const r = bodyFetchRequest(
      { canonicalUrl: "https://x.com/a", url: "https://x.com/a?utm=1", publicationId: "p1" },
      { pubsById: { p1: { name: "The Economist" } } },
    );
    expect(r).toEqual({ ok: true, url: "https://x.com/a", publication: "The Economist" });
  });
  it("falls back to url, then to category for the publication label", () => {
    const r = bodyFetchRequest({ url: "https://x.com/b", category: "NutritionFacts" });
    expect(r).toEqual({ ok: true, url: "https://x.com/b", publication: "NutritionFacts" });
  });
  it("fails cleanly when there is no URL", () => {
    expect(bodyFetchRequest({ title: "no url" }).ok).toBe(false);
    expect(bodyFetchRequest({}).error).toBeTruthy();
  });
});

describe("normalizeFetchedBody — response normalization", () => {
  it("accepts a real body and surfaces refreshed metadata", () => {
    const n = normalizeFetchedBody({ text: "<p>Body</p>", title: "T", author: "A", date: "2026-09-01" });
    expect(n).toEqual({ ok: true, text: "<p>Body</p>", title: "T", author: "A", date: "2026-09-01" });
  });
  it("treats a blank/missing body as a failure with the server error (or a default)", () => {
    expect(normalizeFetchedBody({ text: "   " }).ok).toBe(false);
    expect(normalizeFetchedBody({ error: "Paywalled" })).toEqual({ ok: false, text: "", error: "Paywalled" });
    expect(normalizeFetchedBody(null).error).toBeTruthy();
  });
});

describe("mergeFetchedMetadata — non-destructive, body-free", () => {
  it("fills a placeholder (empty or URL) title but never overwrites a real one", () => {
    const empty = mergeFetchedMetadata({ title: "" }, { title: "Real Title" });
    expect(empty).toEqual({ article: { title: "Real Title" }, changed: true });

    const urlTitle = mergeFetchedMetadata({ title: "https://x.com/a", url: "https://x.com/a" }, { title: "Real Title" });
    expect(urlTitle.article.title).toBe("Real Title");

    const real = mergeFetchedMetadata({ title: "Human Title" }, { title: "Extractor Title" });
    expect(real.article.title).toBe("Human Title");
    expect(real.changed).toBe(false);
  });

  it("fills author/publishedAt only when currently empty", () => {
    const filled = mergeFetchedMetadata({ author: "", publishedAt: null }, { author: "Jane", date: "2026-08-01" });
    expect(filled.article.author).toBe("Jane");
    expect(filled.article.publishedAt).toBe("2026-08-01");
    expect(filled.changed).toBe(true);

    const kept = mergeFetchedMetadata({ author: "Existing", publishedAt: "2026-01-01" }, { author: "Jane", date: "2026-08-01" });
    expect(kept.article.author).toBe("Existing");
    expect(kept.article.publishedAt).toBe("2026-01-01");
    expect(kept.changed).toBe(false);
  });

  it("never mutates the input and never leaks a body onto the metadata", () => {
    const input = { title: "T", text: "SHOULD NOT SURVIVE", body: "NOR THIS" };
    const { article } = mergeFetchedMetadata(input, { title: "X" });
    expect(input.text).toBe("SHOULD NOT SURVIVE"); // input untouched
    expect("text" in article).toBe(false);
    expect("body" in article).toBe(false);
  });
});
