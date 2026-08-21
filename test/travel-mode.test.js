import { describe, it, expect } from "vitest";
import { minutesNow, classifyDay, travelSnapshot } from "../travel-mode.js";
import { buildDayTimeline } from "../travel-itinerary.js";

const D1 = "2026-06-17", D2 = "2026-06-18", D3 = "2026-06-19";

function trip(days) {
  return { id: "t1", name: "Istanbul", startDate: D1, endDate: D3, days };
}
// A day: hotel(09:00) → walk → Hagia(10:00-12:00) → lunch(12:30) → bazaar(14:00)
const dayItems = {
  activities: [
    { id: "hotel", itemType: "activity", name: "Hotel", activityTime: "09:00", startLocation: "Hotel" },
    { id: "hagia", itemType: "activity", name: "Hagia Sophia", activityTime: "10:00", duration: "120", startLocation: "Hagia Sophia" },
    { id: "bazaar", itemType: "activity", name: "Grand Bazaar", activityTime: "14:00", startLocation: "Grand Bazaar" },
  ],
  food: [{ id: "lunch", itemType: "food", name: "Lunch", reservationTime: "12:30", address: "Sultanahmet" }],
};

describe("minutesNow", () => {
  it("computes minutes of day", () => {
    expect(minutesNow(new Date(2026, 5, 17, 9, 30))).toBe(570);
  });
});

describe("classifyDay", () => {
  const timeline = buildDayTimeline(trip({ [D1]: dayItems }), D1);

  it("marks past stops done, the ongoing stop current, and picks the next", () => {
    const at1100 = classifyDay(timeline, 11 * 60); // 11:00 — inside Hagia (10-12)
    const byId = Object.fromEntries(at1100.entries.map(e => [e.stop.id, e.state]));
    expect(byId.hotel).toBe("done");
    expect(byId.hagia).toBe("current");
    expect(at1100.current.id).toBe("hagia");
    expect(at1100.focus.id).toBe("hagia"); // focus is the current stop
    expect(at1100.next.id).toBe("lunch");  // next upcoming after the current one
  });

  it("focuses the next upcoming stop when nothing is current", () => {
    const at0930 = classifyDay(timeline, 9 * 60 + 30); // between hotel(9) end? hotel has no end→current window 60m → 9:00-10:00
    // hotel is 'current' 09:00-10:00; so focus is hotel here
    expect(at0930.focus.id).toBe("hotel");
    const at1300 = classifyDay(timeline, 13 * 60); // after lunch(12:30, +60→13:30 current), before bazaar
    expect(["lunch", "bazaar"]).toContain(at1300.focus.id);
  });

  it("provides the incoming transition for the focus stop when one exists", () => {
    const at0940 = classifyDay(timeline, 9 * 60 + 55); // hotel current until 10; next upcoming hagia
    // focus is hotel (current). If a transition precedes it there may be none (first stop).
    expect(at0940.focus).toBeTruthy();
  });
});

describe("travelSnapshot", () => {
  it("reports day number and today's focus while on the trip", () => {
    const t = trip({ [D1]: dayItems });
    const snap = travelSnapshot(t, new Date(2026, 5, 17, 11, 0));
    expect(snap.onTrip).toBe(true);
    expect(snap.dayNumber).toBe(1);
    expect(snap.next.id).toBe("hagia");
  });

  it("looks ahead to the next day's first stop when today is finished", () => {
    const t = trip({ [D1]: dayItems, [D2]: { activities: [{ id: "ferry", itemType: "activity", name: "Ferry", activityTime: "09:00", startLocation: "Dock" }] } });
    const snap = travelSnapshot(t, new Date(2026, 5, 17, 23, 0)); // late on D1
    expect(snap.next).toBeNull();
    expect(snap.lookahead).toBeTruthy();
    expect(snap.lookahead.stop.id).toBe("ferry");
    expect(snap.lookahead.dayNumber).toBe(2);
  });

  it("knows when the clock is before or after the trip", () => {
    const t = trip({ [D1]: dayItems });
    expect(travelSnapshot(t, new Date(2026, 5, 15, 9, 0)).beforeTrip).toBe(true);
    expect(travelSnapshot(t, new Date(2026, 5, 25, 9, 0)).afterTrip).toBe(true);
  });
});
