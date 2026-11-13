import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../finance-ui.js", import.meta.url), "utf8");

describe("closed months", () => {
  it("are synced with finance: in the section, the defaults, the loader and the union merge", () => {
    expect(app).toMatch(/finance:\s+\[[^\]]*"financeClosedMonths"/);
    expect(app).toMatch(/financeClosedMonths: \{\},/);
    expect(app).toMatch(/financeClosedMonths: \(parsed\?\.financeClosedMonths/);
    expect(app).toMatch(/"financeLabelSnoozes", "financeClosedMonths",/);
  });
  it("keep their saved totals, but a closed month with none (after an account move) is filled", () => {
    expect(ui).toMatch(/if \(financeMonthClosed\(month\) && state\.financeMonthActuals\[month\]\) continue;/);
  });
  it("reopening writes false, so the union merge carries it to other devices", () => {
    expect(ui).toMatch(/state\.financeClosedMonths\[month\] = action === "close-month" \? \{ at: [^}]+\} : false;/);
  });
  it("are never offered an Update of their saved totals", () => {
    expect(ui).toMatch(/!isCurrentMonth && !closedThis && storedThis/);
    expect(ui).toMatch(/financeMonthClosed\(month\) \|\| !financeStoreActive\(\)/);
  });
});

import { financeNudgeInstance, FINANCE_NUDGE_ID_BASE } from "../finance-ui.js";
describe("weekly nudge", () => {
  const wed = new Date(2026, 10, 11, 9, 0).getTime(); // a Wednesday morning, local
  it("fires the coming Sunday at 18:00 with the count", () => {
    const n = financeNudgeInstance(12, wed);
    const at = new Date(n.fireAt);
    expect([at.getDay(), at.getHours(), at.getMinutes()]).toEqual([0, 18, 0]);
    expect(at.getDate()).toBe(15);
    expect(n.body).toBe("12 transactions to categorize");
    expect(n.kind).toBe("finance");
  });
  it("on Sunday evening itself, it waits a week", () => {
    const sun = new Date(2026, 10, 15, 17, 55).getTime();
    expect(new Date(financeNudgeInstance(1, sun).fireAt).getDate()).toBe(22);
  });
  it("nothing to categorize, nothing scheduled", () => {
    expect(financeNudgeInstance(0, wed)).toBeNull();
    expect(financeNudgeInstance(null, wed)).toBeNull();
  });
  it("a changed count is a new id (replaces the old notification); ids stay clear of reminder hashes' usual range", () => {
    expect(financeNudgeInstance(3, wed).id).not.toBe(financeNudgeInstance(4, wed).id);
    expect(financeNudgeInstance(3, wed).id).toBeGreaterThanOrEqual(FINANCE_NUDGE_ID_BASE);
    expect(financeNudgeInstance(5000, wed).id).toBeLessThan(2 ** 31);
  });
  it("is part of the phone's reminder schedule, and a tap opens Finance", () => {
    expect(app).toMatch(/native\.sync\(\[\.\.\.currentReminderInstances\(\), \.\.\.financeNudgeForReminders\(\)\]\)/);
    expect(app).toMatch(/if \(kind === "finance"\) \{ showFinanceApp\(\); return; \}/);
  });
});
