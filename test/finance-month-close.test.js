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
