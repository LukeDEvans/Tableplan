import { describe, it, expect } from "vitest";
import { subscriptionReview, cancelLinkFor, cashForecast, everydaySpendPerDay, goalProgress } from "../finance-plan.js";

describe("subscriptionReview", () => {
  it("yearly cost, a price change since it was accepted, a likely duplicate, cancel links", () => {
    const r = subscriptionReview([
      { id: "a", name: "NETFLIX.COM", lastAmount: 17.99, ackAmount: 15.49, expectedDay: 22 },
      { id: "b", name: "SPOTIFY USA", lastAmount: 11.99, ackAmount: 11.99, expectedDay: 3 },
      { id: "c", name: "SPOTIFY P2", lastAmount: 11.99, expectedDay: 9 },
      { id: "d", name: "Gym", lastAmount: 30, active: false },
    ]);
    expect(r.rows.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.rows[0]).toMatchObject({ yearly: 215.88, priceFrom: 15.49, link: "https://www.netflix.com/cancelplan" });
    expect(r.rows[1].priceFrom).toBeNull();
    expect(r.rows.find((x) => x.id === "c").dupOf).toBe("b");
    expect(r).toMatchObject({ monthly: 41.97, yearly: 503.64 });
  });
  it("no link for an unknown service", () => {
    expect(cancelLinkFor("XCEL ENERGY")).toBe("");
    expect(cancelLinkFor("Disney Plus")).toMatch(/disneyplus/);
  });
});

describe("cashForecast", () => {
  const today = new Date(2026, 10, 12);
  it("adds paydays, takes bills on their day and everyday spending each day", () => {
    const f = cashForecast({ startBalance: 1000, today, days: 10, dailySpend: 20,
      paydays: [{ date: "2026-11-14", amount: 2000 }],
      bills: [{ name: "Mortgage", day: 15, amount: 1850 }, { name: "Netflix", day: 13, amount: 18, paidThisMonth: true }] });
    expect(f.points).toHaveLength(10);
    expect(f.points[0]).toMatchObject({ date: "2026-11-13", balance: 980 }); // Netflix already paid this month
    expect(f.points[1]).toMatchObject({ date: "2026-11-14", balance: 2960 });
    expect(f.points[2]).toMatchObject({ date: "2026-11-15", balance: 1090, events: ["Mortgage −1850.00"] });
    expect(f.low).toMatchObject({ date: "2026-11-22", balance: 950 }); // everyday spending after the mortgage
  });
  it("a bill paid this month comes due again next month", () => {
    const f = cashForecast({ startBalance: 0, today, days: 31, bills: [{ name: "Netflix", day: 13, amount: 18, paidThisMonth: true }] });
    expect(f.points.find((p) => p.date === "2026-12-13").out).toBe(18);
  });
});

describe("everydaySpendPerDay", () => {
  it("averages money out over the window, without bills or transfers", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const t = (d, amount, extra = {}) => ({ posted: `2026-11-${d}T12:00:00Z`, amount, merchantKey: "x", ...extra });
    expect(everydaySpendPerDay([t("10", -60), t("11", -40), t("09", -500, { isTransfer: true }), t("08", -18, { merchantKey: "netflix" }), t("07", 100)],
      { now, windowDays: 10, recurringKeys: new Set(["netflix"]) })).toBe(10);
  });
});

describe("goalProgress", () => {
  const today = new Date(2026, 10, 12);
  it("tied to an account: the balance is the progress, and the recent pace gives a finish month", () => {
    const g = goalProgress({ target: 10000, accountId: "sav", current: 0 }, { balanceNow: 6000, today, history: { "2026-08-12": { balances: { sav: 4800 } } } });
    expect(g.linked).toBe(true);
    expect(g.current).toBe(6000);
    expect(g.perMonth).toBeGreaterThan(390);
    expect(g.perMonth).toBeLessThan(410);
    expect(g.etaMonths).toBe(11); // 4,000 to go at ~$397/mo
    expect(g.etaDate).toBe("2027-10");
  });
  it("not tied: the typed amount; a target date gives the monthly amount needed", () => {
    const g = goalProgress({ target: 3000, current: 1200, targetDate: "2027-05-01" }, { today });
    expect(g).toMatchObject({ linked: false, current: 1200, perMonth: null, needPerMonth: 300 });
  });
  it("no history or a falling balance: no finish date", () => {
    expect(goalProgress({ target: 100, accountId: "a" }, { balanceNow: 50, today }).etaMonths).toBeNull();
    expect(goalProgress({ target: 100, accountId: "a" }, { balanceNow: 50, today, history: { "2026-09-01": { balances: { a: 80 } } } }).etaMonths).toBeNull();
  });
});
