import { describe, it, expect } from "vitest";
import { normalizeReceipt, validateReceipt } from "../receipt-domain.js";
import { parseJsonFromText } from "../document-scan.js";

// The goal is NOT "works on a clean receipt" — it is "fails safe and gives the user
// an easy path to correction when OCR/extraction is imperfect."

describe("extraction output is malformed → surfaced, never a silent bad save", () => {
  it("truncated/garbage model output throws (the caller shows an error, no receipt)", () => {
    expect(() => parseJsonFromText("")).toThrow();
    expect(() => parseJsonFromText("not json at all")).toThrow();
    expect(() => parseJsonFromText('{"storeName":"Mart", "total":')).toThrow(); // truncated
  });
  it("JSON wrapped in prose is still recovered (resilient, not brittle)", () => {
    expect(parseJsonFromText('Here you go:\n{"total": 9.99}\nHope that helps')).toEqual({ total: 9.99 });
  });
});

describe("normalizeReceipt never throws on hostile input; coerces to a safe shape", () => {
  it("nulls / wrong types / missing fields", () => {
    expect(() => normalizeReceipt(null)).not.toThrow();
    const r = normalizeReceipt({ storeName: 123, total: "not a number", lineItems: "nope", subtotal: null });
    expect(r.total).toBe(0);
    expect(Array.isArray(r.lineItems)).toBe(true);
    expect(r.lineItems).toEqual([]);
    expect(r.imageRefs).toEqual([]);
  });
  it("a garbage line with neither rawText nor name is dropped; one with rawText is kept for review", () => {
    const r = normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", lineItems: [
      { quantity: 1, totalPrice: 0 },                          // no text/name → dropped
      { rawText: "ILLEGIBLE ####", normalizedName: "", totalPrice: 0 }, // kept (has rawText)
    ] });
    expect(r.lineItems.length).toBe(1);
    expect(r.lineItems[0].rawText).toBe("ILLEGIBLE ####");
  });
  it("currency symbols / commas in prices are parsed, not dropped", () => {
    const r = normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", total: "$1,234.50", lineItems: [{ rawText: "X", normalizedName: "X", totalPrice: "$12.34" }] });
    expect(r.total).toBe(1234.5);
    expect(r.lineItems[0].totalPrice).toBe(12.34);
  });
});

describe("real-world receipt shapes are handled by the parser/validator, not silently mangled", () => {
  it("weighed produce: quantity is the weight, unitPrice derives from total/qty", () => {
    const r = normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", lineItems: [{ rawText: "BANANAS 1.24 lb @ 0.59", normalizedName: "Bananas", quantity: 1.24, unit: "lb", totalPrice: 0.73 }] });
    const line = r.lineItems[0];
    expect(line.unit).toBe("lb");
    expect(line.quantity).toBeCloseTo(1.24);
    expect(line.unitPrice).toBeCloseTo(0.73 / 1.24, 2);
  });
  it("multi-quantity: qty × unit price reconciles", () => {
    const r = normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", lineItems: [{ rawText: "3 SODA 2.49", normalizedName: "Soda", quantity: 3, totalPrice: 7.47 }] });
    expect(r.lineItems[0].unitPrice).toBeCloseTo(2.49);
  });
});

describe("validation catches the classic misreads (so the reviewer is steered, not blindsided)", () => {
  it("a subtotal/total that doesn't reconcile is flagged (a misread total)", () => {
    const v = validateReceipt({ subtotal: 24.77, tax: 1.98, total: 99.99, lineItems: [
      { rawText: "A", normalizedName: "A", totalPrice: 2.49 },
      { rawText: "B", normalizedName: "B", totalPrice: 18.99 },
      { rawText: "C", normalizedName: "C", totalPrice: 3.29 },
    ] });
    expect(v.reconciles).toBe(false);
    expect(v.flags.some((f) => f.type === "totals-mismatch")).toBe(true);
  });
  it("a refund / negative line is surfaced (not silently treated as a purchase)", () => {
    const v = validateReceipt({ total: 0, lineItems: [{ id: "r", rawText: "RETURN", normalizedName: "Return", totalPrice: -5 }] });
    expect(v.flags.some((f) => f.type === "negative-line" && f.lineId === "r")).toBe(true);
  });
  it("duplicate-looking lines are hinted (double-scanned long receipt)", () => {
    const v = validateReceipt({ total: 0, lineItems: [
      { id: "a", rawText: "MILK", normalizedName: "Milk", totalPrice: 3.5 },
      { id: "b", rawText: "MILK", normalizedName: "Milk", totalPrice: 3.5 },
    ] });
    expect(v.flags.some((f) => f.type === "duplicate")).toBe(true);
  });
  it("validation is advisory — it never throws and never blocks", () => {
    expect(() => validateReceipt(undefined)).not.toThrow();
    expect(() => validateReceipt({ lineItems: [null, {}, "x"] })).not.toThrow();
  });
});
