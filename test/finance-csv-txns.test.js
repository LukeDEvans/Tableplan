import { describe, it, expect } from "vitest";
import { parseCsvRows, parseCsvDate, csvRowsToTxns, dedupeImport, stableHash } from "../finance-csv.js";
import { financeMerchantTokens } from "../finance-transactions.js";

const CSV = `Date,Description,Amount,Category,Account Name
09/01/2026,TRADER JOE'S #552,-45.10,Groceries,Visa
09/01/2026,TRADER JOE'S #552,-45.10,Groceries,Visa
2026-09-03,PAYROLL,2500.00,,Visa
bad,row,xx,,
09/04/2026,COFFEE,0,,`;

const nameToKey = { groceries: "cat:g:groc" };

describe("parseCsvDate", () => {
  it("handles ISO, US, 2-digit years, and rejects junk/invalid days", () => {
    expect(parseCsvDate("2026-09-08")).toBe("2026-09-08");
    expect(parseCsvDate("9/8/26")).toBe("2026-09-08");
    expect(parseCsvDate("13/40/2026")).toBe(null);
    expect(parseCsvDate("")).toBe(null);
  });
});

describe("csvRowsToTxns", () => {
  const rows = parseCsvRows(CSV);
  it("turns rows into txns; description column beats the later 'Account Name' column", () => {
    const { txns, invalid } = csvRowsToTxns(rows, { accountId: "acct1", nameToKey, batchId: "b1" });
    expect(invalid).toBe(2); // junk row + zero amount
    expect(txns).toHaveLength(3);
    expect(txns[0]).toMatchObject({ account_id: "acct1", posted: "2026-09-01T12:00:00.000Z", amount: -45.1, description: "TRADER JOE'S #552", import_label: "cat:g:groc", import_batch: "b1" });
    expect(txns[2]).toMatchObject({ amount: 2500, import_label: null });
  });
  it("two genuine identical same-day charges stay two rows with distinct ids", () => {
    const { txns } = csvRowsToTxns(rows, { accountId: "acct1", nameToKey });
    expect(txns[0].id).not.toBe(txns[1].id);
  });
  it("re-importing the same file produces the SAME ids (so it inserts nothing)", () => {
    const a = csvRowsToTxns(rows, { accountId: "acct1", nameToKey, batchId: "b1" }).txns.map((t) => t.id);
    const b = csvRowsToTxns(rows, { accountId: "acct1", nameToKey, batchId: "b2" }).txns.map((t) => t.id);
    expect(b).toEqual(a);
  });
  it("the same row on a different account gets a different id", () => {
    const a = csvRowsToTxns(rows, { accountId: "acct1" }).txns[0].id;
    const b = csvRowsToTxns(rows, { accountId: "acct2" }).txns[0].id;
    expect(a).not.toBe(b);
  });
  it("requires an account and date/amount columns", () => {
    expect(csvRowsToTxns(rows, {}).error).toBe("missing-account");
    expect(csvRowsToTxns([["Foo", "Bar"], ["1", "2"]], { accountId: "a" }).error).toBe("missing-columns");
  });
  it("stableHash is deterministic", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
  });
});

describe("dedupeImport", () => {
  const cand = (id, posted, amount, description, account_id = "A1") => ({ id, posted, amount, description, account_id });
  const bank = (id, posted, amount, description, o = {}) => ({ id, posted, amount, description, account_id: "A1", origin: "simplefin", status: "active", ...o });

  it("already-imported ids are 'sameFile'", () => {
    const r = dedupeImport([cand("csv_1", "2026-09-01T12:00:00Z", -5, "X")], [{ id: "csv_1", origin: "csv", account_id: "A1" }], financeMerchantTokens);
    expect(r.sameFile).toHaveLength(1);
    expect(r.fresh).toHaveLength(0);
  });
  it("rows from an UNDONE import (soft-deleted) are fresh again — re-import revives them", () => {
    const r = dedupeImport([cand("csv_1", "2026-09-01T12:00:00Z", -5, "X")], [{ id: "csv_1", origin: "csv", account_id: "A1", status: "deleted" }], financeMerchantTokens);
    expect(r.fresh).toHaveLength(1);
  });
  it("a CSV row the bank already gave us (±1 day, same amount, shared token) is 'fromBank'", () => {
    const r = dedupeImport(
      [cand("c1", "2026-09-01T12:00:00Z", -45.1, "TRADER JOES 552")],
      [bank("b1", "2026-09-02T04:00:00Z", -45.1, "TRADER JOE S #552 PORTLAND")],
      financeMerchantTokens,
    );
    expect(r.fromBank.map((c) => c.duplicateOf)).toEqual(["b1"]);
  });
  it("two identical CSV charges vs ONE bank row → one fromBank, one fresh (one-to-one)", () => {
    const r = dedupeImport(
      [cand("c1", "2026-09-01T12:00:00Z", -45.1, "TRADER JOES"), cand("c2", "2026-09-01T12:00:00Z", -45.1, "TRADER JOES")],
      [bank("b1", "2026-09-01T10:00:00Z", -45.1, "TRADER JOES")],
      financeMerchantTokens,
    );
    expect(r.fromBank).toHaveLength(1);
    expect(r.fresh).toHaveLength(1);
  });
  it("different amount, different account, too far apart, superseded bank rows → all fresh", () => {
    const r = dedupeImport(
      [
        cand("c1", "2026-09-01T12:00:00Z", -45.11, "TRADER JOES"),
        cand("c2", "2026-09-01T12:00:00Z", -45.1, "TRADER JOES", "OTHER"),
        cand("c3", "2026-09-05T12:00:00Z", -45.1, "TRADER JOES"),
        cand("c4", "2026-09-10T12:00:00Z", -9, "SHELL"),
      ],
      [bank("b1", "2026-09-01T10:00:00Z", -45.1, "TRADER JOES"), bank("b2", "2026-09-10T10:00:00Z", -9, "SHELL", { status: "superseded" })],
      financeMerchantTokens,
    );
    expect(r.fresh.map((c) => c.id).sort()).toEqual(["c1", "c2", "c3", "c4"]);
  });
});
