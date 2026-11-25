import { describe, it, expect } from "vitest";
import { financeOwedLedger, suggestSettlement, oweLabel, owedByLabel } from "../finance-settle.js";

const LUKE = "u-luke", MJ = "u-mj";
const portionsOf = (t) => (t.label === "split" ? t.split : [{ label: t.label, amount: -t.amount }]);

describe("financeOwedLedger", () => {
  it("nets both directions per person", () => {
    const txns = [
      { id: "t1", label: oweLabel(LUKE), amount: -20, posted: "2026-11-02T12:00:00Z", displayName: "REI" },
      { id: "t2", label: "split", amount: -50, posted: "2026-11-03T12:00:00Z", split: [{ label: "cat:needs:food", amount: 30 }, { label: oweLabel(MJ), amount: 20 }] },
    ];
    const manual = [{ id: "m1", paidBy: LUKE, amount: -15, posted: "2026-11-04T12:00:00Z", description: "Target (Luke's card)" }];
    const settlements = [{ by: MJ, amount: 5, at: "2026-11-05" }];
    const l = financeOwedLedger({ txns, portionsOf, manual, settlements });
    expect(l.get(LUKE)).toMatchObject({ owes: 20, owed: 15, net: 5 });
    expect(l.get(MJ)).toMatchObject({ owes: 20, paidIn: 5, net: 15 });
  });
  it("household owes when the person paid more", () => {
    const l = financeOwedLedger({ manual: [{ id: "m", paidBy: LUKE, amount: 40, posted: "2026-11-04" }], settlements: [{ by: LUKE, amount: -10, at: "2026-11-06" }] });
    expect(l.get(LUKE).net).toBe(-30);
  });
  it("receipt lines count only when their charge isn't already counted", () => {
    const receipts = [
      { id: "r1", financeTxnId: "t1", items: [{ name: "Socks", price: 9, owedBy: LUKE }] },
      { id: "r2", financeTxnId: "", items: [{ name: "Lotion", price: 6, owedBy: MJ }] },
      { id: "r3", view: "personal", items: [{ name: "x", price: 99, owedBy: LUKE }] },
    ];
    const txns = [{ id: "t1", label: "split", amount: -30, split: [{ label: oweLabel(LUKE), amount: 9.6 }, { label: "cat:needs:food", amount: 20.4 }] }];
    const l = financeOwedLedger({ txns, portionsOf, receipts });
    expect(l.get(LUKE).owes).toBe(9.6);
    expect(l.get(MJ).owes).toBe(6);
  });
  it("labels", () => {
    expect(owedByLabel(oweLabel(LUKE))).toBe(LUKE);
    expect(owedByLabel("cat:a:b")).toBe("");
  });
});

describe("suggestSettlement", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const txns = [
    { id: "in", amount: 42.18, posted: "2026-11-20T12:00:00Z" },
    { id: "out", amount: -42.18, posted: "2026-11-21T12:00:00Z" },
    { id: "old", amount: 42.18, posted: "2026-09-01T12:00:00Z" },
  ];
  it("money in when the person owes, money out when the household owes", () => {
    expect(suggestSettlement(42.18, txns, [], { now })?.id).toBe("in");
    expect(suggestSettlement(-42.18, txns, [], { now })?.id).toBe("out");
  });
  it("skips used and old transfers", () => {
    expect(suggestSettlement(42.18, txns, [{ txnId: "in" }], { now })).toBeNull();
  });
});
