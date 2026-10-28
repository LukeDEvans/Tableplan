// News "For you" (NEWS_RANKING_DESIGN.md): features, weights, scoring and
// arrangement (_news-rank.js), AI tags (_news-tags.js), The Athletic's team feeds
// and the hourly job (_news-feeds.js), the store's For you paths (_news-store.js),
// the email path (_news-links.js) and the app's helpers (news-ui.js).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRequire } from "module";
import { teamsSignature as uiSig, teamsForServer, learnedToast, applyLocalDecisions, articlesForView } from "../news-ui.js";
const require = createRequire(import.meta.url);
const R = require("../netlify/functions/_news-rank.js");
const T = require("../netlify/functions/_news-tags.js");
const F = require("../netlify/functions/_news-feeds.js");
const S = require("../netlify/functions/_news-store.js");
const L = require("../netlify/functions/_news-links.js");

const NOW = Date.parse("2026-10-28T12:00:00Z");
const H = 3_600_000;
const iso = (hAgo) => new Date(NOW - hAgo * H).toISOString();
const TEAMS = [
  { key: "nfl:minnesota-vikings", scope: "nfl", name: "Minnesota Vikings", short: "Vikings", league: "nfl" },
  { key: "nhl:minnesota-wild", scope: "nhl", name: "Minnesota Wild", short: "Wild", league: "nhl" },
  { key: "soccer:minnesota-united-fc", scope: "soccer", name: "Minnesota United FC", short: "Minnesota United", league: "mls" },
  { key: "soccer:afc-ajax", scope: "soccer", name: "AFC Ajax", short: "Ajax", league: "eredivisie" }
];

describe("features", () => {
  it("keywords: proper-noun phrases first, no stop words, no duplicates of a phrase's words", () => {
    expect(R.keywordFeatures("Why the Federal Reserve is unlikely to cut rates in December")).toEqual(["k:federal-reserve", "k:december", "k:unlikely", "k:rates"]);
    expect(R.keywordFeatures("Anthony Edwards to undergo arthroscopic procedure on right knee: Source")[0]).toBe("k:anthony-edwards");
    expect(R.keywordFeatures("Anthony Edwards to undergo knee surgery")).not.toContain("k:anthony");
  });
  it("teams: names, nicknames (capitalised only), never a bare place name", () => {
    const m = R.teamMatcher(TEAMS);
    expect(m("Vikings trade for a pass rusher")).toEqual(["nfl:minnesota-vikings"]);
    expect(m("Minnesota Wild open homestand")).toEqual(["nhl:minnesota-wild"]);
    expect(m("A wild night in Minneapolis")).toEqual([]);
    expect(m("Ajax sack their coach")).toEqual(["soccer:afc-ajax"]);
    expect(m("Minnesota United beat Atlanta United")).toEqual(["soccer:minnesota-united-fc"]);
    expect(m("Minnesota lawmakers return")).toEqual([]);
  });
  it("storyFeatures: AI topics and entities, teams (feed + text), keywords, then paper and section", () => {
    const f = R.storyFeatures({ title: "Vikings sign Jones", paper: "athletic", section: "sports" },
      { ai: { tags: ["nfl", "not-a-topic"], entities: ["Kevin O'Connell"] }, matchTeams: R.teamMatcher(TEAMS), teamKeys: ["nhl:minnesota-wild"] });
    expect(f[0]).toBe("t:nfl");
    expect(f).toContain("team:nhl:minnesota-wild");
    expect(f).toContain("team:nfl:minnesota-vikings");
    expect(f).toContain("e:kevin-o-connell");
    expect(f).not.toContain("t:not-a-topic");
    expect(f.slice(-2)).toEqual(["p:athletic", "s:sports"]);
    expect(f.length).toBeLessThanOrEqual(R.MAX_TOPICS);
  });
});

describe("weights and scoring", () => {
  it("feedback moves weights by kind, clamps, and fades with a three-week half-life", () => {
    const w = R.applyFeedback({}, [{ decision: "send", features: ["t:nfl", "s:sports", "p:nyt", "x:junk"] }], NOW);
    expect(R.weightOf(w, "t:nfl", NOW)).toBeCloseTo(3);
    expect(R.weightOf(w, "s:sports", NOW)).toBeCloseTo(0.9);
    expect(R.weightOf(w, "p:nyt", NOW)).toBeCloseTo(0.6);
    expect(w["x:junk"]).toBeUndefined();
    expect(R.weightOf(w, "t:nfl", NOW + R.HALF_LIFE_MS)).toBeCloseTo(1.5);
    let many = {};
    for (let i = 0; i < 10; i++) many = R.applyFeedback(many, [{ decision: "more", features: ["t:ai"] }], NOW);
    expect(R.weightOf(many, "t:ai", NOW)).toBe(10);
    const less = R.applyFeedback(many, [{ decision: "less", features: ["t:ai"] }], NOW);
    expect(R.weightOf(less, "t:ai", NOW)).toBe(7);
  });
  it("keeps at most 400 features, the strongest", () => {
    const items = Array.from({ length: 450 }, (_, i) => ({ decision: i < 50 ? "send" : "read", features: [`k:w${i}`] }));
    const w = R.applyFeedback({}, items, NOW);
    expect(Object.keys(w)).toHaveLength(400);
    expect(w["k:w0"]).toBeDefined();
  });
  it("scores: capped per kind, favourite teams count, freshness and lead bonus, mutes drop the story", () => {
    const interest = { weights: { "k:a": [10, NOW], "k:b": [10, NOW], "t:nfl": [2, NOW] }, muted: {}, teams: TEAMS };
    const s = R.scoreStory(["k:a", "k:b", "t:nfl", "team:nfl:minnesota-vikings"], interest, { nowMs: NOW, publishedAt: iso(0) });
    // keywords capped at 2, topic 2, favourite team 4, fresh 2
    expect(s).toBeCloseTo(10);
    const old = R.scoreStory(["t:nfl"], interest, { nowMs: NOW, publishedAt: iso(48) });
    expect(old).toBeCloseTo(2);
    const lead = R.scoreStory([], interest, { nowMs: NOW, publishedAt: iso(48), leadAt: iso(2) });
    expect(lead).toBeCloseTo(1);
    expect(R.scoreStory(["t:nfl"], { ...interest, muted: { "t:nfl": NOW } }, { nowMs: NOW })).toBeNull();
  });
  it("why: the strongest positive interest, named", () => {
    const interest = { weights: { "t:ai": [3, NOW], "k:openai": [1, NOW] }, muted: {}, teams: TEAMS };
    expect(R.whyLabel(["t:ai", "k:openai"], interest, NOW)).toBe("AI");
    expect(R.whyLabel(["team:nfl:minnesota-vikings"], interest, NOW)).toBe("Vikings");
    expect(R.whyLabel(["k:other"], interest, NOW)).toBe("");
  });
  it("arrangeForYou: no three in a row from a section, ≤3 of the top ten on one topic, an exploration slot every 8th", () => {
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push({ id: `p${i}`, section: "politics", features: ["t:us-politics"], score: 20 - i, publishedAt: iso(1) });
    for (let i = 0; i < 12; i++) rows.push({ id: `b${i}`, section: "business", features: [`t:markets`], score: 10 - i, publishedAt: iso(1) });
    for (let i = 0; i < 4; i++) rows.push({ id: `x${i}`, section: "culture", features: [`k:odd${i}`], score: -5, publishedAt: iso(2) });
    const interest = { weights: { "t:us-politics": [5, NOW], "t:markets": [3, NOW] }, muted: {}, teams: [] };
    const out = R.arrangeForYou(rows, interest, { limit: 20, nowMs: NOW, rng: () => 0 });
    expect(out.slice(0, 8).map((r) => r.id).join(" ")).toBe("p0 p1 b0 p2 b1 b2 x0 x1");
    expect(out.slice(0, 10).filter((r) => r.features[0] === "t:us-politics").length).toBeLessThanOrEqual(3);
    expect(out[7].explore).toBe(true);
    expect(out[7].id.startsWith("x")).toBe(true);
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  });
  it("mute picks a topic, team, entity or keyword — never a paper or section", () => {
    expect(R.primaryFeature(["p:nyt", "s:politics", "k:senate", "t:congress"])).toBe("t:congress");
    expect(R.primaryFeature(["p:nyt", "s:politics"])).toBeNull();
    const m = R.addMute({}, "t:congress", NOW);
    expect(m["t:congress"]).toBe(NOW);
  });
  it("teams on the wire: cleaned, signature matches the app's", () => {
    const clean = R.cleanTeams([...TEAMS, { key: "bad key" }, null]);
    expect(clean).toHaveLength(4);
    expect(R.teamsSignature(clean)).toBe(uiSig(teamsForServer(TEAMS)));
    expect(R.teamsSignature([])).toBe("");
  });
  it("The Athletic per person: favourites' team-feed stories and stories naming them; everything when no favourites", () => {
    const cards = [
      { id: "1", paper: "athletic", title: "Edwards to have knee surgery", teamKeys: ["nba:minnesota-timberwolves"] },
      { id: "2", paper: "athletic", title: "Vikings trade for a pass rusher" },
      { id: "3", paper: "athletic", title: "Arsenal lose to Fleetwood" },
      { id: "4", paper: "nyt", title: "Arsenal lose to Fleetwood" }
    ];
    const wolves = [...TEAMS, { key: "nba:minnesota-timberwolves", name: "Minnesota Timberwolves", short: "Timberwolves" }];
    expect(R.athleticForUser(cards, wolves).map((c) => c.id)).toEqual(["1", "2", "4"]);
    expect(R.athleticForUser(cards, TEAMS).map((c) => c.id)).toEqual(["2", "4"]);
    expect(R.athleticForUser(cards, []).map((c) => c.id)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("AI tags", () => {
  const prev = process.env.NEWS_AI_TAGS_DISABLED;
  afterEach(() => { if (prev === undefined) delete process.env.NEWS_AI_TAGS_DISABLED; else process.env.NEWS_AI_TAGS_DISABLED = prev; });
  it("parses the reply: known topics only, ≤4 tags, ≤3 entities, tolerant of text around it", () => {
    const m = T.parseTagReply('Here:\n```json\n[{"i":0,"t":["nfl","bogus","NBA"],"e":["Kevin O\'Connell"]},{"i":5,"t":["ai"]},{"t":["markets","economy","tech","ai","science"],"e":["a","Fed","ECB","BoE","x"]}]\n```', 3);
    expect(m.get(0)).toEqual({ tags: ["nfl", "nba"], entities: ["Kevin O'Connell"] });
    expect(m.has(5)).toBe(false);
    expect(m.get(2).tags).toHaveLength(4);
    expect(m.get(2).entities).toEqual(["Fed", "ECB", "BoE"]);
    expect(T.parseTagReply("no json", 2).size).toBe(0);
  });
  it("calls Haiku 5.5 with no sampling params or prefill, reads text blocks by type, maps tags by id", async () => {
    let req;
    const fetchImpl = async (url, opts) => {
      req = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 80 }, content: [{ type: "thinking", thinking: "" }, { type: "text", text: '[{"i":0,"t":["ai"]},{"i":1,"t":["nfl"],"e":["Vikings"]}]' }] }) };
    };
    const { byId, stats } = await T.tagStories([{ id: "a", title: "OpenAI ships" }, { id: "b", title: "Vikings win", subtitle: "Big night" }], { apiKey: "k", fetchImpl });
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.temperature).toBeUndefined();
    expect(req.output_config).toEqual({ effort: "low" });
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[0].content).toContain("1. Vikings win — Big night");
    expect(byId.get("a").tags).toEqual(["ai"]);
    expect(byId.get("b").entities).toEqual(["Vikings"]);
    expect(stats).toMatchObject({ requested: 2, tagged: 2, inputTokens: 300, outputTokens: 80 });
  });
  it("never required: refusal, HTTP error, kill switch and no key all give no tags", async () => {
    const cards = [{ id: "a", title: "x" }];
    const refusal = async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
    expect((await T.tagStories(cards, { apiKey: "k", fetchImpl: refusal })).stats.errors).toEqual(["refusal"]);
    const bad = async () => ({ ok: false, status: 529, json: async () => ({}) });
    expect((await T.tagStories(cards, { apiKey: "k", fetchImpl: bad })).byId.size).toBe(0);
    expect((await T.tagStories(cards, { apiKey: "", fetchImpl: bad })).stats.errors).toEqual(["no key"]);
    process.env.NEWS_AI_TAGS_DISABLED = "1";
    let called = false;
    await T.tagStories(cards, { apiKey: "k", fetchImpl: async () => { called = true; } });
    expect(called).toBe(false);
  });
  it("batches 40 stories a request, at most 6 requests a run", async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return { ok: true, json: async () => ({ content: [{ type: "text", text: "[]" }] }) }; };
    const cards = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, title: `t${i}` }));
    const { stats } = await T.tagStories(cards, { apiKey: "k", fetchImpl });
    expect(n).toBe(6);
    expect(stats.requested).toBe(240);
  });
});

describe("The Athletic team feeds", () => {
  it("one candidate feed per known or derived slug, plus the favourites' league feeds", () => {
    const urls = F.athleticFeedsFor([
      { key: "nba:minnesota-timberwolves", scope: "nba", name: "Minnesota Timberwolves", league: "nba" },
      { key: "nfl:minnesota-vikings", scope: "nfl", name: "Minnesota Vikings", league: "nfl" },
      { key: "soccer:minnesota-united-fc", scope: "soccer", name: "Minnesota United FC", league: "mls" },
      { key: "soccer:afc-ajax", scope: "soccer", name: "AFC Ajax", league: "eredivisie" }
    ]).map((f) => f.url.replace("https://www.nytimes.com/athletic/rss/", ""));
    expect(urls).toEqual(["nba/timberwolves/", "nfl/vikings/", "football/minnesota-united/", "football/minnesotaunited/", "football/ajax/", "news/", "nba/", "nfl/", "football/"]);
  });
  it("league feeds for everyone unless every Athletic reader has favourites", () => {
    const users = [{ userId: "u1", papers: new Set(["nyt", "athletic"]) }, { userId: "u2", papers: new Set(["athletic"]) }];
    const some = new Map([["u1", { teams: TEAMS }]]);
    expect(F.feedsForRun(users, some)).toBe(F.FEEDS);
    const all = new Map([["u1", { teams: TEAMS.slice(0, 1) }], ["u2", { teams: TEAMS.slice(1, 2) }]]);
    const feeds = F.feedsForRun(users, all).filter((f) => f.paper === "athletic").map((f) => f.url);
    expect(feeds).toContain("https://www.nytimes.com/athletic/rss/nfl/vikings/");
    expect(feeds).toContain("https://www.nytimes.com/athletic/rss/nhl/wild/");
    expect(feeds).not.toContain("https://www.nytimes.com/athletic/rss/mlb/");
  });
});

// ── The hourly job with For you in place ──────────────────────────────────────
const U1 = "11111111-1111-1111-1111-111111111111";
const ITEM = (title, link, hAgo, desc = "") => `<item><title>${title}</title><link>${link}</link><description>${desc}</description><pubDate>${new Date(NOW - hAgo * H).toUTCString()}</pubDate></item>`;
const rss = (...items) => `<rss><channel>${items.join("")}</channel></rss>`;

function jobFetch({ ready = true, interest = { user_id: U1, teams: TEAMS, teams_sig: "", weights: { "t:ai": [4, NOW] }, muted: {} }, existing = [] } = {}) {
  const calls = [];
  const fetchImpl = async (u, opts = {}) => {
    const url = String(u);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || "GET", body, prefer: opts.headers?.prefer || "" });
    if (url.includes("id=like.mailnewssubs_")) return { ok: true, status: 200, json: async () => [{ id: `mailnewssubs_${U1}`, state: { papers: { nyt: { status: "signed-in" } } } }] };
    if (url.includes("/news_interest?select=user_id&limit=0")) return { ok: ready, status: ready ? 200 : 404, json: async () => [] };
    if (url.includes("/news_interest?select=")) return { ok: true, status: 200, json: async () => [interest] };
    if (url.endsWith("/World.xml")) return { ok: true, status: 200, text: async () => rss(ITEM("OpenAI ships a new model", "https://www.nytimes.com/2026/10/28/technology/openai-model.html", 2)) };
    if (url.endsWith("/athletic/rss/nfl/vikings/")) return { ok: true, status: 200, text: async () => rss(ITEM("Jefferson questionable for Sunday", "https://www.nytimes.com/athletic/7731000/2026/10/28/jefferson-questionable/", 1)) };
    if (url.endsWith("/athletic/rss/nfl/")) return { ok: true, status: 200, text: async () => rss(
      ITEM("Jefferson questionable for Sunday", "https://www.nytimes.com/athletic/7731000/2026/10/28/jefferson-questionable/", 1),
      ITEM("Colts trade Buckner to 49ers", "https://www.nytimes.com/athletic/7731001/2026/10/28/buckner-trade/", 1)) };
    if (url.includes("api.anthropic.com")) return { ok: true, json: async () => ({ content: [{ type: "text", text: '[{"i":0,"t":["ai","tech"]},{"i":1,"t":["nfl"],"e":["Justin Jefferson"]}]' }] }) };
    if (url.includes("/news_articles?on_conflict=user_id,id&select=id")) {
      return { ok: true, status: 201, json: async () => body.filter((r) => !existing.includes(r.id)).map((r) => ({ id: r.id })) };
    }
    return { ok: url.includes("supabase.co"), status: url.includes("supabase.co") ? 201 : 404, text: async () => "", json: async () => [] };
  };
  return { calls, fetchImpl };
}

describe("runFeedIntake with For you", () => {
  beforeEach(() => S.resetSchemaProbe());
  afterEach(() => S.resetSchemaProbe());
  it("follows favourites' team feeds, drops other Athletic stories, tags only new stories once, stores topics + rank", async () => {
    const { calls, fetchImpl } = jobFetch();
    const s = await F.runFeedIntake("svc", { fetchImpl, nowMs: NOW, tagStories: (cards, o) => T.tagStories(cards, { ...o, apiKey: "k" }) });
    expect(s.forYou).toBe(true);
    // No league feeds for leagues without a favourite.
    expect(calls.some((c) => c.url.endsWith("/athletic/rss/mlb/"))).toBe(false);
    const insert = calls.find((c) => c.method === "POST" && c.url.includes("/news_articles?on_conflict=user_id,id&select=id"));
    expect(insert.prefer).toContain("return=representation");
    const titles = insert.body.map((r) => r.title).sort();
    expect(titles).toEqual(["Jefferson questionable for Sunday", "OpenAI ships a new model"]); // Buckner trade isn't about a favourite
    expect(insert.body.every((r) => r.topics === undefined)).toBe(true);
    expect(calls.filter((c) => c.url.includes("api.anthropic.com"))).toHaveLength(1);
    const topics = calls.find((c) => c.method === "POST" && c.prefer.includes("merge-duplicates") && c.url.includes("/news_articles"));
    const byTitle = Object.fromEntries(topics.body.map((r) => [r.title, r]));
    expect(byTitle["Jefferson questionable for Sunday"].topics).toEqual(expect.arrayContaining(["team:nfl:minnesota-vikings", "e:justin-jefferson"]));
    expect(byTitle["OpenAI ships a new model"].topics).toEqual(expect.arrayContaining(["t:ai", "t:tech"]));
    expect(byTitle["OpenAI ships a new model"].rank_score).toBeGreaterThan(0);
    expect(s.tagging).toMatchObject({ requested: 2, tagged: 2 });
    // The job never reads synced state beyond the sign-in rows it always read.
    expect(calls.filter((c) => c.url.includes("tableplan_states") && c.method === "GET").every((c) => c.url.includes("mailnewssubs_"))).toBe(true);
  });
  it("stories already stored aren't tagged again", async () => {
    const all = ["OpenAI", "Jefferson"];
    const { calls, fetchImpl } = jobFetch({ existing: [] });
    // First run to learn the ids.
    await F.runFeedIntake("svc", { fetchImpl, nowMs: NOW, tagStories: async () => ({ byId: new Map(), stats: { errors: [] } }) });
    const ids = calls.find((c) => c.url.includes("select=id") && c.method === "POST").body.map((r) => r.id);
    S.resetSchemaProbe();
    const second = jobFetch({ existing: ids });
    let tagged = null;
    await F.runFeedIntake("svc", { fetchImpl: second.fetchImpl, nowMs: NOW, tagStories: async (cards) => { tagged = cards; return { byId: new Map(), stats: { errors: [] } }; } });
    expect(tagged).toBeNull();
    expect(all).toHaveLength(2);
  });
  it("before the migration: today's behaviour (all league feeds, no tags, plain insert)", async () => {
    const { calls, fetchImpl } = jobFetch({ ready: false });
    let tagCalled = false;
    const s = await F.runFeedIntake("svc", { fetchImpl, nowMs: NOW, tagStories: async () => { tagCalled = true; } });
    expect(s.forYou).toBe(false);
    expect(tagCalled).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/athletic/rss/mlb/"))).toBe(true);
    const insert = calls.find((c) => c.method === "POST" && c.url.includes("/news_articles?on_conflict"));
    expect(insert.prefer).toContain("return=minimal");
    expect(insert.body.map((r) => r.title)).toContain("Colts trade Buckner to 49ers");
  });
});

describe("store: For you", () => {
  beforeEach(() => S.resetSchemaProbe());
  it("queries: the pool is unread / unhidden / unsaved, last two days, ranked; Athletic only when tagged", () => {
    const q = decodeURIComponent(S.forYouQuery("u", { nowMs: NOW }));
    expect(q).toContain("topics,rank_score");
    expect(q).toContain("read_at=is.null");
    expect(q).toContain("sent_at=is.null");
    expect(q).toContain("order=rank_score.desc.nullslast");
    expect(q).toContain("or(paper.neq.athletic,topics.not.is.null)");
    const plain = decodeURIComponent(S.feedQuery("u", { view: { kind: "section", key: "sports" }, nowMs: NOW }));
    expect(plain).not.toContain("topics");
    const tagged = decodeURIComponent(S.feedQuery("u", { view: { kind: "section", key: "sports" }, nowMs: NOW, athleticTagged: true }));
    expect(tagged).toContain("or(paper.neq.athletic,topics.not.is.null)");
    expect(tagged).not.toContain("select=id,url,title,subtitle,image,paper,source,section,published_at,discovered_at,lead_at,read_at,sent_at,topics");
  });
  it("arranges a pool with current interests: muted out, best first, a `why`, no topics sent back", () => {
    const row = (id, topics, hAgo = 1, extra = {}) => ({ id, url: `https://x/${id}`, title: id, paper: "nyt", section: "business", published_at: iso(hAgo), topics, ...extra });
    const interest = { weights: { "t:ai": [6, NOW] }, muted: { "t:crime": NOW }, teams: [] };
    const out = S.arrangeForYouRows([row("a", ["t:markets"]), row("b", ["t:ai"]), row("c", ["t:crime"]), row("b", ["t:ai"])], interest, { nowMs: NOW, rng: () => 0 });
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
    expect(out[0].why).toBe("AI");
    expect(out[0].topics).toBeUndefined();
  });
  it("learns from decisions: one read of the stories + interest, one write; labels for More / Less / Mute", async () => {
    const calls = [];
    const fetchImpl = async (u, opts = {}) => {
      const url = String(u);
      calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes("/news_articles?select=id,title,subtitle,paper,section,topics")) {
        return { ok: true, json: async () => [{ id: "a", title: "x", paper: "nyt", section: "tech", topics: ["t:ai", "p:nyt", "s:tech"] }, { id: "b", title: "Crime spree in town", paper: "nyt", section: "us", topics: null }] };
      }
      if (url.includes("/news_interest?select=")) return { ok: true, json: async () => [{ weights: {}, muted: {}, teams: [] }] };
      return { ok: true, json: async () => [] };
    };
    const learned = await S.learnFromDecisions("svc", "u", [{ id: "a", decision: "more" }, { id: "b", decision: "mute" }, { id: "a", decision: "unread" }], { fetchImpl, nowMs: NOW });
    expect(learned).toEqual([{ id: "a", decision: "more", label: "AI" }, { id: "b", decision: "mute", label: "crime" }]);
    const write = calls.filter((c) => c.method === "POST" && c.url.includes("/news_interest"));
    expect(write).toHaveLength(1);
    expect(write[0].body.weights["t:ai"][0]).toBeCloseTo(3);
    expect(Object.keys(write[0].body.muted)).toEqual(["k:crime"]);
    expect(write[0].body.teams).toBeUndefined(); // feedback never touches favourites
  });
  it("schema probe: one request, cached when ready, re-tried after 10 minutes when missing", async () => {
    let n = 0;
    const miss = async () => { n++; return { ok: false, status: 404 }; };
    expect(await S.forYouReady("svc", { fetchImpl: miss, nowMs: NOW })).toBe(false);
    expect(await S.forYouReady("svc", { fetchImpl: miss, nowMs: NOW + 60_000 })).toBe(false);
    expect(n).toBe(1);
    const hit = async () => { n++; return { ok: true }; };
    expect(await S.forYouReady("svc", { fetchImpl: hit, nowMs: NOW + 11 * 60_000 })).toBe(true);
    expect(await S.forYouReady("svc", { fetchImpl: hit, nowMs: NOW + 99 * 60_000 })).toBe(true);
    expect(n).toBe(2);
  });
});

describe("email path with For you", () => {
  beforeEach(() => S.resetSchemaProbe());
  afterEach(() => S.resetSchemaProbe());
  it("drops Athletic stories about other teams and stores keyword / team topics", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, opts = {}) => {
      const url = String(u);
      calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes("/news_interest?select=user_id&limit=0")) return { ok: true, json: async () => [] };
      if (url.includes("/news_interest?select=")) return { ok: true, json: async () => [{ teams: TEAMS, teams_sig: "", weights: {}, muted: {} }] };
      if (url.includes("tableplan_states")) return { ok: true, json: async () => [] };
      return { ok: true, status: 201, text: async () => "", json: async () => [] };
    };
    try {
      await L.saveNewsBatch("svc", U1, [{ cards: [
        { id: "a1", url: "https://www.nytimes.com/athletic/1/2026/10/28/a/", title: "Vikings win in overtime", paper: "athletic", section: "sports", publishedAt: iso(1) },
        { id: "a2", url: "https://www.nytimes.com/athletic/2/2026/10/28/b/", title: "Arsenal lose to Fleetwood", paper: "athletic", section: "sports", publishedAt: iso(1) },
        { id: "n1", url: "https://www.nytimes.com/2026/10/28/us/x.html", title: "Senate passes budget", paper: "nyt", section: "politics", publishedAt: iso(1) }
      ] }], NOW);
    } finally { globalThis.fetch = realFetch; }
    const insert = calls.find((c) => c.method === "POST" && c.url.includes("/news_articles?on_conflict"));
    expect(insert.body.map((r) => r.id)).toEqual(["a1", "n1"]);
    expect(insert.body[0].topics).toContain("team:nfl:minnesota-vikings");
    expect(Number.isFinite(insert.body[0].rank_score)).toBe(true);
  });
});

describe("app helpers", () => {
  it("only read / listen / unread touch readAt; feedback decisions don't", () => {
    const list = [{ id: "a", readAt: "2026-10-28T00:00:00Z" }, { id: "b" }];
    const out = applyLocalDecisions(list, [{ id: "a", decision: "more" }, { id: "b", decision: "listen" }]);
    expect(out[0].readAt).toBe("2026-10-28T00:00:00Z");
    expect(out[1].readAt).toBeTruthy();
  });
  it("For you keeps the server's order (and the Athletic)", () => {
    const list = [{ id: "b", url: "u", paper: "athletic", publishedAt: iso(9) }, { id: "a", url: "u", paper: "nyt", publishedAt: iso(1) }];
    expect(articlesForView(list, { kind: "foryou" }).map((a) => a.id)).toEqual(["b", "a"]);
    expect(articlesForView(list, { kind: "front" }).map((a) => a.id)).toEqual(["a"]);
  });
  it("toasts name what was learned", () => {
    expect(learnedToast([{ decision: "more", label: "AI" }])).toBe("You'll see more about AI.");
    expect(learnedToast([{ decision: "less", label: "Crime" }])).toBe("You'll see less about Crime.");
    expect(learnedToast([{ decision: "mute", label: "Golf" }])).toBe("Golf muted in For you.");
    expect(learnedToast([])).toBe("");
  });
});
