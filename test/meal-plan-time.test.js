import { describe, expect, it } from "vitest";
import {
  eventDaySpan, eventRunsPastMidnight, isFridayBeforeLastMeal, mealColumnIndexForTime,
  mealTimeWindowForLabel, mealtimeForLabel, spanCoversMealtime
} from "../meal-plan-time.js";

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

describe("mealtimeForLabel", () => {
  it("gives the standard meals their eating windows", () => {
    expect(mealtimeForLabel(standard, "Breakfast")).toEqual([at(6), at(8)]);
    expect(mealtimeForLabel(standard, "lunch")).toEqual([at(11, 30), at(13, 30)]);
    expect(mealtimeForLabel(standard, "Dinner")).toEqual([at(17, 30), at(20)]);
  });

  it("gives custom meal types a mealtime inside their own slice of the day", () => {
    const custom = ["Early", "Mid", "Late"];
    expect(mealtimeForLabel(custom, "Early")).toEqual([at(6), at(8)]);
    expect(mealtimeForLabel(custom, "Mid")).toEqual([at(11), at(13)]);
    expect(mealtimeForLabel(custom, "Late")).toEqual([at(16), at(18)]);
    // A custom column squeezed before a known meal stops where that meal starts.
    const [start, end] = mealtimeForLabel(["Breakfast", "Snack", "Lunch", "Dinner"], "Snack");
    expect(end).toBeLessThanOrEqual(at(11));
    expect(end).toBeGreaterThan(start);
  });

  it("returns null for a label that isn't a column", () => {
    expect(mealtimeForLabel(standard, "Snack")).toBeNull();
    expect(mealtimeForLabel(standard, "")).toBeNull();
  });
});

describe("which meals an event lands on", () => {
  const timed = (startTime, endTime) => ({ allDay: false, startTime, endTime });
  // Meals the given part of an event's day lands on, for a standard plan.
  const mealsFor = (event, part) => standard.filter((meal) => (
    spanCoversMealtime(eventDaySpan(event, part), mealtimeForLabel(standard, meal))
  ));

  it("puts an 8–4 workday on lunch only", () => {
    expect(mealsFor(timed("08:00", "16:00"))).toEqual(["Lunch"]);
  });

  it("puts an evening shift on dinner only", () => {
    expect(mealsFor(timed("15:00", "23:00"))).toEqual(["Dinner"]);
    expect(mealsFor(timed("13:00", "21:00"))).toEqual(["Dinner"]);
  });

  it("puts an overnight shift on dinner, and on the next morning's breakfast only if it runs into it", () => {
    const overnight = timed("19:00", "07:00");
    expect(eventRunsPastMidnight(overnight)).toBe(true);
    expect(mealsFor(overnight, "start")).toEqual(["Dinner"]);
    expect(mealsFor(overnight, "end")).toEqual(["Breakfast"]);
    expect(mealsFor(timed("18:00", "06:00"), "end")).toEqual([]);
  });

  it("puts an early shift on breakfast and lunch", () => {
    expect(mealsFor(timed("06:00", "14:00"))).toEqual(["Breakfast", "Lunch"]);
  });

  it("keeps a workday that ends as dinner starts off dinner", () => {
    expect(mealsFor(timed("09:00", "18:00"))).toEqual(["Lunch"]);
  });

  it("puts a short event on the meal it starts during", () => {
    expect(mealsFor(timed("19:30", "21:00"))).toEqual(["Dinner"]);
    expect(mealsFor(timed("12:00", "12:30"))).toEqual(["Lunch"]);
    expect(mealsFor(timed("12:15", null))).toEqual(["Lunch"]);
    expect(mealsFor(timed("10:00", "10:30"))).toEqual([]);
    expect(mealsFor(timed("16:00", "17:15"))).toEqual([]);
  });

  it("puts all-day and untimed events on every meal", () => {
    expect(mealsFor({ allDay: true })).toEqual(standard);
    expect(mealsFor({ allDay: false, startTime: null })).toEqual(standard);
    expect(mealsFor(timed("08:00", "16:00"), "mid")).toEqual(standard);
  });

  it("does not treat a same-day or open-ended event as running past midnight", () => {
    expect(eventRunsPastMidnight(timed("08:00", "16:00"))).toBe(false);
    expect(eventRunsPastMidnight(timed("08:00", null))).toBe(false);
    expect(eventRunsPastMidnight({ allDay: true, startTime: "19:00", endTime: "07:00" })).toBe(false);
  });

  it("takes up none of the next day when the event ends at midnight", () => {
    expect(eventDaySpan(timed("19:00", "00:00"), "end")).toBeNull();
  });
});
