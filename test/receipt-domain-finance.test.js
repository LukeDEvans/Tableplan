import { describe, it, expect } from "vitest";
import * as D from "../receipt-domain.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { receiptScanPrompt } = require("../receipt-scan.js");

// One receipts list (RECEIPTS.md): Shop's receipt record carries what Finance
// needs — per-line budget category, source, linked transaction.
const scanned = () => D.normalizeReceipt({
  storeName: "Lunds", purchaseDate: "2026-10-01", total: 10,
  lineItems: [
    { name: "Milk", totalPrice: 4, budgetCategory: "cat:food:groc" },
    { name: "Bread", totalPrice: 2, budgetCategory: "cat:food:groc" },
    { name: "Soap", totalPrice: 3, budgetCategory: "cat:home:supplies" },
    { name: "Bag fee", totalPrice: 0.1 }
  ]
});

describe("receipt record — finance fields", () => {
  it("defaults to a scanned receipt with no link, and keeps budget categories", () => {
    const r = scanned();
    expect(r.source).toBe("scan");
    expect(r.financeTxnId).toBe("");
    expect(r.lineItems[0].budgetCategory).toBe("cat:food:groc");
    expect(r.lineItems[3].budgetCategory).toBe("");
  });
  it("round-trips source, externalId and financeTxnId; unknown sources fall back to scan", () => {
    const r = D.normalizeReceipt({ ...scanned(), source: "email", externalId: "g1", financeTxnId: "t9" });
    expect([r.source, r.externalId, r.financeTxnId]).toEqual(["email", "g1", "t9"]);
    expect(D.normalizeReceipt({ ...scanned(), source: "bogus" }).source).toBe("scan");
  });
});

describe("finance view", () => {
  it("sums lines per budget category and puts the rest (tax, uncategorized) in one unlabeled portion", () => {
    expect(D.receiptFinancePortions(scanned())).toEqual([
      { label: "cat:food:groc", amount: 6 },
      { label: "cat:home:supplies", amount: 3 },
      { label: "", amount: 1 }
    ]);
  });
  it("maps a receipt to the shape Finance matches on", () => {
    const f = D.receiptForFinance({ ...scanned(), financeTxnId: "t1" });
    expect(f).toMatchObject({ merchant: "Lunds", date: "2026-10-01", total: 10, source: "scan", financeTxnId: "t1" });
    expect(f.items[0]).toEqual({ name: "Milk", price: 4, category: "cat:food:groc" });
  });
});

describe("email / extension inbox import", () => {
  const inbound = { id: "gmail123", merchant: "Amazon", date: "2026-09-30", total: 25, items: [{ name: "Cable", price: 25, category: "cat:tech:gear" }] };
  it("makes a stable-id email receipt with the Gmail id kept for the link", () => {
    const a = D.receiptFromFinanceInbox(inbound);
    const b = D.receiptFromFinanceInbox(inbound);
    expect(a.id).toBe("receipt-email-gmail123");
    expect(b.id).toBe(a.id);
    expect(a.lineItems.map((l) => l.id)).toEqual(b.lineItems.map((l) => l.id));
    expect(a).toMatchObject({ source: "email", externalId: "gmail123", storeName: "Amazon", total: 25 });
    expect(a.lineItems[0].budgetCategory).toBe("cat:tech:gear");
  });
  it("keeps extension receipts apart and without a Gmail link", () => {
    const r = D.receiptFromFinanceInbox({ ...inbound, id: "imp_x", source: "extension" });
    expect(r.id).toBe("receipt-extension-imp_x");
    expect(r.externalId).toBe("");
  });
  it("email / extension receipts never feed grocery price history; scans do", () => {
    expect(D.priceHistoryFromReceipt(D.receiptFromFinanceInbox(inbound))).toEqual([]);
    expect(D.feedsPriceHistory(scanned())).toBe(true);
    expect(D.priceHistoryFromReceipt(scanned()).length).toBe(4);
  });
});

describe("scan prompt", () => {
  it("asks for a budget category per line only when the household has categories", () => {
    expect(receiptScanPrompt()).not.toContain("budgetCategory");
    const p = receiptScanPrompt([{ key: "cat:food:groc", name: "Food · Groceries" }]);
    expect(p).toContain("budgetCategory");
    expect(p).toContain("cat:food:groc = Food · Groceries");
  });
});
