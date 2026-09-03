import { describe, it, expect } from "vitest";
import {
  sourceKey, canonicalKey, makePublication, makeFeed, makeArticle,
  reconcileArticle, ingestArticles, savedArticleToArticle,
} from "../publications.js";

describe("identity", () => {
  it("sourceKey scopes a GUID to its feed (idempotent per feed); empty guid → ''", () => {
    expect(sourceKey("feedA", "g1")).toBe("feedA g1");
    expect(sourceKey("feedB", "g1")).not.toBe(sourceKey("feedA", "g1")); // same GUID, different feeds
    expect(sourceKey("feedA", "")).toBe("");
  });

  it("canonicalKey uses the conservative canonical URL", () => {
    expect(canonicalKey({ url: "https://x.com/a" })).toBe("u https://x.com/a");
    // tracking params + trailing slash + fragment normalize to the same key
    expect(canonicalKey({ url: "https://x.com/a/?utm_source=rss#top" })).toBe(canonicalKey({ url: "https://x.com/a" }));
    // canonicalUrl wins over url
    expect(canonicalKey({ url: "https://x.com/raw", canonicalUrl: "https://x.com/canon" })).toBe("u https://x.com/canon");
  });

  it("distinct content URLs stay distinct (no false merge)", () => {
    expect(canonicalKey({ url: "https://x.com/a?id=1" })).not.toBe(canonicalKey({ url: "https://x.com/a?id=2" }));
  });

  it("falls back to title+date when there is no URL; empty when nothing to key on", () => {
    expect(canonicalKey({ title: "Big Sugar", publishedAt: "2026-09-01T00:00:00Z" })).toBe("t big sugar 2026-09-01");
    expect(canonicalKey({})).toBe("");
  });
});

describe("shapes", () => {
  it("makeArticle derives canonicalUrl, defaults feedIds/discoveredAt, holds NO body", () => {
    const a = makeArticle({ id: "a1", url: "https://x.com/p?utm_medium=x", title: "T" });
    expect(a.canonicalUrl).toBe("https://x.com/p");
    expect(a.feedIds).toEqual([]);
    expect(a.discoveredAt).toBeTruthy();
    expect("text" in a).toBe(false);   // metadata only — no body
    expect("body" in a).toBe(false);
    expect(a.provenance.origin).toBe("provider");
  });
  it("makePublication owns feedIds; makeFeed carries future-fetch fields only", () => {
    const p = makePublication({ id: "p1", name: "The Economist", feedIds: ["f1", "f2"] });
    expect(p.key).toBe("the economist");
    expect(p.feedIds).toEqual(["f1", "f2"]);
    const f = makeFeed({ id: "f1", publicationId: "p1", url: "https://e.com/rss" });
    expect(f).toMatchObject({ enabled: true, errorCount: 0, etag: null, nextFetchAt: null });
  });
});

describe("reconcileArticle — update, never duplicate (audit §25)", () => {
  const base = makeArticle({ id: "a1", url: "https://x.com/a", title: "Old", author: "A", publishedAt: "2026-09-01T00:00:00Z", feedIds: ["f1"], discoveredAt: "2026-09-01T08:00:00Z" });

  it("preserves id / publishedAt / discoveredAt; unions feedIds; refreshes mutable fields", () => {
    const incoming = makeArticle({ url: "https://x.com/a", title: "New Title", author: "A", publishedAt: "2099-01-01T00:00:00Z", feedIds: ["f2"] });
    const r = reconcileArticle(base, incoming);
    expect(r.id).toBe("a1");                                   // identity preserved
    expect(r.publishedAt).toBe("2026-09-01T00:00:00Z");        // ORIGINAL preserved
    expect(r.discoveredAt).toBe("2026-09-01T08:00:00Z");       // preserved
    expect(r.feedIds.sort()).toEqual(["f1", "f2"]);            // unioned (many feeds → one article)
    expect(r.title).toBe("New Title");                          // mutable refreshed
    expect(r.updatedAt).toBeTruthy();                           // moved because something changed
  });

  it("no mutable change → updatedAt does NOT move (idempotent)", () => {
    const same = reconcileArticle(base, makeArticle({ url: "https://x.com/a", title: "Old", author: "A", feedIds: ["f1"] }));
    expect(same.updatedAt).toBe(base.updatedAt);
  });

  it("structurally cannot reset reading/listening/consumption/playlist (not on the Article)", () => {
    // The Article has no such fields, so no reconcile path can touch them.
    for (const k of ["readingProgress", "listeningProgress", "consumed", "playlist", "notification"]) {
      expect(k in base).toBe(false);
    }
  });
});

describe("ingestArticles — dedupe + idempotency", () => {
  it("two feeds discovering the same URL → ONE canonical article with both feedIds", () => {
    const { articles, added, updated } = ingestArticles([], [
      makeArticle({ url: "https://x.com/a", title: "A", feedIds: ["f1"] }),
      makeArticle({ url: "https://x.com/a/?utm_source=y", title: "A", feedIds: ["f2"] }), // same canonical URL
    ]);
    expect(articles.length).toBe(1);
    expect(added).toBe(1);
    expect(articles[0].feedIds.sort()).toEqual(["f1", "f2"]);
  });

  it("re-ingesting the same batch is idempotent (no new articles, no spurious update)", () => {
    const batch = [makeArticle({ url: "https://x.com/a", title: "A", feedIds: ["f1"] })];
    const first = ingestArticles([], batch);
    const second = ingestArticles(first.articles, batch);
    expect(second.articles.length).toBe(1);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
  });

  it("distinct URLs create distinct articles; missing GUID falls back to canonical URL", () => {
    const { articles } = ingestArticles([], [
      makeArticle({ url: "https://x.com/a", title: "A" }),         // no guid
      makeArticle({ url: "https://x.com/b", title: "B" }),
    ]);
    expect(articles.length).toBe(2);
  });

  it("does not mutate the input list", () => {
    const existing = [makeArticle({ url: "https://x.com/a", title: "A", feedIds: ["f1"] })];
    const snapshot = JSON.stringify(existing);
    ingestArticles(existing, [makeArticle({ url: "https://x.com/a", title: "A2", feedIds: ["f2"] })]);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

describe("savedArticleToArticle — legacy reconciliation (deterministic, non-destructive)", () => {
  it("maps a manual saved article to the canonical shape, dropping the body", () => {
    const saved = { id: "s1", url: "https://x.com/a?utm_source=e", title: "T", author: "Jane", date: "2026-08-01", publication: "NYT", savedAt: "2026-08-02T00:00:00Z", text: "FULL BODY", provenance: { origin: "imported", source: "manual" } };
    const a = savedArticleToArticle(saved);
    expect(a.id).toBe("s1");                              // identity preserved
    expect(a.canonicalUrl).toBe("https://x.com/a");       // tracking stripped
    expect(a.publishedAt).toBe("2026-08-01");             // from date
    expect(a.discoveredAt).toBe("2026-08-02T00:00:00Z");  // from savedAt
    expect(a.category).toBe("NYT");
    expect("text" in a).toBe(false);                      // body dropped (metadata only)
    expect(a.provenance.source).toBe("manual");
  });

  it("is deterministic + idempotent (same input → identical output; two feeds still dedupe)", () => {
    const saved = { id: "s1", url: "https://x.com/a", title: "T", savedAt: "2026-08-02T00:00:00Z" };
    const a1 = savedArticleToArticle(saved);
    const a2 = savedArticleToArticle(saved);
    expect(canonicalKey(a1)).toBe(canonicalKey(a2));
    // a saved article and an RSS discovery of the same URL converge to ONE article
    const { articles } = ingestArticles([a1], [makeArticle({ url: "https://x.com/a", title: "T", feedIds: ["f1"] })]);
    expect(articles.length).toBe(1);
    expect(articles[0].feedIds).toEqual(["f1"]);
  });
});

describe("deterministic canonical article id (cross-device stable)", () => {
  it("same canonical identity → same id; different → different; supplied id wins", () => {
    const a = makeArticle({ url: "https://x.com/a" });
    const b = makeArticle({ url: "https://x.com/a/?utm_source=y" }); // same canonical URL
    const c = makeArticle({ url: "https://x.com/b" });
    expect(a.id).toBe(b.id);            // stable across ingests/devices
    expect(a.id).not.toBe(c.id);
    expect(a.id.startsWith("art_")).toBe(true);
    expect(makeArticle({ id: "explicit", url: "https://x.com/a" }).id).toBe("explicit");
  });
  it("a title/date-only article still gets a stable id; identity-less stays empty", () => {
    const t = makeArticle({ title: "Hello", publishedAt: "2026-09-01T00:00:00Z" });
    expect(t.id).toBe(makeArticle({ title: "Hello", publishedAt: "2026-09-01T00:00:00Z" }).id);
    expect(makeArticle({}).id).toBe(""); // nothing to key on
  });
});
