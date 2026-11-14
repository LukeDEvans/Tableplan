// NPR as a paper, the BBC / AP outside signals, and the check that runs when News
// opens (NEWS_FRONT_PAGE_DESIGN.md §8–§10).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../netlify/functions/_news-feeds.js");
const S = require("../netlify/functions/_news-store.js");
const Sig = require("../netlify/functions/_news-signals.js");
import { NEWS_PAPERS } from "../news-ui.js";
import { paperHandoff } from "../out-catalog.js";

const NOW = Date.parse("2026-11-14T18:00:00Z");
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.url || ""}</link><description>${i.desc || ""}</description>${i.date === null ? "" : `<pubDate>${new Date(i.date ?? NOW - 600_000).toUTCString()}</pubDate>`}</item>`).join("")}</channel></rss>`;

describe("NPR is a paper with no sign-in", () => {
  const feed = (label) => F.FEEDS.find((f) => f.paper === "npr" && f.label === label);
  const item = (url, title = "FAA Halts Flights Nationwide : NPR") => ({ url, title, description: "A summary.", publishedAt: new Date(NOW - 3_600_000).toUTCString() });
  it("reads NPR's news feed and its section feeds", () => {
    const urls = F.FEEDS.filter((f) => f.paper === "npr").map((f) => f.url);
    expect(urls).toContain("https://feeds.npr.org/1001/rss.xml");
    expect(urls.length).toBeGreaterThanOrEqual(8);
    expect(urls.every((u) => /^https:\/\/feeds\.npr\.org\/\d+\/rss\.xml$/.test(u))).toBe(true);
  });
  it("turns NPR story links into cards, with the feed's section and without the \": NPR\" suffix", () => {
    const c = F.cardFromItem(item("https://www.npr.org/2026/11/14/nx-s1-5600123/faa-ground-stop-flights?utm_source=rss"), feed("National"), NOW);
    expect(c).toMatchObject({ paper: "npr", source: "NPR", section: "us", title: "FAA Halts Flights Nationwide", url: "https://www.npr.org/2026/11/14/nx-s1-5600123/faa-ground-stop-flights" });
    expect(F.cardFromItem(item("https://www.npr.org/sections/shots-health-news/2026/11/14/g-s1-99/flu-season"), feed("Health"), NOW).section).toBe("science");
    expect(F.cardFromItem(item("https://www.npr.org/2026/11/14/1148346498/an-older-style-id"), feed("World"), NOW).section).toBe("world");
    expect(F.cardFromItem(item("https://www.npr.org/2026/11/14/nx-s1-1/tech"), feed("Technology"), NOW).section).toBe("business");
    expect(F.cardFromItem(item("https://www.npr.org/2026/11/14/nx-s1-2/a-novel"), feed("Arts & Culture"), NOW).section).toBe("culture");
  });
  it("skips what isn't a story (podcast pages, other sites)", () => {
    expect(F.cardFromItem(item("https://www.npr.org/podcasts/510318/up-first"), feed("World"), NOW)).toBeNull();
    expect(F.cardFromItem(item("https://example.com/2026/11/14/x/y"), feed("World"), NOW)).toBeNull();
  });
  it("every News user gets NPR; someone signed in to no paper still gets nothing", async () => {
    const rows = [
      { id: `mailnewssubs_${U1}`, state: { papers: { nyt: { status: "signed-in" } } } },
      { id: `mailnewssubs_${U2}`, state: { papers: { nyt: { status: "none" } } } }
    ];
    const fetchImpl = async () => ({ ok: true, json: async () => rows });
    const users = await F.loadSignedInUsers("svc", { fetchImpl });
    expect(users).toHaveLength(1);
    expect([...users[0].papers].sort()).toEqual(["athletic", "npr", "nyt"]);
    process.env.NEWS_NPR_DISABLED = "1";
    try { expect([...(await F.loadSignedInUsers("svc", { fetchImpl }))[0].papers]).not.toContain("npr"); } finally { delete process.env.NEWS_NPR_DISABLED; }
  });
  it("the app lists NPR under Papers as free, and can hand a story to NPR's app", () => {
    expect(NEWS_PAPERS.find((p) => p.key === "npr")).toMatchObject({ label: "NPR", free: true });
    expect(paperHandoff("npr", "https://www.npr.org/2026/11/14/nx-s1-1/x")).toMatchObject({ label: "NPR" });
    expect(paperHandoff("npr", "https://example.com/x")).toBeNull();
  });
});

describe("signals (pure)", () => {
  const bbc = Sig.SIGNAL_FEEDS[0];
  it("the feeds are the BBC's and the AP's; none of them is a paper", () => {
    expect(new Set(Sig.SIGNAL_FEEDS.map((f) => f.source))).toEqual(new Set(["bbc", "ap"]));
    const papers = new Set(F.FEEDS.map((f) => f.paper));
    expect(papers.has("bbc") || papers.has("ap")).toBe(false);
    expect(F.FEED_SOURCES.some((s) => s.paper === "bbc" || s.paper === "ap")).toBe(false);
  });
  it("keeps headline, short summary, time and (for an ordered feed) position; drops old and one-word items", () => {
    const items = [
      { title: "Flights grounded across the US", description: "x".repeat(300), publishedAt: new Date(NOW - 60_000).toUTCString() },
      { title: "Live", publishedAt: new Date(NOW).toUTCString() },
      { title: "Something from two days ago", publishedAt: new Date(NOW - 49 * 3_600_000).toUTCString() },
      { title: "No date on this one" }
    ];
    const out = Sig.signalsFromItems(items, bbc, NOW);
    expect(out.map((s) => s.t)).toEqual(["Flights grounded across the US", "No date on this one"]);
    expect(out[0]).toMatchObject({ s: "bbc", pos: 0 });
    expect(out[0].d).toHaveLength(140);
    expect(out[1].at).toBe(new Date(NOW).toISOString());
    expect(Sig.signalsFromItems(items, Sig.SIGNAL_FEEDS[2], NOW)[0].pos).toBeUndefined();
  });
  it("merges to one line per headline per source, best position kept, capped", () => {
    const a = { s: "bbc", t: "Flights grounded across the US", at: new Date(NOW - 1000).toISOString(), pos: 4 };
    const merged = Sig.mergeSignals([[a], [{ ...a, t: "Flights grounded across the US!", pos: 1 }], [{ ...a, s: "ap", pos: undefined }]], NOW);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.s === "bbc").pos).toBe(1);
    const many = Array.from({ length: 200 }, (_, i) => ({ s: "ap", t: `Headline number ${i} today`, at: new Date(NOW - i * 1000).toISOString() }));
    expect(Sig.mergeSignals([many], NOW)).toHaveLength(Sig.MAX_SIGNALS);
  });
  it("signalRows marks every row as a signal with no link", () => {
    const rows = Sig.signalRows([{ s: "bbc", t: "Flights grounded across the US", at: new Date(NOW).toISOString(), pos: 0 }], NOW);
    expect(rows[0]).toMatchObject({ signal: true, paper: "bbc", url: "", pos: 0 });
    expect(rows[0].id).toMatch(/^signal:/);
  });
});

// ── A small fake of Supabase + the feeds ─────────────────────────────────────
function world({ signalsRow = null, existing = [], subs = { [U1]: { nyt: { status: "signed-in" } } }, forYou = true, feeds = {} } = {}) {
  const st = { calls: [], signalsRow, inserted: [], topics: [] };
  const body = {
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml": rss([{ title: "F.A.A. Grounds All Flights Nationwide", url: "https://www.nytimes.com/2026/11/14/us/faa-ground-stop.html" }]),
    "https://www.startribune.com/arc/outboundfeeds/rss/?outputType=xml": rss([{ title: "Departures halted at MSP", url: "https://www.startribune.com/departures-halted-at-msp/601919999" }]),
    "https://feeds.npr.org/1001/rss.xml": rss([{ title: "FAA halts flights nationwide : NPR", url: "https://www.npr.org/2026/11/14/nx-s1-5600123/faa-halts-flights" }]),
    "https://feeds.bbci.co.uk/news/rss.xml": rss([{ title: "All US flights grounded by regulator" }]),
    "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml": rss([{ title: "All US flights grounded by regulator" }]),
    "https://flipboard.com/@associatedpress/top-stories-u7govdf1z.rss": rss([{ title: "FAA grounds flights across the United States" }]),
    ...feeds
  };
  const json = (data, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => (typeof data === "string" ? data : JSON.stringify(data)) });
  const fetchImpl = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)), method = opts.method || "GET";
    const sent = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push({ url: u, method, body: sent });
    if (u in body) return body[u] === null ? json("", false, 503) : { ok: true, status: 200, text: async () => body[u] };
    if (u.includes("tableplan_states") && method === "GET") {
      if (u.includes("id=eq.news_signals")) return json(st.signalsRow ? [{ state: st.signalsRow }] : []);
      if (u.includes("mailnewssubs_")) return json(Object.entries(subs).map(([id, papers]) => ({ id: `mailnewssubs_${id}`, state: { papers } })));
      return json([]);
    }
    if (u.includes("tableplan_states") && method === "POST") { if (sent.id === "news_signals") st.signalsRow = sent.state; return json(null); }
    if (u.includes("/news_interest")) return forYou ? json([{ user_id: U1, teams: [], weights: {}, muted: {} }]) : json({}, false, 404);
    if (u.includes("/news_articles") && method === "POST" && u.includes("select=id")) {
      const fresh = sent.filter((r) => !existing.includes(r.title));
      st.inserted.push(...fresh);
      return json(fresh.map((r) => ({ id: r.id })));
    }
    if (u.includes("/news_articles") && method === "POST") { st.topics.push(...sent); return json(null); }
    return json([]);
  };
  return { st, fetchImpl };
}

describe("the hourly job and the signals row", () => {
  beforeEach(() => { S.resetSchemaProbe(); Sig.resetSignalsCache(); });
  it("stores NPR stories, writes the BBC / AP headlines to news_signals without reading it, and never stores them as articles", async () => {
    const { st, fetchImpl } = world();
    const s = await F.runFeedIntake("svc", { fetchImpl, nowMs: NOW, tagStories: async () => ({ byId: new Map(), stats: { requested: 0, tagged: 0, errors: [] } }), fetchMeta: async () => ({}) });
    expect(st.inserted.map((r) => r.paper).sort()).toEqual(["npr", "nyt"]); // not signed in to the Star Tribune
    expect(st.inserted.some((r) => /bbc|flipboard|apnews/.test(r.url))).toBe(false);
    expect(st.signalsRow.checkedAt).toBe(new Date(NOW).toISOString());
    expect(st.signalsRow.items.map((i) => i.s).sort()).toEqual(["ap", "bbc"]);
    expect(st.signalsRow.items.find((i) => i.s === "bbc").pos).toBe(0);
    expect(st.calls.some((c) => c.method === "GET" && c.url.includes("news_signals"))).toBe(false);
    expect(s.signals).toBe(2);
    expect(s.feeds.filter((f) => f.signal).map((f) => f.ok)).toEqual([true, true, true]);
  });
  it("tags what the open check stored since the last run, with the stories that are new", async () => {
    // Both stories are already stored (not new to this run); the open check added the NYT one without topics.
    const { st, fetchImpl } = world({ existing: ["F.A.A. Grounds All Flights Nationwide", "FAA halts flights nationwide"] });
    const nytId = F.cardFromItem({ url: "https://www.nytimes.com/2026/11/14/us/faa-ground-stop.html", title: "F.A.A. Grounds All Flights Nationwide", description: "", publishedAt: new Date(NOW).toUTCString() }, F.FEEDS[0], NOW).id;
    const base = fetchImpl;
    const withUntagged = async (url, opts = {}) => {
      const u = decodeURIComponent(String(url));
      if (u.includes("/news_articles") && u.includes("topics=is.null")) { st.calls.push({ url: u, method: "GET" }); return { ok: true, status: 200, json: async () => [{ id: nytId }] }; }
      return base(url, opts);
    };
    let tagged = null;
    await F.runFeedIntake("svc", { fetchImpl: withUntagged, nowMs: NOW, tagStories: async (cards) => { tagged = cards; return { byId: new Map(), stats: { requested: cards.length, tagged: 0, errors: [] } }; }, fetchMeta: async () => ({}) });
    expect(tagged.map((c) => c.id)).toEqual([nytId]);
    expect(st.topics.map((r) => r.id)).toEqual([nytId]);
    const q = st.calls.find((c) => c.url.includes("topics=is.null")).url;
    expect(q).toContain("select=id&");
    expect(q).toContain("origin=eq.rss");
    expect(q).toContain("discovered_at=gte.");
  });
  it("a run that gets no outside headlines leaves the row alone", async () => {
    const dead = Object.fromEntries(Sig.SIGNAL_FEEDS.map((f) => [f.url, null]));
    const { st, fetchImpl } = world({ feeds: dead, signalsRow: { checkedAt: "2026-11-14T17:00:00.000Z", items: [{ s: "bbc", t: "An earlier headline today", at: "2026-11-14T16:00:00.000Z" }] } });
    await F.runFeedIntake("svc", { fetchImpl, nowMs: NOW, tagStories: async () => ({ byId: new Map(), stats: { errors: [] } }), fetchMeta: async () => ({}) });
    expect(st.signalsRow.items).toHaveLength(1);
    expect(st.calls.some((c) => c.method === "POST" && c.body?.id === "news_signals")).toBe(false);
  });
});

describe("the check when News opens", () => {
  beforeEach(() => { S.resetSchemaProbe(); S.resetFrontMemo(); Sig.resetSignalsCache(); F.resetOpenCheck(); delete process.env.NEWS_OPEN_CHECK_DISABLED; });
  afterEach(() => { delete process.env.NEWS_OPEN_CHECK_DISABLED; });
  const feedCalls = (st) => st.calls.filter((c) => /nytimes|startribune|npr\.org|bbci|flipboard/.test(c.url));

  it("reads only the three front feeds and the signal feeds, and adds what's new for every News user", async () => {
    const { st, fetchImpl } = world({ subs: { [U1]: { nyt: { status: "signed-in" } }, [U2]: { startribune: { status: "unverified" } } } });
    const r = await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW });
    expect(r).toMatchObject({ ran: true, inserted: 4, signals: 2 });
    expect(feedCalls(st).map((c) => c.url).sort()).toEqual([...F.OPEN_CHECK_FEEDS.map((f) => f.url), ...Sig.SIGNAL_FEEDS.map((f) => f.url)].sort());
    const byUser = (id) => st.inserted.filter((x) => x.user_id === id).map((x) => x.paper).sort();
    expect(byUser(U1)).toEqual(["npr", "nyt"]);
    expect(byUser(U2)).toEqual(["npr", "startribune"]);
    // Stored without topics: the hourly job tags them (below). No AI call, no interest read here.
    expect(st.inserted.every((r) => r.topics === undefined && r.rank_score === undefined)).toBe(true);
    expect(st.topics).toHaveLength(0);
    expect(st.calls.some((c) => c.url.includes("anthropic") || c.url.includes("news_interest"))).toBe(false);
    expect(st.signalsRow.items.length).toBe(2);
  });
  it("claims the slot before reading any feed", async () => {
    const { st, fetchImpl } = world();
    await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW });
    const claim = st.calls.findIndex((c) => c.method === "POST" && c.body?.id === "news_signals");
    const firstFeed = st.calls.findIndex((c) => /nytimes|npr\.org|bbci/.test(c.url));
    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(firstFeed);
    expect(st.calls[claim].body.state.checkedAt).toBe(new Date(NOW).toISOString());
  });
  it("does nothing when anything checked in the last ten minutes (the hourly job counts)", async () => {
    const { st, fetchImpl } = world({ signalsRow: { checkedAt: new Date(NOW - 9 * 60_000).toISOString(), items: [] } });
    expect(await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW })).toEqual({ ran: false, why: "recent" });
    expect(feedCalls(st)).toHaveLength(0);
    expect(st.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    // …and the next open in this warm function doesn't even read the row.
    const before = st.calls.length;
    await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW + 30_000 });
    expect(st.calls.length).toBe(before);
  });
  it("runs again after ten minutes, and only once however many opens arrive", async () => {
    const { st, fetchImpl } = world();
    await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW });
    const first = feedCalls(st).length;
    for (let i = 1; i <= 5; i++) await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW + i * 60_000 });
    expect(feedCalls(st).length).toBe(first);
    await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW + 11 * 60_000 });
    expect(feedCalls(st).length).toBe(first * 2);
  });
  it("a second warm function sees the first one's claim in the row", async () => {
    const { st, fetchImpl } = world();
    await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW });
    const first = feedCalls(st).length;
    F.resetOpenCheck(); Sig.resetSignalsCache(); // "another instance"
    expect((await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW + 60_000 })).ran).toBe(false);
    expect(feedCalls(st).length).toBe(first);
  });
  it("stories already stored aren't stored or ranked again", async () => {
    const { st, fetchImpl } = world({ existing: ["F.A.A. Grounds All Flights Nationwide", "FAA halts flights nationwide"] });
    const r = await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW });
    expect(r.inserted).toBe(0);
    expect(st.topics).toHaveLength(0);
  });
  it("dead feeds don't fail it, and keep the earlier headlines", async () => {
    const dead = Object.fromEntries([...F.OPEN_CHECK_FEEDS, ...Sig.SIGNAL_FEEDS].map((f) => [f.url, null]));
    const { st, fetchImpl } = world({ feeds: dead, signalsRow: { checkedAt: "2026-11-14T16:00:00.000Z", items: [{ s: "bbc", t: "An earlier headline today", at: "2026-11-14T15:00:00.000Z" }] } });
    expect(await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW })).toMatchObject({ ran: true, inserted: 0 });
    expect(st.signalsRow.items).toHaveLength(1);
    expect(st.signalsRow.checkedAt).toBe(new Date(NOW).toISOString());
  });
  it("NEWS_OPEN_CHECK_DISABLED=1 turns it off", async () => {
    process.env.NEWS_OPEN_CHECK_DISABLED = "1";
    const { st, fetchImpl } = world();
    expect(await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW })).toEqual({ ran: false, why: "off" });
    expect(st.calls).toHaveLength(0);
  });
  it("never reads a user's synced state", async () => {
    const { st, fetchImpl } = world();
    await F.runOpenCheck("svc", { fetchImpl, nowMs: NOW });
    const reads = st.calls.filter((c) => c.method === "GET" && c.url.includes("tableplan_states"));
    expect(reads.every((c) => c.url.includes("id=eq.news_signals&select=state") || c.url.includes("mailnewssubs_"))).toBe(true);
  });
});
