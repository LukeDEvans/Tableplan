// News story titles (NEWS_TITLES_DESIGN.md). Fixtures are real titles stored
// on 2026-10-26..28 (live database, read-only).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../netlify/functions/_news-titles.js");
const Links = require("../netlify/functions/_news-links.js");
const Feeds = require("../netlify/functions/_news-feeds.js");

const STRIB = (slug, id = "601885908") => `https://www.startribune.com/${slug}/${id}`;
const NYT_FAQ = "https://www.nytimes.com/interactive/2026/10/27/climate/el-nino-climate-faq.html";

describe("isWeakTitle", () => {
  it("flags newsletter link fragments", () => {
    for (const t of ["your most pressing questions", "and here", "could hit 60 degrees", "filling out our form",
      "he interviewed The Minnesota Daily’s editor in chief", "Rachel Hutton's story here", "Newly retired", "in This Week in Nature"]) {
      expect(T.isWeakTitle(t, { url: STRIB("x-y"), origin: "email" }), t).toBe(true);
    }
  });
  it("flags generic live-blog titles from any source", () => {
    expect(T.isWeakTitle("Here’s the latest.", { origin: "rss" })).toBe(true);
    expect(T.isWeakTitle("Here's the latest", { origin: "rss" })).toBe(true);
  });
  it("flags a glued byline and a slug stand-in", () => {
    const glued = "Where the Parties Are Outspending Each Other in the Midterm Ad War Most ad spending in the general election is taking place in competitive races deep in Trump territory. Republicans are on the defensive. By Jillian Vordick and Theodore Schleifer";
    expect(T.isWeakTitle(glued, { origin: "email" })).toBe(true);
    expect(T.isWeakTitle("Israels Future", { url: "https://www.nytimes.com/2026/10/26/briefing/israels-future.html", origin: "email" })).toBe(true);
  });
  it("keeps real headlines", () => {
    for (const t of ["Climate change nearly tripled size of Boundary Waters wildfires, study suggests",
      "Here’s how to cast a ballot in Minnesota", "2026 Minnesota voter guide: Who's on my ballot?",
      "J.J. McCarthy trade leaves room for Kyler Murray to prove he's Vikings' future at QB", "AI eats science 2: life 2.0",
      "iPhone sales slip in China"]) {
      expect(T.isWeakTitle(t, { url: STRIB("something-else"), origin: "email" }), t).toBe(false);
    }
    // Feed titles are the paper's own: short ones stand.
    expect(T.isWeakTitle("Far, Far Away", { origin: "rss" })).toBe(false);
    expect(T.isWeakTitle("Deportation Doubts", { origin: "rss" })).toBe(false);
  });
});

describe("slugTitle", () => {
  it("title-cases a slug with small words and acronyms", () => {
    expect(T.slugTitle(STRIB("kamala-harris-is-sitting-out-minnesota-for-now"))).toBe("Kamala Harris Is Sitting Out Minnesota for Now");
    expect(T.slugTitle(NYT_FAQ)).toBe("El Nino Climate FAQ");
  });
});

describe("splitAnchor", () => {
  it("separates headline, summary and byline in a card-sized link", () => {
    const inner = "<h2>Where the Parties Are Outspending Each Other in the Midterm Ad War</h2><p>Most ad spending in the general election is taking place in competitive races deep in Trump territory.</p><p>By Jillian Vordick and Theodore Schleifer</p>";
    expect(T.splitAnchor(inner)).toEqual({
      headline: "Where the Parties Are Outspending Each Other in the Midterm Ad War",
      dek: "Most ad spending in the general election is taking place in competitive races deep in Trump territory."
    });
  });
  it("cuts a trailing byline from one line, skips a one-word kicker", () => {
    expect(T.splitAnchor("<span>ANALYSIS</span><br>Senate Reaches Deal on Spending Bill By Carl Hulse").headline).toBe("Senate Reaches Deal on Spending Bill");
  });
  it("leaves plain link text alone", () => {
    expect(T.splitAnchor("your most pressing questions")).toEqual({ headline: "your most pressing questions", dek: "" });
  });
});

describe("chooseEmailTitle", () => {
  it("uses the page's headline when it was read", () => {
    expect(T.chooseEmailTitle({ metaTitle: "Everything You Could Possibly Want to Know About El Niño", anchor: "your most pressing questions", url: NYT_FAQ }))
      .toEqual({ title: "Everything You Could Possibly Want to Know About El Niño", from: "meta" });
  });
  it("falls to the slug when the link text is a fragment", () => {
    expect(T.chooseEmailTitle({ anchor: "your most pressing questions", url: NYT_FAQ }).title).toBe("El Nino Climate FAQ");
    expect(T.chooseEmailTitle({ anchor: "still hasn't weighed in", url: STRIB("kamala-harris-is-sitting-out-minnesota-for-now") }).title)
      .toBe("Kamala Harris Is Sitting Out Minnesota for Now");
  });
  it("prefers a much longer slug over a short link text", () => {
    expect(T.chooseEmailTitle({ anchor: "Stream featured sessions", url: STRIB("watch-the-replays-of-the-north-star-summit-sessions", "601893185") }).from).toBe("slug");
  });
  it("keeps a real headline in the link", () => {
    expect(T.chooseEmailTitle({ anchor: "Twin Cities suburbs restrict license plate data after Star Tribune investigation", url: STRIB("twin-cities-suburbs-license-plate-cameras-immigration") }).from).toBe("anchor");
    expect(T.chooseEmailTitle({ anchor: "Vikings win opener", url: STRIB("vikings-win-opener") }).title).toBe("Vikings win opener");
  });
});

describe("blogName", () => {
  it("drops the blog's own live label", () => {
    expect(T.blogName("Israel Election Results Live Updates: Exit Polls Show No Clear Winner")).toBe("Israel Election Results: Exit Polls Show No Clear Winner");
    expect(T.blogName("Live Updates: At Least 30 Killed in Train Collision in Spain")).toBe("At Least 30 Killed in Train Collision in Spain");
  });
});

describe("fixFeedTitle", () => {
  it("names a live-blog update after its blog", () => {
    expect(T.fixFeedTitle({ title: "Here’s the latest.", subtitle: "One train rear-ended another.", url: "https://www.nytimes.com/live/2026/10/28/world/spain-train-crash-toledo/spain-train-crash-toledo" }))
      .toEqual({ title: "Live: Spain Train Crash Toledo", subtitle: "One train rear-ended another." });
  });
  it("leaves real feed titles alone", () => {
    expect(T.fixFeedTitle({ title: "Takeaways from Warsh’s news conference.", url: "https://www.nytimes.com/live/2026/10/28/business/fed-meeting-warsh-interest-rates/takeaways" }).title)
      .toBe("Takeaways from Warsh’s news conference.");
  });
});

describe("feed parsing keeps titles with inline markup", () => {
  it("doesn't lose the words around <em>", () => {
    const xml = `<rss><channel><item><title>Who Should <em>A.I.</em> Companies Make Rules for?</title><link>https://www.nytimes.com/2026/10/26/magazine/ai-companies-law-regulations.html</link><description><![CDATA[<p>Five experts &amp; more.</p>]]></description></item>
      <item><title><![CDATA[Bread & Butter]]></title><link>x</link></item>
      <item><title>Who Should &lt;em&gt;Pay&lt;/em&gt;?</title><link>y</link></item></channel></rss>`;
    const items = Feeds.parseFeed(xml);
    expect(items[0].title).toBe("Who Should A.I. Companies Make Rules for?");
    expect(items[0].description).toBe("Five experts & more.");
    expect(items[1].title).toBe("Bread & Butter");
    expect(items[2].title).toBe("Who Should Pay?");
  });
  it("a live update card from the feed gets its blog's name", () => {
    const card = Feeds.cardFromItem({ url: "https://www.nytimes.com/live/2026/10/28/world/israel-elections/heres-the-latest", title: "Here’s the latest.", description: "", publishedAt: "2026-10-28T06:00:00Z" },
      { paper: "nyt", label: "" }, Date.parse("2026-10-28T12:00:00Z"));
    expect(card.title).toBe("Live: Israel Elections");
  });
});

describe("email intake", () => {
  it("a blocked page gives the slug, not the link fragment", async () => {
    const source = Links.NEWS_LINK_SOURCES.find((s) => s.paper === "nyt");
    const html = `<p>Here are answers to <a href="${NYT_FAQ}">your most pressing questions</a>.</p>`;
    const { cards } = await Links.collectNewsCards(html, source, { nowMs: Date.parse("2026-10-28T12:00:00Z"), resolve: async (u) => u, fetchMeta: async () => ({}) });
    expect(cards[0].title).toBe("El Nino Climate FAQ");
  });
  it("a card-sized link gives its headline and summary", async () => {
    const source = Links.NEWS_LINK_SOURCES.find((s) => s.paper === "nyt");
    const url = "https://www.nytimes.com/interactive/2026/10/28/us/politics/ad-spending-house-senate-election-campaigns.html";
    const html = `<a href="${url}"><h2>Where the Parties Are Outspending Each Other in the Midterm Ad War</h2><p>Most ad spending is in races deep in Trump territory.</p><p>By Jillian Vordick</p></a>`;
    const { cards } = await Links.collectNewsCards(html, source, { nowMs: Date.parse("2026-10-28T12:00:00Z"), resolve: async (u) => u, fetchMeta: async () => ({}) });
    expect(cards[0]).toMatchObject({ title: "Where the Parties Are Outspending Each Other in the Midterm Ad War", subtitle: "Most ad spending is in races deep in Trump territory." });
  });
});

const NOW = Date.parse("2026-10-28T23:30:00Z");
const ROWS = [
  { id: "faq", url: NYT_FAQ, title: "your most pressing questions", subtitle: null, origin: "email", discovered_at: "2026-10-28T18:39:34Z" },
  { id: "harris", url: STRIB("kamala-harris-is-sitting-out-minnesota-for-now"), title: "still hasn't weighed in", subtitle: null, origin: "email", discovered_at: "2026-10-26T13:59:03Z" },
  { id: "good", url: STRIB("the-humble-turkey-trot", "601905402"), title: "The humble turkey trot is giving Minnesota’s marathons a run for their money", subtitle: null, origin: "email", discovered_at: "2026-10-28T11:40:19Z" },
  { id: "spainMain", url: "https://www.nytimes.com/live/2026/10/28/world/spain-train-crash-toledo", title: "Live Updates: At Least 30 Killed in Train Collision in Spain, Officials Say", subtitle: "Two trains collided.", origin: "rss", discovered_at: "2026-10-28T11:07:06Z" },
  { id: "spainLatest", url: "https://www.nytimes.com/live/2026/10/28/world/spain-train-crash-toledo/spain-train-crash-toledo", title: "Here’s the latest.", subtitle: "One train rear-ended another.", origin: "rss", discovered_at: "2026-10-28T11:07:06Z" },
  { id: "fedLatest", url: "https://www.nytimes.com/live/2026/10/28/business/fed-meeting-warsh-interest-rates/heres-the-latest", title: "Here’s the latest.", subtitle: null, origin: "rss", discovered_at: "2026-10-28T20:07:06Z" },
  { id: "fedArticle", url: "https://www.nytimes.com/2026/10/28/business/economy/warsh-interest-rates-fed.html", title: "Here’s the latest.", subtitle: null, origin: "rss", discovered_at: "2026-10-28T16:07:04Z" },
  { id: "update", url: "https://www.nytimes.com/live/2026/10/27/world/israel-elections/twice-before", title: "Twice before, Netanyahu was ousted then returned to power.", subtitle: null, origin: "rss", discovered_at: "2026-10-27T20:07:05Z" }
];

describe("planRepairs", () => {
  it("fixes each kind of weak title from the best source and leaves good ones", () => {
    const rssById = new Map([["harris", { id: "harris", title: "Kamala Harris is sitting out Minnesota — for now", subtitle: "The former vice president has kept her distance." }]]);
    const metas = new Map([["faq", { title: "Everything You Could Possibly Want to Know About El Niño", description: "The climate pattern is back." }]]);
    const plan = Object.fromEntries(T.planRepairs(ROWS, { rssById, metas }).map((p) => [p.id, p]));
    expect(plan.faq).toMatchObject({ title: "Everything You Could Possibly Want to Know About El Niño", subtitle: "The climate pattern is back.", from: "page" });
    expect(plan.harris).toMatchObject({ title: "Kamala Harris is sitting out Minnesota — for now", from: "feed" });
    expect(plan.spainLatest).toMatchObject({ title: "Live: At Least 30 Killed in Train Collision in Spain, Officials Say", from: "blog" });
    expect(plan.fedLatest).toMatchObject({ title: "Live: Fed Meeting Warsh Interest Rates", from: "feed-fix" });
    expect(plan.fedArticle).toMatchObject({ title: "Warsh Interest Rates Fed", from: "slug" });
    expect(plan.good).toBeUndefined();
    expect(plan.spainMain).toBeUndefined();
    expect(plan.update).toBeUndefined();
  });
  it("without the page, a fragment still becomes the slug", () => {
    const plan = T.planRepairs(ROWS.filter((r) => r.id === "faq"));
    expect(plan[0]).toMatchObject({ title: "El Nino Climate FAQ", from: "slug" });
  });
  it("is stable: running it on its own output changes nothing more", () => {
    const first = T.planRepairs(ROWS);
    const after = ROWS.map((r) => { const p = first.find((x) => x.id === r.id); return p ? { ...r, title: p.title, ...(p.subtitle !== undefined ? { subtitle: p.subtitle } : {}) } : r; });
    const second = T.planRepairs(after).filter((p) => p.from !== "page" && p.from !== "feed");
    // A slug stand-in stays a retry candidate for the page, but nothing rewrites it again.
    expect(second).toEqual([]);
  });
});

describe("wantsMeta", () => {
  it("reads pages only for recent weak email rows and generic feed rows, never live updates", () => {
    const ids = T.wantsMeta(ROWS, { nowMs: NOW }).map((r) => r.id);
    expect(ids).toContain("faq");
    expect(ids).toContain("fedArticle");
    expect(ids).not.toContain("harris");      // older than 36 h
    expect(ids).not.toContain("good");
    expect(ids).not.toContain("spainLatest"); // takes its blog's title
  });
});

describe("repairTitles", () => {
  it("reads once, fetches capped pages, patches only improvements", async () => {
    const queries = [], patches = [], fetched = [];
    const r = await T.repairTitles({
      userId: "u1", nowMs: NOW, metaCap: 1,
      getRows: async (q) => { queries.push(q); return ROWS; },
      patchRow: async (id, body) => { patches.push([id, body]); },
      fetchMeta: async (url) => { fetched.push(url); return { title: "Everything You Could Possibly Want to Know About El Niño" }; }
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("select=id,url,title,subtitle,origin,discovered_at");
    expect(queries[0]).toContain("limit=200");
    expect(fetched).toEqual([NYT_FAQ]);
    expect(patches.map(([id]) => id).sort()).toEqual(["faq", "fedArticle", "fedLatest", "harris", "spainLatest"].sort());
    expect(Object.fromEntries(patches).faq.title).toBe("Everything You Could Possibly Want to Know About El Niño");
    expect(r).toMatchObject({ candidates: ROWS.length, pagesRead: 1, pagesFound: 1, fixed: 5 });
  });
  it("a failed page read or patch doesn't stop the run", async () => {
    const r = await T.repairTitles({
      userId: "u1", nowMs: NOW,
      getRows: async () => ROWS,
      patchRow: async (id) => { if (id === "harris") throw new Error("500"); },
      fetchMeta: async () => { throw new Error("blocked"); }
    });
    expect(r.fixed).toBe(4);
  });
});
