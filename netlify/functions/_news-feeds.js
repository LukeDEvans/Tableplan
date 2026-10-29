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
const Rank = require("./_news-rank.js");
const Tags = require("./_news-tags.js");
const Titles = require("./_news-titles.js");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15";
// Netlify scheduled functions get ~30 s. Each fetch (headers AND body) is capped,
// and no new fetch starts after START_DEADLINE_MS, so the inserts, prune and status
// write always get to run.
const FETCH_TIMEOUT_MS = 5000;
const CONCURRENCY = 24;
const START_DEADLINE_MS = 16000;
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
const athletic = (path) => ({ paper: "athletic", url: `https://www.nytimes.com/athletic/rss/${path}/`, label: "sports", athleticLeague: path });

// ── The Athletic: favourite teams only (NEWS_RANKING_DESIGN.md §3.6) ─────────
// The Athletic publishes a feed per team at /athletic/rss/<league>/<slug>/, and
// its editors tag each story with its teams, so a team feed catches stories that
// name only a player. Slugs aren't predictable for every team, so each favourite
// gets up to three candidate feeds (known slugs first); whichever answer are used
// and the status row shows which did. League feeds are still read for the
// favourites' leagues, and their stories kept only when they name a favourite.
const ATHLETIC_LEAGUE = { nfl: "nfl", nba: "nba", wnba: "wnba", nhl: "nhl", mlb: "mlb", ncaaf: "college-football", ncaam: "college-basketball", ncaaw: "womens-college-basketball" };
const ATHLETIC_SCOPE_LEAGUE = { nfl: "nfl", nba: "nba", wnba: "wnba", nhl: "nhl", mlb: "mlb", college: "college-football", soccer: "football", "soccer-w": "football" };
// Seen in public feed directories (feedspot, feeder): rss/nba/timberwolves/,
// rss/football/atlunited/, rss/mlb/braves/; team pages nhl/team/wild/, mlb/team/twins/.
const ATHLETIC_KNOWN_SLUGS = { "nba:minnesota-timberwolves": "timberwolves", "nhl:minnesota-wild": "wild", "mlb:minnesota-twins": "twins", "soccer:atlanta-united-fc": "atlunited", "mlb:atlanta-braves": "braves" };
const GENERIC = new Set(["fc", "afc", "sc", "cf", "united", "city", "state", "university", "club"]);
const slugWord = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function athleticLeagueFor(team) {
  return ATHLETIC_LEAGUE[team?.league] || ATHLETIC_SCOPE_LEAGUE[team?.scope] || "";
}
function athleticSlugCandidates(team) {
  const out = [];
  const add = (x) => { const v = slugWord(x); if (v && v.length >= 3 && !out.includes(v)) out.push(v); };
  add(ATHLETIC_KNOWN_SLUGS[team?.key]);
  const words = slugWord(team?.name).split("-").filter(Boolean);
  const named = words.filter((w) => !GENERIC.has(w));
  if (team?.scope === "soccer" || team?.scope === "soccer-w") {
    const club = words.filter((w) => !["fc", "afc", "sc", "cf"].includes(w)); // "afc ajax" → [ajax]; "minnesota united fc" → [minnesota, united]
    add(club.join("-"));  // ajax, minnesota-united
    add(club.join(""));   // minnesotaunited
  } else if (team?.scope === "college") {
    add(named[0]);                                        // minnesota
    add(named.join("-"));                                 // minnesota-golden-gophers
  } else {
    add(named[named.length - 1]);                         // vikings, lynx
  }
  return out.slice(0, 3);
}
// Favourite teams → their candidate team feeds, plus the league feeds for those
// leagues (and The Athletic's general news feed) for name matching.
function athleticFeedsFor(teams) {
  const feeds = [];
  const leagues = new Set(["news"]);
  for (const t of teams || []) {
    const league = athleticLeagueFor(t);
    if (!league) continue;
    leagues.add(league);
    for (const slug of athleticSlugCandidates(t)) {
      feeds.push({ paper: "athletic", url: `https://www.nytimes.com/athletic/rss/${league}/${slug}/`, label: "sports", team: t.key });
    }
  }
  const seen = new Set();
  return [...feeds, ...[...leagues].map(athletic)].filter((f) => !seen.has(f.url) && seen.add(f.url));
}

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

// Titles and summaries are read raw (stopNodes): parsed as XML, a title with
// inline markup ("Who Should <em>A.I.</em> …") lost the text around the tag
// (NEWS_TITLES_DESIGN.md). stripHtml then unwraps CDATA, drops tags and decodes.
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true,
  stopNodes: ["*.item.title", "*.item.description", "*.entry.title", "*.entry.summary"]
});
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const text = (x) => {
  if (x == null) return "";
  if (typeof x === "object") return String(x["#text"] ?? x["@_href"] ?? "");
  return String(x);
};
const stripHtml = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;(\/?[a-z][a-z0-9]*\b[^&]*?)&gt;/gi, "<$1>")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;|&#8220;|&#8221;/gi, '"').replace(/&#39;|&#8217;|&#8216;|&apos;/gi, "’")
  .replace(/\s+/g, " ").replace(/ ([?!.,;:])/g, "$1").trim();

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
  // No date at all → skip: freshness can't be judged, and dating it "now" would
  // re-admit it every few days for as long as the feed lists it.
  const t = Date.parse(item.publishedAt || "");
  const publishedAt = Number.isNaN(t) ? Links.dateFromUrl(c.url) : new Date(t).toISOString();
  if (!publishedAt) return null;
  if (!Links.isFresh(publishedAt, nowMs)) return null;
  // "Here’s the latest." (NYT live-blog updates) → "Live: <the blog>".
  const fixed = Titles.fixFeedTitle({
    title: String(item.title || "").replace(source.titleSuffixRe, "").trim(),
    subtitle: String(item.description || "").trim(),
    url: c.url
  });
  const title = fixed.title;
  if (!title) return null;
  const subtitle = fixed.subtitle;
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS); // covers the body read too
  try {
    const res = await fetchImpl(feed.url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    if (!res.ok) return { status: res.status, items: [] };
    const body = await Promise.race([
      res.text(),
      new Promise((_, reject) => ctrl.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })), { once: true }))
    ]);
    const items = parseFeed(String(body).slice(0, 3_000_000)).slice(0, ITEMS_PER_FEED);
    return { status: res.status, items };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 120), items: [] };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the feeds of the given papers once; cards de-duplicated by id across feeds
// (an article is often in HomePage and its section feed). Returns cards per paper
// and per-feed status for the status row.
async function collectFeedCards(papers, { fetchImpl = fetch, nowMs = Date.now(), feeds = FEEDS, startDeadlineMs = START_DEADLINE_MS } = {}) {
  const wanted = feeds.filter((f) => papers.has(f.paper));
  const startedAt = Date.now();
  const results = await mapLimit(wanted, CONCURRENCY, (f) => (Date.now() - startedAt > startDeadlineMs
    ? { status: 0, error: "skipped (run deadline)", items: [] }
    : fetchFeed(f, { fetchImpl })));
  const byId = new Map();
  const status = wanted.map((f, i) => {
    const r = results[i];
    let cards = 0;
    for (const item of r.items) {
      const card = cardFromItem(item, f, nowMs);
      if (!card) continue;
      cards++;
      const cur = byId.get(card.id);
      const teamKeys = [...new Set([...(cur?.teamKeys || []), ...(f.team ? [f.team] : [])])];
      // Prefer the copy with a real section (a section feed over HomePage).
      const keep = !cur || (cur.section === "more" && card.section !== "more") ? card : cur;
      byId.set(card.id, teamKeys.length ? { ...keep, teamKeys } : keep);
    }
    return { url: f.url, paper: f.paper, ok: r.status >= 200 && r.status < 300 && r.items.length > 0, status: r.status, items: r.items.length, cards, ...(f.team ? { team: f.team } : {}), ...(r.error ? { error: r.error } : {}) };
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

// The feed list for this run: the papers someone is signed in to; for The
// Athletic, every league feed if anyone signed in to it has no favourites,
// otherwise only the favourites' team and league feeds.
function feedsForRun(users, interests) {
  const athleticUsers = users.filter((u) => u.papers.has("athletic"));
  const allHaveFavorites = athleticUsers.length > 0 && athleticUsers.every((u) => interests.get(u.userId)?.teams?.length);
  if (!allHaveFavorites) return FEEDS;
  const teams = [];
  for (const u of athleticUsers) for (const t of interests.get(u.userId).teams) if (!teams.some((x) => x.key === t.key)) teams.push(t);
  return [...FEEDS.filter((f) => f.paper !== "athletic"), ...athleticFeedsFor(teams)];
}

// Hourly: fetch, filter, insert; then, once the For you migration is in, tag the
// stories that were actually new (one AI call for everyone's new stories) and
// store each person's topics + rank for them.
const RUN_BUDGET_MS = 26_000; // scheduled functions get ~30 s

const TITLE_PAGE_CAP = 8; // article pages read per run to fix weak email titles

async function runFeedIntake(serviceKey, { fetchImpl = fetch, nowMs = Date.now(), store = require("./_news-store.js"), tagStories = Tags.tagStories, startedAt = Date.now(), fetchMeta = Links.fetchArticleMeta } = {}) {
  const users = await loadSignedInUsers(serviceKey, { fetchImpl });
  const forYou = users.length ? await store.forYouReady(serviceKey, { fetchImpl }) : false;
  const interests = forYou ? await store.loadInterests(serviceKey, users.map((u) => u.userId), { fetchImpl }).catch(() => new Map()) : new Map();
  const papers = new Set(users.flatMap((u) => [...u.papers]));
  const feeds = feedsForRun(users, interests);
  const { cards, status } = papers.size ? await collectFeedCards(papers, { fetchImpl, nowMs, feeds }) : { cards: [], status: [] };
  const inserted = {};
  const fresh = new Map(); // userId → [cards actually inserted]
  for (const u of users) {
    const teams = interests.get(u.userId)?.teams || [];
    const mine = Rank.athleticForUser(cards.filter((c) => u.papers.has(c.paper)), teams);
    const ids = await store.insertArticles(serviceKey, u.userId, mine, "rss", { fetchImpl, returnIds: forYou });
    if (forYou) {
      const set = new Set(ids);
      fresh.set(u.userId, mine.filter((c) => set.has(c.id)));
      inserted[u.userId] = ids.length;
    } else inserted[u.userId] = ids;
  }
  let tagging = null;
  if (forYou) {
    const newCards = new Map();
    for (const list of fresh.values()) for (const c of list) newCards.set(c.id, c);
    const left = RUN_BUDGET_MS - (Date.now() - startedAt);
    const { byId, stats } = newCards.size && left > 6000
      ? await tagStories([...newCards.values()], { fetchImpl, deadlineMs: Date.now() + left - 4000 })
      : { byId: new Map(), stats: { requested: 0, tagged: 0, errors: newCards.size ? ["no time left"] : [] } };
    tagging = stats;
    for (const u of users) {
      const list = fresh.get(u.userId) || [];
      if (!list.length) continue;
      const interest = interests.get(u.userId) || Rank.normalizeInterest({});
      const matchTeams = interest.teams.length ? Rank.teamMatcher(interest.teams) : null;
      const ranked = list.map((c) => {
        const topics = Rank.storyFeatures(c, { ai: byId.get(c.id) || null, matchTeams, teamKeys: c.teamKeys || [] });
        const rankScore = Rank.scoreStory(topics, interest, { nowMs, publishedAt: c.publishedAt, leadAt: c.lead });
        return { ...c, topics, rankScore: rankScore == null ? -100 : rankScore };
      });
      await store.setTopics(serviceKey, u.userId, ranked, "rss", { fetchImpl }).catch((e) => { tagging.errors.push(String(e.message).slice(0, 80)); });
    }
  }
  // Weak titles (newsletter link text, live-blog stand-ins) get the feed's
  // headline, the live blog's, or the article page's (NEWS_TITLES_DESIGN.md).
  const titles = {};
  const rssById = new Map(cards.map((c) => [c.id, c]));
  for (const u of users) {
    const left = RUN_BUDGET_MS - (Date.now() - startedAt);
    if (left < 4000) break;
    titles[u.userId] = await Titles.repairTitles({
      userId: u.userId,
      rssById,
      getRows: (q) => store.getRows(serviceKey, q, { fetchImpl }),
      patchRow: (id, body) => store.patchRows(serviceKey, u.userId, [id], body, "", { fetchImpl }),
      fetchMeta: (url) => fetchMeta(url),
      metaCap: TITLE_PAGE_CAP,
      deadlineMs: Date.now() + left - 3000,
      nowMs
    }).catch((e) => ({ error: String(e.message || e).slice(0, 80) }));
  }
  await store.pruneArticles(serviceKey, { fetchImpl, nowMs });
  const summary = { runAt: new Date(nowMs).toISOString(), users: users.length, cards: cards.length, inserted, forYou, ...(tagging ? { tagging } : {}), titles, feeds: status };
  // One small status row per run (no read): which feeds answered and how many items.
  await fetchImpl(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ id: "newsfeeds_status", state: summary, updated_at: summary.runAt })
  }).catch(() => {});
  return summary;
}

module.exports = {
  FEEDS, parseFeed, cardFromItem, collectFeedCards, loadSignedInUsers, runFeedIntake,
  athleticLeagueFor, athleticSlugCandidates, athleticFeedsFor, feedsForRun
};
