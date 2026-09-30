// TRV-1: day keys must be calendar dates independent of the device timezone.
// Pin a zone east of UTC BEFORE importing (Node re-reads process.env.TZ on
// assignment), then import the modules dynamically.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const prevTZ = process.env.TZ;
let itin, mode;

beforeAll(async () => {
  process.env.TZ = "Asia/Tokyo";
  itin = await import("../travel-itinerary.js");
  mode = await import("../travel-mode.js");
});
afterAll(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

describe("travel day keys east of UTC (TZ=Asia/Tokyo)", () => {
  it("the zone is actually pinned", () => {
    expect(new Date("2026-06-17T00:00:00").getTimezoneOffset()).toBe(-540);
  });

  it("tripDayKeys returns the trip's own calendar dates, not the day before", () => {
    expect(itin.tripDayKeys({ startDate: "2026-06-17", endDate: "2026-06-19" }))
      .toEqual(["2026-06-17", "2026-06-18", "2026-06-19"]);
  });

  it("spans a month end without skipping or repeating", () => {
    expect(itin.tripDayKeys({ startDate: "2026-02-27", endDate: "2026-03-02" }))
      .toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("Travel Mode recognizes local 'today' as the trip's first day", () => {
    const trip = {
      startDate: "2026-06-17", endDate: "2026-06-19",
      days: { "2026-06-17": { activities: [{ id: "a", itemType: "activity", name: "Museum", activityTime: "10:00" }] } },
    };
    const snap = mode.travelSnapshot(trip, new Date("2026-06-17T08:00:00"));
    expect(snap.dateKey).toBe("2026-06-17");
    expect(snap.dayNumber).toBe(1);
    expect(snap.next && snap.next.title).toBe("Museum");
  });
});
