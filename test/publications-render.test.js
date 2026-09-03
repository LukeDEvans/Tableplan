import { describe, it, expect } from "vitest";
import { notificationCardHtml, notificationDeckHtml, libraryListHtml, publicationTabsHtml, publicationsPanelHtml, subscriptionListHtml } from "../publications-render.js";

const art = (over = {}) => ({ id: "a1", title: "Big Sugar", author: "Greger", publishedAt: "2026-09-01T00:00:00Z", publicationId: "p1", description: "An excerpt.", imageUrl: null, ...over });
const pubsById = { p1: { id: "p1", name: "NutritionFacts" } };

describe("notificationCardHtml", () => {
  const h = notificationCardHtml(art(), { pubsById });
  it("shows title, publication, author, date, and both front/back faces", () => {
    expect(h).toContain("Big Sugar");
    expect(h).toContain("NutritionFacts");
    expect(h).toContain("Greger");
    expect(h).toContain("pub-card-front");
    expect(h).toContain("pub-card-back");
    expect(h).toContain("An excerpt.");
  });
  it("has explicit Save + Dismiss buttons (accessible, not swipe-only) and a flip control", () => {
    expect(h).toContain('data-pub-save="a1"');
    expect(h).toContain('data-pub-dismiss="a1"');
    expect(h).toContain("data-pub-flip");
  });
  it("does NOT expose a play/open/read affordance (§32/§33) or a body", () => {
    expect(h).not.toMatch(/data-pub-(play|open|read|listen)/);
    expect(h).not.toContain("FULL BODY");
  });
  it("escapes untrusted content (XSS-safe)", () => {
    const evil = notificationCardHtml(art({ title: '<img src=x onerror=alert(1)>', description: '</div><script>x</script>' }), { pubsById });
    expect(evil).not.toContain("<img src=x onerror");
    expect(evil).not.toContain("<script>x");
    expect(evil).toContain("&lt;img src=x");
  });
  it("renders an image only when present, with no-referrer", () => {
    expect(notificationCardHtml(art({ imageUrl: "https://img/x.jpg" }), { pubsById })).toContain('referrerpolicy="no-referrer"');
    expect(notificationCardHtml(art({ imageUrl: null }), { pubsById })).not.toContain("pub-card-img");
  });
});

describe("empty states (distinct from failures)", () => {
  it("empty deck shows a caught-up message", () => {
    expect(notificationDeckHtml([])).toContain("all caught up");
  });
  it("empty library shows a no-saved message", () => {
    expect(libraryListHtml([])).toContain("No saved articles");
  });
  it("marks a consumed library row read (check mark), unread rows have none", () => {
    const arts = [{ id: "a1", title: "Read one" }, { id: "a2", title: "Unread one" }];
    const h = libraryListHtml(arts, { readIds: new Set(["a1"]) });
    expect(h).toMatch(/data-article-id="a1"[^>]*class="[^"]*"|class="[^"]*article-row--read[^"]*"[^>]*data-article-id="a1"/);
    // the read row carries the read class + a check; the unread row carries neither
    const rowA1 = h.slice(h.indexOf('data-article-id="a1"') - 80, h.indexOf('data-article-id="a1"') + 200);
    expect(rowA1).toContain("article-row--read");
    expect(rowA1).toContain("article-row-check");
    const rowA2 = h.slice(h.indexOf('data-article-id="a2"') - 80, h.indexOf('data-article-id="a2"') + 200);
    expect(rowA2).not.toContain("article-row--read");
  });
});

describe("subscriptionListHtml", () => {
  it("lists each publication with its feed URL and a remove control", () => {
    const h = subscriptionListHtml(
      [{ id: "p1", name: "NutritionFacts", feedIds: ["f1"] }],
      { feedUrlById: { f1: "https://nutritionfacts.org/feed" } },
    );
    expect(h).toContain("NutritionFacts");
    expect(h).toContain("https://nutritionfacts.org/feed");
    expect(h).toContain('data-pub-remove="p1"');
  });
  it("escapes a hostile publication name (no raw markup)", () => {
    const h = subscriptionListHtml([{ id: "p1", name: "<img src=x onerror=alert(1)>", feedIds: [] }], {});
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img");
  });
  it("shows an empty state when there are no subscriptions", () => {
    expect(subscriptionListHtml([])).toContain("No publications yet");
  });
});

describe("publicationTabsHtml", () => {
  it("renders All + each publication, marking the active filter", () => {
    const h = publicationTabsHtml([{ id: "p1", name: "NutritionFacts" }], "p1");
    expect(h).toContain('data-pub-filter="all"');
    expect(h).toContain('data-pub-filter="p1"');
    expect(h).toMatch(/data-pub-filter="p1"[^>]*>NutritionFacts/); // wait: class order
  });
});

describe("publicationsPanelHtml", () => {
  it("notifications tab shows the deck + a badge when pending > 0", () => {
    const h = publicationsPanelHtml({ tab: "notifications", badge: 3, badgeLabel: "3", pending: [art()], pubsById });
    expect(h).toContain('data-pub-tab="notifications"');
    expect(h).toContain("pub-badge");
    expect(h).toContain(">3<");
    expect(h).toContain("Big Sugar");
    expect(h).toContain("data-pub-refresh");
  });
  it("no badge when nothing is pending", () => {
    expect(publicationsPanelHtml({ badge: 0, pending: [] })).not.toContain("pub-badge");
  });
  it("library tab shows publication filter + retained list", () => {
    const h = publicationsPanelHtml({ tab: "library", retained: [art()], pubs: [{ id: "p1", name: "NutritionFacts" }], pubsById });
    expect(h).toContain('data-pub-filter="all"');
    expect(h).toContain("pub-lib-row");
    expect(h).toContain("Big Sugar");
  });
});
