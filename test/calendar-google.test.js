process.env.TZ = "America/Chicago";
import { describe, it, expect } from "vitest";
import {
  googleCalendarIdFromIcalUrl, appCalendarIdForGoogle, proposeGoogleLinks,
  googleEventToCacheEntries, applyGoogleEvents, storeToCacheEntries,
  toGooglePrivateProps, fromGooglePrivateProps,
  parseRrule, exdatesFromRecurrence, googleRecurrenceToApp,
  convertGoogleCalendar, buildSeveranceReport,
  googleEventToFeedEvent
} from "../calendar/google.js";
import { feedEventsFor } from "../calendar/google-client.js";
import { mealPlanEventsFromScope, buildSharedSnapshot } from "../calendar/meal-plan-share.js";

const CAL = { id: "cal-1", name: "Family", color: "#3366ff" };

describe("linking", () => {
  it("extracts the calendar id from secret and public iCal URLs", () => {
    expect(googleCalendarIdFromIcalUrl("https://calendar.google.com/calendar/ical/luke%40gmail.com/private-abc123/basic.ics")).toBe("luke@gmail.com");
    expect(googleCalendarIdFromIcalUrl("https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics")).toBe("abc@group.calendar.google.com");
    expect(googleCalendarIdFromIcalUrl("https://example.com/calendar/ical/x/basic.ics")).toBe("");
    expect(googleCalendarIdFromIcalUrl("not a url")).toBe("");
  });

  it("mints a deterministic, salt-sensitive app id", () => {
    const a = appCalendarIdForGoogle("luke@gmail.com");
    expect(a).toMatch(/^gcal-[0-9a-f]{16}$/);
    expect(appCalendarIdForGoogle("luke@gmail.com")).toBe(a);
    expect(appCalendarIdForGoogle("wife@gmail.com")).not.toBe(a);
    expect(appCalendarIdForGoogle("luke@gmail.com", "re-add-1")).not.toBe(a);
  });

  it("keeps legacy iCal app ids, auto-links owned/writable calendars, skips read-only and known ones", () => {
    const google = [
      { id: "luke@gmail.com", accessRole: "owner" },
      { id: "wife@gmail.com", accessRole: "writer" },
      { id: "holidays@group.v.calendar.google.com", accessRole: "reader" },
      { id: "birthdays@group", accessRole: "reader" },
      { id: "declined@group", accessRole: "owner" }
    ];
    const links = [{ googleCalendarId: "declined@group", appCalendarId: "gcal-x", enabled: false }];
    const state = [
      { id: "cal-legacy", url: "https://calendar.google.com/calendar/ical/luke%40gmail.com/private-1/basic.ics" },
      { id: "cal-bday", url: "https://calendar.google.com/calendar/ical/birthdays%40group/private-2/basic.ics" }
    ];
    const proposed = proposeGoogleLinks(google, links, state);
    expect(proposed).toEqual([
      { googleCalendarId: "luke@gmail.com", appCalendarId: "cal-legacy", reason: "ical-match" },
      { googleCalendarId: "wife@gmail.com", appCalendarId: appCalendarIdForGoogle("wife@gmail.com"), reason: "auto" },
      { googleCalendarId: "birthdays@group", appCalendarId: "cal-bday", reason: "ical-match" }
    ]);
  });
});

describe("live display mapping", () => {
  it("maps a timed event to local date + times", () => {
    const [e] = googleEventToCacheEntries({
      id: "e1", summary: "Work shift",
      start: { dateTime: "2026-10-13T08:00:00-05:00" }, end: { dateTime: "2026-10-13T16:00:00-05:00" }
    }, CAL);
    expect(e).toMatchObject({ summary: "Work shift", date: "2026-10-13", allDay: false, startTime: "08:00", endTime: "16:00", endDate: null, gid: "e1", calendarId: "cal-1", calendarColor: "#3366ff", recursYearly: false });
  });

  it("converts other time zones into local time", () => {
    const [e] = googleEventToCacheEntries({ id: "e2", summary: "Call", start: { dateTime: "2026-10-13T14:00:00Z" }, end: { dateTime: "2026-10-13T15:00:00Z" } }, CAL);
    expect(e).toMatchObject({ date: "2026-10-13", startTime: "09:00", endTime: "10:00" });
  });

  it("expands multi-day all-day events per day using Google's exclusive end", () => {
    const entries = googleEventToCacheEntries({ id: "trip", summary: "Trip", start: { date: "2026-10-16" }, end: { date: "2026-10-19" } }, CAL);
    expect(entries.map((e) => e.date)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(entries.every((e) => e.allDay && e.endDate === "2026-10-18")).toBe(true);
    const single = googleEventToCacheEntries({ id: "d", summary: "Day", start: { date: "2026-10-16" }, end: { date: "2026-10-17" } }, CAL);
    expect(single).toHaveLength(1);
    expect(single[0].endDate).toBeNull();
  });

  it("keeps overnight timed events on their start day with an endDate", () => {
    const [e] = googleEventToCacheEntries({ id: "n", summary: "Night shift", start: { dateTime: "2026-10-13T19:00:00-05:00" }, end: { dateTime: "2026-10-14T07:00:00-05:00" } }, CAL);
    expect(e).toMatchObject({ date: "2026-10-13", startTime: "19:00", endTime: null, endDate: "2026-10-14" });
  });

  it("drops cancelled and start-less events; untitled events get a label", () => {
    expect(googleEventToCacheEntries({ id: "c", status: "cancelled", start: { date: "2026-10-13" } }, CAL)).toEqual([]);
    expect(googleEventToCacheEntries({ id: "x" }, CAL)).toEqual([]);
    expect(googleEventToCacheEntries({ id: "u", start: { date: "2026-10-13" }, end: { date: "2026-10-14" } }, CAL)[0].summary).toBe("(No title)");
  });

  it("applies full replacements and updatedMin deltas (cancelled deletes)", () => {
    let store = applyGoogleEvents(null, [{ id: "a", summary: "A", start: { date: "2026-10-13" } }, { id: "b", summary: "B", start: { date: "2026-10-14" } }], { full: true });
    store = applyGoogleEvents(store, [{ id: "a", status: "cancelled" }, { id: "c", summary: "C", start: { date: "2026-10-15" } }]);
    expect(Object.keys(store.events).sort()).toEqual(["b", "c"]);
    store = applyGoogleEvents(store, [{ id: "z", summary: "Z", start: { date: "2026-10-20" } }], { full: true });
    expect(Object.keys(store.events)).toEqual(["z"]);
    expect(storeToCacheEntries(store, CAL)[0]).toMatchObject({ summary: "Z", calendarId: "cal-1" });
  });
});

describe("app-only fields round-trip through extendedProperties.private", () => {
  it("round-trips every app-only field", () => {
    const ev = { id: "plan-evt-1", showInMealPlan: true, addToDo: true, chores: ["Pack lunches", " "], color: "#ff0000", attachment: { name: "a.pdf", url: "https://x" }, location: { name: "Park", address: "1 Main" } };
    const props = toGooglePrivateProps(ev);
    expect(Object.values(props).every((v) => typeof v === "string")).toBe(true);
    expect(fromGooglePrivateProps(props)).toEqual({ id: "plan-evt-1", showInMealPlan: true, addToDo: true, chores: ["Pack lunches"], color: "#ff0000", attachment: { name: "a.pdf", url: "https://x" }, location: { name: "Park", address: "1 Main" } });
  });
  it("tolerates missing or corrupt props", () => {
    expect(fromGooglePrivateProps(undefined)).toMatchObject({ id: null, showInMealPlan: false, chores: [], attachment: null });
    expect(fromGooglePrivateProps({ tpChores: "{bad" }).chores).toEqual([]);
  });
});

describe("RRULE → app recurrence", () => {
  it("parses parts", () => {
    expect(parseRrule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2")).toEqual({ FREQ: "WEEKLY", BYDAY: "MO,WE", INTERVAL: "2" });
  });
  it("reads EXDATE in all common shapes", () => {
    expect(exdatesFromRecurrence([
      "RRULE:FREQ=DAILY",
      "EXDATE;VALUE=DATE:20261014,20261016",
      "EXDATE;TZID=America/Chicago:20261020T080000",
      "EXDATE:20261022T130000Z"
    ])).toEqual(["2026-10-14", "2026-10-16", "2026-10-20", "2026-10-22"]);
  });
  it("converts the rules a family calendar uses", () => {
    expect(googleRecurrenceToApp(["RRULE:FREQ=DAILY"], "2026-10-12").recurrence).toMatchObject({ freq: "daily", interval: 1 });
    expect(googleRecurrenceToApp(["RRULE:FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2"], "2026-10-13").recurrence).toMatchObject({ freq: "weekly", interval: 2, byWeekdays: [2, 4] });
    expect(googleRecurrenceToApp(["RRULE:FREQ=MONTHLY;BYDAY=3FR"], "2026-10-16").recurrence).toMatchObject({ freq: "monthly", monthMode: "nthWeekday", byWeekday: 5, bySetPos: 3 });
    expect(googleRecurrenceToApp(["RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1"], "2026-10-30").recurrence).toMatchObject({ monthMode: "nthWeekday", byWeekday: 5, bySetPos: -1 });
    expect(googleRecurrenceToApp(["RRULE:FREQ=MONTHLY;BYMONTHDAY=12"], "2026-10-12").recurrence).toMatchObject({ freq: "monthly", monthMode: "dayOfMonth" });
    expect(googleRecurrenceToApp(["RRULE:FREQ=YEARLY"], "2026-10-12").recurrence).toMatchObject({ freq: "yearly", monthMode: "dayOfMonth" });
    expect(googleRecurrenceToApp(["RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH"], "2026-11-26").recurrence).toMatchObject({ freq: "yearly", monthMode: "nthWeekday", byWeekday: 4, bySetPos: 4 });
    expect(googleRecurrenceToApp(["RRULE:FREQ=WEEKLY;UNTIL=20261231T055959Z"], "2026-10-12").recurrence.until).toBe("2026-12-30");
    expect(googleRecurrenceToApp(["RRULE:FREQ=WEEKLY;COUNT=10"], "2026-10-12").recurrence).toMatchObject({ count: 10, until: "2026-12-14" });
    expect(googleRecurrenceToApp(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261019"], "2026-10-12").exceptions).toEqual(["2026-10-19"]);
  });
  it("flags what the app engine can't express", () => {
    expect(googleRecurrenceToApp(["RRULE:FREQ=HOURLY"], "2026-10-12").unsupported).toMatch(/hourly/);
    expect(googleRecurrenceToApp(["RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15"], "2026-10-01").unsupported).toMatch(/several days/);
    expect(googleRecurrenceToApp(["RRULE:FREQ=MONTHLY;BYDAY=MO,WE"], "2026-10-12").unsupported).toMatch(/several weekdays/);
    expect(googleRecurrenceToApp(["RRULE:FREQ=DAILY;BYHOUR=9"], "2026-10-12").unsupported).toMatch(/BYHOUR/);
    expect(googleRecurrenceToApp(["RRULE:FREQ=DAILY", "RDATE:20261101"], "2026-10-12").unsupported).toMatch(/RDATE/);
    expect(googleRecurrenceToApp(["RRULE:FREQ=MONTHLY;BYMONTHDAY=5"], "2026-10-12").unsupported).toMatch(/differs/);
  });
});

describe("severance conversion + dry-run report", () => {
  const items = [
    { id: "single", summary: "Dentist", start: { dateTime: "2026-10-20T09:00:00-05:00" }, end: { dateTime: "2026-10-20T10:00:00-05:00" },
      extendedProperties: { private: { tpEventId: "plan-evt-9", tpShowInMealPlan: "1", tpChores: '["Bring forms"]' } } },
    { id: "soccer", summary: "Soccer", start: { dateTime: "2026-10-14T17:30:00-05:00" }, end: { dateTime: "2026-10-14T18:30:00-05:00" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], attendees: [{ email: "me", self: true }, { email: "coach@x" }] },
    { id: "soccer_20261021", recurringEventId: "soccer", status: "cancelled", originalStartTime: { dateTime: "2026-10-21T17:30:00-05:00" } },
    { id: "soccer_20261028", recurringEventId: "soccer", summary: "Soccer (moved)", originalStartTime: { dateTime: "2026-10-28T17:30:00-05:00" },
      start: { dateTime: "2026-10-29T17:30:00-05:00" }, end: { dateTime: "2026-10-29T18:30:00-05:00" } },
    { id: "odd", summary: "Bills", start: { date: "2026-11-01" }, end: { date: "2026-11-02" }, recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15"] },
    { id: "gone", summary: "Old", status: "cancelled", start: { date: "2026-01-01" } }
  ];

  it("converts singles, series, cancelled and moved occurrences; restores app-only fields", () => {
    const { events, issues, stats } = convertGoogleCalendar(items, { appCalendarId: "cal-1", calendarName: "Family" });
    expect(stats).toMatchObject({ singles: 1, series: 1, movedOccurrences: 1, cancelledOccurrences: 1, guests: 1 });
    const dentist = events.find((e) => e.title === "Dentist");
    expect(dentist).toMatchObject({ id: "plan-evt-9", date: "2026-10-20", startTime: "09:00", endTime: "10:00", allDay: false, showInMealPlan: true, chores: ["Bring forms"], calendarId: "cal-1" });
    const soccer = events.find((e) => e.title === "Soccer");
    expect(soccer.recurrence).toMatchObject({ freq: "weekly", byWeekdays: [3] });
    expect(soccer.exceptions).toEqual(["2026-10-21", "2026-10-28"]);
    expect(events.find((e) => e.title === "Soccer (moved)")).toMatchObject({ date: "2026-10-29", startTime: "17:30", recurrence: null });
    expect(issues).toEqual([{ calendar: "Family", title: "Bills", reason: expect.stringMatching(/several days.*individual events/) }]);
    expect(events.some((e) => e.title === "Old")).toBe(false);
  });

  it("summarises across calendars", () => {
    const report = buildSeveranceReport([
      { name: "Family", appCalendarId: "cal-1", items },
      { name: "Work", appCalendarId: "cal-2", items: [{ id: "w", summary: "Standup", start: { dateTime: "2026-10-13T09:00:00-05:00" }, end: { dateTime: "2026-10-13T09:15:00-05:00" }, hangoutLink: "https://meet" }] }
    ]);
    expect(report.clean).toBe(false);
    expect(report.totals).toMatchObject({ singles: 2, series: 1, meetLinks: 1, guests: 1, events: 4 });
    expect(report.perCalendar.map((c) => [c.name, c.events, c.issues])).toEqual([["Family", 3, 1], ["Work", 1, 0]]);
  });
});

describe("Google calendars on the meal plan (Show on Meal Plan)", () => {
  const cache = { "gcal-1": { events: {
    shift: { id: "shift", summary: "Work shift", start: { dateTime: "2026-10-13T08:00:00-05:00" }, end: { dateTime: "2026-10-13T16:00:00-05:00" } },
    trip: { id: "trip", summary: "Trip", start: { date: "2026-10-16" }, end: { date: "2026-10-19" } },
    gone: { id: "gone", status: "cancelled" }
  } } };
  const cal = { id: "gcal-1", name: "Luke", color: "#9fe1e7", enabled: true, googleCalendarId: "luke@gmail.com", url: "" };

  it("keeps multi-day events whole with an inclusive end date", () => {
    expect(googleEventToFeedEvent(cache["gcal-1"].events.trip)).toEqual({ uid: "trip", title: "Trip", date: "2026-10-16", allDay: true, startTime: null, endTime: null, endDate: "2026-10-18" });
    expect(feedEventsFor(cal, cache)).toHaveLength(2);
    expect(feedEventsFor({ id: "other" }, cache)).toBeNull();
  });

  it("a switched-on Google calendar puts timed events on the meal plan; switched-off or iCal-only ones don't", () => {
    const scope = { calendars: [cal, { id: "ical-only", url: "https://x", enabled: true }], planCalendars: [], planEvents: [], planMealPlanCalendars: { "gcal-1": true, "ical-only": true } };
    const { events, uncachedCalendarIds } = mealPlanEventsFromScope(scope, (c) => feedEventsFor(c, cache));
    expect(uncachedCalendarIds).toEqual([]);
    const shift = events.find((e) => e.title === "Work shift");
    expect(shift).toMatchObject({ id: "gcal-1:shift", date: "2026-10-13", startTime: "08:00", endTime: "16:00", allDay: false, external: true, color: "#9fe1e7" });
    expect(events.some((e) => e.calendarId === "ical-only")).toBe(false);
    expect(mealPlanEventsFromScope({ ...scope, planMealPlanCalendars: {} }, (c) => feedEventsFor(c, cache)).events).toEqual([]);
  });

  it("a switched-on Google calendar this device hasn't fetched keeps the previous shared copy", () => {
    const scope = { calendars: [cal], planCalendars: [], planEvents: [], planMealPlanCalendars: { "gcal-1": true } };
    const previous = { events: [{ id: "gcal-1:shift", title: "Work shift", date: "2026-10-13", allDay: false, startTime: "08:00", endTime: "16:00", external: true, calendarId: "gcal-1" }] };
    const snap = buildSharedSnapshot(scope, { cacheFor: () => null, previous, now: new Date("2026-10-12T12:00:00") });
    expect(snap.events.map((e) => e.id)).toEqual(["gcal-1:shift"]);
  });
});
