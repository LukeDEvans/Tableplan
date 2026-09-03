import { describe, it, expect } from "vitest";
import { parseFeed } from "../feed-parse.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>NutritionFacts</title>
  <description>Latest videos</description>
  <link>https://nutritionfacts.org</link>
  <item>
    <title><![CDATA[Big Sugar & the Guidelines]]></title>
    <link>https://nutritionfacts.org/a?utm_source=rss</link>
    <guid isPermaLink="false">nf-123</guid>
    <pubDate>Tue, 01 Sep 2026 10:00:00 +0000</pubDate>
    <dc:creator>Michael Greger</dc:creator>
    <description>A short excerpt &amp; more.</description>
    <content:encoded><![CDATA[<p>FULL BODY HTML</p>]]></content:encoded>
    <category>Nutrition</category>
    <media:content url="https://img.example/a.jpg" medium="image"/>
  </item>
  <item>
    <title>Second</title>
    <link>https://nutritionfacts.org/b</link>
    <guid>https://nutritionfacts.org/b</guid>
    <pubDate>Mon, 31 Aug 2026 09:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Sample</title>
  <subtitle>sub</subtitle>
  <link rel="self" href="https://x.com/feed"/>
  <link rel="alternate" href="https://x.com/home"/>
  <entry>
    <title>Atom One</title>
    <link rel="alternate" href="https://x.com/one"/>
    <id>tag:x.com,2026:one</id>
    <published>2026-09-01T12:00:00Z</published>
    <updated>2026-09-02T08:00:00Z</updated>
    <author><name>Jane Doe</name></author>
    <summary>Atom excerpt</summary>
    <category term="Tech"/>
  </entry>
</feed>`;

describe("parseFeed — RSS 2.0", () => {
  const r = parseFeed(RSS);
  it("detects RSS and reads channel + items", () => {
    expect(r.ok).toBe(true);
    expect(r.format).toBe("rss");
    expect(r.feed.title).toBe("NutritionFacts");
    expect(r.items.length).toBe(2);
  });
  it("extracts CDATA title, link, guid (+isPermaLink), date, author, category, image", () => {
    const a = r.items[0];
    expect(a.title).toBe("Big Sugar & the Guidelines"); // CDATA unwrapped
    expect(a.link).toBe("https://nutritionfacts.org/a?utm_source=rss");
    expect(a.guid).toBe("nf-123");
    expect(a.guidIsPermalink).toBe(false);
    expect(a.published).toContain("01 Sep 2026");
    expect(a.author).toBe("Michael Greger");
    expect(a.description).toBe("A short excerpt & more."); // entity-decoded excerpt
    expect(a.category).toBe("Nutrition");
    expect(a.imageUrl).toBe("https://img.example/a.jpg");
  });
  it("does NOT surface content:encoded as a body field (excerpt only)", () => {
    expect(JSON.stringify(r.items[0])).not.toContain("FULL BODY");
  });
});

describe("parseFeed — Atom", () => {
  const r = parseFeed(ATOM);
  it("detects Atom and reads the alternate link + id + dates + author + category", () => {
    expect(r.ok).toBe(true);
    expect(r.format).toBe("atom");
    expect(r.feed.title).toBe("Atom Sample");
    const e = r.items[0];
    expect(e.link).toBe("https://x.com/one");            // rel=alternate, not rel=self
    expect(e.guid).toBe("tag:x.com,2026:one");
    expect(e.guidIsPermalink).toBe(false);
    expect(e.published).toBe("2026-09-01T12:00:00Z");
    expect(e.updated).toBe("2026-09-02T08:00:00Z");
    expect(e.author).toBe("Jane Doe");
    expect(e.category).toBe("Tech");
  });
});

describe("parseFeed — robustness", () => {
  it("an EMPTY but valid feed is ok:true with no items (≠ a broken feed)", () => {
    const r = parseFeed(`<rss version="2.0"><channel><title>Empty</title></channel></rss>`);
    expect(r.ok).toBe(true);
    expect(r.items).toEqual([]);
  });
  it("malformed / non-feed input is ok:false (never a fake empty success)", () => {
    expect(parseFeed("").ok).toBe(false);
    expect(parseFeed("<html><body>not a feed</body></html>").ok).toBe(false);
    expect(parseFeed("garbage <<< not xml").ok).toBe(false);
  });
  it("one malformed item does not lose neighboring valid items", () => {
    const r = parseFeed(`<rss><channel><title>T</title>
      <item><title>Good A</title><link>https://x.com/a</link></item>
      <item><title>Bad — no link</title></item>
      <item><title>Good B</title><link>https://x.com/b</link></item>
    </channel></rss>`);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.title)).toEqual(["Good A", "Bad — no link", "Good B"]);
  });
});
