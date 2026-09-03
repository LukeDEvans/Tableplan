import { describe, it, expect } from "vitest";
import { parseFeedDate, normalizeFeedItem, runFeedIngestion } from "../feed-ingest.js";
import { canonicalKey } from "../publications.js";

const RSS = (items) => `<rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;
const item = (link, title = "T", extra = "") => `<item><title>${title}</title><link>${link}</link>${extra}</item>`;
const ok = (body, over = {}) => ({ status: 200, body, etag: '"e1"', lastModified: "Mon, 01 Sep 2026 10:00:00 GMT", ...over });
const feed = { id: "f1", publicationId: "p1", errorCount: 0 };

describe("parseFeedDate", () => {
  it("parses RFC 822 and ISO 8601 to ISO; null for missing/malformed (never 'now')", () => {
    expect(parseFeedDate("Tue, 01 Sep 2026 10:00:00 +0000")).toBe("2026-09-01T10:00:00.000Z");
    expect(parseFeedDate("2026-09-01T12:00:00Z")).toBe("2026-09-01T12:00:00.000Z");
    expect(parseFeedDate("")).toBe(null);
    expect(parseFeedDate("not a date")).toBe(null);
  });
});

describe("normalizeFeedItem", () => {
  it("maps to a canonical-Article candidate with rss provenance; description is excerpt, no body", () => {
    const c = normalizeFeedItem({ link: "https://x.com/a", title: "T", author: "A", published: "2026-09-01T00:00:00Z", description: "excerpt" }, { feedId: "f1", publicationId: "p1" });
    expect(c.feedIds).toEqual(["f1"]);
    expect(c.publicationId).toBe("p1");
    expect(c.description).toBe("excerpt");
    expect("text" in c).toBe(false);
    expect("body" in c).toBe(false);
    expect(c.provenance.source).toBe("rss");
    expect(c.provenance.providerId).toBe("f1");
  });
});

describe("runFeedIngestion — HTTP status semantics", () => {
  it("304 not-modified → success, no ingest, no article mutation", () => {
    const existing = [{ id: "x", canonicalUrl: "https://x.com/a", feedIds: ["f1"] }];
    const r = runFeedIngestion({ feed, response: { status: 304, notModified: true }, existingList: existing });
    expect(r.notModified).toBe(true);
    expect(r.added).toBe(0);
    expect(r.articles).toBe(existing);          // untouched
    expect(r.feedUpdate.lastSuccessAt).toBeTruthy();
    expect(r.feedUpdate.errorCount).toBe(0);
  });
  it("HTTP error (404/410/429/5xx) → explicit failure, articles untouched, errorCount++", () => {
    for (const status of [404, 410, 429, 500, 503]) {
      const r = runFeedIngestion({ feed, response: { status, error: `HTTP ${status}` }, existingList: [] });
      expect(r.failure).toBeTruthy();
      expect(r.failure.status).toBe(status);
      expect(r.added).toBe(0);
      expect(r.feedUpdate.errorCount).toBe(1);
    }
  });
  it("network/transport error → failure (not an empty success)", () => {
    const r = runFeedIngestion({ feed, response: { status: null, error: "timeout" }, existingList: [] });
    expect(r.failure.message).toBe("timeout");
    expect(r.status).toBe(null);
  });
  it("malformed XML → failure, NOT an empty successful feed", () => {
    const r = runFeedIngestion({ feed, response: ok("<html>not a feed</html>"), existingList: [] });
    expect(r.failure).toBeTruthy();
    expect(r.added).toBe(0);
    expect(r.feedUpdate.errorCount).toBe(1);
  });
  it("200 success → parses + ingests; records etag/lastModified", () => {
    const r = runFeedIngestion({ feed, response: ok(RSS(item("https://x.com/a") + item("https://x.com/b"))), existingList: [] });
    expect(r.added).toBe(2);
    expect(r.articles.length).toBe(2);
    expect(r.feedUpdate.etag).toBe('"e1"');
    expect(r.feedUpdate.lastSuccessAt).toBeTruthy();
    expect(r.feedUpdate.errorCount).toBe(0);
  });
});

describe("runFeedIngestion — idempotency + convergence (reuses publications reconciliation)", () => {
  it("re-ingesting identical feed content adds/updates nothing", () => {
    const body = ok(RSS(item("https://x.com/a")));
    const first = runFeedIngestion({ feed, response: body, existingList: [] });
    const second = runFeedIngestion({ feed, response: body, existingList: first.articles });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.articles.length).toBe(1);
  });
  it("same canonical URL from a DIFFERENT feed → ONE article, feed association unioned", () => {
    const a = runFeedIngestion({ feed: { id: "f1", publicationId: "p1" }, response: ok(RSS(item("https://x.com/a"))), existingList: [] });
    const b = runFeedIngestion({ feed: { id: "f2", publicationId: "p1" }, response: ok(RSS(item("https://x.com/a/?utm_source=y"))), existingList: a.articles });
    expect(b.articles.length).toBe(1);
    expect(b.articles[0].feedIds.sort()).toEqual(["f1", "f2"]);
  });
  it("SAME guid from two DIFFERENT feeds does NOT merge unless the canonical URL matches", () => {
    const a = runFeedIngestion({ feed: { id: "f1" }, response: ok(RSS(item("https://a.com/x", "A", "<guid>123</guid>"))), existingList: [] });
    const b = runFeedIngestion({ feed: { id: "f2" }, response: ok(RSS(item("https://b.com/y", "B", "<guid>123</guid>"))), existingList: a.articles });
    expect(b.articles.length).toBe(2); // different URLs → different articles despite same GUID
  });
  it("changed description updates the existing article (no duplicate)", () => {
    const first = runFeedIngestion({ feed, response: ok(RSS(item("https://x.com/a", "A", "<description>old</description>"))), existingList: [] });
    const second = runFeedIngestion({ feed, response: ok(RSS(item("https://x.com/a", "A", "<description>new</description>"))), existingList: first.articles });
    expect(second.articles.length).toBe(1);
    expect(second.updated).toBe(1);
    expect(second.articles[0].description).toBe("new");
  });
});

describe("runFeedIngestion — validation + lifecycle safety", () => {
  it("identity-less items (no url + no title) are skipped with a warning (keeps idempotency)", () => {
    const r = runFeedIngestion({ feed, response: ok(RSS(`<item></item>` + item("https://x.com/a"))), existingList: [] });
    expect(r.added).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("rediscovery cannot introduce reading/listening/consumption/notification fields", () => {
    const r = runFeedIngestion({ feed, response: ok(RSS(item("https://x.com/a"))), existingList: [] });
    const a = r.articles[0];
    for (const k of ["readingProgress", "listeningProgress", "consumed", "playlist", "notification", "body", "text", "audioUrl"]) {
      expect(k in a).toBe(false);
    }
  });
  it("preserves original publishedAt + discoveredAt across a re-ingest", () => {
    const first = runFeedIngestion({ feed, response: ok(RSS(item("https://x.com/a", "A", "<pubDate>Tue, 01 Sep 2026 10:00:00 +0000</pubDate>"))), existingList: [] });
    const orig = first.articles[0];
    const second = runFeedIngestion({ feed, response: ok(RSS(item("https://x.com/a", "A2", "<pubDate>Wed, 02 Sep 2026 10:00:00 +0000</pubDate>"))), existingList: first.articles });
    expect(second.articles[0].publishedAt).toBe(orig.publishedAt);   // original preserved
    expect(second.articles[0].discoveredAt).toBe(orig.discoveredAt);
  });
});
