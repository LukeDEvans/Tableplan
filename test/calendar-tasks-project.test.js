import { describe, it, expect } from "vitest";
import {
  taskTimeMinutes,
  taskIsScheduled,
  taskCalendarState,
  projectTask,
  tasksForCalendarDate,
  taskCountsByDate
} from "../calendar/tasks-project.js";

describe("taskTimeMinutes", () => {
  it("parses HH:MM to minutes", () => {
    expect(taskTimeMinutes({ time: "14:30" })).toBe(870);
    expect(taskTimeMinutes({ time: "00:00" })).toBe(0);
  });
  it("returns null for missing/malformed/out-of-range times", () => {
    expect(taskTimeMinutes({ time: "" })).toBe(null);
    expect(taskTimeMinutes({ time: "nope" })).toBe(null);
    expect(taskTimeMinutes({ time: "25:00" })).toBe(null);
    expect(taskTimeMinutes({})).toBe(null);
  });
});

describe("taskCalendarState (§24)", () => {
  it("scheduled when it has a time slot", () => {
    expect(taskCalendarState({ id: "t", dateKey: "2026-01-01", time: "09:00" })).toBe("scheduled");
  });
  it("due when assigned to a date/day but no time", () => {
    expect(taskCalendarState({ id: "t", dateKey: "2026-01-01" })).toBe("due");
    expect(taskCalendarState({ id: "t", dayId: "mon", time: "" })).toBe("due");
  });
  it("unscheduled when it has neither a time nor a date/day", () => {
    expect(taskCalendarState({ id: "t", title: "Backlog thing" })).toBe("unscheduled");
  });
  it("taskIsScheduled agrees", () => {
    expect(taskIsScheduled({ time: "09:00" })).toBe(true);
    expect(taskIsScheduled({ time: "" })).toBe(false);
  });
});

describe("projectTask", () => {
  it("returns null for an unscheduled task (nothing to place)", () => {
    expect(projectTask({ id: "t", title: "x" })).toBe(null);
  });
  it("marks the projection as a Task, never an Event (§25)", () => {
    const p = projectTask({ id: "t", dateKey: "2026-01-01", time: "09:00", title: "Call", done: false });
    expect(p).toMatchObject({ isTask: true, kind: "task", state: "scheduled", time: "09:00", startMinutes: 540, done: false });
  });
  it("a due task carries no time slot", () => {
    const p = projectTask({ id: "t", dateKey: "2026-01-01", title: "Pay rent" });
    expect(p).toMatchObject({ state: "due", time: null, startMinutes: null });
  });
});

describe("tasksForCalendarDate", () => {
  const tasks = [
    { id: "a", dateKey: "2026-01-01", time: "13:00", title: "Lunch call" },
    { id: "b", dateKey: "2026-01-01", time: "09:00", title: "Standup" },
    { id: "c", dateKey: "2026-01-01", title: "Pay rent" },     // due
    { id: "d", dateKey: "2026-01-02", time: "10:00", title: "Other day" },
    { id: "e", title: "Backlog" }                               // unscheduled → excluded
  ];
  it("buckets scheduled vs due for a date, scheduled ordered by time", () => {
    const { scheduled, due } = tasksForCalendarDate(tasks, "2026-01-01");
    expect(scheduled.map((t) => t.id)).toEqual(["b", "a"]); // 09:00 before 13:00
    expect(due.map((t) => t.id)).toEqual(["c"]);
  });
  it("ignores tasks on other dates and unscheduled tasks", () => {
    const { scheduled, due } = tasksForCalendarDate(tasks, "2026-01-02");
    expect(scheduled.map((t) => t.id)).toEqual(["d"]);
    expect(due).toEqual([]);
  });
});

describe("taskCountsByDate (§25 Month indicators)", () => {
  it("counts scheduled/due/total per date", () => {
    const counts = taskCountsByDate([
      { id: "a", dateKey: "2026-01-01", time: "09:00" },
      { id: "b", dateKey: "2026-01-01" },
      { id: "c", dateKey: "2026-01-01" },
      { id: "d", dateKey: "2026-01-02", time: "10:00" },
      { id: "e", title: "unscheduled" }
    ]);
    expect(counts.get("2026-01-01")).toEqual({ scheduled: 1, due: 2, total: 3 });
    expect(counts.get("2026-01-02")).toEqual({ scheduled: 1, due: 0, total: 1 });
    expect(counts.has("__none__")).toBe(false);
  });
});
