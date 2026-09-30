// Audit fixes FIN-4/5/7/8/13 — the pure helpers (finance-actuals.js / finance-ui.js
// top-level exports). Module-level fixes (FIN-1/6/9/11/12) are exercised through
// the real createFinanceModule in finance-audit-module.test.js.
import { describe, it, expect } from "vitest";
import { localMonthKey, monthKeyOffset, financeMonthsToSnapshot, financeTransferPairIds, financePendingDuplicates } from "../finance-actuals.js";
import { parseFinAmount } from "../finance-ui.js";
import { financeMerchantKey } from "../finance-transactions.js";

describe("localMonthKey / monthKeyOffset (FIN-4)", () => {
  it("uses the LOCAL calendar month, not the UTC one", () => {
    // Local 23:30 on Jan 31 — in any timezone west of UTC this is already Feb in UTC.
    const d = new Date(2026, 0, 31, 23, 30);
    expect(localMonthKey(d)).toBe("2026-01");
    // Local midnight on the 1st — east of UTC this is the previous month in UTC.
    expect(localMonthKey(new Date(2026, 2, 1, 0, 0))).toBe("2026-03");
  });
  it("month series never repeat or skip regardless of offset", () => {
    expect([5, 4, 3, 2, 1, 0].map((i) => monthKeyOffset("2026-03", -i)))
      .toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(monthKeyOffset("2026-01", -1)).toBe("2025-12");
    expect(monthKeyOffset("2026-12", 1)).toBe("2027-01");
  });
});

describe("parseFinAmount (FIN-5)", () => {
  it("handles Unicode minus, parentheses, and currency formatting", () => {
    expect(parseFinAmount("−500")).toBe(-500);
    expect(parseFinAmount("(500)")).toBe(-500);
    expect(parseFinAmount("−$1,200.50")).toBe(-1200.5);
    expect(parseFinAmount("$1,200.50")).toBe(1200.5);
    expect(parseFinAmount("-3")).toBe(-3);
    expect(parseFinAmount("")).toBe(0);
    expect(parseFinAmount("abc")).toBe(0);
  });
  it("the manual-balance handler's sign rule now yields the negative value", () => {
    const manualBalance = (raw) => { const neg = /^[-−(]/.test(raw); const n = parseFinAmount(raw); return neg ? -Math.abs(n) : n; };
    expect(manualBalance("−500")).toBe(-500);
    expect(manualBalance("(500)")).toBe(-500);
    expect(manualBalance("−$1,200.50")).toBe(-1200.5);
  });
});

describe("financeTransferPairIds (FIN-7)", () => {
  const bankOut = { id: "b1", accountId: "A", amount: -200, posted: "2026-09-01" };
  const bankIn = { id: "b2", accountId: "B", amount: 200, posted: "2026-09-02" };
  it("pairs opposite-sign bank rows across accounts", () => {
    expect([...financeTransferPairIds([bankOut, bankIn])].sort()).toEqual(["b1", "b2"]);
  });
  it("never pairs a manual entry with a bank transaction", () => {
    const manual = { id: "m1", accountId: "manual:cash", amount: -200, posted: "2026-09-02", isManual: true };
    expect(financeTransferPairIds([manual, bankIn]).size).toBe(0);
  });
});

describe("financePendingDuplicates (FIN-13)", () => {
  it("a posted row absorbs at most one pending row", () => {
    const txns = [
      { id: "p1", accountId: "A", amount: -4.5, posted: "2026-09-01", description: "BLUE BOTTLE COFFEE", pending: true },
      { id: "p2", accountId: "A", amount: -4.5, posted: "2026-09-02", description: "BLUE BOTTLE COFFEE", pending: true },
      { id: "q1", accountId: "A", amount: -4.5, posted: "2026-09-03", description: "BLUE BOTTLE COFFEE", pending: false },
    ];
    const d = financePendingDuplicates(txns, financeMerchantKey);
    expect(d.size).toBe(1);
    expect(d.get("p1")).toBe("q1");
    expect(d.has("p2")).toBe(false);
  });
  it("two pendings + two posteds each pair one-to-one", () => {
    const txns = ["p1", "p2", "q1", "q2"].map((id, i) => ({ id, accountId: "A", amount: -4.5, posted: `2026-09-0${i + 1}`, description: "BLUE BOTTLE", pending: id.startsWith("p") }));
    const d = financePendingDuplicates(txns, financeMerchantKey);
    expect(new Set(d.values())).toEqual(new Set(["q1", "q2"]));
  });
});

describe("financeMonthsToSnapshot partial pull (FIN-8)", () => {
  const txns = [
    { posted: "2026-07-01", label: "cat:g:c" },
    { posted: "2026-08-10", label: "cat:g:c" },
    { posted: "2026-09-05", label: "cat:g:c" },
  ];
  it("full pull re-snapshots covered past months", () => {
    expect([...financeMonthsToSnapshot(txns, "2026-09")].sort()).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
  it("partial pull (errors) only touches the current month", () => {
    expect([...financeMonthsToSnapshot(txns, "2026-09", { partial: true })]).toEqual(["2026-09"]);
  });
});
