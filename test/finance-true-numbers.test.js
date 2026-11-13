// "Make the numbers true" (FINANCE_AUDIT.md B1, B3, B5): pure helpers.
import { describe, it, expect } from "vitest";
import {
  financeMonthEntry, financeMonthEntryTotals, financeMonthEntriesMatch, financeTxnsCoverMonth,
  financeUncategorizedByMonth, financeProjectedSpend,
} from "../finance-actuals.js";

const portions = (t) => {
  if (t.label === "split") return t.split.map((p) => ({ label: p.label, amount: p.amount }));
  if (!t.label) return [];
  const income = t.label === "income" || t.label.startsWith("income:");
  return [{ label: t.label, amount: income ? t.amount : -t.amount }];
};
const T = (id, posted, amount, label = "", extra = {}) => ({ id, posted: `${posted}T12:00:00.000Z`, amount, label, ...extra });

describe("financeMonthEntry", () => {
  const txns = [
    T("a", "2026-10-03", -40.1, "cat:g:groc"), T("b", "2026-10-09", -9.9, "cat:g:groc"),
    T("c", "2026-10-10", -100, "split", { split: [{ label: "cat:g:groc", amount: 60 }, { label: "cat:w:fun", amount: 40 }] }),
    T("d", "2026-10-12", 12.5, "cat:w:fun"), // a refund nets against its category
    T("e", "2026-10-15", 2000, "income:job"), T("f", "2026-10-16", -500, "mgmt"), T("g", "2026-10-17", -75, ""),
    T("h", "2026-11-01", -5, "cat:g:groc"),
  ];
  it("sums categories and income for that month only; transfers and unlabelled add nothing", () => {
    expect(financeMonthEntry(txns, "2026-10", portions)).toEqual({ cats: { "g:groc": 110, "w:fun": 27.5 }, income: 2000, incomeBy: { "income:job": 2000 } });
  });
  it("an empty month is an empty entry", () => {
    expect(financeMonthEntry(txns, "2026-08", portions)).toEqual({ cats: {}, income: 0, incomeBy: {} });
  });
  it("totals and comparison", () => {
    const now = financeMonthEntry(txns, "2026-10", portions);
    expect(financeMonthEntryTotals(now)).toEqual({ spend: 137.5, categories: 2, income: 2000 });
    expect(financeMonthEntryTotals({ cats: {}, income: 0 })).toEqual({ spend: 0, categories: 0, income: 0 });
    expect(financeMonthEntriesMatch(now, { income: 2000, incomeBy: { "income:job": 2000 }, cats: { "w:fun": 27.5, "g:groc": 110, "x:gone": 0 } })).toBe(true);
    expect(financeMonthEntriesMatch(now, { cats: {}, income: 0, incomeBy: {} })).toBe(false);
    expect(financeMonthEntriesMatch(now, { ...now, cats: { ...now.cats, "g:groc": 110.01 } })).toBe(false);
  });
});

describe("financeTxnsCoverMonth", () => {
  const txns = [T("a", "2026-06-30", -1), T("b", "2026-11-04", -1), T("m", "2026-01-05", -1, "", { isManual: true })];
  it("the current month always; a past month only when the bank rows reach its first day", () => {
    expect(financeTxnsCoverMonth(txns, "2026-11", "2026-11")).toBe(true);
    expect(financeTxnsCoverMonth(txns, "2026-07", "2026-11")).toBe(true);
    expect(financeTxnsCoverMonth(txns, "2026-06", "2026-11")).toBe(false); // starts Jun 30
    expect(financeTxnsCoverMonth(txns, "2026-01", "2026-11")).toBe(false); // a manual entry is not coverage
    expect(financeTxnsCoverMonth(txns, "2026-12", "2026-11")).toBe(false);
    expect(financeTxnsCoverMonth([], "2026-10", "2026-11")).toBe(false);
  });
});

describe("financeUncategorizedByMonth", () => {
  it("counts money out with no label; never labelled, transfers, or deposits", () => {
    const m = financeUncategorizedByMonth([
      T("a", "2026-10-03", -40.1), T("b", "2026-10-09", -9.95), T("c", "2026-10-10", -100, "cat:g:groc"),
      T("d", "2026-10-11", -300, "mgmt"), T("e", "2026-10-12", 55), T("f", "2026-11-02", -7),
    ]);
    expect(m.get("2026-10")).toEqual({ spend: 50.05, count: 2 });
    expect(m.get("2026-11")).toEqual({ spend: 7, count: 1 });
    expect(m.has("2026-09")).toBe(false);
  });
});

describe("financeProjectedSpend", () => {
  const opts = { dayOfMonth: 7, daysInMonth: 30 };
  it("paces everyday spending", () => {
    expect(financeProjectedSpend([{ amount: 70 }, { amount: 70 }], { ...opts, budget: 900 }).projected).toBe(600);
  });
  it("a mortgage paid on the 7th is one mortgage, not four", () => {
    const p = financeProjectedSpend([{ amount: 1850 }], { ...opts, budget: 1850 });
    expect(p).toEqual({ projected: 1850, fixed: 1850, paced: 0 });
  });
  it("a known recurring bill counts once even when it's small against the budget", () => {
    const isRecurring = (c) => c.merchantKey === "netflix";
    const p = financeProjectedSpend([{ amount: 18, merchantKey: "netflix" }, { amount: 14, merchantKey: "coffee" }], { ...opts, budget: 85, isRecurring });
    expect(p).toEqual({ projected: 78, fixed: 18, paced: 14 });
  });
  it("a refund lowers the paced part", () => {
    expect(financeProjectedSpend([{ amount: 100 }, { amount: -30 }], { ...opts, budget: 900 }).projected).toBe(300);
  });
  it("never divides by zero or projects backwards", () => {
    expect(financeProjectedSpend([{ amount: 10 }], { dayOfMonth: 0, daysInMonth: 0, budget: 100 }).projected).toBe(10);
    expect(financeProjectedSpend([], opts).projected).toBe(0);
  });
});
