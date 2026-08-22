import { describe, it, expect } from "vitest";
import {
  eventInstancesInRange,
  sortEventsForDisplay,
  eventsOverlap,
  conflictsFor
} from "../calendar/projection.js";
import { normalizeRecurrence } from "../calendar/recurrence.js";

describe("eventInstancesInRange", () => {
  it("single dated event inside the range → one plain instance (no occurrenceOf/spanPos)", () => {
    const out = eventInstancesInRange({ id: "e", date: "2026-01-10" }, "2026-01-01", "2026-01-31");
    expect(out).toEqual([{ date: "2026-01-10" }]);
  });
  it("single dated event outside the range → nothing", () => {
    expect(eventInstancesInRange({ id: "e", date: "2026-02-10" }, "2026-01-01", "2026-01-31")).toEqual([]);
  });
  it("recurring event → an instance per occurrence, each tagged occurrenceOf", () => {
    const e = { id: "e", date: "2026-01-01", recurrence: normalizeRecurrence({ freq: "daily" }) };
    const out = eventInstancesInRange(e, "2026-01-01", "2026-01-03");
    expect(out).toEqual([
      { date: "2026-01-01", occurrenceOf: "e" },
      { date: "2026-01-02", occurrenceOf: "e" },
      { date: "2026-01-03", occurrenceOf: "e" }
    ]);
  });
  it("multi-day event → start/mid/end span positions, clipped to the window", () => {
    const e = { id: "e", date: "2026-01-10", endDate: "2026-01-13" };
    const out = eventInstancesInRange(e, "2026-01-11", "2026-01-31");
    // start day (Jan10) is before the window, so we begin at Jan11 (mid)
    expect(out).toEqual([
      { date: "2026-01-11", occurrenceOf: "e", spanPos: "mid" },
      { date: "2026-01-12", occurrenceOf: "e", spanPos: "mid" },
      { date: "2026-01-13", occurrenceOf: "e", spanPos: "end" }
    ]);
  });
  it("multi-day fully inside the window keeps a start and an end", () => {
    const out = eventInstancesInRange({ id: "e", date: "2026-01-10", endDate: "2026-01-12" }, "2026-01-01", "2026-01-31");
    expect(out.map((i) => i.spanPos)).toEqual(["start", "mid", "end"]);
  });
  it("recurrence takes precedence over endDate", () => {
    const e = { id: "e", date: "2026-01-01", endDate: "2026-01-05", recurrence: normalizeRecurrence({ freq: "daily", interval: 2 }) };
    const out = eventInstancesInRange(e, "2026-01-01", "2026-01-05");
    expect(out.every((i) => i.occurrenceOf === "e" && i.spanPos === undefined)).toBe(true);
    expect(out.map((i) => i.date)).toEqual(["2026-01-01", "2026-01-03", "2026-01-05"]);
  });
});

describe("sortEventsForDisplay", () => {
  it("all-day events sort before timed, then by start time", () => {
    const list = [
      { id: "t2", allDay: false, startTime: "14:00" },
      { id: "a1", allDay: true },
      { id: "t1", allDay: false, startTime: "09:00" },
      { id: "t3", allDay: false, startTime: null }
    ];
    sortEventsForDisplay(list);
    expect(list.map((e) => e.id)).toEqual(["a1", "t3", "t1", "t2"]);
  });
  it("returns the same array reference (sorts in place)", () => {
    const list = [{ id: "x", allDay: true }];
    expect(sortEventsForDisplay(list)).toBe(list);
  });
});

describe("eventsOverlap / conflictsFor (§22)", () => {
  const timed = (id, date, startTime, endTime) => ({ id, date, startTime, endTime, allDay: false });

  it("overlapping timed events on the same day conflict", () => {
    expect(eventsOverlap(timed("a", "2026-01-01", "09:00", "10:30"), timed("b", "2026-01-01", "10:00", "11:00"))).toBe(true);
  });
  it("touching intervals (end == start) do NOT conflict", () => {
    expect(eventsOverlap(timed("a", "2026-01-01", "09:00", "10:00"), timed("b", "2026-01-01", "10:00", "11:00"))).toBe(false);
  });
  it("different days never conflict", () => {
    expect(eventsOverlap(timed("a", "2026-01-01", "09:00", "10:00"), timed("b", "2026-01-02", "09:00", "10:00"))).toBe(false);
  });
  it("all-day events never conflict", () => {
    expect(eventsOverlap({ id: "a", date: "2026-01-01", allDay: true }, timed("b", "2026-01-01", "09:00", "10:00"))).toBe(false);
  });
  it("conflictsFor returns the ids of all overlapping events, not the free ones", () => {
    const events = [
      timed("a", "2026-01-01", "09:00", "10:30"),
      timed("b", "2026-01-01", "10:00", "11:00"),
      timed("c", "2026-01-01", "12:00", "13:00"), // free
      { id: "d", date: "2026-01-01", allDay: true } // all-day, never conflicts
    ];
    const conflicted = conflictsFor(events);
    expect([...conflicted].sort()).toEqual(["a", "b"]);
  });
  it("no conflicts → empty set", () => {
    expect(conflictsFor([timed("a", "2026-01-01", "09:00", "10:00"), timed("b", "2026-01-01", "10:00", "11:00")]).size).toBe(0);
  });
});
