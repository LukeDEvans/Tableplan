import { describe, it, expect } from "vitest";
import {
  beginTasksWeekSession, stepTasksWeek, endTasksWeekSession, tasksBellState,
} from "../tasks-overlay.js";

const wk = (s) => new Date(s + "T00:00:00");
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("T1 — Tasks overlay week isolation from the shared (Meal Plan) week", () => {
  it("opens on the provided week and stashes the shared week", () => {
    const s = beginTasksWeekSession(wk("2026-08-14"), wk("2026-08-21"));
    expect(key(s.overlayWeek)).toBe("2026-08-21");
    expect(key(endTasksWeekSession(s))).toBe("2026-08-14");
  });

  it("INVARIANT: stepping the overlay week never mutates the stashed shared week", () => {
    const shared = wk("2026-08-14");
    const s = beginTasksWeekSession(shared, wk("2026-08-21"));
    stepTasksWeek(s, 1);
    stepTasksWeek(s, 1);
    expect(key(s.overlayWeek)).toBe("2026-09-04");           // overlay moved +2 weeks
    expect(key(endTasksWeekSession(s))).toBe("2026-08-14");  // shared week restored unchanged
  });

  it("stepping backwards works and stays isolated", () => {
    const s = beginTasksWeekSession(wk("2026-08-14"), wk("2026-08-21"));
    expect(key(stepTasksWeek(s, -3))).toBe("2026-07-31");
    expect(key(endTasksWeekSession(s))).toBe("2026-08-14");
  });

  it("does NOT mutate the caller's Date objects (shared or open-on)", () => {
    const shared = wk("2026-08-14");
    const openOn = wk("2026-08-21");
    const s = beginTasksWeekSession(shared, openOn);
    stepTasksWeek(s, 5);
    expect(key(shared)).toBe("2026-08-14");
    expect(key(openOn)).toBe("2026-08-21");
  });

  it("week stepping is DST-safe (whole-day math, not fixed ms)", () => {
    // US spring-forward is 2026-03-08; a +1 week step must land on the same weekday.
    const s = beginTasksWeekSession(wk("2026-03-01"), wk("2026-03-08"));
    expect(key(stepTasksWeek(s, 1))).toBe("2026-03-15");
    // US fall-back is 2026-11-01; -1 week must also stay aligned.
    const s2 = beginTasksWeekSession(wk("2026-11-15"), wk("2026-11-08"));
    expect(key(stepTasksWeek(s2, -1))).toBe("2026-11-01");
  });
});

describe("T2 — Tasks bell honours the page-enable setting", () => {
  it("enabled → bell visible and openable", () => {
    expect(tasksBellState(true)).toEqual({ hidden: false, canOpen: true });
  });
  it("disabled → bell hidden and cannot open (no bypass)", () => {
    expect(tasksBellState(false)).toEqual({ hidden: true, canOpen: false });
  });
  it("coerces truthy/falsy inputs to real booleans", () => {
    expect(tasksBellState(undefined)).toEqual({ hidden: true, canOpen: false });
    expect(tasksBellState(1)).toEqual({ hidden: false, canOpen: true });
  });
});
