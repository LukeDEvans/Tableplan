import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeScannedArticle, scanArticleFromImages } from "../article-scan.js";

describe("article-scan — normalize to the app's article shape", () => {
  it("assembles paragraphs into ESCAPED HTML body + carries metadata + scan provenance", () => {
    const a = normalizeScannedArticle({ title: "T", author: "Jane", date: "2026-09-01", publication: "Mag", paragraphs: ["Hello <b>world</b>", "Second"] });
    expect(a).toMatchObject({ title: "T", author: "Jane", date: "2026-09-01", publication: "Mag" });
    expect(a.text).toBe("<p>Hello &lt;b&gt;world&lt;/b&gt;</p><p>Second</p>");
    expect(a.provenance).toEqual({ origin: "imported", source: "scan" });
  });
  it("falls back to splitting a body string on blank lines; drops empties", () => {
    expect(normalizeScannedArticle({ title: "T", body: "Para one\n\nPara two\n\n" }).text).toBe("<p>Para one</p><p>Para two</p>");
  });
  it("safe on garbage input", () => {
    expect(() => normalizeScannedArticle(null)).not.toThrow();
    expect(normalizeScannedArticle({}).text).toBe("");
  });
});

describe("scanArticleFromImages — reuses the shared document-scan seam", () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });
  it("returns { article, rawText, model } and posts the article prompt + image block", async () => {
    let body;
    globalThis.fetch = vi.fn(async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"title":"Scanned","paragraphs":["Body"]}' }] }) };
    });
    const res = await scanArticleFromImages(["data:image/jpeg;base64,QUJD"], { apiKey: "k", model: "m" });
    expect(res.model).toBe("m");
    expect(res.rawText).toContain("Scanned");
    expect(res.article.title).toBe("Scanned");
    expect(res.article.text).toBe("<p>Body</p>");
    expect(body.messages[0].content[0].text).toContain("Extract the article");
    expect(body.messages[0].content[1].type).toBe("image");
  });
});
