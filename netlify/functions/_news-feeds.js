// News RSS intake (NEWS_PAGE_DESIGN.md §10): every section feed of the four papers,
// read hourly by the scheduled news-feeds function and inserted into news_articles
// for each user signed in to that paper. Email intake (_news-links.js) keeps running
// alongside; both share one article id (seenId of the canonical URL), so an article
// seen both ways is one story.
//
// Feed URLs follow each paper's documented pattern but could not be fetched from the
// build environment (egress-blocked), so every run records per-feed status in the
// `newsfeeds_status` row (ok, HTTP status, item count). A dead feed is skipped, not
// fatal. Check that row after the first deploy and prune dead URLs here.
const { XMLParser } = require("fast-xml-parser");
const Links = require("./_news-links.js");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15";
const FETCH_TIMEOUT_MS = 6000;
const CONCURRENCY = 16;
const ITEMS_PER_FEED = 60;

// `label` feeds sectionFor() when the URL alone can't place an article (the Star
// Tribune's URLs carry no section). NYT and Economist URLs carry their own.
const nyt = (name, label = "") => ({ paper: "nyt", url: `https://rss.nytimes.com/services/xml/rss/nyt/${name}.xml`, label });
const econ = (slug) => ({ paper: "economist", url: `https://www.economist.com/${slug}/rss.xml`, label: slug });
// Star Tribune: its site runs on Arc XP; both Arc's outbound-feed paths and the
// legacy section feeds are listed — whichever answers is used (see the status row).
const strib = (slug, label) => [
  { paper: "startribune", url: `https://www.startribune.com/arc/outboundfeeds/rss/category/${slug}/?outputType=xml`, label },
  { paper: "startribune", url: `https://www.startribune.com/${slug}/index.rss2`, label }
];
const athletic = (path) => ({ paper: "athletic", url: `https://www.nytimes.com/athletic/rss/${path}/`, label: "sports" });

const FEEDS = [
  nyt("HomePage"), nyt("World"), nyt("US"), nyt("Politics"), nyt("NYRegion"), nyt("Upshot"),
  nyt("Business"), nyt("Economy"), nyt("Technology"), nyt("YourMoney"), nyt("RealEstate"),
  nyt("Science"), nyt("Climate"), nyt("Health"), nyt("Well"),
  nyt("Opinion"), nyt("Arts"), nyt("Books"), nyt("Movies"), nyt("Theater"), nyt("Television"),
  nyt("FashionandStyle"), nyt("DiningandWine"), nyt("Travel"), nyt("Magazine"), nyt("Obituaries"), nyt("Sports"),
  econ("leaders"), econ("briefing"), econ("united-states"), econ("the-americas"), econ("asia"), econ("china"),
  econ("middle-east-and-africa"), econ("europe"), econ("britain"), econ("international"),
  econ("business"), econ("finance-and-economics"), econ("science-and-technology"), econ("culture"),
  econ("graphic-detail"), econ("obituary"), econ("special-report"), econ("by-invitation"), econ("the-world-this-week"),
  { paper: "startribune", url: "https://www.startribune.com/arc/outboundfeeds/rss/?outputType=xml", label: "" },
  ...strib("local", "Local"), ...strib("politics", "Politics"), ...strib("business", "Business"),
  ...strib("sports", "Sports"), ...strib("opinion", "Opinion"), ...strib("variety", "Variety"),
  ...strib("nation", "Nation"), ...strib("world", "World"), ...strib("health", "Health"),
  athletic("news"), athletic("nfl"), athletic("nba"), athletic("mlb"), athletic("nhl"),
  athletic("college-football"), athletic("football")
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const text = (x) => {
  if (x == null) return "";
  if (typeof x === "object") return String(x["#text"] ?? x["@_href"] ?? "");
  return String(x);
};
const stripHtml = (s) => String(s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;|&#8220;|&#8221;/gi, '"').replace(/&#39;|&#8217;|&#8216;|&apos;/gi, "’")
  .replace(/\s+/g, " ").trim();

// RSS 2.0 or Atom → [{ url, title, description, image, publishedAt }]. Pure.
function parseFeed(xml) {
  let doc;
  try { doc = parser.parse(String(xml || "")); } catch { return []; }
  const rssItems = arr(doc?.rss?.channel?.item);
  const atomEntries = arr(doc?.feed?.entry);
  const out = [];
  for (const it of rssItems) {
    const media = arr(it["media:content"]).find((m) => m?.["@_url"]) || arr(it["media:thumbnail"])[0] || arr(it.enclosure).find((e) => /^image\//.test(e?.["@_type"] || "image/"));
    out.push({
      url: text(it.link) || text(it.guid),
      title: stripHtml(text(it.title)),
      description: stripHtml(text(it.description)),
      image: media?.["@_url"] || "",
      publishedAt: text(it.pubDate) || text(it["dc:date"])
    });
  }
  for (const e of atomEntries) {
    const link = arr(e.link).find((l) => !l?.["@_rel"] || l["@_rel"] === "alternate") || arr(e.link)[0];
    out.push({
      url: link?.["@_href"] || text(link),
      title: stripHtml(text(e.title)),
      description: stripHtml(text(e.summary) || text(e.content)),
      image: arr(e["media:thumbnail"])[0]?.["@_url"] || arr(e["media:content"])[0]?.["@_url"] || "",
      publishedAt: text(e.published) || text(e.updated)
    });
  }
  return out;
}

// One feed item → a News card (same shape and id as the email intake), or null if
// it isn't an article of this paper or is too old. Pure.
function cardFromItem(item, feed, nowMs = Date.now()) {
  const source = Links.NEWS_LINK_SOURCES.find((s) => s.paper === feed.paper);
  const hit = String(item.url || "").trim().match(source.articleRe);
  if (!hit) return null;
  const c = Links.canonicalizeArticleUrl(hit[0]);
  if (!c) return null;
  const t = Date.parse(item.publishedAt || "");
  const publishedAt = Number.isNaN(t) ? (Links.dateFromUrl(c.url) || new Date(nowMs).toISOString()) : new Date(t).toISOString();
  if (!Links.isFresh(publishedAt, nowMs)) return null;
  const title = String(item.title || "").replace(source.titleSuffixRe, "").trim();
  if (!title) return null;
  const subtitle = String(item.description || "").trim();
  return {
    id: Links.seenId(c.key),
    url: c.url,
    title: title.slice(0, 300),
    subtitle: subtitle && subtitle !== title ? subtitle.slice(0, 500) : "",
    image: /^https:\/\//i.test(item.image || "") ? item.image : "",
    paper: feed.paper,
    source: source.name,
    section: Links.sectionFor(c.url, { section: feed.label }, feed.paper),
    publishedAt,
    discoveredAt: new Date(nowMs).toISOString()
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function fetchFeed(feed, { fetchImpl = fetch } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchImpl(feed.url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    clearTimeout(timer);
    if (!res.ok) return { status: res.status, items: [] };
    const items = parseFeed((await res.text()).slice(0, 3_000_000)).slice(0, ITEMS_PER_FEED);
    return { status: res.status, items };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 120), items: [] };
  }
}

// Fetch the feeds of the given papers once; cards de-duplicated by id across feeds
// (an article is often in HomePage and its section feed). Returns cards per paper
// and per-feed status for the status row.
async function collectFeedCards(papers, { fetchImpl = fetch, nowMs = Date.now(), feeds = FEEDS } = {}) {
  const wanted = feeds.filter((f) => papers.has(f.paper));
  const results = await mapLimit(wanted, CONCURRENCY, (f) => fetchFeed(f, { fetchImpl }));
  const byId = new Map();
  const status = wanted.map((f, i) => {
    const r = results[i];
    let cards = 0;
    for (const item of r.items) {
      const card = cardFromItem(item, f, nowMs);
      if (!card) continue;
      cards++;
      const cur = byId.get(card.id);
      // Prefer the copy with a real section (a section feed over HomePage).
      if (!cur || (cur.section === "more" && card.section !== "more")) byId.set(card.id, card);
    }
    return { url: f.url, paper: f.paper, ok: r.status >= 200 && r.status < 300 && r.items.length > 0, status: r.status, items: r.items.length, cards, ...(r.error ? { error: r.error } : {}) };
  });
  return { cards: [...byId.values()], status };
}

// ── The hourly job ───────────────────────────────────────────────────────────

const sbHeaders = (serviceKey, extra = {}) => ({ apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json", ...extra });

// Every user with a sign-in status row → the papers they're signed in to.
async function loadSignedInUsers(serviceKey, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/tableplan_states?id=like.mailnewssubs_*&select=id,state`, { headers: sbHeaders(serviceKey) });
  if (!res.ok) throw new Error(`sign-in rows read failed (${res.status})`);
  const rows = await res.json();
  return rows.map((r) => {
    const userId = String(r.id).replace(/^mailnewssubs_/, "");
    const papers = new Set(["nyt", "economist", "startribune", "athletic"].filter((p) => Links.paperSignedIn(r.state?.papers || {}, p)));
    return { userId, papers };
  }).filter((u) => /^[0-9a-f-]{36}$/i.test(u.userId) && u.papers.size);
}

async function runFeedIntake(serviceKey, { fetchImpl = fetch, nowMs = Date.now(), store = require("./_news-store.js") } = {}) {
  const users = await loadSignedInUsers(serviceKey, { fetchImpl });
  const papers = new Set(users.flatMap((u) => [...u.papers]));
  const { cards, status } = papers.size ? await collectFeedCards(papers, { fetchImpl, nowMs }) : { cards: [], status: [] };
  const inserted = {};
  for (const u of users) {
    const mine = cards.filter((c) => u.papers.has(c.paper));
    inserted[u.userId] = await store.insertArticles(serviceKey, u.userId, mine, "rss", { fetchImpl });
  }
  await store.pruneArticles(serviceKey, { fetchImpl, nowMs });
  const summary = { runAt: new Date(nowMs).toISOString(), users: users.length, cards: cards.length, inserted, feeds: status };
  // One small status row per run (no read): which feeds answered and how many items.
  await fetchImpl(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ id: "newsfeeds_status", state: summary, updated_at: summary.runAt })
  }).catch(() => {});
  return summary;
}

module.exports = { FEEDS, parseFeed, cardFromItem, collectFeedCards, loadSignedInUsers, runFeedIntake };
