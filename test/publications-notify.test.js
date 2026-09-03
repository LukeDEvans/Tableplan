import { describe, it, expect } from "vitest";
import {
  NOTIF, DEFAULT_NOTIFICATION_RETENTION_DAYS, normalizeNotifications,
  markDiscovered, markManyDiscovered, saveArticle, dismissArticle, isSaved, isDismissed,
  pendingNotifications, notificationBadgeCount, badgeLabel, retainedArticles, recentRetained, pruneNotifications,
} from "../publications-notify.js";

const art = (id, publishedAt, publicationId = "p1", discoveredAt = "2026-09-02T00:00:00Z") =>
  ({ id, publishedAt, publicationId, discoveredAt });
const now = "2026-09-02T12:00:00Z";

describe("markDiscovered — only NEW articles become pending", () => {
  it("a never-seen article becomes PENDING", () => {
    const m = markDiscovered({}, "a1", now);
    expect(m.a1.state).toBe(NOTIF.PENDING);
    expect(m.a1.resolvedAt).toBe(null);
  });
  it("rediscovering a saved/dismissed/expired article does NOT reset it (§20)", () => {
    let m = saveArticle({}, "a1", now);
    m = markDiscovered(m, "a1", "2099-01-01T00:00:00Z"); // rediscovery
    expect(m.a1.state).toBe(NOTIF.SAVED); // unchanged — no resurrection
    m = dismissArticle({}, "a2", now);
    m = markDiscovered(m, "a2", "2099-01-01T00:00:00Z");
    expect(m.a2.state).toBe(NOTIF.DISMISSED);
  });
  it("markManyDiscovered only adds pending for unseen ids", () => {
    const seen = saveArticle({}, "a1", now);
    const m = markManyDiscovered(seen, ["a1", "a2", "a3"], now);
    expect(m.a1.state).toBe(NOTIF.SAVED);
    expect(m.a2.state).toBe(NOTIF.PENDING);
    expect(m.a3.state).toBe(NOTIF.PENDING);
  });
});

describe("save / dismiss transitions (resolve the notification, keep the Article)", () => {
  it("save → SAVED; dismiss → DISMISSED; both set resolvedAt", () => {
    const s = saveArticle({}, "a1", now);
    expect(isSaved(s, "a1")).toBe(true);
    expect(s.a1.resolvedAt).toBe(now);
    const d = dismissArticle({}, "a2", now);
    expect(isDismissed(d, "a2")).toBe(true);
  });
});

describe("pendingNotifications — the triage deck", () => {
  const articles = [art("a1", "2026-09-01T00:00:00Z"), art("a2", "2026-09-02T00:00:00Z"), art("a3", "2026-08-01T00:00:00Z")];
  const m = markManyDiscovered({}, ["a1", "a2", "a3"], now);

  it("only PENDING articles appear, newest publication date first", () => {
    expect(pendingNotifications(articles, m, now).map((a) => a.id)).toEqual(["a2", "a1", "a3"]);
  });
  it("saved/dismissed articles leave the deck (but remain Articles)", () => {
    let m2 = saveArticle(m, "a2", now);
    m2 = dismissArticle(m2, "a1", now);
    expect(pendingNotifications(articles, m2, now).map((a) => a.id)).toEqual(["a3"]);
  });
  it("retention (default 7d) ages a stale PENDING entry OUT of the deck — the Article stays", () => {
    const stale = markDiscovered({}, "old", "2026-08-01T00:00:00Z"); // discovered 32d before `now`
    const arts = [art("old", "2026-08-01T00:00:00Z", "p1", "2026-08-01T00:00:00Z")];
    expect(pendingNotifications(arts, stale, now).length).toBe(0); // expired from triage
    expect(stale.old.state).toBe(NOTIF.PENDING); // record untouched (not deleted)
    // a longer retention window keeps it
    expect(pendingNotifications(arts, stale, now, { retentionDays: 60 }).length).toBe(1);
  });
});

describe("badge", () => {
  it("counts only actionable pending notifications (not library/history/playlist)", () => {
    const articles = [art("a1", "2026-09-01T00:00:00Z"), art("a2", "2026-09-02T00:00:00Z")];
    let m = markManyDiscovered({}, ["a1", "a2"], now);
    expect(notificationBadgeCount(articles, m, now)).toBe(2);
    m = saveArticle(m, "a1", now); // saving resolves the notification
    expect(notificationBadgeCount(articles, m, now)).toBe(1);
  });
  it("badgeLabel caps display at 99+ while the count stays exact", () => {
    expect(badgeLabel(5)).toBe("5");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(150)).toBe("99+");
    expect(badgeLabel(0)).toBe("0");
  });
});

describe("permanent library (retained = SAVED)", () => {
  const articles = [art("a1", "2026-09-01T00:00:00Z", "p1"), art("a2", "2026-09-02T00:00:00Z", "p2"), art("a3", "2026-08-01T00:00:00Z", "p1")];
  it("only saved articles are in the library, newest first; dismissed/pending excluded", () => {
    let m = saveArticle({}, "a1", now); m = saveArticle(m, "a3", now); m = dismissArticle(m, "a2", now);
    expect(retainedArticles(articles, m).map((a) => a.id)).toEqual(["a1", "a3"]);
  });
  it("publication filter runs through the canonical publicationId", () => {
    let m = saveArticle({}, "a1", now); m = saveArticle(m, "a2", now); m = saveArticle(m, "a3", now);
    expect(retainedArticles(articles, m, { publicationId: "p1" }).map((a) => a.id)).toEqual(["a1", "a3"]);
  });
  it("Recent = retained within the recency window (by publication date)", () => {
    let m = saveArticle({}, "a1", now); m = saveArticle(m, "a3", now);
    expect(recentRetained(articles, m, now, { days: 14 }).map((a) => a.id)).toEqual(["a1"]); // a3 is 32d old
  });
  it("notification expiration NEVER removes a saved (permanent) article", () => {
    const arts = [art("keep", "2026-01-01T00:00:00Z", "p1", "2026-01-01T00:00:00Z")]; // very old
    const m = saveArticle({}, "keep", "2026-01-01T00:00:00Z");
    expect(retainedArticles(arts, m).map((a) => a.id)).toEqual(["keep"]); // still in the library
    expect(pendingNotifications(arts, m, now).length).toBe(0);            // just not a notification
  });
});

describe("pruneNotifications (bounded interim store)", () => {
  it("drops entries whose article is gone, keeps all pending, caps resolved by recency", () => {
    let m = {};
    m = markDiscovered(m, "p", now);                 // pending
    m = saveArticle(m, "s1", "2026-09-01T00:00:00Z");
    m = saveArticle(m, "s2", "2026-09-02T00:00:00Z");
    m = markDiscovered(m, "gone", now);               // will be pruned (not in live ids)
    const pruned = pruneNotifications(m, ["p", "s1", "s2"], { keepResolved: 1 });
    expect(pruned.p).toBeTruthy();          // pending kept
    expect("gone" in pruned).toBe(false);   // article gone → dropped
    expect(Object.keys(pruned).filter((k) => pruned[k].state === NOTIF.SAVED)).toEqual(["s2"]); // newest resolved kept
  });
});

describe("normalizeNotifications", () => {
  it("coerces garbage to {}", () => {
    expect(normalizeNotifications(null)).toEqual({});
    expect(normalizeNotifications([1])).toEqual({});
  });
});
