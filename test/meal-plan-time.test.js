import { describe, expect, it } from "vitest";
import { isFridayBeforeLastMeal, mealColumnIndexForTime, mealTimeWindowForLabel } from "../meal-plan-time.js";

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

describe("isFridayBeforeLastMeal", () => {
  const friday = (h) => new Date(2026, 8, 25, h, 0); // Fri 25 Sep 2026
  it("is true on Friday before dinner", () => {
    expect(isFridayBeforeLastMeal(standard, friday(8))).toBe(true);
    expect(isFridayBeforeLastMeal(standard, friday(12))).toBe(true);
  });
  it("is false on Friday from dinner on", () => {
    expect(isFridayBeforeLastMeal(standard, friday(15))).toBe(false);
    expect(isFridayBeforeLastMeal(standard, friday(20))).toBe(false);
  });
  it("is false on other days and single-meal plans", () => {
    expect(isFridayBeforeLastMeal(standard, new Date(2026, 8, 26, 8, 0))).toBe(false);
    expect(isFridayBeforeLastMeal(["Dinner"], friday(8))).toBe(false);
  });
});

describe("mealTimeWindowForLabel", () => {
  it("reproduces the old fixed Breakfast/Lunch/Dinner windows", () => {
    expect(mealTimeWindowForLabel(standard, "Breakfast")).toEqual([0, at(11)]);
    expect(mealTimeWindowForLabel(standard, "Lunch")).toEqual([at(11), at(15)]);
    expect(mealTimeWindowForLabel(standard, "Dinner")).toEqual([at(15), at(24)]);
  });

  it("matches labels case-insensitively", () => {
    expect(mealTimeWindowForLabel(["breakfast", "lunch", "dinner"], "LUNCH")).toEqual([at(11), at(15)]);
  });

  it("gives custom meal types a window instead of none", () => {
    const custom = ["Early", "Mid", "Late"];
    const windows = custom.map((label) => mealTimeWindowForLabel(custom, label));
    windows.forEach((win) => expect(win).not.toBeNull());
    expect(windows[0][0]).toBe(0);
    expect(windows[2][1]).toBe(at(24));
    expect(windows[0][1]).toBe(windows[1][0]);
  });

  it("returns null for a label that isn't a column", () => {
    expect(mealTimeWindowForLabel(standard, "Snack")).toBeNull();
    expect(mealTimeWindowForLabel(standard, "")).toBeNull();
  });
});
