import { describe, it, expect } from "vitest";
import {
  articleToRow, articleFromRow, publicationToRow, publicationFromRow,
  feedToRow, feedFromRow, assemblePublications,
} from "../publications-store.js";
import { makeArticle, makeFeed, makePublication } from "../publications.js";

describe("articleToRow — snake_case row for the relational table", () => {
  it("maps every column, injects group_id, and coerces feedIds to a clean array", () => {
    const a = makeArticle({ id: "art_1", publicationId: "pub_1", feedIds: ["f1", "", "f2"], url: "https://x.com/a?utm_source=news", title: "T", author: "Jane", publishedAt: "2026-09-01T00:00:00Z", description: "d", imageUrl: "https://x.com/i.png", category: "News", discoveredAt: "2026-09-02T00:00:00Z" });
    const row = articleToRow(a, "grp1");
    expect(row.id).toBe("art_1");
    expect(row.group_id).toBe("grp1");
    expect(row.publication_id).toBe("pub_1");
    expect(row.feed_ids).toEqual(["f1", "f2"]);
    expect(row.canonical_url).toBe("https://x.com/a"); // tracking stripped by makeArticle
    expect(row.image_url).toBe("https://x.com/i.png");
    expect(row.published_at).toBe("2026-09-01T00:00:00Z");
    expect(row.discovered_at).toBe("2026-09-02T00:00:00Z");
  });

  it("empty optional fields become null (not '')", () => {
    const row = articleToRow(makeArticle({ id: "art_2", title: "" }), "g");
    expect(row.publication_id).toBeNull();
    expect(row.url).toBeNull();
    expect(row.author).toBeNull();
    expect(row.published_at).toBeNull();
    expect(row.feed_ids).toEqual([]);
    expect(row.discovered_at).toBeTruthy(); // always stamped
  });
});

describe("article round-trip — DB row → client → DB row is stable", () => {
  it("preserves id, canonical_url, feed_ids, dates through fromRow(toRow(x))", () => {
    const a = makeArticle({ id: "art_9", publicationId: "pub_9", feedIds: ["f1", "f2"], url: "https://x.com/p", title: "Round", author: "A", publishedAt: "2026-08-01T00:00:00Z", discoveredAt: "2026-08-02T00:00:00Z" });
    const row = articleToRow(a, "g");
    const back = articleFromRow(row);
    expect(back.id).toBe("art_9");
    expect(back.canonicalUrl).toBe("https://x.com/p");
    expect(back.feedIds.sort()).toEqual(["f1", "f2"]);
    expect(back.publishedAt).toBe("2026-08-01T00:00:00Z");
    expect(back.discoveredAt).toBe("2026-08-02T00:00:00Z");
    // and back to a row again is identical
    expect(articleToRow(back, "g")).toEqual(row);
  });

  it("articleFromRow does NOT re-derive canonical_url — the DB value is authoritative", () => {
    // A row whose canonical_url disagrees with url keeps the stored canonical_url.
    const back = articleFromRow({ id: "art_x", url: "https://x.com/raw?utm=1", canonical_url: "https://stored/canonical", feed_ids: [], title: "T" });
    expect(back.canonicalUrl).toBe("https://stored/canonical");
  });
});

describe("publications + feeds mappers", () => {
  it("publicationToRow drops feedIds (they live in feeds) and injects group_id", () => {
    const row = publicationToRow(makePublication({ id: "pub_1", name: "The Economist", feedIds: ["f1", "f2"] }), "g");
    expect(row).toMatchObject({ id: "pub_1", group_id: "g", name: "The Economist", key: "the economist", enabled: true });
    expect("feed_ids" in row).toBe(false);
    expect("feedIds" in row).toBe(false);
  });

  it("feed round-trips its fetch metadata", () => {
    const f = makeFeed({ id: "f1", publicationId: "pub_1", url: "https://e.com/rss", title: "Econ", etag: "W/\"abc\"", errorCount: 2, nextFetchAt: "2026-09-03T00:00:00Z" });
    const back = feedFromRow(feedToRow(f, "g"));
    expect(back).toMatchObject({ id: "f1", publicationId: "pub_1", url: "https://e.com/rss", etag: "W/\"abc\"", errorCount: 2, nextFetchAt: "2026-09-03T00:00:00Z" });
    expect(feedToRow(f, "g").group_id).toBe("g");
  });
});

describe("assemblePublications — read-side join of publications + feeds", () => {
  it("attaches each publication's feed ids from the feeds rows", () => {
    const pubRows = [{ id: "pub_1", name: "P1", key: "p1", enabled: true }, { id: "pub_2", name: "P2", key: "p2", enabled: true }];
    const feedRows = [
      { id: "f1", publication_id: "pub_1", url: "u1" },
      { id: "f2", publication_id: "pub_1", url: "u2" },
      { id: "f3", publication_id: "pub_2", url: "u3" },
    ];
    const pubs = assemblePublications(pubRows, feedRows);
    expect(pubs.find((p) => p.id === "pub_1").feedIds.sort()).toEqual(["f1", "f2"]);
    expect(pubs.find((p) => p.id === "pub_2").feedIds).toEqual(["f3"]);
  });
});
