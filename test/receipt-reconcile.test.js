import { describe, it, expect } from "vitest";
import {
  reconcileReceipt, receiptScanStatus, storeProfileFor, ocrRowsFromObservations, moneyOnRow,
  ocrHeaderValues, crossCheckWithOcr, applyOcrHeader, ocrTranscript,
} from "../receipt-reconcile.js";
import { validateReceipt, receiptFinancePortions } from "../receipt-domain.js";

// Lines whose prices sum to `sum`, split into n lines (exact cents).
function linesSumming(sum, n = 4) {
  const cents = Math.round(sum * 100);
  const each = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => ({ id: `l${i}`, rawText: `ITEM ${i}`, totalPrice: (i === n - 1 ? cents - each * (n - 1) : each) / 100 }));
}

// The three scans from 2026-10-23 that all read "doesn't add up" (live data).
const costco = { storeName: "Costco Wholesale", subtotal: 163.4, tax: 4.09, fees: 0, discounts: 10, total: 167.49, lineItems: linesSumming(173.4, 10) };
const target = { storeName: "Target - Nicollet Mall", subtotal: 31.29, tax: 1.07, fees: 0.05, discounts: 1.56, total: 30.8, lineItems: linesSumming(36.47, 7) };
const aldi = { storeName: "ALDI", subtotal: 97.09, tax: 0, fees: 0, discounts: 0, total: 97.09, lineItems: linesSumming(95.92, 37) };

describe("reconcileReceipt — the 2026-10-23 receipts", () => {
  it("Costco: coupon taken off before the subtotal → adds up", () => {
    const v = reconcileReceipt(costco);
    expect(v.ok).toBe(true);
    expect(v.layout.discounts).toBe("before");
    expect(v.totalGap).toBe(0);
    expect(v.lineGap).toBe(0);
  });

  it("Target: the total adds up (RedCard after, bag fee inside the subtotal); the items are $5.23 over", () => {
    const v = reconcileReceipt(target);
    expect(v.totalOk).toBe(true);
    expect(v.layout).toEqual({ discounts: "after", fees: "before" });
    expect(v.subtotalOk).toBe(false);
    expect(v.lineGap).toBe(-5.23);
    expect(v.message).toMatch(/\$5\.23 more/);
  });

  it("ALDI: a real $1.17 gap between the items and the subtotal", () => {
    const v = reconcileReceipt(aldi);
    expect(v.totalOk).toBe(true);
    expect(v.subtotalOk).toBe(false);
    expect(v.lineGap).toBe(1.17);
    expect(v.message).toMatch(/\$1\.17 less/);
    expect(receiptScanStatus(aldi)).toBe("check");
  });

  it("validateReceipt no longer double-counts Costco's coupon", () => {
    const v = validateReceipt(costco);
    expect(v.reconciles).toBe(true);
    expect(v.subtotalReconciles).toBe(true);
    expect(v.flags.some((f) => f.type === "totals-mismatch" || f.type === "subtotal-mismatch")).toBe(false);
  });
});

describe("reconcileReceipt — layouts", () => {
  it("coupons printed as negative lines, discounts repeating them", () => {
    const lines = [...linesSumming(20, 3), { id: "c", rawText: "COUPON", category: "Savings", totalPrice: -2 }];
    const v = reconcileReceipt({ subtotal: 18, tax: 1, discounts: 2, total: 19, lineItems: lines });
    expect(v.ok).toBe(true);
    expect(v.layout.discounts).toBe("lines");
  });

  it("fee added below the subtotal", () => {
    const v = reconcileReceipt({ subtotal: 10, tax: 0.5, fees: 0.1, total: 10.6, lineItems: linesSumming(10, 2) });
    expect(v.ok).toBe(true);
    expect(v.layout.fees).toBe("after");
  });

  it("no subtotal printed: lines + tax = total", () => {
    const v = reconcileReceipt({ subtotal: 0, tax: 2, total: 22, lineItems: linesSumming(20, 2) });
    expect(v.ok).toBe(true);
    expect(v.subtotalOk).toBe(null);
  });

  it("header numbers that can't agree under any layout", () => {
    const v = reconcileReceipt({ subtotal: 50, tax: 3, total: 60, lineItems: linesSumming(50, 5) });
    expect(v.ok).toBe(false);
    expect(v.totalOk).toBe(false);
    expect(v.message).toMatch(/don't come to the \$60\.00 total/);
  });

  it("nothing printed to check against → not 'checked', status check", () => {
    const r = { lineItems: linesSumming(10, 2) };
    expect(reconcileReceipt(r).checked).toBe(false);
    expect(receiptScanStatus(r)).toBe("check");
  });

  it("the store profile breaks ties", () => {
    expect(storeProfileFor("COSTCO WHOLESALE #123").id).toBe("costco");
    expect(storeProfileFor("Target T-1234").id).toBe("target");
    expect(storeProfileFor("Lunds & Byerlys")).toBe(null);
  });
});

describe("validateReceipt — hints", () => {
  it("duplicate lines are only flagged when the receipt doesn't add up", () => {
    const two = [{ id: "a", rawText: "MILK", totalPrice: 3.5 }, { id: "b", rawText: "MILK", totalPrice: 3.5 }];
    expect(validateReceipt({ subtotal: 7, total: 7, lineItems: two }).flags.some((f) => f.type === "duplicate")).toBe(false);
    expect(validateReceipt({ subtotal: 10.5, total: 10.5, lineItems: two }).flags.some((f) => f.type === "duplicate")).toBe(true);
  });

  it("a savings line isn't flagged as a negative price", () => {
    const v = validateReceipt({ subtotal: 8, total: 8, lineItems: [{ id: "a", totalPrice: 10 }, { id: "b", category: "Savings", totalPrice: -2 }] });
    expect(v.flags.some((f) => f.type === "negative-line")).toBe(false);
  });

  it("lines the phone's text recognition couldn't find are flagged", () => {
    const v = validateReceipt({ total: 0, lineItems: [{ id: "a", rawText: "X", totalPrice: 2 }] }, { ocrUnmatchedLineIds: ["a"] });
    expect(v.flags.some((f) => f.type === "price-not-printed")).toBe(true);
  });
});

describe("receiptFinancePortions — savings below the subtotal", () => {
  it("scales the categories so the split matches the charge", () => {
    const portions = receiptFinancePortions({
      total: 30.8,
      lineItems: [
        { totalPrice: 20, budgetCategory: "cat:g:food" },
        { totalPrice: 15, budgetCategory: "cat:g:home" },
      ],
    });
    const sum = Math.round(portions.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    expect(sum).toBe(30.8);
    expect(portions.every((p) => p.label)).toBe(true);
  });
});

describe("on-device text recognition helpers", () => {
  const obs = [
    { text: "BANANAS", x: 0.05, y: 0.20, w: 0.3, h: 0.02 },
    { text: "0.59", x: 0.8, y: 0.201, w: 0.1, h: 0.02 },
    { text: "MILK 2%", x: 0.05, y: 0.24, w: 0.3, h: 0.02 },
    { text: "3.49", x: 0.8, y: 0.239, w: 0.1, h: 0.02 },
    { text: "/1234567", x: 0.05, y: 0.28, w: 0.3, h: 0.02 },
    { text: "3.00-", x: 0.8, y: 0.281, w: 0.1, h: 0.02 },
    { text: "SUBTOTAL", x: 0.05, y: 0.33, w: 0.3, h: 0.02 },
    { text: "1.08", x: 0.8, y: 0.33, w: 0.1, h: 0.02 },
    { text: "TAX", x: 0.05, y: 0.36, w: 0.3, h: 0.02 },
    { text: "0.07", x: 0.8, y: 0.36, w: 0.1, h: 0.02 },
    { text: "**** TOTAL", x: 0.05, y: 0.39, w: 0.3, h: 0.02 },
    { text: "1.15", x: 0.8, y: 0.39, w: 0.1, h: 0.02 },
  ];
  const rows = ocrRowsFromObservations(obs);

  it("rebuilds printed rows from separate name and price observations", () => {
    expect(rows[0]).toBe("BANANAS  0.59");
    expect(rows[2]).toBe("/1234567  3.00-");
    expect(rows).toHaveLength(6);
  });

  it("reads money amounts, including trailing-minus coupons", () => {
    expect(moneyOnRow("/1234567  3.00-")).toEqual([-300]);
    expect(moneyOnRow("2 @ 1.99  3.98")).toEqual([199, 398]);
    expect(moneyOnRow("QTY 2 EA")).toEqual([]);
  });

  it("finds the printed subtotal, tax and total", () => {
    expect(ocrHeaderValues(rows)).toEqual({ subtotal: 1.08, tax: 0.07, total: 1.15 });
  });

  it("cross-checks the AI's prices against the printed text (each amount once)", () => {
    const r = { lineItems: [{ id: "a", totalPrice: 0.59 }, { id: "b", totalPrice: 3.49 }, { id: "c", totalPrice: 3.49 }, { id: "d", totalPrice: -3 }] };
    expect(crossCheckWithOcr(r, rows).unmatchedLineIds).toEqual(["c"]);
  });

  it("adopts the printed totals only when that makes the receipt add up", () => {
    const misread = { subtotal: 1.08, tax: 0.07, total: 7.15, lineItems: [{ id: "a", totalPrice: 0.59 }, { id: "b", totalPrice: 3.49 }, { id: "d", totalPrice: -3 }] };
    expect(applyOcrHeader(misread, rows).total).toBe(1.15);
    const fine = { ...misread, total: 1.15 };
    expect(applyOcrHeader(fine, rows)).toBe(fine);
  });

  it("builds a bounded transcript", () => {
    expect(ocrTranscript([rows]).startsWith("— page 1 —\nBANANAS  0.59")).toBe(true);
    expect(ocrTranscript([rows], 20).length).toBe(20);
  });
});
