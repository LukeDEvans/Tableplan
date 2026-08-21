import { describe, it, expect } from "vitest";
import {
  timeToMinutes, addMinutes, orderStops, collectDayStops, buildDayTimeline,
  tripDayKeys, daySummary,
} from "../travel-itinerary.js";

// Minimal trip fixtures using the real storage shape: trip.days[dateKey][section][]
function trip(days, extra = {}) {
  return { id: "t1", name: "Trip", startDate: "2026-06-17", endDate: "2026-06-19", days, ...extra };
}

const D1 = "2026-06-17", D2 = "2026-06-18", D3 = "2026-06-19";

describe("time helpers", () => {
  it("parses HH:MM and rejects junk", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes("noon")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
  });
  it("adds minutes with wraparound", () => {
    expect(addMinutes("09:00", 90)).toBe("10:30");
    expect(addMinutes("23:30", 60)).toBe("00:30");
    expect(addMinutes("", 30)).toBe("");
  });
});

describe("collectDayStops", () => {
  it("returns [] for an empty day (an opportunity, not an error)", () => {
    expect(collectDayStops(trip({ [D1]: {} }), D1)).toEqual([]);
    expect(collectDayStops(trip({}), D1)).toEqual([]);
  });

  it("normalizes activities, food and lodging into stops", () => {
    const t = trip({
      [D1]: {
        activities: [{ id: "a1", itemType: "activity", name: "Hagia Sophia", activityTime: "10:00", duration: "120", startLocation: "Hagia Sophia" }],
        food: [{ id: "f1", itemType: "food", name: "Lunch", reservationTime: "12:30", address: "Sultanahmet" }],
        lodging: [{ id: "l1", itemType: "lodging", name: "Hotel", checkInDate: D1, checkInTime: "15:00", address: "Hotel Istanbul" }],
      },
    });
    const stops = collectDayStops(t, D1);
    expect(stops.map(s => s.type)).toContain("activity");
    const a = stops.find(s => s.type === "activity");
    expect(a.endTime).toBe("12:00"); // 10:00 + 120m
    expect(a.location).toBe("Hagia Sophia");
  });

  it("surfaces arriving legs and check-outs owned by other days", () => {
    const t = trip({
      [D1]: { travel: [{ id: "leg1", mode: "airplane", from: "JFK", to: "IST", departDate: D1, departTime: "20:00", arriveDate: D2, arriveTime: "13:00" }] },
      [D2]: {},
    });
    const d2 = collectDayStops(t, D2);
    const arrive = d2.find(s => s.type === "leg" && s.legRole === "arrive");
    expect(arrive).toBeTruthy();
    expect(arrive.time).toBe("13:00");
  });
});

describe("orderStops", () => {
  it("timed before untimed; untimed by dayOrder", () => {
    const stops = [
      { type: "food", time: null, raw: { dayOrder: 2 } },
      { type: "activity", time: "09:00", raw: {} },
      { type: "activity", time: null, raw: { dayOrder: 1 } },
    ];
    const ordered = orderStops(stops);
    expect(ordered[0].time).toBe("09:00");
    expect(ordered[1].raw.dayOrder).toBe(1);
    expect(ordered[2].raw.dayOrder).toBe(2);
  });
});

describe("buildDayTimeline transitions", () => {
  it("emits an open transition between two located, differently-placed stops", () => {
    const t = trip({
      [D1]: {
        activities: [
          { id: "a1", itemType: "activity", name: "Hagia Sophia", activityTime: "10:00", startLocation: "Hagia Sophia, Istanbul" },
          { id: "a2", itemType: "activity", name: "Grand Bazaar", activityTime: "14:00", startLocation: "Grand Bazaar, Istanbul" },
        ],
      },
    });
    const tl = buildDayTimeline(t, D1);
    const trans = tl.filter(e => e.kind === "transition");
    expect(trans).toHaveLength(1);
    expect(trans[0].planned).toBe(false);
    expect(trans[0].fromLocation).toContain("Hagia Sophia");
    expect(trans[0].toLocation).toContain("Grand Bazaar");
  });

  it("marks a transition planned when an explicit leg bridges it", () => {
    const t = trip({
      [D1]: {
        activities: [
          { id: "a1", itemType: "activity", name: "Hotel", activityTime: "09:00", startLocation: "Hotel Istanbul" },
          { id: "a2", itemType: "activity", name: "Hagia Sophia", activityTime: "10:00", startLocation: "Hagia Sophia" },
        ],
        travel: [{ id: "leg1", mode: "walk", from: "Hotel Istanbul", to: "Hagia Sophia", departTime: "09:40" }],
      },
    });
    const tl = buildDayTimeline(t, D1);
    const trans = tl.filter(e => e.kind === "transition");
    // The leg is both a stop (depart) and the bridge; at least one transition is planned.
    expect(trans.some(x => x.planned)).toBe(true);
  });

  it("no transition between stops at the same place", () => {
    const t = trip({
      [D1]: {
        activities: [{ id: "a1", itemType: "activity", name: "Museum", activityTime: "10:00", startLocation: "Louvre" }],
        food: [{ id: "f1", itemType: "food", name: "Cafe", reservationTime: "12:00", address: "Louvre" }],
      },
    });
    expect(buildDayTimeline(t, D1).filter(e => e.kind === "transition")).toHaveLength(0);
  });

  it("stops with no location produce no transition but still render", () => {
    const t = trip({
      [D1]: {
        activities: [
          { id: "a1", itemType: "activity", name: "Rest", activityTime: "10:00" },
          { id: "a2", itemType: "activity", name: "Walk", activityTime: "14:00", startLocation: "Park" },
        ],
      },
    });
    const tl = buildDayTimeline(t, D1);
    expect(tl.filter(e => e.kind === "stop")).toHaveLength(2);
    expect(tl.filter(e => e.kind === "transition")).toHaveLength(0);
  });

  it("is read-only — never mutates the trip", () => {
    const t = trip({ [D1]: { activities: [{ id: "a1", itemType: "activity", name: "X", activityTime: "10:00", startLocation: "A" }] } });
    const snapshot = JSON.stringify(t);
    buildDayTimeline(t, D1);
    daySummary(t, D1);
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});

describe("cancelled items", () => {
  it("are dropped from the plan (kept as history in the store)", () => {
    const t = trip({ [D1]: { activities: [
      { id: "a1", itemType: "activity", name: "Live", activityTime: "10:00", startLocation: "A" },
      { id: "a2", itemType: "activity", name: "Cancelled", activityTime: "14:00", startLocation: "B", cancelled: true },
    ] } });
    const stops = collectDayStops(t, D1);
    expect(stops.map(s => s.title)).toEqual(["Live"]);
    // still present in the raw store
    expect(t.days[D1].activities).toHaveLength(2);
  });
});

describe("tripDayKeys", () => {
  it("returns inclusive day list", () => {
    expect(tripDayKeys(trip({}))).toEqual([D1, D2, D3]);
  });
  it("returns [] for an idea trip with no dates", () => {
    expect(tripDayKeys({ id: "x", name: "Germany" })).toEqual([]);
    expect(tripDayKeys({ startDate: "2026-06-19", endDate: "2026-06-17" })).toEqual([]);
  });
});

describe("daySummary", () => {
  it("counts stops and open transitions; flags empty days", () => {
    const t = trip({
      [D1]: {
        activities: [
          { id: "a1", itemType: "activity", name: "A", activityTime: "10:00", startLocation: "P1" },
          { id: "a2", itemType: "activity", name: "B", activityTime: "14:00", startLocation: "P2" },
        ],
      },
      [D2]: {},
    });
    const s1 = daySummary(t, D1);
    expect(s1.activities).toBe(2);
    expect(s1.openTransitions).toBe(1);
    expect(s1.isEmpty).toBe(false);
    expect(daySummary(t, D2).isEmpty).toBe(true);
  });
});
