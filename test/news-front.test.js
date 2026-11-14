// The Front page's top stories (NEWS_FRONT_PAGE_DESIGN.md). The fixture is the real
// pool from the evening of 2026-11-13 (nationwide FAA ground stop): the stories the
// Front page had, when it led with a travel piece instead.
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Front = require("../netlify/functions/_news-front.js");
const Store = require("../netlify/functions/_news-store.js");
const POOL = require("./fixtures/news-front-2026-11-13.json");

const at = (iso) => Date.parse(iso);
const poolAt = (nowMs) => POOL.filter((r) => at(r.published_at) <= nowMs);
const byId = new Map(POOL.map((r) => [r.id, r]));
const titles = (top) => top.map((t) => byId.get(t.id).title);
const SCREENSHOT = at("2026-11-14T02:41:00Z"); // 8:41 pm Central, Luke's screenshot

describe("story words", () => {
  it("joins word forms and drops the standing cast of the news", () => {
    expect(Front.stem("grounded")).toBe("ground");
    expect(Front.stem("grounding")).toBe("ground");
    expect(Front.stem("flights")).toBe("flight");
    const t = Front.storyTokens({ title: "Trump Says Flights Are Grounded Nationwide", subtitle: "The F.A.A. cited safety." });
    expect([...t]).toEqual(expect.arrayContaining(["flight", "ground", "nationwide", "faa", "safety"]));
    expect(t.has("trump")).toBe(false);
  });
  it("tells a live blog from one of its updates", () => {
    const blog = { title: "Live: Ground Stop Nationwide Flights Faa", url: "https://www.nytimes.com/live/2026/11/13/us/ground-stop/nationwide" };
    const update = { title: "The last ground stop in 2023 came after a pilot warning system went down.", url: "https://www.nytimes.com/live/2026/11/13/us/ground-stop/2023" };
    expect(Front.isLive(blog) && !Front.isLiveUpdate(blog)).toBe(true);
    expect(Front.isLiveUpdate(update)).toBe(true);
  });
});

describe("events (2026-11-13 fixture)", () => {
  const clusters = Front.clusterRows(poolAt(SCREENSHOT).filter((r) => SCREENSHOT - at(r.published_at) <= Front.POOL_WINDOW_MS));
  const clusterOf = (needle) => clusters.find((c) => c.items.some((it) => it.row.title.includes(needle)));
  it("groups the ground-stop coverage of both papers into one event", () => {
    const c = clusterOf("Live: Ground Stop Nationwide");
    const t = c.items.map((it) => it.row.title);
    expect(t).toEqual(expect.arrayContaining([
      "Flights are halted at airports across the U.S., FAA says",
      "FAA nationwide flight grounding brings departures to a halt at MSP",
      "Mullin Says Nationwide Ground Stop Is a Telecommunication Outage",
      "Flight Canceled During the FAA Ground Stop? Here’s What to Do."
    ]));
    expect(new Set(c.items.map((it) => it.row.paper)).size).toBe(2);
    // …and nothing that isn't about it.
    expect(t.every((x) => /ground|flight|faa/i.test(x))).toBe(true);
  });
  it("keeps unrelated stories apart (no chains through everyday words)", () => {
    expect(clusterOf("Gophers offense is among the worst")).not.toBe(clusterOf("Lauren Boebert Loses"));
    expect(clusterOf("Sports on TV today")?.items.length ?? 1).toBe(1);
    expect(clusterOf("Microsoft’s Global Outage")).not.toBe(clusterOf("Mullin Says Nationwide Ground Stop"));
  });
  it("merges one saga that arrived as two threads", () => {
    expect(clusterOf("A Scorecard for Huang’s Exit From Nvidia")).toBe(clusterOf("The Jensen Huang scandal reaches"));
  });
});

describe("rankFront (2026-11-13 fixture)", () => {
  it("at the time of the screenshot, the ground stop leads: the live blog, then the other paper's", () => {
    const top = Front.rankFront(poolAt(SCREENSHOT), { nowMs: SCREENSHOT });
    const t = titles(top);
    expect(t.slice(0, 2).sort()).toEqual([
      "Live: Ground Stop Nationwide Flights Faa",
      "Live: Nationwide FAA flight grounding halts departures at MSP airport"
    ]);
    expect(top[0]).toMatchObject({ live: true, papers: 2 });
    expect(top[0].stories).toBeGreaterThanOrEqual(8);
    // The day's other big story is next; the travel piece a newsletter led with is nowhere.
    expect(t[2]).toMatch(/Nvidia|Huang/);
    expect(t).not.toContain("Embracing the Darkness: 5 European Festivals of Light");
    expect(top.length).toBeLessThanOrEqual(Front.TOP_MAX);
  });
  it("sixteen minutes in, with two stories, it already leads over a 22-story saga", () => {
    const now = at("2026-11-13T22:00:00Z");
    const top = Front.rankFront(poolAt(now), { nowMs: now });
    expect(titles(top)[0]).toBe("Live: Ground Stop Nationwide Flights Faa");
    expect(titles(top)[1]).toMatch(/Huang|Nvidia/);
  });
  it("before it broke, the day's biggest running story leads", () => {
    const now = at("2026-11-13T21:30:00Z");
    expect(titles(Front.rankFront(poolAt(now), { nowMs: now }))[0]).toMatch(/Huang|Nvidia/);
  });
  it("no top story is an opinion piece, a feature or a live-blog update", () => {
    for (const now of [at("2026-11-13T21:30:00Z"), SCREENSHOT]) {
      for (const t of Front.rankFront(poolAt(now), { nowMs: now })) {
        const r = byId.get(t.id);
        expect(["opinion", "culture"]).not.toContain(r.section);
        expect(Front.isLiveUpdate(r)).toBe(false);
      }
    }
  });
  it("is stable: the same pool gives the same order", () => {
    const a = Front.rankFront(poolAt(SCREENSHOT), { nowMs: SCREENSHOT }).map((t) => t.id);
    const b = Front.rankFront([...poolAt(SCREENSHOT)].reverse(), { nowMs: SCREENSHOT }).map((t) => t.id);
    expect(b).toEqual(a);
  });
});

describe("rankFront (rules)", () => {
  const NOW = at("2026-11-13T12:00:00Z");
  const story = (id, title, extra = {}) => ({ id, url: `https://www.nytimes.com/2026/11/13/us/${id}.html`, title, subtitle: "", paper: "nyt", section: "us", origin: "rss", published_at: new Date(NOW - 3_600_000).toISOString(), lead_at: null, ...extra });
  it("a quiet pool of old features has no top stories", () => {
    const rows = [story("a", "Wandering Budapest’s Haunted Streets", { section: "culture", published_at: new Date(NOW - 10 * 3_600_000).toISOString() }),
      story("b", "The Virtues of Traveling on Foot", { section: "culture" })];
    expect(Front.rankFront(rows, { nowMs: NOW })).toEqual([]);
  });
  it("a newsletter lead is one signal, not a pin", () => {
    const rows = [
      story("fest", "Embracing the Darkness: 5 European Festivals of Light", { section: "culture", lead_at: new Date(NOW).toISOString() }),
      story("q1", "Earthquake Strikes Central Chile, Killing Dozens", { section: "world" }),
      story("q2", "Chile Earthquake: Rescuers Search Collapsed Buildings", { section: "world", paper: "economist" }),
      story("q3", "Death Toll Rises After Earthquake in Chile", { section: "world" })
    ];
    const top = Front.rankFront(rows, { nowMs: NOW });
    expect(top[0].id).toMatch(/^q/);
    expect(top.map((t) => t.id)).not.toContain("fest");
  });
  it("skips stories older than a day, dated in the future, or with a fragment for a title", () => {
    const rows = [
      story("old", "Senate Passes Sweeping Budget Bill", { published_at: new Date(NOW - 30 * 3_600_000).toISOString() }),
      story("future", "Senate Passes Sweeping Budget Bill Again", { published_at: new Date(NOW + 5 * 3_600_000).toISOString() }),
      story("weak", "click here to submit questions"),
      story("ok", "Senate Passes Sweeping Budget Bill After Marathon Session")
    ];
    const top = Front.rankFront(rows, { nowMs: NOW, isWeak: (r) => /^[a-z]/.test(r.title) });
    expect(top.map((t) => t.id)).toEqual(["ok"]);
  });
  it("a second story of a big event comes from another paper", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id, i) => story(id, `Wildfire Evacuations Ordered Near Boulder, part ${i}`, { subtitle: "The wildfire near Boulder forced evacuations." }));
    rows.push(story("s", "Boulder wildfire evacuations: what Minnesotans there are seeing", { paper: "startribune", section: "mn", subtitle: "A wildfire near Boulder forced evacuations." }));
    const top = Front.rankFront(rows, { nowMs: NOW });
    expect(top).toHaveLength(2);
    expect(new Set(top.map((t) => rows.find((r) => r.id === t.id).paper)).size).toBe(2);
  });
});

// ── The Front page read (_news-store.js loadFeedPage) ────────────────────────
describe("loadFeedPage: ranked Front page", () => {
  const full = (r) => ({ ...r, image: "", source: "", discovered_at: r.published_at, read_at: null, sent_at: null });
  function mockDb(rows, st = { calls: [], hidden: new Set() }) {
    const fn = async (url) => {
      const u = decodeURIComponent(String(url));
      st.calls.push(u);
      let out = rows.filter((r) => !st.hidden.has(r.id));
      const ids = u.match(/id=in\.\(([^)]*)\)/)?.[1];
      if (ids) out = out.filter((r) => ids.split(",").map((x) => x.replace(/"/g, "")).includes(r.id));
      else if (u.includes("lead_at=gte.")) out = out.filter((r) => r.lead_at);
      else out = [...out].sort((a, b) => at(b.published_at) - at(a.published_at)).slice(0, Number(u.match(/limit=(\d+)/)?.[1] || 150));
      return { ok: true, status: 200, json: async () => out.map(full) };
    };
    fn.st = st;
    return fn;
  }
  beforeEach(() => { Store.resetFrontMemo(); delete process.env.NEWS_FRONT_RANK_DISABLED; });

  it("sends the top stories first, with `lead` times that give their order; no other card has `lead`", async () => {
    const fetchImpl = mockDb(poolAt(SCREENSHOT));
    const { articles } = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, limit: 200, fetchImpl, nowMs: SCREENSHOT });
    const leads = articles.filter((a) => a.lead);
    expect(leads.length).toBeGreaterThanOrEqual(3);
    expect(leads.length).toBeLessThanOrEqual(Front.TOP_MAX);
    // What every installed app does with them (news-ui.js recentLeads): most recent lead first.
    const shown = [...leads].sort((a, b) => at(b.lead) - at(a.lead));
    expect(shown.map((a) => a.id)).toEqual(articles.slice(0, leads.length).map((a) => a.id));
    expect(shown[0].title).toMatch(/^Live: .*(Ground Stop|FAA)/);
    expect(leads.every((a) => SCREENSHOT - at(a.lead) < 60_000)).toBe(true);
    // The newsletter's travel lead is still on the page, in date order, unpinned.
    const fest = articles.find((a) => a.title.startsWith("Embracing the Darkness"));
    expect(fest && !fest.lead).toBe(true);
    expect(new Set(articles.map((a) => a.id)).size).toBe(articles.length);
  });
  it("the dock ticker's one-row request gets the same top stories", async () => {
    const fetchImpl = mockDb(poolAt(SCREENSHOT));
    const { articles } = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, limit: 1, fetchImpl, nowMs: SCREENSHOT });
    expect(articles.filter((a) => a.lead)[0].title).toMatch(/^Live: /);
  });
  it("reads the slim pool once per few minutes, and never select=*", async () => {
    const fetchImpl = mockDb(poolAt(SCREENSHOT));
    await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, fetchImpl, nowMs: SCREENSHOT });
    await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, limit: 1, fetchImpl, nowMs: SCREENSHOT + 60_000 });
    const pool = fetchImpl.st.calls.filter((u) => u.includes("select=id,url,title,subtitle,paper,section,origin,published_at,lead_at&"));
    expect(pool).toHaveLength(1);
    expect(pool[0]).toContain("hidden_at=is.null");
    expect(pool[0]).toContain("paper.neq.athletic");
    expect(fetchImpl.st.calls.some((u) => u.includes("select=*"))).toBe(false);
    await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, fetchImpl, nowMs: SCREENSHOT + 6 * 60_000 });
    expect(fetchImpl.st.calls.filter((u) => u.includes("origin,published_at")).length).toBe(2);
  });
  it("a top story hidden since the ranking is gone at once", async () => {
    const fetchImpl = mockDb(poolAt(SCREENSHOT));
    const first = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, fetchImpl, nowMs: SCREENSHOT });
    const lead = first.articles[0];
    fetchImpl.st.hidden.add(lead.id);
    const again = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, fetchImpl, nowMs: SCREENSHOT + 1000 });
    expect(again.articles.map((a) => a.id)).not.toContain(lead.id);
    expect(again.articles[0].lead).toBeTruthy();
  });
  it("later pages and searches carry no `lead`; other views are untouched", async () => {
    const fetchImpl = mockDb(poolAt(SCREENSHOT));
    const paged = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, before: "2026-11-13T20:00:00Z|x", fetchImpl, nowMs: SCREENSHOT });
    expect(paged.articles.some((a) => a.lead)).toBe(false);
    const calls = fetchImpl.st.calls.length;
    const section = await Store.loadFeedPage("k", "u1", { view: { kind: "section", key: "culture" }, limit: 200, fetchImpl, nowMs: SCREENSHOT });
    expect(fetchImpl.st.calls.length).toBe(calls + 1); // no pool read
    expect(section.articles.some((a) => a.lead)).toBe(true); // the stored newsletter lead, as before
  });
  it("a failed ranking read leaves a plain newest-first page", async () => {
    const ok = mockDb(poolAt(SCREENSHOT));
    const fetchImpl = async (url) => (decodeURIComponent(String(url)).includes("origin,published_at") ? { ok: false, status: 500, json: async () => ({}) } : ok(url));
    const { articles } = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, fetchImpl, nowMs: SCREENSHOT });
    expect(articles.length).toBeGreaterThan(100);
    expect(articles.some((a) => a.lead)).toBe(false);
  });
  it("NEWS_FRONT_RANK_DISABLED=1 restores newsletter leads first", async () => {
    process.env.NEWS_FRONT_RANK_DISABLED = "1";
    const fetchImpl = mockDb(poolAt(SCREENSHOT));
    const { articles } = await Store.loadFeedPage("k", "u1", { view: { kind: "front" }, fetchImpl, nowMs: SCREENSHOT });
    expect(articles[0].title).toBe("Embracing the Darkness: 5 European Festivals of Light");
    expect(fetchImpl.st.calls.some((u) => u.includes("origin,published_at"))).toBe(false);
  });
});
