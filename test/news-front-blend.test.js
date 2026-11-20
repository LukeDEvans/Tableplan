// The blended Front page (Luke, 2026-11-20; NEWS_FRONT_PAGE_DESIGN.md §12):
// _news-front.js rankFrontFor (angle, lift, muted) and _news-store.js
// arrangeBlendedFront (the river below the top stories, and seen stories sinking).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Front = require("../netlify/functions/_news-front.js");
const Store = require("../netlify/functions/_news-store.js");
const POOL = require("./fixtures/news-front-2026-11-13.json");

const NOW = Date.parse("2026-11-14T02:41:00Z");
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
let n = 0;
const row = (title, extra = {}) => ({ id: `r${++n}`, url: `https://www.nytimes.com/2026/11/13/x/${n}.html`, title, subtitle: "A summary.", paper: "nyt", section: "us", published_at: ago(1), ...extra });

describe("rankFrontFor", () => {
  const pool = POOL.filter((r) => Date.parse(r.published_at) <= NOW);
  it("with no interests it picks exactly what rankFront picks", () => {
    expect(Front.rankFrontFor(pool, { nowMs: NOW }).top.map((t) => t.id)).toEqual(Front.rankFront(pool, { nowMs: NOW }).map((t) => t.id));
  });
  it("reports importance for every story in the pool, marking the top events'", () => {
    const { top, importance } = Front.rankFrontFor(pool, { nowMs: NOW });
    expect(importance.size).toBeGreaterThan(100);
    for (const t of top) expect(importance.get(t.id).top).toBe(true);
    expect([...importance.values()].some((v) => !v.top)).toBe(true);
  });

  it("lifts a near-miss the person cares about; not one they don't", () => {
    const vikings = row("Vikings Rally Late to Beat the Packers at Lambeau", { section: "sports" }); // just under the bar
    const culture = row("A Museum Reopens After a Decade of Painstaking Repairs", { section: "culture" });
    const news = row("Senate Passes Sweeping Rail Safety Bill After Derailment", { section: "us" });
    const rows = [vikings, culture, news];
    const plain = Front.rankFrontFor(rows, { nowMs: NOW }).top.map((t) => t.id);
    expect(plain).toEqual([news.id]);
    const { top } = Front.rankFrontFor(rows, { nowMs: NOW, interestOf: (r) => (r.id === vikings.id ? 4 : 0) });
    expect(top.map((t) => t.id)).toEqual([news.id, vikings.id]);
    expect(top[1].lifted).toBe(true);
    expect(top[0].lifted).toBe(false);
  });
  it("in a full block a lift replaces only a marginal must-read", () => {
    const rows = [row("Vikings Rally Late to Beat the Packers at Lambeau", { section: "sports" })];
    // One clear must-read and one that barely clears the bar (Science: +0.2).
    rows.push(row("Senate Passes Sweeping Rail Safety Bill After Derailment"));
    rows.push(row("Researchers Map the Ocean Floor Under Antarctic Ice Shelf", { section: "science", published_at: ago(0.3) }));
    const full = Front.rankFrontFor(rows, { nowMs: NOW, max: 2 });
    expect(full.top).toHaveLength(2);
    const { top } = Front.rankFrontFor(rows, { nowMs: NOW, max: 2, interestOf: (r) => (/Vikings/.test(r.title) ? 4 : 0) });
    expect(top.map((t) => t.id)).toEqual([rows[1].id, rows[0].id]);
  });

  it("a muted small event leaves the block; a muted big one still leads", () => {
    const small = row("Senate Passes Sweeping Rail Safety Bill After Derailment");
    const big = [0, 1, 2, 3, 4].map((i) => row(`Ground stop halts flights nationwide FAA outage ${["update", "travelers", "airports", "airlines", "delays"][i]}`, { paper: i % 2 ? "startribune" : "nyt", published_at: ago(0.5 + i * 0.3) }));
    const rows = [small, ...big];
    const isMuted = () => true;
    const { top } = Front.rankFrontFor(rows, { nowMs: NOW, isMuted });
    expect(top.some((t) => t.id === small.id)).toBe(false);
    expect(big.some((b) => b.id === top[0]?.id)).toBe(true);
  });

  it("the angle the person reads most stands for an event, when it is nearly as good", () => {
    const stories = [
      row("Ground stop halts flights nationwide after FAA outage", { published_at: ago(1) }),
      row("Ground stop halts flights at MSP after nationwide FAA outage", { paper: "startribune", section: "mn", published_at: ago(1.1) }),
      row("FAA outage ground stop halts flights nationwide travelers stranded", { published_at: ago(1.3) })
    ];
    const plain = Front.rankFrontFor(stories, { nowMs: NOW, max: 1 }).top[0].id;
    const local = stories[1];
    const { top } = Front.rankFrontFor(stories, { nowMs: NOW, max: 1, interestOf: (r) => (r.paper === "startribune" ? 3 : 0) });
    // Either the local story already led, or interest swung it to the local angle.
    expect(top[0].id).toBe(local.id);
    expect(plain === local.id || top[0].id !== plain).toBe(true);
  });
});

describe("arrangeBlendedFront", () => {
  const interest = { weights: { "t:minnesota": [6, NOW], "k:vikings": [5, NOW] }, muted: { "t:golf": NOW }, teams: [] };
  const rank = { top: [], importance: new Map() };
  const r = (id, extra = {}) => ({ id, url: `https://x/${id}`, title: `Title ${id}`, subtitle: "", paper: "nyt", section: "us", published_at: ago(2), topics: [], ...extra });

  it("top stories first, unseen before seen, each marked; lifted ones say for you", () => {
    const top = [r("a", { read_at: ago(1) }), r("b"), r("c", { lifted: true, topics: ["t:minnesota"] })];
    const out = Store.arrangeBlendedFront(top, [], rank, interest, { nowMs: NOW, rng: () => 0.5 });
    expect(out.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(out.every((c) => c.top)).toBe(true);
    expect(out[1].forYou).toBe(true);
    expect(out[1].why).toBe("Minnesota");
    // `lead` keeps the order for the dock ticker and older code.
    expect(Date.parse(out[0].lead)).toBeGreaterThan(Date.parse(out[1].lead));
  });

  it("the river: interests and importance order it, muted stories leave, seen ones sink", () => {
    const imp = new Map([["big", { event: 10, prior: 1, cluster: 0, top: false }], ["covered", { event: 10, prior: 1, cluster: 1, top: true }]]);
    const rows = [
      r("plain"),
      r("liked", { topics: ["t:minnesota"], section: "mn" }),
      r("big"),
      r("covered"),
      r("golf", { topics: ["t:golf"], section: "sports" }),
      r("seen", { topics: ["t:minnesota"], skips: 1 }),
      r("opened", { read_at: ago(1) })
    ];
    const out = Store.arrangeBlendedFront([], rows, { top: [], importance: imp }, interest, { nowMs: NOW, rng: () => 0.5 });
    const ids = out.map((c) => c.id);
    expect(ids).not.toContain("golf");
    expect(ids.indexOf("big")).toBeLessThan(ids.indexOf("plain"));
    expect(ids.indexOf("liked")).toBeLessThan(ids.indexOf("plain"));
    expect(ids.indexOf("big")).toBeLessThan(ids.indexOf("covered")); // a top event's other stories count half
    expect(ids.slice(-2).sort()).toEqual(["opened", "seen"]);
    expect(out.find((c) => c.id === "liked").why).toBe("Minnesota");
    expect(out.find((c) => c.id === "plain").why).toBeUndefined();
    expect(out.some((c) => c.top)).toBe(false);
  });

  it("never repeats a top story in the river", () => {
    const out = Store.arrangeBlendedFront([r("a")], [r("a"), r("b")], rank, interest, { nowMs: NOW, rng: () => 0.5 });
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("loadBlendedFront", () => {
  it("reads the page, the pool (with topics) and the top rows; returns blend: true", async () => {
    const urls = [];
    const pool = POOL.filter((x) => Date.parse(x.published_at) <= NOW);
    const fetchImpl = async (url) => {
      urls.push(url);
      let body = [];
      if (/news_signals|tableplan_states/.test(url)) body = [];
      else if (/select=id,url,title,subtitle,paper,section,origin,published_at,lead_at,topics/.test(url)) body = pool;
      else if (/id=in\./.test(url)) {
        const ids = decodeURIComponent(url.match(/id=in\.\(([^)]*)\)/)[1]).replace(/"/g, "").split(",");
        body = pool.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, skips: 0 }));
      } else body = pool.slice(0, 50).map((x) => ({ ...x, skips: 0 }));
      return { ok: true, json: async () => body, text: async () => "" };
    };
    const page = await Store.loadBlendedFront("key", "u1", { weights: {}, muted: {}, teams: [] }, { fetchImpl, nowMs: NOW, memo: false, rng: () => 0.5 });
    expect(page.blend).toBe(true);
    expect(page.articles[0].top).toBe(true);
    expect(page.articles[0].title).toMatch(/Live: Nationwide FAA|Live: Ground Stop/);
    expect(new Set(page.articles.map((a) => a.id)).size).toBe(page.articles.length);
    const feed = urls.find((u) => /order=published_at\.desc,id\.desc/.test(u));
    expect(feed).toMatch(/select=[^&]*topics,skips/);
  });
});
