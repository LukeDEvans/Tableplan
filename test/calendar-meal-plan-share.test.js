import { describe, expect, it } from "vitest";
import {
  buildSharedSnapshot, mealPlanDisplayEvents, mealPlanEventsFromScope, mergeMealPlanSharedEvents,
  normalizeMealPlanCalendarFlags, normalizeMealPlanSharedEvents, shareWindowStart, slimSharedEvent
} from "../calendar/meal-plan-share.js";

const NOW = new Date(2026, 9, 7, 12, 0); // Wed 7 Oct 2026
const work = {
  id: "work", title: "Work", date: "2026-08-24", allDay: false, startTime: "08:00", endTime: "16:00",
  recurrence: { freq: "weekly", interval: 1, byWeekdays: [1, 2, 3, 4] }, exceptions: [], showInMealPlan: true,
  notes: "private note", location: { name: "Clinic" }, chores: ["pack bag"]
};
const dentist = { id: "dentist", title: "Dentist", date: "2026-10-08", allDay: false, startTime: "12:00", endTime: "13:00", showInMealPlan: false };
const feed = { id: "cal-mj", name: "MJ Work", url: "https://example.test/feed.ics", color: "#e91e63", enabled: true };
const bucket = { id: "cal-luke", name: "Luke Work", url: "", color: "#0f9d58", enabled: true };
const shift = { uid: "s1", title: "Night", date: "2026-10-06", endDate: "2026-10-07", allDay: false, startTime: "19:00", endTime: "07:00" };
const oldShift = { uid: "s0", title: "Day", date: "2026-07-01", allDay: false, startTime: "07:00", endTime: "17:00" };
const cacheWith = (events) => (cal) => (cal.id === feed.id ? events : null);

describe("mealPlanEventsFromScope", () => {
  it("takes events ticked Meal Plan and leaves the rest", () => {
    const { events } = mealPlanEventsFromScope({ planEvents: [work, dentist] });
    expect(events.map((e) => e.id)).toEqual(["work"]);
  });

  it("takes every event of a calendar switched to Show on Meal Plan, coloured by the calendar", () => {
    const inBucket = { ...dentist, calendarId: bucket.id };
    const { events } = mealPlanEventsFromScope({ planEvents: [inBucket], planCalendars: [bucket], planMealPlanCalendars: { [bucket.id]: true } });
    expect(events).toHaveLength(1);
    expect(events[0].color).toBe("#0f9d58");
  });

  it("reads a switched-on subscribed feed from this device's cache", () => {
    const scope = { planCalendars: [feed], planMealPlanCalendars: { [feed.id]: true } };
    const { events, uncachedCalendarIds } = mealPlanEventsFromScope(scope, cacheWith([shift]));
    expect(uncachedCalendarIds).toEqual([]);
    expect(events[0]).toMatchObject({ id: "cal-mj:s1", title: "Night", external: true, calendarId: "cal-mj", color: "#e91e63" });
  });

  it("leaves a feed alone when it is not switched on, is hidden, or has no copy here", () => {
    expect(mealPlanEventsFromScope({ planCalendars: [feed] }, cacheWith([shift])).events).toEqual([]);
    const off = { planCalendars: [{ ...feed, enabled: false }], planMealPlanCalendars: { [feed.id]: true } };
    expect(mealPlanEventsFromScope(off, cacheWith([shift])).events).toEqual([]);
    const on = { planCalendars: [feed], planMealPlanCalendars: { [feed.id]: true } };
    expect(mealPlanEventsFromScope(on, () => null)).toEqual({ events: [], uncachedCalendarIds: ["cal-mj"] });
  });

  it("honours a feed event hidden or renamed on the Calendar", () => {
    const scope = {
      planCalendars: [feed], planMealPlanCalendars: { [feed.id]: true },
      planExternalExclusions: [{ id: "cal-mj:s0", hidden: true }],
      planExternalOverrides: [{ id: "cal-mj:s1", title: "MJ nights" }]
    };
    const { events } = mealPlanEventsFromScope(scope, cacheWith([shift, oldShift]));
    expect(events.map((e) => e.title)).toEqual(["MJ nights"]);
  });
});

describe("buildSharedSnapshot", () => {
  it("copies only what the meal plan needs", () => {
    const { events } = buildSharedSnapshot({ planEvents: [work] }, { now: NOW });
    expect(events).toEqual([{
      id: "work", title: "Work", date: "2026-08-24", endDate: null, allDay: false, startTime: "08:00", endTime: "16:00",
      recurrence: expect.objectContaining({ freq: "weekly", byWeekdays: [1, 2, 3, 4] }), exceptions: [], color: null
    }]);
    expect(JSON.stringify(events)).not.toContain("private note");
    expect(JSON.stringify(events)).not.toContain("Clinic");
  });

  it("keeps only events inside the window, in a stable order", () => {
    const scope = { planEvents: [work], planCalendars: [feed], planMealPlanCalendars: { [feed.id]: true } };
    const first = buildSharedSnapshot(scope, { cacheFor: cacheWith([shift, oldShift]), now: NOW });
    const second = buildSharedSnapshot({ ...scope, planEvents: [work] }, { cacheFor: cacheWith([oldShift, shift]), now: new Date(2026, 9, 9) });
    expect(first.windowStart).toBe("2026-09-27");
    expect(first.events.map((e) => e.id)).toEqual(["cal-mj:s1", "work"]);
    expect(second).toEqual(first); // same week, same data → same copy
    expect(shareWindowStart(new Date(2026, 9, 11))).toBe("2026-10-04"); // the window moves on Sunday
  });

  it("drops a repeating event that ended before the window", () => {
    const ended = { ...work, recurrence: { ...work.recurrence, until: "2026-09-01" } };
    expect(buildSharedSnapshot({ planEvents: [ended] }, { now: NOW }).events).toEqual([]);
  });

  it("keeps the previous copy of a feed this device has not fetched", () => {
    const scope = { planCalendars: [feed], planMealPlanCalendars: { [feed.id]: true } };
    const previous = buildSharedSnapshot(scope, { cacheFor: cacheWith([shift]), now: NOW });
    const here = buildSharedSnapshot(scope, { cacheFor: () => null, previous, now: NOW });
    expect(here.events).toEqual(previous.events);
    // …but not once the calendar is switched off.
    const offNow = buildSharedSnapshot({ planCalendars: [feed], planMealPlanCalendars: { [feed.id]: false } }, { cacheFor: () => null, previous, now: NOW });
    expect(offNow.events).toEqual([]);
  });
});

describe("mergeMealPlanSharedEvents", () => {
  const entry = (updatedAt, title) => ({ updatedAt, windowStart: "2026-09-27", events: [slimSharedEvent({ ...work, title })] });
  it("keeps every member and takes each member's later copy", () => {
    const merged = mergeMealPlanSharedEvents(
      { luke: entry("2026-10-07T10:00:00Z", "Work (old)") },
      { luke: entry("2026-10-07T12:00:00Z", "Work"), mj: entry("2026-10-01T00:00:00Z", "Clinic") }
    );
    expect(merged.luke.events[0].title).toBe("Work");
    expect(merged.mj.events[0].title).toBe("Clinic");
  });
  it("tolerates missing or malformed input", () => {
    expect(mergeMealPlanSharedEvents(undefined, null)).toEqual({});
    expect(normalizeMealPlanSharedEvents({ luke: { events: [{ id: "x" }, null] } }).luke.events).toEqual([]);
    expect(normalizeMealPlanCalendarFlags({ a: true, b: "yes", "": true })).toEqual({ a: true });
  });
});

describe("mealPlanDisplayEvents", () => {
  const shared = {
    luke: { updatedAt: "t", windowStart: "2026-09-27", events: [slimSharedEvent(work), slimSharedEvent({ ...shift, id: "cal-mj:s1", external: true, calendarId: "cal-mj" })] }
  };

  it("shows another member what was shared, marked with whose it is", () => {
    const events = mealPlanDisplayEvents([{ events: [], uncachedCalendarIds: [] }], shared, "mj");
    expect(events.map((e) => [e.id, e.sharedBy])).toEqual([["work", "luke"], ["cal-mj:s1", "luke"]]);
  });

  it("shows the owner their live events, not their own snapshot", () => {
    const live = [{ events: [{ ...work, title: "Work (edited)" }], uncachedCalendarIds: [] }];
    const events = mealPlanDisplayEvents(live, shared, "luke");
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Work (edited)");
    expect(events[0].sharedBy).toBeUndefined();
  });

  it("fills in the owner's own feed from the snapshot only where this device has no copy", () => {
    const live = [{ events: [work], uncachedCalendarIds: ["cal-mj"] }];
    expect(mealPlanDisplayEvents(live, shared, "luke").map((e) => e.id)).toEqual(["work", "cal-mj:s1"]);
  });

  it("lists an event once when both Calendar views hold it", () => {
    const live = [{ events: [work], uncachedCalendarIds: [] }, { events: [work], uncachedCalendarIds: [] }];
    expect(mealPlanDisplayEvents(live, {}, "")).toHaveLength(1);
  });
});
