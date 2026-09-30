import { describe, it, expect } from "vitest";
import { parseCsvRows, parseCsvDate, csvRowsToTxns, dedupeImport, stableHash, findDuplicateCsvAccount } from "../finance-csv.js";
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

describe("findDuplicateCsvAccount — same file under a different new-account name", () => {
  const row = (account_id, posted, amount, description, o = {}) => ({ id: `${account_id}-${posted}-${amount}`, account_id, posted, amount, description, origin: "csv", status: "active", ...o });
  const earlier = [
    row("csv:Checking", "2026-09-01T12:00:00.000Z", -5, "Coffee Shop"),
    row("csv:Checking", "2026-09-02T12:00:00.000Z", -40, "Groceries"),
    row("csv:Checking", "2026-09-03T12:00:00.000Z", -12.5, "Lunch"),
    row("csv:Checking", "2026-09-04T12:00:00.000Z", -60, "Gas"),
    row("csv:Savings", "2026-09-01T12:00:00.000Z", -5, "Coffee Shop"),
  ];
  const again = earlier.slice(0, 4).map((r) => ({ ...r, id: `new-${r.id}`, account_id: "csv:Checking copy", description: r.description.toUpperCase() }));

  it("flags an earlier CSV account holding ≥80% of the rows", () => {
    expect(findDuplicateCsvAccount(again, earlier)).toEqual({ accountId: "csv:Checking", matched: 4, total: 4 });
  });
  it("stays quiet below the threshold, for bank rows, deleted rows, and the target account itself", () => {
    const mostlyNew = [...again.slice(0, 2), row("x", "2026-09-10T12:00:00.000Z", -1, "A"), row("x", "2026-09-11T12:00:00.000Z", -2, "B")];
    expect(findDuplicateCsvAccount(mostlyNew, earlier)).toBeNull();
    expect(findDuplicateCsvAccount(again, earlier.map((r) => ({ ...r, origin: "simplefin" })))).toBeNull();
    expect(findDuplicateCsvAccount(again, earlier.map((r) => ({ ...r, status: "deleted" })))).toBeNull();
    expect(findDuplicateCsvAccount(again, earlier, { excludeAccountId: "csv:Checking" })).toBeNull();
    expect(findDuplicateCsvAccount([], earlier)).toBeNull();
  });
  it("matches one-to-one, so a single stored charge can't cover two identical new ones", () => {
    const twice = [again[0], { ...again[0], id: "dup" }];
    expect(findDuplicateCsvAccount(twice, earlier, { threshold: 1 })).toBeNull();
  });
});

describe("Debit/Credit column exports (review LOW)", () => {
  const rows = parseCsvRows(`Date,Description,Debit,Credit,Category
09/01/2026,GROCER,45.10,,Groceries
09/02/2026,REFUND,,5.00,Groceries
09/03/2026,EMPTY,,,`);
  it("csvRowsToTxns: debit → negative, credit → positive, empty row invalid", () => {
    const { txns, invalid } = csvRowsToTxns(rows, { accountId: "a", nameToKey: { groceries: "cat:g:c" } });
    expect(txns.map((t) => t.amount)).toEqual([-45.1, 5]);
    expect(invalid).toBe(1);
  });
  it("aggregateCsvBackfill: debits count as spending (not income)", async () => {
    const { aggregateCsvBackfill } = await import("../finance-csv.js");
    const out = aggregateCsvBackfill(rows, { groceries: "cat:g:c" });
    expect(out.months["2026-09"].cats["cat:g:c"]).toBe(50.1); // |−45.10| + |+5| — same magnitude rule as before for categorized rows
    expect(out.months["2026-09"].income).toBe(0);
  });
});

describe("\"Debit Amount\"/\"Credit Amount\" headers (FIN-14)", () => {
  const rows = parseCsvRows(`Transaction Date,Description,Debit Amount,Credit Amount
09/01/2026,GROCER,45.10,
09/02/2026,REFUND,,5.00
09/03/2026,PAYROLL,,2500.00`);
  it("uses the debit/credit pair, not \"Debit Amount\" as a single signed column", () => {
    const { txns } = csvRowsToTxns(rows, { accountId: "a" });
    expect(txns.map((t) => t.amount)).toEqual([-45.1, 5, 2500]);
  });
  it("aggregateCsvBackfill: the debit is spending, only credits are income", async () => {
    const { aggregateCsvBackfill } = await import("../finance-csv.js");
    const out = aggregateCsvBackfill(rows, {});
    expect(out.months["2026-09"].income).toBe(2505);
    expect(out.uncategorized).toBe(1); // the −45.10 debit, not counted as income
  });
  it("a plain signed Amount column still wins", async () => {
    const { csvAmountResolver } = await import("../finance-csv.js");
    const amt = csvAmountResolver(["Date", "Amount", "Debit", "Credit"]);
    expect(amt(["x", "-3.50", "", ""])).toBe(-3.5);
  });
});
