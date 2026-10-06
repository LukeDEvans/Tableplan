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

describe("applyNewsDecisions", () => {
  const list = [{ id: "a" }, { id: "b", readAt: "x" }, { id: "c" }, { id: "d", sentAt: "earlier" }];
  it("read / unread / send / hide", () => {
    const r = N.applyNewsDecisions(list, [
      { id: "a", decision: "read" }, { id: "b", decision: "unread" },
      { id: "c", decision: "send" }, { id: "c", decision: "hide" },
      { id: "d", decision: "send" }
    ], "now");
    expect(r.list).toEqual([{ id: "a", readAt: "now" }, { id: "b" }, { id: "d", sentAt: "earlier" }]);
    expect(r.toSend).toEqual([]); // c was hidden; d was already sent
    expect(r.changed).toBe(true);
  });
  it("send keeps the card and stamps it", () => {
    const r = N.applyNewsDecisions(list, [{ id: "a", decision: "send" }], "now");
    expect(r.list[0]).toEqual({ id: "a", sentAt: "now" });
    expect(r.toSend.map((c) => c.id)).toEqual(["a"]);
  });
  it("a no-op batch reports no change", () => {
    expect(N.applyNewsDecisions(list, [{ id: "b", decision: "read" }, { id: "zz", decision: "hide" }]).changed).toBe(false);
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

// ── gmail.js actions ─────────────────────────────────────────────────────────
const USER = "u1";
const today = new Date().toISOString();
const card = (id, extra = {}) => ({ id, url: `https://www.nytimes.com/x/${id}.html`, title: `T ${id}`, paper: "nyt", source: "The New York Times", section: "us", publishedAt: today, ...extra });

function mock() {
  const st = { pending: [card("a"), card("b"), card("c")], stamp: "t0", writes: 0, media: null, subs: { papers: { nyt: { status: "signed-in" } } }, fetched: [] };
  const resp = (data, ok = true, status = 200) => ({ ok, status, url: "", json: async () => data, text: async () => JSON.stringify(data) });
  const fn = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.includes("/auth/v1/user")) return resp({ id: USER });
    if (u.includes("mailnewssubs_") && method === "GET") return resp(st.subs ? [{ state: st.subs }] : []);
    if (method === "POST" && body?.id === `mailnewssubs_${USER}`) { st.subs = body.state; return resp(null); }
    if (u.includes("mailnews_") && method === "GET") return resp([{ state: { newsPending: st.pending }, updated_at: st.stamp }]);
    if (method === "PATCH" && u.includes(`mailnews_${USER}`)) {
      if (!u.includes(`updated_at=eq.${st.stamp}`)) return resp([]);
      st.pending = body.state.newsPending; st.writes++; st.stamp = `t${st.writes}`;
      return resp([{ state: body.state, updated_at: st.stamp }]);
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

  it("newsFeed returns the cards and the sign-in status", async () => {
    vi.spyOn(global, "fetch").mockImplementation(mock());
    const d = JSON.parse((await call({ action: "newsFeed" })).body);
    expect(d.articles.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(d.signIns.nyt.status).toBe("signed-in");
  });

  it("updateNews: send saves to Media and keeps the card; hide removes; one locked write", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const d = JSON.parse((await call({ action: "updateNews", decisions: [
      { id: "a", decision: "send" }, { id: "b", decision: "hide" }, { id: "c", decision: "read" }
    ] })).body);
    expect(d.articles.map((a) => a.id)).toEqual(["a", "c"]);
    expect(d.articles[0].sentAt).toBeTruthy();
    expect(d.articles[1].readAt).toBeTruthy();
    expect(m.st.writes).toBe(1);
    expect(m.st.media.state.savedArticles.map((x) => x.id)).toEqual(["nl-a"]);
    expect(m.st.media.state.savedArticles[0].publication).toBe("nyt");
  });

  it("updateNews: sending an already-sent card saves nothing again", async () => {
    const m = mock();
    m.st.pending = [card("a", { sentAt: "earlier" })];
    vi.spyOn(global, "fetch").mockImplementation(m);
    await call({ action: "updateNews", decisions: [{ id: "a", decision: "send" }] });
    expect(m.st.media).toBeNull();
    expect(m.st.writes).toBe(0);
  });

  it("updateNews rejects a malformed batch", async () => {
    vi.spyOn(global, "fetch").mockImplementation(mock());
    expect((await call({ action: "updateNews", decisions: [{ id: "a", decision: "accept" }] })).statusCode).toBe(400);
    expect((await call({ action: "updateNews", decisions: [] })).statusCode).toBe(400);
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
