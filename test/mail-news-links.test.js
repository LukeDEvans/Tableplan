// News intake (NEWS_INTAKE_DESIGN.md): link extraction, canonical identity,
// freshness, card building, and the never-twice merge. Network is injected.
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const N = require("../netlify/functions/_news-links.js");

const src = (paper) => N.NEWS_LINK_SOURCES.find((s) => s.paper === paper);
const NOW = Date.parse("2026-09-27T12:00:00Z");
const EMAIL_DATE = "Sun, 27 Sep 2026 06:00:00 -0500";

// NYT newsletters wrap every link in an nl.nytimes.com click-tracker.
const NYT_EMAIL = `
<html><body>
  <a href="https://nl.nytimes.com/f/a/AAA~~/1"><img src="https://static01.nyt.com/images/2026/09/26/a.jpg"></a>
  <a href="https://nl.nytimes.com/f/a/AAA~~/2">Senate Reaches Deal on Spending Bill</a>
  <a href="https://nl.nytimes.com/f/a/BBB~~/3">Read the full story</a>
  <a href="https://nl.nytimes.com/f/a/CCC~~/4">A Quiet Revolution in Minnesota Farming</a>
  <a href="https://nl.nytimes.com/f/a/DDD~~/5">Try this pasta tonight</a>
  <a href="https://nl.nytimes.com/f/a/EEE~~/6">Play today's Wordle</a>
  <a href="https://nl.nytimes.com/f/a/FFF~~/7">Unsubscribe</a>
  <a href="https://nl.nytimes.com/f/a/GGG~~/8">An old story resurfaced</a>
</body></html>`;
const NYT_REDIRECTS = {
  "https://nl.nytimes.com/f/a/AAA~~/1": "https://www.nytimes.com/2026/09/26/us/politics/spending-deal.html?smid=nl-share&utm_source=x",
  "https://nl.nytimes.com/f/a/AAA~~/2": "https://www.nytimes.com/2026/09/26/us/politics/spending-deal.html?campaign_id=9",
  "https://nl.nytimes.com/f/a/BBB~~/3": "https://www.nytimes.com/2026/09/26/us/politics/spending-deal.html",
  "https://nl.nytimes.com/f/a/CCC~~/4": "https://www.nytimes.com/2026/09/25/business/minnesota-farming.html",
  "https://nl.nytimes.com/f/a/DDD~~/5": "https://cooking.nytimes.com/recipes/1234-pasta",
  "https://nl.nytimes.com/f/a/EEE~~/6": "https://www.nytimes.com/games/wordle/index.html",
  "https://nl.nytimes.com/f/a/GGG~~/8": "https://www.nytimes.com/2025/01/02/world/old-story.html"
};
const resolveNyt = async (u) => NYT_REDIRECTS[u] || u;

const ECON_EMAIL = `
<a href="https://www.economist.com/leaders/2026/09/24/the-case-for-cheaper-housing?utm_campaign=x">The case for cheaper housing</a>
<a href="https://www.economist.com/the-world-in-brief">The world in brief</a>
<a href="https://www.economist.com/finance-and-economics/2026/09/25/why-bond-yields-are-rising/">Why bond yields are rising</a>
<a href="https://www.economist.com/subscribe">Subscribe</a>`;

const STRIB_EMAIL = `
<a href="https://www.startribune.com/vikings-win-opener/601234567?utm_source=nl"><img src="https://arc.startribune.com/v.jpg">Vikings win opener</a>
<a href="https://www.startribune.com/newsletters">Manage newsletters</a>`;

const COOKING_EMAIL = `
<a href="https://cooking.nytimes.com/recipes/1025-lentil-soup">Lentil Soup</a>
<a href="https://cooking.nytimes.com/article/best-soups">Best soups</a>`;

describe("canonical identity", () => {
  it("drops query, hash, trailing slash, www and scheme differences", () => {
    const a = N.canonicalizeArticleUrl("https://www.nytimes.com/2026/09/26/us/x.html?smid=nl#top");
    const b = N.canonicalizeArticleUrl("http://nytimes.com/2026/09/26/us/x.html/");
    expect(a.key).toBe(b.key);
    expect(a.url).toBe("https://www.nytimes.com/2026/09/26/us/x.html");
    expect(N.seenId(a.key)).toBe(N.seenId(b.key));
  });
  it("rejects non-http URLs", () => {
    expect(N.canonicalizeArticleUrl("mailto:x@y.z")).toBeNull();
  });
});

describe("extractNewsLinks", () => {
  it("NYT: resolves trackers, merges one article linked three ways, drops Cooking/Games/boilerplate", async () => {
    const links = await N.extractNewsLinks(NYT_EMAIL, src("nyt"), { resolve: resolveNyt });
    const keys = links.map((l) => l.key).sort();
    expect(keys).toEqual([
      "nytimes.com/2025/01/02/world/old-story.html",
      "nytimes.com/2026/09/25/business/minnesota-farming.html",
      "nytimes.com/2026/09/26/us/politics/spending-deal.html"
    ]);
    const deal = links.find((l) => l.key.includes("spending-deal"));
    expect(deal.anchorText).toBe("Senate Reaches Deal on Spending Bill"); // not "Read the full story"
    expect(deal.emailImage).toBe("https://static01.nyt.com/images/2026/09/26/a.jpg");
    expect(deal.url).not.toMatch(/\?/);
  });
  it("Economist: direct links only, non-article pages ignored", async () => {
    const links = await N.extractNewsLinks(ECON_EMAIL, src("economist"), { resolve: async (u) => u });
    expect(links.map((l) => l.url)).toEqual([
      "https://www.economist.com/leaders/2026/09/24/the-case-for-cheaper-housing",
      "https://www.economist.com/finance-and-economics/2026/09/25/why-bond-yields-are-rising"
    ]);
  });
  it("Star Tribune: slug/numeric-id URLs", async () => {
    const links = await N.extractNewsLinks(STRIB_EMAIL, src("startribune"), { resolve: async (u) => u });
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://www.startribune.com/vikings-win-opener/601234567");
    expect(links[0].anchorText).toBe("Vikings win opener");
  });
  it("NYT Cooking email yields no news links", async () => {
    const links = await N.extractNewsLinks(COOKING_EMAIL, src("nyt"), { resolve: async (u) => u });
    expect(links).toEqual([]);
  });
  it("caps articles per email", async () => {
    const html = Array.from({ length: 60 }, (_, i) =>
      `<a href="https://www.economist.com/briefing/2026/09/24/story-number-${i}">Story number ${i}</a>`).join("");
    const links = await N.extractNewsLinks(html, src("economist"), {});
    expect(links).toHaveLength(40);
  });
});

describe("parseArticleMeta", () => {
  it("reads og tags in either attribute order and decodes entities", () => {
    const head = `<title>Fallback</title>
      <meta property="og:title" content="Deal &amp; Done">
      <meta content="A subtitle here" property="og:description">
      <meta property="og:image" content="https://img.example/x.jpg">
      <meta property="article:published_time" content="2026-09-26T10:00:00Z">`;
    expect(N.parseArticleMeta(head)).toEqual({
      title: "Deal & Done", description: "A subtitle here",
      image: "https://img.example/x.jpg", publishedAt: "2026-09-26T10:00:00Z"
    });
  });
});

describe("collectNewsCards", () => {
  const meta = {
    "https://www.nytimes.com/2026/09/26/us/politics/spending-deal.html": {
      title: "Senate Reaches Deal - The New York Times", description: "The agreement averts a shutdown.", image: "https://static01.nyt.com/og.jpg"
    }
  };
  const fetchMeta = async (u) => meta[u] || {};

  it("builds cards with title/subtitle/photo, falls back to email context, drops stale and seen", async () => {
    const seen = { [N.seenId("nytimes.com/2026/09/25/business/minnesota-farming.html")]: 20000 };
    const { cards, seenIds } = await N.collectNewsCards(NYT_EMAIL, src("nyt"), {
      emailDate: EMAIL_DATE, seen, nowMs: NOW, resolve: resolveNyt, fetchMeta
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      url: "https://www.nytimes.com/2026/09/26/us/politics/spending-deal.html",
      title: "Senate Reaches Deal", subtitle: "The agreement averts a shutdown.",
      image: "https://static01.nyt.com/og.jpg", paper: "nyt", source: "The New York Times"
    });
    // The stale 2025 article is recorded as seen (never re-fetched) but not carded;
    // the already-seen farming story isn't re-recorded.
    expect(seenIds).toContain(N.seenId("nytimes.com/2025/01/02/world/old-story.html"));
    expect(seenIds).not.toContain(N.seenId("nytimes.com/2026/09/25/business/minnesota-farming.html"));
  });

  it("title-only card when the page fetch is blocked", async () => {
    const { cards } = await N.collectNewsCards(STRIB_EMAIL, src("startribune"), {
      emailDate: EMAIL_DATE, nowMs: NOW, resolve: async (u) => u, fetchMeta: async () => ({})
    });
    expect(cards[0]).toMatchObject({ title: "Vikings win opener", subtitle: "", image: "https://arc.startribune.com/v.jpg" });
    expect(cards[0].publishedAt).toBe(new Date(EMAIL_DATE).toISOString()); // no URL date → email date
  });

  it("drops an undated article whose page says it is old", async () => {
    const { cards, seenIds } = await N.collectNewsCards(STRIB_EMAIL, src("startribune"), {
      emailDate: EMAIL_DATE, nowMs: NOW, resolve: async (u) => u,
      fetchMeta: async () => ({ publishedAt: "2025-06-01T00:00:00Z" })
    });
    expect(cards).toEqual([]);
    expect(seenIds).toHaveLength(1);
  });
});

describe("mergeNewsResults — never twice, never stale", () => {
  const card = (id, publishedAt = "2026-09-26T00:00:00.000Z") => ({ id, url: `https://x/${id}`, title: id, publishedAt });

  it("the same article from two emails in one batch is added once", () => {
    const r = N.mergeNewsResults({}, [
      { cards: [card("a"), card("b")], seenIds: ["a", "b"] },
      { cards: [card("a")], seenIds: ["a"] }
    ], NOW);
    expect(r.added).toBe(2);
    expect(r.row.newsPending.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("an article already seen (accepted/dismissed earlier) never comes back", () => {
    const today = Math.floor(NOW / 86400000);
    const r = N.mergeNewsResults({ newsSeen: { a: today - 3 }, newsPending: [] }, [{ cards: [card("a")], seenIds: [] }], NOW);
    expect(r.added).toBe(0);
    expect(r.row.newsPending).toEqual([]);
  });

  it("prunes the seen record past its window and pending cards past freshness", () => {
    const today = Math.floor(NOW / 86400000);
    const r = N.mergeNewsResults({
      newsSeen: { old: today - N.SEEN_DAYS - 1, recent: today - 1 },
      newsPending: [card("stale", "2026-09-10T00:00:00.000Z"), card("ok")]
    }, [], NOW);
    expect(Object.keys(r.row.newsSeen)).toEqual(["recent"]);
    expect(r.row.newsPending.map((c) => c.id)).toEqual(["ok"]);
  });

  it("newest first", () => {
    const r = N.mergeNewsResults({}, [{ cards: [card("older", "2026-09-24T00:00:00Z"), card("newer", "2026-09-26T00:00:00Z")], seenIds: ["older", "newer"] }], NOW);
    expect(r.row.newsPending.map((c) => c.id)).toEqual(["newer", "older"]);
  });
});

describe("toggles", () => {
  it("on by default; only an explicit false disables a paper", () => {
    expect(N.newsLinkSourceForSender("The New York Times <nytdirect@nytimes.com>", {})?.paper).toBe("nyt");
    expect(N.newsLinkSourceForSender("The New York Times <nytdirect@nytimes.com>", { nytNewsLinks: false })).toBeNull();
    expect(N.newsLinkSourceForSender("The New York Times <nytdirect@nytimes.com>", { nytNewsLinks: true })?.paper).toBe("nyt");
    expect(N.newsLinkSourceForSender("Star Tribune <news@email.startribune.com>", { startribuneNewsLinks: true })?.paper).toBe("startribune");
  });
});
