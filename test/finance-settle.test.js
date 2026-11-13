import { describe, it, expect } from "vitest";
import { financeOwedBalances } from "../finance-settle.js";

const r = (id, items, extra = {}) => ({ id, merchant: "Target", date: "2026-11-10", items, ...extra });
describe("financeOwedBalances", () => {
  it("adds up each person's marked lines on household receipts, less what they paid back", () => {
    const b = financeOwedBalances(
      [r("a", [{ name: "Book", price: 12.5, owedBy: "luke" }, { name: "Milk", price: 4 }]), r("b", [{ name: "Shirt", price: 20, owedBy: "luke" }])],
      [{ id: "s1", by: "luke", amount: 10 }],
    );
    expect(b.get("luke")).toMatchObject({ owed: 32.5, paid: 10, balance: 22.5 });
    expect(b.get("luke").items.map((i) => i.name)).toEqual(["Book", "Shirt"]);
  });
  it("a receipt paid personally owes nothing; paying back more never goes below zero", () => {
    const b = financeOwedBalances([r("a", [{ name: "Book", price: 12, owedBy: "luke" }], { view: "personal" })], [{ by: "luke", amount: 5 }]);
    expect(b.get("luke")).toMatchObject({ owed: 0, paid: 5, balance: 0 });
  });
  it("ignores refunds, unmarked lines and removed settlements", () => {
    const b = financeOwedBalances([r("a", [{ name: "Return", price: -8, owedBy: "luke" }, { name: "Gum", price: 1 }])], [{ by: "luke", amount: 3, deleted: true }]);
    expect(b.has("luke")).toBe(false);
  });
});
