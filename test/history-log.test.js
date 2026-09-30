import { describe, it, expect } from "vitest";
import {
  createHistoryLog, normalizeHistoryRow, historyRowFromMedia, historyRowFromArticle,
  historyRowFromPracticeEvent, historyRowFromChat, fnv1a, buildHistoryPageQuery,
  fetchAllHistory, HISTORY_QUEUE_KEY,
} from "../history-log.js";

function harness({ responses = [], user = "u1", maxQueue, batchSize = 3 } = {}) {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const timers = [];
  const posts = [];
  const logs = [];
  let uid = user;
  const replies = [...responses];
  const log = createHistoryLog({
    storage,
    post: async (rows) => { posts.push(rows); const r = replies.shift() ?? { ok: true, status: 201 }; if (r instanceof Error) throw r; return r; },
    getUserId: () => uid,
    schedule: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    cancel: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    log: (m) => logs.push(m),
    batchSize,
    ...(maxQueue ? { maxQueue } : {}),
  });
  const runTimers = async () => { while (timers.length) { const t = timers.shift(); t.fn(); await log.flush(); } };
  return { log, store, timers, posts, logs, runTimers, setUser: (u) => { uid = u; } };
}

const row = (n, extra = {}) => ({ id: `r${n}`, kind: "media_play", occurred_at: 1700000000000 + n, title: `T${n}`, ...extra });

describe("row builders", () => {
  it("media: one row per play, stable id, ms → ISO", () => {
    const a = historyRowFromMedia({ kind: "podcast", id: "ep1", title: "Ep", at: 1700000000000 });
    expect(a.kind).toBe("media_play");
    expect(a.occurred_at).toBe(new Date(1700000000000).toISOString());
    expect(a.id).toBe(historyRowFromMedia({ kind: "podcast", id: "ep1", title: "Ep", at: 1700000000000 }).id);
    expect(a.id).not.toBe(historyRowFromMedia({ kind: "podcast", id: "ep1", at: 1700000000001 }).id);
    expect(historyRowFromMedia({ kind: "podcast" })).toBeNull();
  });
  it("article and practice event", () => {
    expect(historyRowFromArticle({ id: "a1", title: "News", url: "u", date: "2026-09-01T00:00:00.000Z" }).payload).toEqual({ url: "u" });
    const pe = historyRowFromPracticeEvent({ id: "evt_1", type: "session.completed", at: "2026-09-01T00:00:00.000Z", source: "app", subject: "w1" });
    expect(pe).toMatchObject({ id: "pe:evt_1", kind: "practice_event", ref_id: "w1", title: "session.completed" });
  });
  it("chat strips the app-generated context preamble and hashes content", () => {
    const m = { role: "user", content: "CURRENT CONTEXT:\nlots\n\n---\n\nWhat's for dinner?" };
    const r = historyRowFromChat(m, 1700000000000);
    expect(r.payload).toEqual({ role: "user", text: "What's for dinner?" });
    expect(historyRowFromChat(m, 1800000000000).id).toBe(r.id); // re-log after reload = same row
    expect(historyRowFromChat({ role: "assistant", content: [{ type: "tool_use" }] })).toBeNull();
  });
  it("stamped chat turns: the same question asked twice records two rows; a reload doesn't", () => {
    const first = { role: "user", content: "What's for dinner?", at: 1700000000000 };
    const again = { role: "user", content: "What's for dinner?", at: 1700000500000 };
    const a = historyRowFromChat(first, 1);
    expect(a.occurred_at).toBe(new Date(1700000000000).toISOString()); // the turn's own time
    expect(historyRowFromChat(again).id).not.toBe(a.id);
    expect(historyRowFromChat({ ...first }, 999).id).toBe(a.id); // re-log of the same stamped turn
    // Legacy turns (no stamp, or null after a reload) keep the content-only id.
    const legacy = historyRowFromChat({ role: "user", content: "What's for dinner?" });
    expect(historyRowFromChat({ role: "user", content: "What's for dinner?", at: null }).id).toBe(legacy.id);
  });
  it("normalize rejects unknown kinds / bad dates and clips oversized fields", () => {
    expect(normalizeHistoryRow({ id: "x", kind: "nope", occurred_at: 1 })).toBeNull();
    expect(normalizeHistoryRow({ id: "x", kind: "ai_chat", occurred_at: "garbage" })).toBeNull();
    const big = normalizeHistoryRow({ id: "x", kind: "ai_chat", occurred_at: 1, title: "t".repeat(900), payload: { s: "y".repeat(50000) } });
    expect(big.title.length).toBe(500);
    expect(big.payload.truncated).toBe(true);
  });
  it("fnv1a is stable", () => { expect(fnv1a("abc")).toBe(fnv1a("abc")); expect(fnv1a("abc")).not.toBe(fnv1a("abd")); });
});

describe("createHistoryLog", () => {
  it("is a no-op when signed out", () => {
    const h = harness({ user: null });
    expect(h.log.record(row(1))).toBe(0);
    expect(h.timers).toHaveLength(0);
  });

  it("debounces, batches, stamps user_id, and clears the queue on success", async () => {
    const h = harness();
    h.log.record([row(1), row(2), row(3), row(4)]);
    h.log.record(row(1)); // duplicate id ignored
    expect(h.timers).toHaveLength(1);
    await h.runTimers();
    expect(h.posts.map((b) => b.map((r) => r.id))).toEqual([["r1", "r2", "r3"], ["r4"]]);
    expect(h.posts[0][0].user_id).toBe("u1");
    expect(h.log.status().queued).toBe(0);
    expect(JSON.parse(h.store.get(HISTORY_QUEUE_KEY)).rows).toEqual([]);
  });

  it("disables for the session on a missing table, keeping rows locally", async () => {
    const h = harness({ responses: [{ ok: false, status: 404 }] });
    h.log.record([row(1), row(2)]);
    await h.runTimers();
    expect(h.posts).toHaveLength(1);
    expect(h.log.status()).toMatchObject({ queued: 2, disabled: true });
    h.log.record(row(3));
    expect(h.timers).toHaveLength(0); // no further network attempts
    expect(JSON.parse(h.store.get(HISTORY_QUEUE_KEY)).rows).toHaveLength(3);
  });

  it("backs off on transient errors and stops after the retry budget", async () => {
    const h = harness({ responses: [new Error("net"), { ok: false, status: 503 }, { ok: false, status: 503 }, { ok: false, status: 503 }, { ok: false, status: 503 }] });
    h.log.record(row(1));
    await h.runTimers();
    expect(h.posts).toHaveLength(4); // first try + 3 retries, then quiet
    expect(h.log.status().queued).toBe(1);
    h.log.record(row(2)); // a new user action re-arms
    await h.runTimers();
    expect(h.posts.length).toBeGreaterThan(4);
  });

  it("isolates and drops a row the server rejects without losing the rest", async () => {
    // [r1,r2,r3] 400 → probe 1; [r1] ok → probe 2; [r2,r3] 400 → probe 1; [r2] 400 → dropped; [r3] ok
    const h = harness({ responses: [{ ok: false, status: 400 }, { ok: true }, { ok: false, status: 400 }, { ok: false, status: 400 }, { ok: true }] });
    h.log.record([row(1), row(2), row(3)]);
    await h.runTimers();
    expect(h.posts.map((b) => b.map((r) => r.id).join())).toEqual(["r1,r2,r3", "r1", "r2,r3", "r2", "r3"]);
    const sent = h.posts.filter((_, i) => [1, 4].includes(i)).flat().map((r) => r.id);
    expect(sent).toEqual(["r1", "r3"]);
    expect(h.log.status().queued).toBe(0);
    expect(h.logs.some((m) => m.includes("r2"))).toBe(true);
  });

  it("bounds the queue by dropping the oldest unsent rows", () => {
    const h = harness({ maxQueue: 3 });
    h.log.record([row(1), row(2), row(3), row(4), row(5)]);
    expect(h.log.status().queued).toBe(3);
    expect(JSON.parse(h.store.get(HISTORY_QUEUE_KEY)).rows.map((r) => r.id)).toEqual(["r3", "r4", "r5"]);
  });

  it("backfills once per tag per user", () => {
    const h = harness();
    expect(h.log.backfill("media-v1", [row(1), row(2)])).toBe(2);
    expect(h.log.backfill("media-v1", [row(3)])).toBe(0);
  });

  it("restores the persisted queue for the same user only", () => {
    const h = harness({ responses: [{ ok: false, status: 404 }] });
    h.log.record(row(1));
    const saved = h.store.get(HISTORY_QUEUE_KEY);
    const h2 = harness();
    h2.store.set(HISTORY_QUEUE_KEY, saved);
    h2.log.record(row(2));
    expect(h2.log.status().queued).toBe(2);
    const h3 = harness({ user: "someone-else" });
    h3.store.set(HISTORY_QUEUE_KEY, saved);
    h3.log.record(row(9));
    expect(h3.log.status().queued).toBe(1);
  });

  it("drops an in-flight result if the account changed", async () => {
    const h = harness();
    h.log.record(row(1));
    const p = h.log.flush();
    h.setUser("u2");
    await p;
    h.setUser("u1");
    expect(h.log.status().queued).toBe(1);
  });
});

describe("export read", () => {
  it("builds keyset queries newest-first", () => {
    expect(buildHistoryPageQuery("u1", null, 2)).toBe("live_history?user_id=eq.u1&select=id,kind,occurred_at,ref_id,title,payload&order=occurred_at.desc,id.desc&limit=2");
    expect(buildHistoryPageQuery("u1", { occurredAt: "2026-01-01T00:00:00+00:00", id: "a" }, 2)).toContain('&or=(occurred_at.lt."2026-01-01T00%3A00%3A00%2B00%3A00",and(occurred_at.eq."2026-01-01T00%3A00%3A00%2B00%3A00",id.lt."a"))');
  });
  it("pages until a short page and is hard-bounded", async () => {
    const pages = [[{ id: "3", occurred_at: "c" }, { id: "2", occurred_at: "b" }], [{ id: "1", occurred_at: "a" }]];
    const calls = [];
    const rows = await fetchAllHistory(async (q) => { calls.push(q); return pages.shift() || []; }, "u1", { limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(["3", "2", "1"]);
    expect(calls).toHaveLength(2);
    let n = 0;
    await fetchAllHistory(async () => { n++; return [{ id: "x", occurred_at: "t" }, { id: "y", occurred_at: "t" }]; }, "u1", { limit: 2, maxPages: 5 });
    expect(n).toBe(5);
  });
});
