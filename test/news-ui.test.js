// News page client helpers (news-ui.js, NEWS_PAGE_DESIGN.md §6): view filtering,
// the Front page lead, unread counts, briefings, sign-in recheck, and the
// optimistic decisions that keep a racing load from undoing a tap.
import { describe, it, expect } from "vitest";
import {
  articlesForView, arrangeFront, unreadCounts, briefingsFrom, signInsNeedCheck,
  paperStatus, sentArticleRecord, applyLocalDecisions, timeAgo, NEWS_SECTIONS, mergeArticles
} from "../news-ui.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const server = require("../netlify/functions/_news-links.js");

const NOW = Date.parse("2026-10-06T12:00:00Z");
const h = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
const card = (id, extra = {}) => ({ id, url: `https://x/${id}`, title: `Title ${id}`, paper: "nyt", section: "us", publishedAt: h(5), ...extra });

describe("articlesForView", () => {
  const list = [
    card("a", { section: "world", publishedAt: h(1) }),
    card("b", { section: "mn", paper: "startribune", publishedAt: h(3), sentAt: h(2) }),
    card("c", { section: "bogus", publishedAt: h(2), subtitle: "Lake Superior fish" })
  ];
  it("front: all, newest first; section, paper and sent views filter", () => {
    expect(articlesForView(list, { kind: "front" }).map((a) => a.id)).toEqual(["a", "c", "b"]);
    expect(articlesForView(list, { kind: "section", key: "mn" }).map((a) => a.id)).toEqual(["b"]);
    expect(articlesForView(list, { kind: "section", key: "more" }).map((a) => a.id)).toEqual(["c"]); // unknown section → More
    expect(articlesForView(list, { kind: "paper", key: "startribune" }).map((a) => a.id)).toEqual(["b"]);
    expect(articlesForView(list, { kind: "sent" }).map((a) => a.id)).toEqual(["b"]);
  });
  it("search matches title or summary", () => {
    expect(articlesForView(list, { kind: "front" }, "superior").map((a) => a.id)).toEqual(["c"]);
  });
});

describe("arrangeFront", () => {
  it("recent newsletter leads come first, most recent lead on top", () => {
    const list = [card("new", { publishedAt: h(1) }), card("l1", { lead: h(10), publishedAt: h(12) }), card("l2", { lead: h(4), publishedAt: h(6) })];
    const { lead, rest } = arrangeFront(list, NOW);
    expect(lead.id).toBe("l2");
    expect(rest.map((a) => a.id)).toEqual(["l1", "new"]);
  });
  it("an old lead flag no longer leads; with no leads the newest story does", () => {
    const list = [card("new", { publishedAt: h(1) }), card("old", { lead: h(48), publishedAt: h(50) })];
    expect(arrangeFront(list, NOW).lead.id).toBe("new");
    expect(arrangeFront([], NOW).lead).toBeNull();
  });
});

describe("unreadCounts", () => {
  it("counts unread by section and paper, and sent", () => {
    const c = unreadCounts([card("a"), card("b", { readAt: h(1) }), card("c", { section: "sports", paper: "athletic", sentAt: h(1) })]);
    expect(c).toEqual({ all: 2, sent: 1, section: { us: 1, sports: 1 }, paper: { nyt: 1, athletic: 1 } });
  });
});

describe("briefingsFrom", () => {
  it("newsletter articles (news-*) from the last 3 days, newest first", () => {
    const saved = [
      { id: "news-m1", title: "The Morning", savedAt: h(6) },
      { id: "news-m0", title: "Old brief", savedAt: h(24 * 4) },
      { id: "nl-x", title: "A sent article", savedAt: h(1) },
      { id: "news-m2", title: "The world in brief", savedAt: h(2) }
    ];
    expect(briefingsFrom(saved, NOW).map((b) => b.id)).toEqual(["news-m2", "news-m1"]);
  });
});

describe("sign-in status", () => {
  it("rechecks when any paper is unchecked or older than a day", () => {
    const fresh = { nyt: { checkedAt: h(2) }, economist: { checkedAt: h(2) }, startribune: { checkedAt: h(2) } };
    expect(signInsNeedCheck(fresh, NOW)).toBe(false);
    expect(signInsNeedCheck({ ...fresh, economist: { checkedAt: h(30) } }, NOW)).toBe(true);
    expect(signInsNeedCheck({}, NOW)).toBe(true);
  });
  it("The Athletic shows the NYT's status", () => {
    expect(paperStatus({ nyt: { status: "expired" } }, "athletic")).toBe("expired");
    expect(paperStatus({}, "economist")).toBe("unknown");
  });
});

describe("optimistic decisions", () => {
  it("a queued hide / read / send survives a reload that raced the write", () => {
    const list = [card("a"), card("b", { readAt: h(1) }), card("c")];
    const out = applyLocalDecisions(list, [
      { id: "a", decision: "hide" }, { id: "b", decision: "unread" }, { id: "c", decision: "send" }, { id: "c", decision: "read" }
    ]);
    expect(out.map((a) => a.id)).toEqual(["b", "c"]);
    expect(out[0].readAt).toBeUndefined();
    expect(out[1].sentAt).toBeTruthy();
    expect(out[1].readAt).toBeTruthy();
  });
});

describe("sentArticleRecord", () => {
  it("matches the server's record exactly (same id → one merged copy in Media)", () => {
    const c = card("z", { subtitle: "s", image: "https://i/x.jpg", source: "The New York Times" });
    const iso = "2026-10-06T12:00:00.000Z";
    expect(sentArticleRecord(c, iso)).toEqual(server.acceptedArticleRecord(c, iso));
  });
});

describe("misc", () => {
  it("timeAgo", () => {
    expect(timeAgo(h(0.5), NOW)).toBe("30m ago");
    expect(timeAgo(h(5), NOW)).toBe("5h ago");
    expect(timeAgo(h(50), NOW)).toBe("2d ago");
    expect(timeAgo("", NOW)).toBe("");
  });
  it("client and server share one section list", () => {
    expect(NEWS_SECTIONS.map((s) => s.key)).toEqual(server.NEWS_SECTIONS);
  });
});

describe("mergeArticles", () => {
  it("appends the next page, dropping the boundary story the inclusive cursor repeats", () => {
    const out = mergeArticles([card("a"), card("b")], [card("b"), card("c"), card("c")]);
    expect(out.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });
});
