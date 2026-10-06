// News RSS intake + the news_articles store (NEWS_PAGE_DESIGN.md §10): feed
// parsing, item → card, de-dup across feeds, per-user sign-in gating, the job's
// writes (insert-only, prune, status row), and the store's query strings.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const F = require("../netlify/functions/_news-feeds.js");
const S = require("../netlify/functions/_news-store.js");
const L = require("../netlify/functions/_news-links.js");

const NOW = Date.parse("2026-10-06T12:00:00Z");
const pub = (h) => new Date(NOW - h * 3_600_000).toUTCString();

const NYT_RSS = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel><title>NYT &gt; World</title>
<item><title>Cease-Fire Talks Resume in Cairo</title><link>https://www.nytimes.com/2026/10/06/world/middleeast/ceasefire.html</link>
  <description>Negotiators returned after a pause.</description><pubDate>${pub(2)}</pubDate>
  <media:content url="https://static01.nyt.com/images/a.jpg" medium="image"/></item>
<item><title>An Old Story</title><link>https://www.nytimes.com/2026/09/20/world/old.html</link><pubDate>${pub(24 * 16)}</pubDate></item>
<item><title>Wordle</title><link>https://www.nytimes.com/games/wordle/index.html</link><pubDate>${pub(1)}</pubDate></item>
</channel></rss>`;
const NYT_HOME = `<rss><channel><item><title><![CDATA[Cease-Fire Talks Resume in Cairo]]></title>
  <link>https://www.nytimes.com/2026/10/06/world/middleeast/ceasefire.html?partner=rss</link><pubDate>${pub(2)}</pubDate></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Vikings defense carries them</title>
  <link rel="alternate" href="https://www.startribune.com/vikings-defense/601234567"/><published>${new Date(NOW - 3600e3).toISOString()}</published>
  <summary>Four sacks.</summary></entry></feed>`;

describe("parseFeed", () => {
  it("reads RSS 2.0 items (CDATA, media:content) and Atom entries", () => {
    const items = F.parseFeed(NYT_RSS);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ title: "Cease-Fire Talks Resume in Cairo", image: "https://static01.nyt.com/images/a.jpg", description: "Negotiators returned after a pause." });
    expect(F.parseFeed(NYT_HOME)[0].title).toBe("Cease-Fire Talks Resume in Cairo");
    expect(F.parseFeed(ATOM)[0]).toMatchObject({ url: "https://www.startribune.com/vikings-defense/601234567", description: "Four sacks." });
    expect(F.parseFeed("not xml <<<")).toEqual([]);
  });
});

describe("cardFromItem", () => {
  const nytFeed = { paper: "nyt", url: "x", label: "" };
  it("builds the same id and shape as the email intake; drops stale and non-article links", () => {
    const [fresh, old, game] = F.parseFeed(NYT_RSS);
    const card = F.cardFromItem(fresh, nytFeed, NOW);
    expect(card.id).toBe(L.seenId("nytimes.com/2026/10/06/world/middleeast/ceasefire.html"));
    expect(card).toMatchObject({ paper: "nyt", section: "world", source: "The New York Times", subtitle: "Negotiators returned after a pause." });
    expect(F.cardFromItem(old, nytFeed, NOW)).toBeNull();
    expect(F.cardFromItem(game, nytFeed, NOW)).toBeNull();
  });
  it("Star Tribune sections come from the feed's label", () => {
    const card = F.cardFromItem(F.parseFeed(ATOM)[0], { paper: "startribune", url: "x", label: "Sports" }, NOW);
    expect(card.section).toBe("sports");
  });
});

describe("collectFeedCards", () => {
  it("de-duplicates across feeds, prefers a sectioned copy, and reports per-feed status", async () => {
    const feeds = [
      { paper: "nyt", url: "https://feeds/home", label: "" },
      { paper: "nyt", url: "https://feeds/world", label: "" },
      { paper: "nyt", url: "https://feeds/dead", label: "" },
      { paper: "economist", url: "https://feeds/econ", label: "leaders" }
    ];
    const bodies = { "https://feeds/home": NYT_HOME, "https://feeds/world": NYT_RSS };
    const fetchImpl = vi.fn(async (u) => bodies[u]
      ? { ok: true, status: 200, text: async () => bodies[u] }
      : { ok: false, status: 404, text: async () => "" });
    const { cards, status } = await F.collectFeedCards(new Set(["nyt"]), { fetchImpl, nowMs: NOW, feeds });
    expect(cards).toHaveLength(1);
    expect(cards[0].section).toBe("world");
    expect(status.map((s) => [s.url, s.ok, s.cards])).toEqual([["https://feeds/home", true, 1], ["https://feeds/world", true, 1], ["https://feeds/dead", false, 0]]);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // the economist feed isn't fetched: no one needs it
  });
  it("every configured feed belongs to one of the four papers", () => {
    expect(F.FEEDS.length).toBeGreaterThan(40);
    expect(new Set(F.FEEDS.map((f) => f.paper))).toEqual(new Set(["nyt", "economist", "startribune", "athletic"]));
  });
});

describe("runFeedIntake", () => {
  afterEach(() => vi.restoreAllMocks());
  it("inserts only each user's signed-in papers, prunes, and writes the status row", async () => {
    const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
    const calls = [];
    const fetchImpl = async (u, opts = {}) => {
      calls.push({ u: String(u), method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
      if (String(u).includes("id=like.mailnewssubs_")) {
        return { ok: true, status: 200, json: async () => [
          { id: `mailnewssubs_${U1}`, state: { papers: { nyt: { status: "signed-in" }, economist: { status: "expired" } } } },
          { id: `mailnewssubs_${U2}`, state: { papers: { nyt: { status: "none" } } } }
        ] };
      }
      if (String(u).startsWith("https://rss.nytimes.com/") && String(u).endsWith("/World.xml")) return { ok: true, status: 200, text: async () => NYT_RSS };
      return { ok: String(u).includes("supabase.co"), status: String(u).includes("supabase.co") ? 201 : 404, text: async () => "", json: async () => [] };
    };
    const s = await F.runFeedIntake("svc", { fetchImpl, nowMs: NOW });
    expect(s.users).toBe(1);
    const inserts = calls.filter((c) => c.method === "POST" && c.u.includes("/news_articles"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].u).toContain("on_conflict=user_id,id");
    expect(inserts[0].body.map((r) => [r.user_id, r.paper, r.origin])).toEqual([[U1, "nyt", "rss"]]);
    // Only NYT (+ The Athletic, which follows the NYT sign-in) feeds were fetched — not the Economist's.
    expect(calls.some((c) => c.u.includes("economist.com"))).toBe(false);
    expect(calls.some((c) => c.u.includes("/athletic/rss/"))).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.u.includes("/news_articles?published_at=lt."))).toBe(true);
    const statusWrite = calls.find((c) => c.body?.id === "newsfeeds_status");
    expect(statusWrite.body.state.feeds.length).toBeGreaterThan(0);
  });
});

describe("news_articles store", () => {
  const U = "u-1";
  it("feedQuery: selected columns only, hidden excluded, view filters, inclusive cursor, safe search", () => {
    const q = S.feedQuery(U, { view: { kind: "section", key: "mn" }, before: "2026-10-05T10:00:00.000Z", q: "lake, street*", limit: 999, nowMs: NOW });
    expect(q).toContain(`select=${S.COLUMNS}`);
    expect(q).toContain("hidden_at=is.null");
    expect(q).toContain("section=eq.mn");
    expect(q).toContain("published_at=lte.");
    expect(q).toContain(`title=ilike.${encodeURIComponent("*lake  street*")}`);
    expect(q).toContain("limit=200");
    expect(S.feedQuery(U, { view: { kind: "sent" } })).toContain("sent_at=not.is.null");
  });
  it("cardFromRow / countsFromRows", () => {
    expect(S.cardFromRow({ id: "a", url: "u", title: "t", paper: "nyt", section: "us", published_at: "p", discovered_at: "d", lead_at: "l", read_at: null, sent_at: "s" }))
      .toEqual({ id: "a", url: "u", title: "t", subtitle: "", image: "", paper: "nyt", source: "", section: "us", publishedAt: "p", discoveredAt: "d", lead: "l", sentAt: "s" });
    expect(S.countsFromRows([
      { section: "us", paper: "nyt", unread: 2, total: 3, sent: 1 },
      { section: "mn", paper: "startribune", unread: 0, total: 1, sent: 0 }
    ])).toEqual({ all: 2, sent: 1, section: { us: 2 }, paper: { nyt: 2 }, sections: ["us", "mn"] });
  });
  it("applyDecisions: send saves to Media then stamps; read only unread rows; hide wins over read", async () => {
    const calls = [];
    const fetchImpl = async (u, opts = {}) => {
      calls.push({ u: decodeURIComponent(String(u)), method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
      if ((opts.method || "GET") === "GET") return { ok: true, json: async () => [{ id: "a", url: "https://www.nytimes.com/x", title: "T", paper: "nyt", source: "The New York Times", section: "us", published_at: "2026-10-06T00:00:00Z" }] };
      return { ok: true, text: async () => "" };
    };
    const saved = [];
    await S.applyDecisions("svc", U, [
      { id: "a", decision: "send" }, { id: "b", decision: "read" }, { id: "c", decision: "read" }, { id: "c", decision: "hide" }
    ], { saveToMedia: async (r) => saved.push(r), fetchImpl });
    expect(saved.map((r) => r.id)).toEqual(["nl-a"]);
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches.map((p) => [p.u.match(/id=in\.\(([^)]*)\)/)[1], Object.keys(p.body).filter((k) => k !== "updated_at")[0]])).toEqual([
      ['"a"', "sent_at"], ['"b"', "read_at"], ['"c"', "hidden_at"]
    ]);
    expect(patches[1].u).toContain("read_at=is.null");
  });
});
