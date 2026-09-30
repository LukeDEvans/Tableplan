// Media news deck (news-notif-ui.js): pure markup + the accepted-article record,
// which must match the server's record exactly (same id → one merged article).
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { newsDeckHtml, acceptedArticleRecord } from "../news-notif-ui.js";
const require = createRequire(import.meta.url);
const N = require("../netlify/functions/_news-links.js");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const card = {
  id: "abc123", url: "https://www.nytimes.com/2026/09/26/us/deal.html", title: "Deal <b>reached</b>",
  subtitle: "It averts a shutdown.", image: "https://static01.nyt.com/x.jpg", paper: "nyt",
  source: "The New York Times", publishedAt: "2026-09-26T00:00:00.000Z"
};

describe("newsDeckHtml", () => {
  it("renders a swipe card with photo, title, subtitle and source, escaped", () => {
    const html = newsDeckHtml([card], esc);
    expect(html).toContain('data-news-id="abc123"');
    expect(html).toContain('src="https://static01.nyt.com/x.jpg"');
    expect(html).toContain("Deal &lt;b&gt;reached&lt;/b&gt;");
    expect(html).not.toContain("<b>reached</b>");
    expect(html).toContain("It averts a shutdown.");
    expect(html).toContain("The New York Times");
    expect(html).toContain("data-news-save");
    expect(html).toContain("data-news-dismiss");
  });
  it("title-only card still renders (no image, no subtitle)", () => {
    const html = newsDeckHtml([{ ...card, image: "", subtitle: "" }], esc);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("media-news-subtitle");
    expect(html).toContain("No summary available.");
  });
  it("empty state", () => {
    expect(newsDeckHtml([], esc)).toContain("No new articles");
  });
});

describe("acceptedArticleRecord", () => {
  it("client record === server record (so the two copies merge by id)", () => {
    const now = "2026-09-27T12:00:00.000Z";
    expect(acceptedArticleRecord(card, now)).toEqual(N.acceptedArticleRecord(card, now));
  });
  it("files under the paper's Media → Publications key, link-only", () => {
    const r = acceptedArticleRecord(card, "2026-09-27T12:00:00.000Z");
    expect(r).toMatchObject({ id: "nl-abc123", publication: "nyt", url: card.url, text: null });
  });
});

describe("filterResolvedNews (PUB-1: no resurrection of swiped cards)", () => {
  it("drops cards that are queued or already resolved this session", async () => {
    const { filterResolvedNews } = await import("../news-notif-ui.js");
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const out = filterResolvedNews(list, [{ id: "b", decision: "dismiss" }], new Set(["c"]));
    expect(out.map((x) => x.id)).toEqual(["a", "d"]);
  });
  it("tolerates missing inputs", async () => {
    const { filterResolvedNews } = await import("../news-notif-ui.js");
    expect(filterResolvedNews(null, null, null)).toEqual([]);
    expect(filterResolvedNews([{ id: "x" }], [], new Set()).map((x) => x.id)).toEqual(["x"]);
  });
});
