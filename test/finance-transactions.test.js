import { describe, it, expect } from "vitest";
import {
  financeMerchantKey, feedToStoreRows, reconcilePending, storeAccountsView,
  snapshotWindowTxns, recentTxns, latestUpdatedAt, mergeStoreRows, storeRowToTxn,
} from "../finance-transactions.js";
import { financeMonthsToSnapshot } from "../finance-actuals.js";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const day = (d) => new Date(NOW - d * 86400000).toISOString();

describe("financeMerchantKey (moved from finance-ui.js — behavior unchanged)", () => {
  it("strips digits/punctuation/stopwords and keeps 3 tokens", () => {
    expect(financeMerchantKey("POS DEBIT SHELL OIL 57444 #12 HOUSTON TX")).toBe("shell oil houston");
    expect(financeMerchantKey("")).toBe("");
  });
});

describe("feedToStoreRows", () => {
  const accounts = [
    { id: "A1", transactions: [
      { id: "t1", posted: day(1), amount: -12.346, description: "SHELL", pending: true },
      { id: "t2", posted: day(2), amount: null, description: "no amount" },
      { id: "", posted: day(2), amount: -1, description: "no id" },
      { id: "t1", posted: day(1), amount: -12.346, description: "dup id" },
    ] },
    { id: "", transactions: [{ id: "x", amount: -1 }] },
  ];
  it("emits only bank-owned columns, skips bad/duplicate rows, rounds to cents", () => {
    const rows = feedToStoreRows("g1", accounts, "2026-09-26T00:00:00Z");
    expect(rows).toEqual([{
      id: "t1", group_id: "g1", origin: "simplefin", account_id: "A1", posted: day(1),
      amount: -12.35, description: "SHELL", pending: true, last_seen_at: "2026-09-26T00:00:00Z",
    }]);
    // App-owned columns must never be in an ingest upsert (merge-duplicates would clobber them).
    for (const k of ["status", "superseded_by", "import_label", "import_batch"]) expect(rows[0]).not.toHaveProperty(k);
  });
  it("is deterministic — the same payload twice yields identical rows (idempotent upsert)", () => {
    expect(feedToStoreRows("g1", accounts, "x")).toEqual(feedToStoreRows("g1", accounts, "x"));
  });
});

describe("reconcilePending", () => {
  const row = (id, o) => ({ id, account_id: "A1", status: "active", pending: false, amount: -10, description: "SHELL OIL 123", posted: day(3), ...o });
  const feed = (...ids) => [{ id: "A1", transactions: [{ id: "anchor", posted: day(40) }, ...ids.map((id) => ({ id, posted: day(1) }))] }];

  it("gas pre-auth: pending $1 replaced by posted $48.12 with a NEW id → superseded", () => {
    const rows = [row("p1", { pending: true, amount: -1 }), row("q1", { amount: -48.12, posted: day(2) })];
    expect(reconcilePending(rows, feed("q1"), { now: NOW })).toEqual([{ id: "p1", status: "superseded", superseded_by: "q1" }]);
  });
  it("does nothing while the pending row is still in the feed", () => {
    const rows = [row("p1", { pending: true }), row("q1")];
    expect(reconcilePending(rows, feed("p1", "q1"), { now: NOW })).toEqual([]);
  });
  it("ambiguous (two posted candidates, neither amount-exact) → untouched", () => {
    const rows = [row("p1", { pending: true, amount: -1 }), row("q1", { amount: -30 }), row("q2", { amount: -40 })];
    expect(reconcilePending(rows, feed("q1", "q2"), { now: NOW })).toEqual([]);
  });
  it("two candidates but exactly one amount-exact → that one", () => {
    const rows = [row("p1", { pending: true, amount: -30 }), row("q1", { amount: -30 }), row("q2", { amount: -40 })];
    expect(reconcilePending(rows, feed("q1", "q2"), { now: NOW })).toEqual([{ id: "p1", status: "superseded", superseded_by: "q1" }]);
  });
  it("two same-amount pendings claim two different posted rows (one-to-one)", () => {
    const rows = [
      row("p1", { pending: true, posted: day(5) }), row("p2", { pending: true, posted: day(4) }),
      row("q1", { posted: day(3) }), row("q2", { posted: day(2) }),
    ];
    const out = reconcilePending(rows, feed("q1", "q2"), { now: NOW });
    expect(out.map((p) => p.superseded_by).sort()).toEqual(["q1", "q2"]);
  });
  it("never pairs across accounts, signs, or unrelated merchants", () => {
    const rows = [
      row("p1", { pending: true }),
      row("q1", { account_id: "B" }), row("q2", { amount: 10 }), row("q3", { description: "TARGET" }),
    ];
    expect(reconcilePending(rows, feed("q1", "q2", "q3"), { now: NOW })).toEqual([]);
  });
  it("a pending with no successor older than 10 days → vanished; younger → untouched", () => {
    expect(reconcilePending([row("p1", { pending: true, posted: day(12) })], feed(), { now: NOW }))
      .toEqual([{ id: "p1", status: "vanished", superseded_by: null }]);
    expect(reconcilePending([row("p1", { pending: true, posted: day(5) })], feed(), { now: NOW })).toEqual([]);
  });
  it("an EMPTY feed proves nothing — no pending is ever vanished on a failed pull", () => {
    expect(reconcilePending([row("p1", { pending: true, posted: day(30) })], [], { now: NOW })).toEqual([]);
  });
  it("pending older than the feed's coverage is left alone (absence isn't evidence)", () => {
    const rows = [row("p1", { pending: true, posted: day(80) })];
    expect(reconcilePending(rows, feed(), { now: NOW })).toEqual([]);
  });
  it("a posted row already claimed by an earlier supersede is not reused", () => {
    const rows = [row("p0", { pending: true, status: "superseded", superseded_by: "q1" }), row("p1", { pending: true }), row("q1")];
    expect(reconcilePending(rows, feed("q1"), { now: NOW })).toEqual([]);
  });
});

describe("storeAccountsView", () => {
  const rows = [
    { id: "a", account_id: "A1", origin: "simplefin", status: "active", amount: "-5.00", posted: day(1), description: "X" },
    { id: "b", account_id: "A1", origin: "simplefin", status: "superseded", amount: -1, posted: day(2) },
    { id: "c", account_id: "CSV1", origin: "csv", status: "active", amount: -7, posted: day(400), import_label: "cat:g:c" },
    { id: "d", account_id: "manual:cash", origin: "manual", status: "active", amount: -3 },
    { id: "e", account_id: "A1", origin: "csv", status: "deleted", amount: -9 },
  ];
  it("keeps live account metadata, hides non-active rows, excludes manual, synthesizes store-only accounts", () => {
    const view = storeAccountsView(rows, [{ id: "A1", org: "Bank", name: "Checking", balance: 100 }], { CSV1: "Old Visa" });
    expect(view.map((a) => [a.id, a.name, a.transactions.map((t) => t.id)])).toEqual([
      ["A1", "Checking", ["a"]],
      ["CSV1", "Old Visa", ["c"]],
    ]);
    expect(view[0].balance).toBe(100);
    expect(view[0].transactions[0].amount).toBe(-5);
    expect(view[1].transactions[0].importLabel).toBe("cat:g:c");
  });
});

describe("snapshotWindowTxns — past budget actuals can't be rewritten (design §5.3, T5)", () => {
  it("3 years of stored history still only lets the current month (and a feed-covered one) re-snapshot", () => {
    const store = [];
    for (let d = 0; d < 3 * 365; d += 3) store.push({ id: `t${d}`, posted: day(d), label: "cat:g:c" });
    // WITHOUT the pin: every past month becomes eligible — the data-loss trap.
    expect(financeMonthsToSnapshot(store, "2026-09").size).toBeGreaterThan(30);
    // WITH the pin: identical to the old 45-day feed's eligibility.
    const pinned = financeMonthsToSnapshot(snapshotWindowTxns(store, NOW), "2026-09");
    const oldFeed = financeMonthsToSnapshot(store.filter((t) => Date.parse(t.posted) >= NOW - 45 * 86400000), "2026-09");
    expect([...pinned].sort()).toEqual([...oldFeed].sort());
    expect([...pinned].every((m) => m >= "2026-08")).toBe(true);
  });
  it("manual txns of any age are still included, exactly as before", () => {
    const out = snapshotWindowTxns([{ id: "m", isManual: true, posted: day(500) }, { id: "old", posted: day(500) }], NOW);
    expect(out.map((t) => t.id)).toEqual(["m"]);
  });
});

describe("recentTxns (deck/bell window)", () => {
  it("keeps only the last 60 days", () => {
    expect(recentTxns([{ id: "a", posted: day(59) }, { id: "b", posted: day(61) }], NOW).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("incremental-sync helpers", () => {
  it("latestUpdatedAt picks the max cursor and keeps prev when nothing newer", () => {
    expect(latestUpdatedAt([{ updated_at: "2026-09-01" }, { updated_at: "2026-09-03" }], "2026-09-02")).toBe("2026-09-03");
    expect(latestUpdatedAt([], "2026-09-02")).toBe("2026-09-02");
  });
  it("mergeStoreRows replaces by id (a soft-delete arrives as a status change, not an absence)", () => {
    const merged = mergeStoreRows([{ id: "a", status: "active" }, { id: "b" }], [{ id: "a", status: "deleted" }]);
    expect(merged).toEqual([{ id: "a", status: "deleted" }, { id: "b" }]);
  });
  it("storeRowToTxn maps snake_case and numeric strings", () => {
    expect(storeRowToTxn({ id: 5, amount: "-1.50", account_id: "A", import_label: "cat:x" })).toMatchObject({ id: "5", amount: -1.5, accountId: "A", importLabel: "cat:x", status: "active" });
  });
});
