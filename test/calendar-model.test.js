import { describe, it, expect } from "vitest";
import { normalizePlanEvents } from "../calendar/model.js";

describe("normalizePlanEvents — canonical event boundary", () => {
  it("returns [] for non-arrays", () => {
    expect(normalizePlanEvents(null)).toEqual([]);
    expect(normalizePlanEvents(undefined)).toEqual([]);
    expect(normalizePlanEvents("x")).toEqual([]);
  });

  it("drops events missing a date or a title (the two required fields)", () => {
    const out = normalizePlanEvents([
      { id: "a", title: "No date" },
      { id: "b", date: "2026-01-01" }, // no title
      { id: "c", title: "Keep", date: "2026-01-01" }
    ]);
    expect(out.map((e) => e.id)).toEqual(["c"]);
  });

  it("preserves the full canonical shape with sensible defaults", () => {
    const [e] = normalizePlanEvents([{ id: "e1", title: "Meeting", date: "2026-01-02" }]);
    expect(e).toMatchObject({
      id: "e1",
      title: "Meeting",
      date: "2026-01-02",
      startTime: null,
      endTime: null,
      allDay: true, // defaults to all-day when not explicitly false
      color: null,
      calendarId: null,
      notes: "",
      location: null,
      attachment: null,
      recurrence: null,
      exceptions: [],
      addToDo: false,
      chores: [],
      showInMealPlan: false,
      reminder: null,
      endDate: null
    });
    expect(typeof e.createdAt).toBe("string");
  });

  it("trims strings and coerces times", () => {
    const [e] = normalizePlanEvents([{ title: "  Lunch  ", date: " 2026-01-02 ", startTime: " 12:00 ", endTime: " 13:00 ", allDay: false, notes: "  hi  " }]);
    expect(e.title).toBe("Lunch");
    expect(e.date).toBe("2026-01-02");
    expect(e.startTime).toBe("12:00");
    expect(e.endTime).toBe("13:00");
    expect(e.allDay).toBe(false);
    expect(e.notes).toBe("hi");
  });

  it("filters exceptions by date SHAPE (not calendar validity) and trims chores", () => {
    const [e] = normalizePlanEvents([{
      title: "R", date: "2026-01-01",
      recurrence: { freq: "weekly" },
      // The shape regex accepts anything YYYY-MM-DD; it does NOT range-check the
      // month/day, so "2026-13-40" survives while "nope" is dropped. Pinning the
      // faithful behavior rather than an idealized one.
      exceptions: ["2026-01-08", "nope", "2026-13-40"],
      chores: [" take out bins ", "", "  "]
    }]);
    expect(e.exceptions).toEqual(["2026-01-08", "2026-13-40"]);
    expect(e.chores).toEqual(["take out bins"]);
    expect(e.recurrence).toMatchObject({ freq: "weekly" });
  });

  it("keeps location/attachment only when they are objects", () => {
    const [e] = normalizePlanEvents([{ title: "T", date: "2026-01-01", location: "somewhere", attachment: { url: "x" } }]);
    expect(e.location).toBe(null);
    expect(e.attachment).toEqual({ url: "x" });
  });

  it("mints an id when one is missing", () => {
    const [e] = normalizePlanEvents([{ title: "T", date: "2026-01-01" }]);
    expect(typeof e.id).toBe("string");
    expect(e.id.length).toBeGreaterThan(0);
  });

  it("rejects a malformed endDate but keeps a valid one", () => {
    const [bad] = normalizePlanEvents([{ title: "T", date: "2026-01-01", endDate: "later" }]);
    expect(bad.endDate).toBe(null);
    const [good] = normalizePlanEvents([{ title: "T", date: "2026-01-01", endDate: "2026-01-03" }]);
    expect(good.endDate).toBe("2026-01-03");
  });
});
