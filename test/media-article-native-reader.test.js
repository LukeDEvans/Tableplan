import { describe, it, expect } from "vitest";
import {
  SUBSCRIBER_PAPERS,
  subscriberPaperFor,
  bodyTextLength,
  looksLikeTeaser,
  chooseLongerResult,
  parseNativeExtractResult,
  articleDomExtractor,
  ARTICLE_DOM_EXTRACTOR_SOURCE,
  TEASER_MAX_CHARS
} from "../article-native-reader.js";

describe("subscriberPaperFor", () => {
  it("matches the three papers by URL host", () => {
    expect(subscriberPaperFor({ url: "https://www.economist.com/china/2026/09/25/the-rise-of-therapy-in-china" })?.key).toBe("economist");
    expect(subscriberPaperFor({ url: "https://www.nytimes.com/2026/09/30/us/x.html" })?.key).toBe("nyt");
    expect(subscriberPaperFor({ url: "https://www.startribune.com/some-story/601234567" })?.key).toBe("startribune");
  });
  it("falls back to the publication key", () => {
    expect(subscriberPaperFor({ url: "not a url", publication: "economist" })?.key).toBe("economist");
  });
  it("returns null for other sites, including look-alike hosts", () => {
    expect(subscriberPaperFor({ url: "https://example.com/a", publication: "other" })).toBeNull();
    expect(subscriberPaperFor({ url: "https://notnytimes.com/a" })).toBeNull();
  });
  it("every paper has an https login URL and a bare cookie domain", () => {
    for (const p of SUBSCRIBER_PAPERS) {
      expect(p.loginUrl.startsWith("https://")).toBe(true);
      expect(p.cookieDomain).not.toMatch(/^\.|\//);
    }
  });
});

describe("teaser detection and result choice", () => {
  const para = (n) => `<p>${"word ".repeat(n)}</p>`;
  it("measures text without tags or entities", () => {
    expect(bodyTextLength("<p>a &amp; b</p>")).toBe(3); // "a b"
  });
  it("flags short bodies as teasers, not empty or long ones", () => {
    expect(looksLikeTeaser(para(50))).toBe(true);
    expect(looksLikeTeaser("")).toBe(false);
    expect(looksLikeTeaser(para(TEASER_MAX_CHARS))).toBe(false);
  });
  it("picks the longer result and handles nulls", () => {
    const short = { text: para(10) };
    const long = { text: para(100) };
    expect(chooseLongerResult(short, long)).toBe(long);
    expect(chooseLongerResult(long, null)).toBe(long);
    expect(chooseLongerResult(null, { error: "x" })).toBeNull();
  });
});

describe("parseNativeExtractResult", () => {
  it("parses the extractor JSON and finalUrl", () => {
    const r = parseNativeExtractResult({ json: JSON.stringify({ title: "T", author: "", date: "", text: "<p>x</p>" }), finalUrl: "https://e.com/a" });
    expect(r).toEqual({ title: "T", author: "", date: "", text: "<p>x</p>", finalUrl: "https://e.com/a" });
  });
  it("returns null for null, bad JSON or empty text", () => {
    expect(parseNativeExtractResult({ json: "null" })).toBeNull();
    expect(parseNativeExtractResult({ json: "{" })).toBeNull();
    expect(parseNativeExtractResult({ json: JSON.stringify({ text: "  " }) })).toBeNull();
    expect(parseNativeExtractResult(undefined)).toBeNull();
  });
});

// A minimal DOM stand-in: enough of querySelector/querySelectorAll/closest for
// the extractor, so it can run without a browser.
function fakeDocument({ meta = {}, title = "", nodes = [] }) {
  const mk = (tag, text, cls = "", attrs = {}) => ({
    tagName: tag.toUpperCase(), textContent: text, attrs: { class: cls, ...attrs }, children: [], parentElement: null,
    getAttribute(n) { return this.attrs[n] ?? null; },
    closest() { return null; },
    querySelectorAll(sel) { return sel === "p, h2, h3, h4, blockquote" ? this.children : []; }
  });
  const body = mk("section", "", "", { name: "articleBody" });
  body.children = nodes.map(([tag, text, cls]) => { const n = mk(tag, text, cls); n.parentElement = body; return n; });
  return {
    title,
    querySelector(sel) {
      const m = sel.match(/^meta\[(?:property|name)="([^"]+)"\]$/);
      if (m) return meta[m[1]] ? { getAttribute: () => meta[m[1]] } : null;
      return null;
    },
    querySelectorAll(sel) { return sel === 'section[name="articleBody"]' ? [body] : []; }
  };
}

describe("articleDomExtractor", () => {
  it("is a self-contained script that parses as JavaScript", () => {
    expect(() => new Function(ARTICLE_DOM_EXTRACTOR_SOURCE)).not.toThrow();
  });
  it("extracts paragraphs and metadata, skipping boilerplate and promos", () => {
    const long = "A paragraph of real article text that is comfortably long enough.";
    globalThis.document = fakeDocument({
      meta: { "og:title": "The rise of therapy in China", author: "Staff" },
      nodes: [["p", long + " 1"], ["p", "Subscribe"], ["h2", "A subheading here"], ["p", long + " 2"], ["p", "Promo text that is long enough to count", "promo-box"], ["p", long + " 3"]]
    });
    try {
      const out = JSON.parse(articleDomExtractor());
      expect(out.title).toBe("The rise of therapy in China");
      expect(out.author).toBe("Staff");
      expect(out.text).toBe(`<p>${long} 1</p>\n<h3>A subheading here</h3>\n<p>${long} 2</p>\n<p>${long} 3</p>`);
    } finally { delete globalThis.document; }
  });
  it("returns \"null\" when there isn't an article", () => {
    globalThis.document = fakeDocument({ nodes: [["p", "Only one paragraph of text here."]] });
    try { expect(articleDomExtractor()).toBe("null"); } finally { delete globalThis.document; }
  });
});
