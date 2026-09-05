import { describe, it, expect } from "vitest";
import { prepareArticleListenText } from "../tts-article-text.mjs";

// This text feeds the content-addressed TTS cache key, and the client + the
// server-side pre-synth job BOTH call this function. These assertions pin the
// exact output so any drift (which would silently break cache matching) fails CI.
describe("prepareArticleListenText", () => {
  it("prepends a title + source intro, then the stripped body", () => {
    const r = prepareArticleListenText({ title: "Big News", author: "Jane Doe", text: "<p>Hello  world.</p>" });
    expect(r.text).toBe("Big News. From Jane Doe. Hello world.");
    // intro = "Big News. From Jane Doe." → 5 words
    expect(r.introWords).toBe(5);
  });

  it("omits the source line for email-sourced articles", () => {
    const r = prepareArticleListenText({ title: "Digest", author: "email", text: "Body here." });
    expect(r.text).toBe("Digest. Body here.");
    expect(r.introWords).toBe(1); // intro "Digest" → "Digest." is one token
  });

  it("falls back to publication when author is absent", () => {
    const r = prepareArticleListenText({ title: "T", publication: "The Times", text: "Words." });
    expect(r.text).toBe("T. From The Times. Words.");
  });

  it("handles a missing title (body only, no leading intro)", () => {
    const r = prepareArticleListenText({ text: "Just the body." });
    expect(r.text).toBe("Just the body.");
    expect(r.introWords).toBe(0);
  });

  it("strips HTML tags and collapses whitespace in the body", () => {
    const r = prepareArticleListenText({ title: "X", text: "<h1>A</h1>\n\n  <p>b\tc</p>" });
    expect(r.text).toBe("X. A b c");
  });

  it("returns null when there is no readable body", () => {
    expect(prepareArticleListenText({ title: "Only a title" })).toBeNull();
    expect(prepareArticleListenText({ text: "<p>   </p>" })).toBeNull();
    expect(prepareArticleListenText(null)).toBeNull();
  });
});
