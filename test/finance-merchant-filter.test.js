import { describe, it, expect } from "vitest";
import { financeMerchantFilterKey } from "../finance-guess.js";
import { financeMerchantKey } from "../finance-transactions.js";

// Tapping a merchant on a transaction card filters the list to that merchant
// (Luke, 2026-11-25: tapping an Amazon charge showed only that one charge).
describe("financeMerchantFilterKey", () => {
  const amazon = ["AMAZON MKTPLACE PMTS", "AMAZON MKTPL*536J44LI1", "AMAZON MKTPL*JH3KM5KI3", "Amazon.com*CP4PN3ZB3", "Amazon.com*5R31E70A0"];
  it("groups every Amazon charge together despite per-order codes", () => {
    expect(new Set(amazon.map(financeMerchantFilterKey))).toEqual(new Set(["amazon"]));
    // the old key split them apart — the bug
    expect(new Set(amazon.map(financeMerchantKey)).size).toBeGreaterThan(1);
  });
  it("groups Target stores and refunds", () => {
    const target = ["TARGET 1375 MINNEAPOLIS MN", "TARGET 1095 MINNEAPOLIS MN", "TARGET 1375 MINNEAPOLIS MN CREDIT"];
    expect(new Set(target.map(financeMerchantFilterKey))).toEqual(new Set(["target"]));
  });
  it("keeps different merchants apart", () => {
    expect(financeMerchantFilterKey("AMAZON MKTPL*536J44LI1")).not.toBe(financeMerchantFilterKey("TARGET 1375 MINNEAPOLIS MN"));
  });
});
