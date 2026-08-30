import { describe, it, expect } from "vitest";
import { parsePlanIcs, parseIcsRrule, readIcsDatetime } from "../calendar/ics.mjs";

// Wrap VEVENT bodies in a VCALENDAR envelope.
const cal = (...vevents) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${vevents.map((v) => `BEGIN:VEVENT\r\n${v}\r\nEND:VEVENT`).join("\r\n")}\r\nEND:VCALENDAR`;

describe("parsePlanIcs — core iCal shapes", () => {
  it("all-day event via DTSTART;VALUE=DATE (no spurious endDate for a single day)", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260624\r\nDTEND;VALUE=DATE:20260625\r\nUID:a@x\r\nSUMMARY:Holiday"));
    expect(e).toMatchObject({ title: "Holiday", date: "2026-06-24", allDay: true, startTime: null, endDate: null });
  });
  it("multi-day all-day event: exclusive DTEND → inclusive last day as endDate", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260104\r\nUID:b@x\r\nSUMMARY:Trip"));
    expect(e).toMatchObject({ date: "2026-01-01", endDate: "2026-01-03", allDay: true });
  });
  it("floating timed event (no zone) keeps its wall-clock time", () => {
    const [e] = parsePlanIcs(cal("DTSTART:20260101T090000\r\nDTEND:20260101T103000\r\nUID:c@x\r\nSUMMARY:Meeting"));
    expect(e).toMatchObject({ date: "2026-01-01", startTime: "09:00", endTime: "10:30", allDay: false });
  });
  it("a UTC ('Z') time parses to a valid local HH:MM timed event", () => {
    const [e] = parsePlanIcs(cal("DTSTART:20260101T120000Z\r\nDTEND:20260101T130000Z\r\nUID:d@x\r\nSUMMARY:UTC call"));
    expect(e.allDay).toBe(false);
    expect(e.startTime).toMatch(/^\d{2}:\d{2}$/); // exact value is tz-dependent; shape is not
  });
  it("drops a VEVENT with no SUMMARY", () => {
    expect(parsePlanIcs(cal("DTSTART;VALUE=DATE:20260101\r\nUID:e@x"))).toEqual([]);
  });
  it("no VEVENTs → []", () => {
    expect(parsePlanIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR")).toEqual([]);
    expect(parsePlanIcs("")).toEqual([]);
  });
  it("unescapes commas/semicolons in SUMMARY", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260101\r\nUID:f@x\r\nSUMMARY:Clinic\\, AM\\; room 5"));
    expect(e.title).toBe("Clinic, AM; room 5");
  });
});

describe("parsePlanIcs — recurrence (RRULE)", () => {
  it("weekly BYDAY → sorted byWeekdays", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260105\r\nUID:g@x\r\nSUMMARY:Standup\r\nRRULE:FREQ=WEEKLY;BYDAY=WE,MO"));
    expect(e.recurrence).toMatchObject({ freq: "weekly", byWeekdays: [1, 3] });
  });
  it("monthly BYDAY=3FR → nth-weekday", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260116\r\nUID:h@x\r\nSUMMARY:Board\r\nRRULE:FREQ=MONTHLY;BYDAY=3FR"));
    expect(e.recurrence).toMatchObject({ freq: "monthly", monthMode: "nthWeekday", byWeekday: 5, bySetPos: 3 });
  });
  it("COUNT is converted to a derived until date", () => {
    // daily, 7 occurrences from Jan 1 → until Jan 7
    expect(parseIcsRrule("RRULE:FREQ=DAILY;COUNT=7;INTERVAL=1", "2026-01-01")).toMatchObject({ freq: "daily", interval: 1, until: "2026-01-07" });
  });
  it("EXDATE → exceptions", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260105\r\nUID:i@x\r\nSUMMARY:Class\r\nRRULE:FREQ=WEEKLY\r\nEXDATE:20260112,20260119"));
    expect(e.exceptions).toEqual(["2026-01-12", "2026-01-19"]);
  });
});

describe("Amion feed format (§12 — one parser for ICS + Amion)", () => {
  // Amion's on-call VCal endpoint emits exactly this shape: VALUE=DATE all-day or
  // UTC timed events, repetition as DAILY RRULE with COUNT, and ++-style UIDs.
  const amion = cal(
    "DTSTART;VALUE=DATE:20260624\r\nDTEND;VALUE=DATE:20260624\r\nRRULE:FREQ=DAILY;COUNT=7;INTERVAL=1\r\nUID:10767++0++426@amion.com\r\nTRANSP:TRANSPARENT\r\nDTSTAMP:20260822T111500Z\r\nSUMMARY:On-call A",
    "DTSTART:20260625T180000Z\r\nDTEND:20260625T220000Z\r\nRRULE:FREQ=DAILY;COUNT=3;INTERVAL=7\r\nUID:10768++11++458@amion.com\r\nTRANSP:TRANSPARENT\r\nSUMMARY:PM: Continuity Clinic",
    "DTSTART;VALUE=DATE:20260706\r\nDTEND;VALUE=DATE:20260706\r\nUID:10779++0++425@amion.com\r\nSUMMARY:PTO"
  );

  it("parses every Amion VEVENT with no malformed events", () => {
    const evs = parsePlanIcs(amion);
    expect(evs).toHaveLength(3);
    expect(evs.filter((e) => !e.title || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))).toHaveLength(0);
  });
  it("all-day on-call block with COUNT recurs for the right span, keeps the ++ UID", () => {
    const e = parsePlanIcs(amion).find((x) => x.uid.startsWith("10767"));
    expect(e).toMatchObject({ title: "On-call A", date: "2026-06-24", allDay: true });
    expect(e.recurrence).toMatchObject({ freq: "daily", interval: 1, until: "2026-06-30" }); // COUNT=7 → 7 days
    expect(e.uid).toBe("10767++0++426@amion.com");
  });
  it("a single-day all-day block (DTEND = DTSTART) gets no spurious endDate", () => {
    const e = parsePlanIcs(amion).find((x) => x.uid.startsWith("10779"));
    expect(e).toMatchObject({ title: "PTO", date: "2026-07-06", allDay: true, endDate: null });
  });
  it("timed on-call with interval-7 COUNT derives a 3-occurrence span", () => {
    const e = parsePlanIcs(amion).find((x) => x.uid.startsWith("10768"));
    expect(e.allDay).toBe(false);
    expect(e.recurrence).toMatchObject({ freq: "daily", interval: 7 }); // COUNT=3, every 7 days
  });
});

describe("readIcsDatetime", () => {
  it("reads an all-day VALUE=DATE", () => {
    expect(readIcsDatetime("DTSTART;VALUE=DATE:20260624", "DTSTART")).toEqual({ date: "2026-06-24", time: null, allDay: true });
  });
  it("returns null when the property is absent", () => {
    expect(readIcsDatetime("SUMMARY:x", "DTSTART")).toBe(null);
  });
});
