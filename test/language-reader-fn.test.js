import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { _test } = require("../netlify/functions/dutch-reader.js");
const { parseNosFeed, htmlToParagraphs, cleanGloss, parseJsonObject, allowedArticleUrl, FULL_TEXT_MIN } = _test;

const long = "Dit is een lange zin over het nieuws van vandaag. ".repeat(20);
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>NOS Jeugdjournaal</title>
<item><title>Heel Holland Bakt-winnaar Pep trakteert op school</title><link>https://jeugdjournaal.nl/artikel/123-pep</link>
<pubDate>Mon, 26 Oct 2026 14:00:00 +0100</pubDate><description><![CDATA[<p>Pep heeft gewonnen.</p><p>Hij bakt taart&nbsp;voor de klas.</p>]]></description></item>
<item><title>Lang verhaal</title><link>https://nos.nl/artikel/456</link><pubDate>Mon, 26 Oct 2026 12:00:00 +0100</pubDate>
<description><![CDATA[<p>${long}</p><figure><img src="x"/><figcaption>Foto</figcaption></figure><p>Tweede alinea.</p><p>Lees ook: iets anders</p>]]></description></item>
<item><title></title><link>https://nos.nl/x</link></item>
</channel></rss>`;

describe("dutch-reader: feeds", () => {
  it("parses items; short descriptions are summaries, long ones carry paragraphs", () => {
    const items = parseNosFeed(RSS);
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ title: "Heel Holland Bakt-winnaar Pep trakteert op school", url: "https://jeugdjournaal.nl/artikel/123-pep", publishedAt: "2026-10-26T13:00:00.000Z" });
    expect(items[0].summary).toBe("Pep heeft gewonnen. Hij bakt taart voor de klas.");
    expect(items[0].paragraphs).toBeUndefined();
    expect(items[1].paragraphs.length).toBe(2); // figure and "Lees ook" dropped
    expect(items[1].paragraphs[1]).toBe("Tweede alinea.");
    expect(items[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(long.length).toBeGreaterThan(FULL_TEXT_MIN);
  });
  it("bad XML gives no items", () => expect(parseNosFeed("<not xml")).toEqual([]));
  it("html → paragraphs", () => {
    expect(htmlToParagraphs("<p>Een &amp; twee</p><p>drie<br>vier</p>")).toEqual(["Een & twee", "drie vier"]);
  });
  it("only NOS article hosts, https", () => {
    expect(allowedArticleUrl("https://nos.nl/artikel/1")).toBe(true);
    expect(allowedArticleUrl("https://jeugdjournaal.nl/artikel/1")).toBe(true);
    expect(allowedArticleUrl("http://nos.nl/artikel/1")).toBe(false);
    expect(allowedArticleUrl("https://evil.example/nos.nl")).toBe(false);
    expect(allowedArticleUrl("https://nos.nl.evil.example/")).toBe(false);
  });
});

describe("dutch-reader: lookups", () => {
  it("reads a JSON reply, even wrapped in text", () => {
    expect(parseJsonObject('Here: {"en":"bread"} ok')).toEqual({ en: "bread" });
    expect(parseJsonObject("nope")).toBeNull();
  });
  it("cleans a gloss and refuses an empty one", () => {
    expect(cleanGloss({ lemma: "lopen", en: "to walk", pos: "verb", form: "past tense", note: "" }, "liep")).toEqual({ lemma: "lopen", en: "to walk", pos: "verb", form: "past tense", note: "" });
    expect(cleanGloss({ en: "x".repeat(200), pos: "bogus" }, "woord")).toMatchObject({ lemma: "woord", pos: "other" });
    expect(cleanGloss({ en: "" }, "w")).toBeNull();
    expect(cleanGloss(null, "w")).toBeNull();
  });
});
