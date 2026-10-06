// News page server side (NEWS_PAGE_DESIGN.md): sections, The Athletic, the
// Front page lead, 3-day retention, the batched read/send/hide decisions, the
// sign-in gate, and the gmail.js newsFeed / updateNews / verifyNewsSignIns actions.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const N = require("../netlify/functions/_news-links.js");
const gmail = require("../netlify/functions/gmail.js");

const src = (paper) => N.NEWS_LINK_SOURCES.find((s) => s.paper === paper);
const NOW = Date.parse("2026-10-06T12:00:00Z");

describe("sectionFor", () => {
  const nyt = (path) => N.sectionFor(`https://www.nytimes.com/2026/10/05/${path}`, {}, "nyt");
  it("NYT: reads the path after the date", () => {
    expect(nyt("us/politics/shutdown.html")).toBe("politics");
    expect(nyt("us/gulf-storm.html")).toBe("us");
    expect(nyt("nyregion/subway.html")).toBe("us");
    expect(nyt("world/middleeast/talks.html")).toBe("world");
    expect(nyt("technology/ai-chips.html")).toBe("business");
    expect(nyt("climate/lake-superior.html")).toBe("science");
    expect(nyt("opinion/carbon-tax.html")).toBe("opinion");
    expect(nyt("arts/music/review.html")).toBe("culture");
    expect(nyt("sports/football/vikings.html")).toBe("sports");
    expect(N.sectionFor("https://www.nytimes.com/interactive/2026/10/05/upshot/polls.html", {}, "nyt")).toBe("politics");
  });
  it("Economist: reads the first path segment", () => {
    const e = (seg) => N.sectionFor(`https://www.economist.com/${seg}/2026/10/05/x`, {}, "economist");
    expect(e("asia")).toBe("world");
    expect(e("united-states")).toBe("us");
    expect(e("finance-and-economics")).toBe("business");
    expect(e("science-and-technology")).toBe("science");
    expect(e("leaders")).toBe("opinion");
    expect(e("culture")).toBe("culture");
    expect(e("graphic-detail")).toBe("more");
  });
  it("Star Tribune: the article:section label; unknown labels go to More", () => {
    const s = (section) => N.sectionFor("https://www.startribune.com/lake-street-transit/601234567", { section }, "startribune");
    expect(s("Local")).toBe("mn");
    expect(s("Minneapolis")).toBe("mn");
    expect(s("Politics")).toBe("politics");
    expect(s("Vikings")).toBe("sports");
    expect(s("Variety")).toBe("culture");
    expect(s("Puzzles")).toBe("more");
    expect(s("")).toBe("more");
  });
  it("The Athletic is always Sports; an NYT path with no rule falls back to the meta label", () => {
    expect(N.sectionFor("https://www.nytimes.com/athletic/6650000/2026/10/05/wild-blue-line/", {}, "athletic")).toBe("sports");
    expect(N.sectionFor("https://www.nytimes.com/2026/10/05/briefing/the-morning.html", { section: "World" }, "nyt")).toBe("world");
  });
});

describe("The Athletic source", () => {
  it("is matched by sender before the NYT and extracts its article links", async () => {
    const athletic = N.newsLinkSourceForSender("The Athletic <newsletters@nytimes.com>", {});
    expect(athletic.paper).toBe("athletic");
    expect(N.newsLinkSourceForSender("The Morning <nytdirect@nytimes.com>", {}).paper).toBe("nyt");
    const html = `<a href="https://www.nytimes.com/athletic/6650000/2026/10/05/wild-blue-line/?source=nl">How the Wild rebuilt their blue line</a>
      <a href="https://theathletic.com/4819239/2026/10/04/vikings-defense/">Vikings defense</a>
      <a href="https://www.nytimes.com/2026/10/05/us/politics/x.html">Not an Athletic link</a>`;
    const links = await N.extractNewsLinks(html, athletic, { resolve: async (u) => u });
    expect(links.map((l) => l.url)).toEqual([
      "https://www.nytimes.com/athletic/6650000/2026/10/05/wild-blue-line",
      "https://theathletic.com/4819239/2026/10/04/vikings-defense"
    ]);
  });
  it("its sign-in follows the NYT's", () => {
    expect(N.paperSignedIn({ nyt: { status: "signed-in" } }, "athletic")).toBe(true);
    expect(N.paperSignedIn({ nyt: { status: "expired" } }, "athletic")).toBe(false);
  });
});

describe("the Front page lead", () => {
  // Trackers resolve after direct links; the lead must still be the FIRST link.
  const html = `
    <a href="https://nl.nytimes.com/f/1">Cease-fire talks resume in Cairo</a>
    <a href="https://www.nytimes.com/2026/10/06/us/politics/shutdown.html">Senate leaders trade offers</a>`;
  const resolve = async () => "https://www.nytimes.com/2026/10/06/world/middleeast/ceasefire.html";

  it("is the first article in document order of a main newsletter", async () => {
    const r = await N.collectNewsCards(html, src("nyt"), { nowMs: NOW, resolve, fetchMeta: async () => ({}), lead: true });
    expect(r.leadId).toBe(N.seenId("nytimes.com/2026/10/06/world/middleeast/ceasefire.html"));
    const merged = N.mergeNewsResults({}, [r], NOW).row.newsPending;
    expect(merged.find((c) => c.lead)?.title).toBe("Cease-fire talks resume in Cairo");
    expect(merged.filter((c) => c.lead)).toHaveLength(1);
  });
  it("other emails mark no lead", async () => {
    const r = await N.collectNewsCards(html, src("nyt"), { nowMs: NOW, resolve, fetchMeta: async () => ({}) });
    expect(r.leadId).toBeNull();
  });
  it("marks an article already on News when the newsletter links it again", async () => {
    const first = await N.collectNewsCards(html, src("nyt"), { nowMs: NOW, resolve, fetchMeta: async () => ({}) });
    const row = N.mergeNewsResults({}, [first], NOW).row;
    const again = await N.collectNewsCards(html, src("nyt"), { nowMs: NOW, resolve, fetchMeta: async () => ({}), lead: true, seen: row.newsSeen });
    expect(again.cards).toEqual([]); // nothing new…
    const after = N.mergeNewsResults(row, [again], NOW).row.newsPending;
    expect(after.find((c) => c.lead)?.url).toMatch(/ceasefire/); // …but the lead is marked
  });
});

describe("3-day retention", () => {
  it("drops articles older than 3 days and prunes stored cards past it", () => {
    expect(N.FRESH_DAYS).toBe(3);
    const card = (d) => ({ id: d, url: `https://x/${d}`, publishedAt: `${d}T08:00:00Z` });
    const kept = N.prunePending([card("2026-10-06"), card("2026-10-03"), card("2026-10-01")], NOW).map((c) => c.id);
    expect(kept).toEqual(["2026-10-06", "2026-10-03"]);
  });
});

describe("sign-in checks", () => {
  const page = (html, { url = "https://www.nytimes.com/saved", status = 200 } = {}) =>
    async () => ({ ok: status >= 200 && status < 300, status, url, text: async () => html });
  it("NYT: signed in unless the page shows the signed-out markers", async () => {
    expect(await N.checkPaperSignIn("nyt", "c", { fetchImpl: page("<div>Your saved articles</div>") })).toBe("signed-in");
    expect(await N.checkPaperSignIn("nyt", "c", { fetchImpl: page('<a href="/login?x">Log in</a>') })).toBe("expired");
    expect(await N.checkPaperSignIn("nyt", "c", { fetchImpl: page("", { url: "https://myaccount.nytimes.com/auth/login?x" }) })).toBe("expired");
  });
  it("inconclusive answers return null; no cookie is none; Star Tribune is unverified", async () => {
    expect(await N.checkPaperSignIn("nyt", "c", { fetchImpl: page("", { status: 403 }) })).toBeNull();
    expect(await N.checkPaperSignIn("economist", "c", { fetchImpl: async () => { throw new Error("net"); } })).toBeNull();
    expect(await N.checkPaperSignIn("nyt", "  ")).toBe("none");
    expect(await N.checkPaperSignIn("startribune", "c")).toBe("unverified");
  });
  it("verifySignIns keeps the previous answer when a check is inconclusive", async () => {
    const answers = { nyt: null, economist: "expired", startribune: "none" };
    const out = await N.verifySignIns({ nyt: { status: "signed-in" } }, {}, { check: async (p) => answers[p], nowMs: NOW });
    expect(out.nyt.status).toBe("signed-in");
    expect(out.economist.status).toBe("expired");
    expect(out.startribune.status).toBe("none");
    const fresh = await N.verifySignIns({}, {}, { check: async () => null, nowMs: NOW });
    expect(fresh.nyt.status).toBe("unverified"); // saved but never checked
  });
  it("the gate: only signed-in or unverified papers feed News", () => {
    const s = { nyt: { status: "signed-in" }, economist: { status: "expired" }, startribune: { status: "unverified" } };
    expect(N.newsLinkSourceForSender("x@nytimes.com", {}, { signIns: s })?.paper).toBe("nyt");
    expect(N.newsLinkSourceForSender("x@economist.com", {}, { signIns: s })).toBeNull();
    expect(N.newsLinkSourceForSender("x@startribune.com", {}, { signIns: s })?.paper).toBe("startribune");
    expect(N.newsLinkSourceForSender("x@economist.com", {})?.paper).toBe("economist"); // conversion path: toggle only
  });
});

// ── gmail.js actions (backed by the news_articles table) ─────────────────────
const USER = "u1";
const today = new Date().toISOString();
const row = (id, extra = {}) => ({ id, url: `https://www.nytimes.com/x/${id}.html`, title: `T ${id}`, paper: "nyt", source: "The New York Times", section: "us", published_at: today, discovered_at: today, lead_at: null, read_at: null, sent_at: null, ...extra });

function mock() {
  const st = { rows: [row("a"), row("b"), row("c")], media: null, subs: { papers: { nyt: { status: "signed-in" } } }, fetched: [], calls: [] };
  const resp = (data, ok = true, status = 200) => ({ ok, status, url: "", json: async () => data, text: async () => JSON.stringify(data) });
  const idsOf = (u) => (decodeURIComponent(u).match(/id=in\.\(([^)]*)\)/)?.[1] || "").split(",").map((x) => x.replace(/"/g, "")).filter(Boolean);
  const fn = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push(`${method} ${decodeURIComponent(u)}`);
    if (u.includes("/auth/v1/user")) return resp({ id: USER });
    if (u.includes("mailnewssubs_") && method === "GET") return resp(st.subs ? [{ state: st.subs }] : []);
    if (method === "POST" && body?.id === `mailnewssubs_${USER}`) { st.subs = body.state; return resp(null); }
    if (u.includes("/rpc/news_counts")) {
      const live = st.rows.filter((r) => !r.hidden_at);
      return resp(live.map((r) => ({ section: r.section, paper: r.paper, unread: r.read_at ? 0 : 1, total: 1, sent: r.sent_at ? 1 : 0 })));
    }
    if (u.includes("/news_articles") && method === "GET") {
      let rows = st.rows.filter((r) => !r.hidden_at);
      const ids = idsOf(u);
      if (ids.length) rows = rows.filter((r) => ids.includes(r.id));
      if (u.includes("sent_at=is.null")) rows = rows.filter((r) => !r.sent_at);
      if (u.includes("lead_at=gte.")) rows = rows.filter((r) => r.lead_at);
      return resp(rows);
    }
    if (u.includes("/news_articles") && method === "PATCH") {
      for (const r of st.rows) if (idsOf(u).includes(r.id)) {
        if (u.includes("read_at=is.null") && r.read_at) continue;
        Object.assign(r, body);
      }
      return resp(null);
    }
    if (u.includes(`u-${USER}`) && method === "GET") return resp(st.media ? [st.media] : []);
    if (method === "POST" && body?.id === `u-${USER}:media`) { st.media = { id: body.id, state: body.state, updated_at: body.updated_at }; return resp(null); }
    if (/nytimes\.com|economist\.com/.test(u)) { st.fetched.push({ u, cookie: opts.headers?.cookie }); return resp("<div>Saved</div>"); }
    return resp([]);
  };
  fn.st = st;
  return fn;
}
const call = (payload) => gmail.handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify(payload) });

describe("gmail.js News actions", () => {
  beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"; });
  afterEach(() => vi.restoreAllMocks());

  it("newsFeed returns a page of cards, the counts and the sign-in status", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const d = JSON.parse((await call({ action: "newsFeed", view: { kind: "section", key: "us" } })).body);
    expect(d.articles.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(d.articles[0]).toMatchObject({ paper: "nyt", section: "us", publishedAt: today });
    expect(d.counts).toMatchObject({ all: 3, section: { us: 3 } });
    expect(d.signIns.nyt.status).toBe("signed-in");
    expect(m.st.calls.some((c) => c.includes("section=eq.us"))).toBe(true);
    expect(m.st.calls.some((c) => c.includes("select=*"))).toBe(false);
  });

  it("paging further (before=…) skips the counts and sign-in reads", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const d = JSON.parse((await call({ action: "newsFeed", before: today })).body);
    expect(d.counts).toBeNull();
    expect(m.st.calls.some((c) => c.includes("news_counts"))).toBe(false);
  });

  it("updateNews: send saves to Media and stamps the row; hide and read patch only their rows", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const d = JSON.parse((await call({ action: "updateNews", decisions: [
      { id: "a", decision: "send" }, { id: "b", decision: "hide" }, { id: "c", decision: "read" }
    ] })).body);
    expect(d.ok).toBe(true);
    const [a, b, c] = m.st.rows;
    expect(a.sent_at).toBeTruthy();
    expect(b.hidden_at).toBeTruthy();
    expect(c.read_at).toBeTruthy();
    expect(m.st.media.state.savedArticles.map((x) => x.id)).toEqual(["nl-a"]);
    expect(d.counts.all).toBe(1); // a unread; b hidden; c read
  });

  it("updateNews: sending an already-sent story saves nothing again", async () => {
    const m = mock();
    m.st.rows[0].sent_at = "earlier";
    vi.spyOn(global, "fetch").mockImplementation(m);
    await call({ action: "updateNews", decisions: [{ id: "a", decision: "send" }] });
    expect(m.st.media).toBeNull();
  });

  it("updateNews rejects a malformed batch", async () => {
    vi.spyOn(global, "fetch").mockImplementation(mock());
    expect((await call({ action: "updateNews", decisions: [{ id: "a", decision: "accept" }] })).statusCode).toBe(400);
    expect((await call({ action: "updateNews", decisions: [] })).statusCode).toBe(400);
  });

  it("old bell builds: resolveNews maps accept → send and dismiss → hide; pendingNews lists unsent stories", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const d = JSON.parse((await call({ action: "resolveNews", decisions: [{ id: "a", decision: "accept" }, { id: "b", decision: "dismiss" }] })).body);
    expect(m.st.rows[0].sent_at).toBeTruthy();
    expect(m.st.rows[1].hidden_at).toBeTruthy();
    expect(d.articles.map((x) => x.id)).toEqual(["c"]);
    expect(JSON.parse((await call({ action: "pendingNews" })).body).articles.map((x) => x.id)).toEqual(["c"]);
    expect((await call({ action: "resolveNews", decisions: [{ id: "a", decision: "maybe" }] })).statusCode).toBe(400);
  });

  it("verifyNewsSignIns checks with the sent cookies and stores the result", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const d = JSON.parse((await call({ action: "verifyNewsSignIns", cookies: { nytCookie: "N1", stribCookie: "S1" } })).body);
    expect(d.signIns.nyt.status).toBe("signed-in");
    expect(d.signIns.economist.status).toBe("none");
    expect(d.signIns.startribune.status).toBe("unverified");
    expect(m.st.subs.papers).toEqual(d.signIns);
    expect(m.st.fetched).toEqual([{ u: "https://www.nytimes.com/saved", cookie: "NYT-S=N1" }]);
  });
});
