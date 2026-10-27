// Ticking a Household task from Personal changes only that task (2026-10-26).
import { describe, it, expect } from "vitest";
import { setTaskDoneInDoData } from "../calendar/tasks-project.js";

const data = {
  doPlans: { "2026-10-25": { mon: [{ id: "a", title: "Trash", done: false }, { id: "b", title: "Vacuum", done: true }], tue: [{ id: "c", title: "Bills" }] }, "2026-10-18": { mon: [{ id: "a", done: false }] } },
  doBacklog: [{ id: "x", title: "Gutters", done: false }, { id: "y", title: "Filters", done: false }],
  recurringTasks: [{ id: "r" }],
};

describe("setTaskDoneInDoData", () => {
  it("ticks one day task and leaves everything else as it was", () => {
    const next = setTaskDoneInDoData(data, "2026-10-25", "mon", "a", true);
    expect(next.doPlans["2026-10-25"].mon).toEqual([{ id: "a", title: "Trash", done: true }, { id: "b", title: "Vacuum", done: true }]);
    expect(next.doPlans["2026-10-25"].tue).toBe(data.doPlans["2026-10-25"].tue);
    expect(next.doPlans["2026-10-18"]).toBe(data.doPlans["2026-10-18"]);
    expect(next.doBacklog).toBe(data.doBacklog);
    expect(next.recurringTasks).toBe(data.recurringTasks);
    expect(data.doPlans["2026-10-25"].mon[0].done).toBe(false); // input untouched
  });

  it("unticks too, and handles chores", () => {
    expect(setTaskDoneInDoData(data, "2026-10-25", "mon", "b", false).doPlans["2026-10-25"].mon[1].done).toBe(false);
    const next = setTaskDoneInDoData(data, "2026-10-25", "backlog", "y", true);
    expect(next.doBacklog).toEqual([{ id: "x", title: "Gutters", done: false }, { id: "y", title: "Filters", done: true }]);
    expect(next.doPlans).toBe(data.doPlans);
  });

  it("returns null when the task is gone", () => {
    expect(setTaskDoneInDoData(data, "2026-10-25", "mon", "zzz", true)).toBeNull();
    expect(setTaskDoneInDoData(data, "2026-11-01", "mon", "a", true)).toBeNull();
    expect(setTaskDoneInDoData(data, "2026-10-25", "backlog", "a", true)).toBeNull();
    expect(setTaskDoneInDoData(null, "2026-10-25", "mon", "a", true)).toBeNull();
  });
});
