import { describe, it, expect } from "vitest";
import { groceryPaceFrom } from "../finance-ui.js";

const groups = [{ id: "g1", categories: [
  { id: "c1", name: "Groceries", items: [{ amount: 600 }] },
  { id: "c2", name: "Dining", items: [{ amount: 200 }] },
] }];

describe("groceryPaceFrom", () => {
  it("is null without a grocery budget", () => {
    expect(groceryPaceFrom({ groups: [], cats: {} })).toBeNull();
  });
  it("flags spending ahead of the month's pace", () => {
    const p = groceryPaceFrom({ groups, cats: { "g1:c1": -400, "g1:c2": -500 }, now: new Date(2026, 10, 12) });
    expect(p).toMatchObject({ spent: 400, budget: 600, left: 200, ahead: true });
  });
  it("is on pace when spending tracks the calendar", () => {
    const p = groceryPaceFrom({ groups, cats: { "g1:c1": 200 }, now: new Date(2026, 10, 12) });
    expect(p.ahead).toBe(false);
  });
  it("flags over budget late in the month", () => {
    expect(groceryPaceFrom({ groups, cats: { "g1:c1": 650 }, now: new Date(2026, 10, 30) }).ahead).toBe(true);
  });
});
