import { describe, expect, it } from "vitest";
import { hasMealAheadTask, restoreWeekPlan, snapshotWeekPlan } from "../meal-plan-state.js";

describe("snapshotWeekPlan / restoreWeekPlan (auto-fill rollback, MP-1)", () => {
  const makeWeek = () => ({
    slots: { monday: { "Luke Dinner": [{ id: "e1", recipeId: "r1", plannedServings: 2 }] } },
    combinedMealSections: { monday: { Dinner: ["Luke Dinner", "MJ Dinner"] } },
    publishedSlots: { monday: { "Luke Dinner": "r1" } },
    publishedCombinedMealSections: { monday: { Dinner: true } },
    mealPlanView: "published",
    manualGroceries: ["legacy"]
  });

  it("restores everything a week clear wipes, including publishedWeeks[key]", () => {
    const week = makeWeek();
    const original = JSON.parse(JSON.stringify(week));
    const publishedWeeks = { "2026-09-25": { slots: { a: 1 } }, other: { keep: true } };
    const snapshot = snapshotWeekPlan(week, publishedWeeks, "2026-09-25");

    // Simulate clearPlannerWeekSlots + a failed generate.
    week.slots.monday["Luke Dinner"] = "";
    week.combinedMealSections.monday.Dinner = false;
    week.publishedSlots = null;
    week.publishedCombinedMealSections = {};
    week.mealPlanView = "edit";
    delete publishedWeeks["2026-09-25"];

    restoreWeekPlan(week, publishedWeeks, "2026-09-25", snapshot);
    expect(week).toEqual(original);
    expect(publishedWeeks).toEqual({ "2026-09-25": { slots: { a: 1 } }, other: { keep: true } });
  });

  it("snapshot is a deep clone (in-place mutation doesn't leak into it)", () => {
    const week = makeWeek();
    const snapshot = snapshotWeekPlan(week, {}, "k");
    week.slots.monday["Luke Dinner"][0].plannedServings = 99;
    restoreWeekPlan(week, {}, "k", snapshot);
    expect(week.slots.monday["Luke Dinner"][0].plannedServings).toBe(2);
  });

  it("removes keys that were absent at snapshot time", () => {
    const week = { slots: {} };
    const publishedWeeks = {};
    const snapshot = snapshotWeekPlan(week, publishedWeeks, "k");
    week.mealPlanView = "edit";
    week.publishedSlots = null;
    publishedWeeks.k = { x: 1 };
    restoreWeekPlan(week, publishedWeeks, "k", snapshot);
    expect(week).toEqual({ slots: {} });
    expect(publishedWeeks).toEqual({});
  });
});

describe("hasMealAheadTask (make/prep-ahead de-dupe, MP-6)", () => {
  const title = "Make Ahead: Lentil Soup";

  it("finds a matching backlog task for this week or with no week", () => {
    expect(hasMealAheadTask([{ title, weekKey: "w1" }], {}, title, "w1")).toBe(true);
    expect(hasMealAheadTask([{ title: "make ahead: lentil soup" }], {}, title, "w1")).toBe(true);
    expect(hasMealAheadTask([{ title, weekKey: "w0" }], {}, title, "w1")).toBe(false);
  });

  it("finds a task already scheduled onto a day in doPlans", () => {
    const doPlans = { w1: { monday: [{ title }], __skippedRecurring: {} } };
    expect(hasMealAheadTask([], doPlans, title, "w1")).toBe(true);
  });

  it("finds a task scheduled in another week's plan that carries this week's key", () => {
    const doPlans = { w0: { friday: [{ title, weekKey: "w1" }] } };
    expect(hasMealAheadTask([], doPlans, title, "w1")).toBe(true);
  });

  it("ignores scheduled tasks belonging to other weeks and other titles", () => {
    const doPlans = { w0: { monday: [{ title }] }, w1: { monday: [{ title: "Prep: Lentil Soup" }] } };
    expect(hasMealAheadTask([], doPlans, title, "w1")).toBe(false);
    expect(hasMealAheadTask(undefined, undefined, title, "w1")).toBe(false);
  });
});
