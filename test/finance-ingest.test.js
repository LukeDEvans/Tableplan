// Server ingest (netlify/functions/_finance-ingest.js) against a stateful mock of
// PostgREST that honors the (group_id, id) upsert + merge-duplicates semantics, so
// we can prove: repeat pulls are idempotent, app-owned columns survive re-ingest,
// pending→posted reconciles across pulls, and a missing table is reported as null.
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { ingestFeed, hasStoredTransactions, trimAccountsToDays } = require("../netlify/functions/_finance-ingest.js");

const NOW = Date.parse("2026-09-26T12:00:00Z");
const day = (d) => new Date(NOW - d * 86400000).toISOString();

function makeDb({ tableExists = true } = {}) {
  const rows = new Map(); // key `${group}|${id}`
  const calls = [];
  const resp = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  async function fetchImpl(url, opts = {}) {
    const u = new URL(url);
    calls.push({ method: opts.method || "GET", path: u.pathname });
    if (!tableExists) return resp({ message: "relation does not exist" }, 404);
    const q = Object.fromEntries(u.searchParams);
    const eq = (v) => decodeURIComponent(String(v || "").replace(/^eq\./, ""));
    if ((opts.method || "GET") === "POST") {
      for (const r of JSON.parse(opts.body)) {
        const k = `${r.group_id}|${r.id}`;
        const prev = rows.get(k);
        // merge-duplicates: update ONLY the columns in the payload
        rows.set(k, prev ? { ...prev, ...r } : { status: "active", superseded_by: null, import_label: null, ...r });
      }
      return resp(null, 201);
    }
    if (opts.method === "PATCH") {
      const k = `${eq(q.group_id)}|${eq(q.id)}`;
      const prev = rows.get(k);
      if (prev && prev.origin === "simplefin" && prev.pending) rows.set(k, { ...prev, ...JSON.parse(opts.body) });
      return resp(null, 204);
    }
    const g = eq(q.group_id);
    let out = [...rows.values()].filter((r) => r.group_id === g);
    if (q.posted) out = out.filter((r) => r.posted >= decodeURIComponent(q.posted.replace(/^gte\./, "")));
    if (q.limit === "1") out = out.slice(0, 1);
    return resp(out);
  }
  return { rows, calls, fetchImpl };
}

const feed = (txns) => [{ id: "A1", transactions: txns }];
const opts = (db, accounts) => ({ serviceKey: "svc", groupId: "g1", accounts, fetchImpl: db.fetchImpl, now: NOW });

describe("ingestFeed", () => {
  it("first pull inserts; an identical second pull changes nothing (idempotent)", async () => {
    const db = makeDb();
    const accounts = feed([{ id: "t1", posted: day(1), amount: -5, description: "COFFEE", pending: false }]);
    await ingestFeed(opts(db, accounts));
    const snapshot = JSON.stringify([...db.rows.values()]);
    await ingestFeed(opts(db, accounts));
    expect(db.rows.size).toBe(1);
    expect(JSON.stringify([...db.rows.values()])).toBe(snapshot);
  });

  it("re-ingest never clobbers app-owned columns (import_label / status)", async () => {
    const db = makeDb();
    const accounts = feed([{ id: "t1", posted: day(1), amount: -5, description: "COFFEE" }]);
    await ingestFeed(opts(db, accounts));
    db.rows.set("g1|t1", { ...db.rows.get("g1|t1"), import_label: "cat:g:c" });
    await ingestFeed(opts(db, accounts));
    expect(db.rows.get("g1|t1").import_label).toBe("cat:g:c");
  });

  it("gas pre-auth across two pulls: pending $1 → posted $48.12 (new id) supersedes", async () => {
    const db = makeDb();
    await ingestFeed(opts(db, feed([
      { id: "anchor", posted: day(30), amount: -2, description: "OTHER" },
      { id: "p1", posted: day(3), amount: -1, description: "SHELL OIL 5744", pending: true },
    ])));
    const res = await ingestFeed(opts(db, feed([
      { id: "anchor", posted: day(30), amount: -2, description: "OTHER" },
      { id: "q1", posted: day(2), amount: -48.12, description: "SHELL OIL 57444", pending: false },
    ])));
    expect(res.superseded).toBe(1);
    expect(db.rows.get("g1|p1")).toMatchObject({ status: "superseded", superseded_by: "q1" });
    expect(db.rows.get("g1|q1")).toMatchObject({ status: "active", amount: -48.12 });
  });

  it("an empty pull (bank hiccup) writes nothing and vanishes nothing", async () => {
    const db = makeDb();
    await ingestFeed(opts(db, feed([{ id: "p1", posted: day(20), amount: -1, description: "SHELL", pending: true }])));
    const res = await ingestFeed(opts(db, []));
    expect(res).toEqual({ upserted: 0, superseded: 0, vanished: 0 });
    expect(db.rows.get("g1|p1").status).toBe("active");
  });

  it("throws on a missing table (callers catch + log; never blocks the cache write)", async () => {
    const db = makeDb({ tableExists: false });
    await expect(ingestFeed(opts(db, feed([{ id: "t1", posted: day(1), amount: -5, description: "X" }])))).rejects.toThrow(/upsert 404/);
  });

  it("is bounded: one bulk POST + one reconcile read (+ patches only when needed)", async () => {
    const db = makeDb();
    const txns = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, posted: day(i % 90), amount: -i - 1, description: "SHOP" }));
    await ingestFeed(opts(db, feed(txns)));
    expect(db.calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });
});

describe("hasStoredTransactions (decides the one-time 90-day backfill)", () => {
  it("false on an empty table, true once ingested, null when the table is missing", async () => {
    const db = makeDb();
    expect(await hasStoredTransactions({ serviceKey: "s", groupId: "g1", fetchImpl: db.fetchImpl })).toBe(false);
    await ingestFeed(opts(db, feed([{ id: "t1", posted: day(1), amount: -5, description: "X" }])));
    expect(await hasStoredTransactions({ serviceKey: "s", groupId: "g1", fetchImpl: db.fetchImpl })).toBe(true);
    expect(await hasStoredTransactions({ serviceKey: "s", groupId: "g1", fetchImpl: makeDb({ tableExists: false }).fetchImpl })).toBe(null);
  });
  it("network failure → null (skip ingest), never throws", async () => {
    const boom = vi.fn(async () => { throw new Error("offline"); });
    expect(await hasStoredTransactions({ serviceKey: "s", groupId: "g1", fetchImpl: boom })).toBe(null);
  });
});

describe("trimAccountsToDays (cache keeps the 45-day shape on a 90-day backfill)", () => {
  it("drops older txns, keeps undated pending ones, keeps account metadata", () => {
    const out = trimAccountsToDays([{ id: "A", balance: 5, transactions: [
      { id: "new", posted: day(10) }, { id: "old", posted: day(80) }, { id: "nodate", posted: null },
    ] }], 45, NOW);
    expect(out[0].balance).toBe(5);
    expect(out[0].transactions.map((t) => t.id)).toEqual(["new", "nodate"]);
  });
});
