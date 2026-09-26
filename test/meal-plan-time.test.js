import { describe, expect, it } from "vitest";
import { mealColumnIndexForTime } from "../meal-plan-time.js";

const at = (h, m = 0) => h * 60 + m;
const standard = ["Breakfast", "Lunch", "Dinner"];

describe("mealColumnIndexForTime", () => {
  it("opens on breakfast in the morning", () => {
    expect(mealColumnIndexForTime(standard, at(0))).toBe(0);
    expect(mealColumnIndexForTime(standard, at(7, 30))).toBe(0);
    expect(mealColumnIndexForTime(standard, at(10, 59))).toBe(0);
  });

  it("opens on lunch around noon", () => {
    expect(mealColumnIndexForTime(standard, at(11))).toBe(1);
    expect(mealColumnIndexForTime(standard, at(12))).toBe(1);
    expect(mealColumnIndexForTime(standard, at(14, 59))).toBe(1);
  });

  it("opens on dinner from mid-afternoon on", () => {
    expect(mealColumnIndexForTime(standard, at(15))).toBe(2);
    expect(mealColumnIndexForTime(standard, at(23, 59))).toBe(2);
  });

  it("uses column position when a day lacks a meal (e.g. dinner-only Friday)", () => {
    expect(mealColumnIndexForTime(["Dinner"], at(8))).toBe(0);
    expect(mealColumnIndexForTime(["Breakfast", "Lunch"], at(19))).toBe(1);
  });

  it("is case-insensitive and spreads unknown labels across the day", () => {
    expect(mealColumnIndexForTime(["breakfast", "LUNCH", "dinner"], at(12))).toBe(1);
    expect(mealColumnIndexForTime(["First", "Second", "Third"], at(7))).toBe(0);
    expect(mealColumnIndexForTime(["First", "Second", "Third"], at(12))).toBe(1);
    expect(mealColumnIndexForTime(["First", "Second", "Third"], at(18))).toBe(2);
  });

  it("places custom labels by position among known meals", () => {
    const withSnack = ["Breakfast", "Snack", "Lunch", "Dinner"];
    expect(mealColumnIndexForTime(withSnack, at(7))).toBe(0);
    expect(mealColumnIndexForTime(withSnack, at(10))).toBe(1);
    expect(mealColumnIndexForTime(withSnack, at(12))).toBe(2);
    expect(mealColumnIndexForTime(withSnack, at(18))).toBe(3);
  });

  it("falls back to the earliest meal before any window starts", () => {
    expect(mealColumnIndexForTime(["First", "Second", "Third"], at(3))).toBe(0);
  });

  it("handles empty input", () => {
    expect(mealColumnIndexForTime([], at(12))).toBe(0);
    expect(mealColumnIndexForTime(undefined, at(12))).toBe(0);
  });
});
