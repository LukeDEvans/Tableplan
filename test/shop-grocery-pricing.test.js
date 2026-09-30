import { describe, it, expect } from "vitest";
import { convertComparablePriceQuantity, packageCostForQuantity } from "../groceries-ui.js";

describe("price quantity comparison (GRO-5)", () => {
  it("converts the package unit the same way as the desired unit", () => {
    const desired = convertComparablePriceQuantity(2, "lb"); // 32 oz
    expect(desired).toEqual({ quantity: 32, unit: "oz" });
    // A 1 lb package priced $3: need two packages. Previously "oz" !== "lb" fell back to one.
    expect(packageCostForQuantity(desired, 1, "lb", 3)).toBe(6);
    // A 16 oz package covering a 1 lb need: exactly one.
    expect(packageCostForQuantity(convertComparablePriceQuantity(1, "lb"), 16, "oz", 4)).toBe(4);
    // Half a gallon from quart packages: two.
    expect(packageCostForQuantity(convertComparablePriceQuantity(0.5, "gal"), 1, "qt", 2)).toBe(4);
  });
  it("falls back to one package when units are incomparable or unknown", () => {
    expect(packageCostForQuantity(convertComparablePriceQuantity(3, "oz"), 1, "each", 5)).toBe(5);
    expect(packageCostForQuantity(null, 1, "lb", 5)).toBe(5);
    expect(convertComparablePriceQuantity(null, "lb")).toBeNull();
    expect(convertComparablePriceQuantity(2, "")).toBeNull();
  });
});
