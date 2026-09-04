import { describe, it, expect } from "vitest";
import { validateReceipt } from "../receipt-domain.js";

const line = (over = {}) => ({ id: over.id || "l", rawText: over.rawText || "ITEM", normalizedName: over.name || "Item", quantity: 1, totalPrice: 0, discountAmount: 0, confidenceScore: 0.9, ...over });

describe("validateReceipt — arithmetic reconciliation", () => {
  it("reconciles a clean receipt (lines + tax = total)", () => {
    const v = validateReceipt({
      subtotal: 24.77, tax: 1.98, fees: 0, discounts: 0, total: 26.75,
      lineItems: [line({ totalPrice: 2.49 }), line({ totalPrice: 18.99 }), line({ totalPrice: 3.29 })],
    });
    expect(v.reconciles).toBe(true);
    expect(v.subtotalReconciles).toBe(true);
    expect(v.flags.find((f) => f.type === "totals-mismatch")).toBeUndefined();
  });

  it("flags a total that doesn't reconcile", () => {
    const v = validateReceipt({ subtotal: 24.77, tax: 1.98, fees: 0, discounts: 0, total: 30.00, lineItems: [line({ totalPrice: 24.77 })] });
    expect(v.reconciles).toBe(false);
    expect(v.flags.some((f) => f.type === "totals-mismatch")).toBe(true);
  });

  it("flags line items that don't add up to the subtotal", () => {
    const v = validateReceipt({ subtotal: 24.77, tax: 1.98, total: 26.75, lineItems: [line({ totalPrice: 2.49 }), line({ totalPrice: 18.99 })] });
    expect(v.subtotalReconciles).toBe(false);
    expect(v.flags.some((f) => f.type === "subtotal-mismatch")).toBe(true);
  });

  it("tolerates small rounding (±0.5% / floor)", () => {
    const v = validateReceipt({ subtotal: 100, tax: 0, total: 100.01, lineItems: [line({ totalPrice: 100 })] });
    expect(v.reconciles).toBe(true);
  });
});

describe("validateReceipt — per-line flags", () => {
  it("missing price, negative line, bad quantity, low confidence, duplicate", () => {
    const v = validateReceipt({
      subtotal: 0, tax: 0, total: 0,
      lineItems: [
        line({ id: "a", name: "No Price", totalPrice: 0 }),
        line({ id: "b", name: "Refund", totalPrice: -3 }),
        line({ id: "c", name: "Zero Qty", totalPrice: 2, quantity: 0 }),
        line({ id: "d", name: "Blurry", totalPrice: 2, confidenceScore: 0.3 }),
        line({ id: "e", rawText: "MILK", name: "Milk", totalPrice: 3.5 }),
        line({ id: "f", rawText: "MILK", name: "Milk", totalPrice: 3.5 }),
      ],
    });
    const types = v.flags.map((f) => f.type);
    expect(types).toContain("missing-price");
    expect(types).toContain("negative-line");
    expect(types).toContain("bad-quantity");
    expect(types).toContain("low-confidence");
    expect(types).toContain("duplicate");
  });

  it("a user-corrected low-confidence line is NOT re-flagged", () => {
    const v = validateReceipt({ total: 0, lineItems: [line({ totalPrice: 2, confidenceScore: 0.2, userCorrected: true })] });
    expect(v.flags.some((f) => f.type === "low-confidence")).toBe(false);
  });

  it("advisory only — no throw on empty/garbage input", () => {
    expect(() => validateReceipt(null)).not.toThrow();
    expect(validateReceipt({}).flags).toEqual([]);
  });
});
