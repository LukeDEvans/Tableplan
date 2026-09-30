import { describe, it, expect } from "vitest";
import { parsePlanIcs, parseIcsRrule, readIcsDatetime } from "../calendar/ics.mjs";
import { expandRecurringOccurrences, planNthOccurrenceDate } from "../calendar/recurrence.js";

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

// ── Audit fixes (CAL-1/2/3/4/19) ────────────────────────────────────────────
const LA = { timeZone: "America/Los_Angeles" };

describe("CAL-1 — Z/TZID datetimes convert into the viewer's timeZone", () => {
  it("Z near midnight lands on the viewer's (LA) previous day", () => {
    const [e] = parsePlanIcs(cal("DTSTART:20260115T020000Z\r\nDTEND:20260115T030000Z\r\nUID:z@x\r\nSUMMARY:Late call"), LA);
    expect(e).toMatchObject({ date: "2026-01-14", startTime: "18:00", endTime: "19:00", endDate: null, allDay: false });
  });
  it("Z in summer uses PDT (-7)", () => {
    const [e] = parsePlanIcs(cal("DTSTART:20260701T170000Z\r\nUID:s@x\r\nSUMMARY:Summer"), LA);
    expect(e).toMatchObject({ date: "2026-07-01", startTime: "10:00" });
  });
  it("TZID wall time converts zone→zone (Tokyo 08:00 = LA 15:00 the day before)", () => {
    const [e] = parsePlanIcs(cal("DTSTART;TZID=Asia/Tokyo:20260115T080000\r\nDTEND;TZID=Asia/Tokyo:20260115T090000\r\nUID:t@x\r\nSUMMARY:Tokyo"), LA);
    expect(e).toMatchObject({ date: "2026-01-14", startTime: "15:00", endTime: "16:00" });
  });
  it("all-day and floating values are never shifted by timeZone", () => {
    const evs = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260115\r\nUID:a1@x\r\nSUMMARY:AD", "DTSTART:20260115T090000\r\nUID:f1@x\r\nSUMMARY:FL"), LA);
    expect(evs[0]).toMatchObject({ date: "2026-01-15", allDay: true });
    expect(evs[1]).toMatchObject({ date: "2026-01-15", startTime: "09:00" });
  });
  it("an invalid/absent timeZone falls back to process-local conversion", () => {
    const text = cal("DTSTART:20260115T020000Z\r\nUID:z2@x\r\nSUMMARY:x");
    expect(parsePlanIcs(text, { timeZone: "Not/AZone" })).toEqual(parsePlanIcs(text));
    const d = new Date(Date.UTC(2026, 0, 15, 2, 0));
    const p = (n) => String(n).padStart(2, "0");
    expect(parsePlanIcs(text)[0]).toMatchObject({ date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, startTime: `${p(d.getHours())}:${p(d.getMinutes())}` });
  });
});

describe("CAL-2 — EXDATE/UNTIL convert like DTSTART; BYDAY follows a shifted DTSTART", () => {
  // Tue 03:00Z == Mon 19:00 in LA. The series is weekly on (UTC) Tuesdays.
  const text = cal("DTSTART:20260106T030000Z\r\nDTEND:20260106T040000Z\r\nUID:w@x\r\nSUMMARY:Weekly\r\nRRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20260120T035959Z\r\nEXDATE:20260113T030000Z");
  it("DTSTART, EXDATE and UNTIL all land on the viewer's day; BYDAY shifts TU→MO", () => {
    const [e] = parsePlanIcs(text, LA);
    expect(e.date).toBe("2026-01-05");
    expect(e.exceptions).toEqual(["2026-01-12"]);
    expect(e.recurrence).toMatchObject({ freq: "weekly", byWeekdays: [1], until: "2026-01-19" });
    expect(expandRecurringOccurrences(e, "2026-01-01", "2026-02-28")).toEqual(["2026-01-05", "2026-01-19"]);
  });
  it("EXDATE with TZID converts too", () => {
    const [e] = parsePlanIcs(cal("DTSTART;TZID=Asia/Tokyo:20260115T080000\r\nUID:x2@x\r\nSUMMARY:T\r\nRRULE:FREQ=DAILY\r\nEXDATE;TZID=Asia/Tokyo:20260117T080000"), LA);
    expect(e.exceptions).toEqual(["2026-01-16"]);
  });
  it("all-day EXDATE/UNTIL are unchanged", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260105\r\nUID:ad@x\r\nSUMMARY:C\r\nRRULE:FREQ=WEEKLY;UNTIL=20260126\r\nEXDATE;VALUE=DATE:20260112"), LA);
    expect(e.exceptions).toEqual(["2026-01-12"]);
    expect(e.recurrence.until).toBe("2026-01-26");
  });
});

describe("CAL-3 — RECURRENCE-ID overrides and STATUS:CANCELLED", () => {
  const master = "DTSTART;VALUE=DATE:20260105\r\nUID:m@x\r\nSUMMARY:Class\r\nRRULE:FREQ=WEEKLY";
  it("an override replaces its instance: master gets an exception, override gets uid@date", () => {
    const evs = parsePlanIcs(cal(master, "DTSTART;VALUE=DATE:20260114\r\nUID:m@x\r\nRECURRENCE-ID;VALUE=DATE:20260112\r\nSUMMARY:Class (moved)"));
    expect(evs).toHaveLength(2);
    const m = evs.find((e) => e.uid === "m@x");
    const o = evs.find((e) => e.uid === "m@x@2026-01-12");
    expect(m.exceptions).toEqual(["2026-01-12"]);
    expect(o).toMatchObject({ date: "2026-01-14", title: "Class (moved)", recurrence: null });
  });
  it("override listed BEFORE its master still excludes the instance", () => {
    const evs = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260120\r\nUID:m@x\r\nRECURRENCE-ID;VALUE=DATE:20260119\r\nSUMMARY:Moved", master));
    expect(evs.find((e) => e.uid === "m@x").exceptions).toEqual(["2026-01-19"]);
  });
  it("a cancelled instance is dropped and excluded from the master", () => {
    const evs = parsePlanIcs(cal(master, "DTSTART;VALUE=DATE:20260112\r\nUID:m@x\r\nRECURRENCE-ID;VALUE=DATE:20260112\r\nSTATUS:CANCELLED\r\nSUMMARY:Class"));
    expect(evs).toHaveLength(1);
    expect(evs[0].exceptions).toEqual(["2026-01-12"]);
  });
  it("a cancelled standalone event is dropped", () => {
    expect(parsePlanIcs(cal("DTSTART;VALUE=DATE:20260112\r\nUID:c@x\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone"))).toEqual([]);
  });
});

describe("CAL-4 — COUNT / BYSETPOS / unsupported ordinals", () => {
  it("COUNT with multi-BYDAY counts actual occurrences", () => {
    // Mon Jan 5 start, Mon+Wed: 5, 7, 12, 14 → 4th = Jan 14 (old approximation said Jan 26)
    expect(parseIcsRrule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", "2026-01-05")).toMatchObject({ byWeekdays: [1, 3], until: "2026-01-14" });
  });
  it("monthly day-31 COUNT skips short months (SKIP semantics)", () => {
    expect(parseIcsRrule("RRULE:FREQ=MONTHLY;COUNT=3", "2026-01-31").until).toBe("2026-05-31");
  });
  it("monthly nth-weekday COUNT", () => {
    // 3rd Friday: Jan 16, Feb 20, Mar 20
    expect(parseIcsRrule("RRULE:FREQ=MONTHLY;BYDAY=3FR;COUNT=3", "2026-01-16").until).toBe("2026-03-20");
  });
  it("BYSETPOS + single BYDAY → nth weekday", () => {
    expect(parseIcsRrule("RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1", "2026-01-30")).toMatchObject({ monthMode: "nthWeekday", byWeekday: 5, bySetPos: -1 });
  });
  it("unsupported ordinals / multi-day BYSETPOS → no recurrence (single event, not a wrong series)", () => {
    expect(parseIcsRrule("RRULE:FREQ=MONTHLY;BYDAY=-2FR", "2026-01-23")).toBe(null);
    expect(parseIcsRrule("RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", "2026-01-30")).toBe(null);
    expect(parseIcsRrule("RRULE:FREQ=MONTHLY;BYDAY=MO", "2026-01-05")).toBe(null);
    expect(parseIcsRrule("RRULE:FREQ=YEARLY;BYDAY=20MO", "2026-05-18")).toBe(null); // 20th Monday of the YEAR
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260123\r\nUID:o@x\r\nSUMMARY:Odd\r\nRRULE:FREQ=MONTHLY;BYDAY=-2FR"));
    expect(e).toMatchObject({ date: "2026-01-23", recurrence: null });
  });
  it("yearly nth weekday with matching BYMONTH is kept", () => {
    expect(parseIcsRrule("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH", "2026-11-26")).toMatchObject({ freq: "yearly", monthMode: "nthWeekday", byWeekday: 4, bySetPos: 4 });
  });
  it("DAILY + BYDAY (every weekday) → weekly on those days", () => {
    expect(parseIcsRrule("RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", "2026-01-05")).toMatchObject({ freq: "weekly", byWeekdays: [1, 2, 3, 4, 5] });
  });
});

describe("CAL-19 — VALARM isolation, TEXT unescape, stable fallback UID", () => {
  it("VALARM properties don't shadow the event's; properties after the alarm still read", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260105\r\nUID:al@x\r\nSUMMARY:Dentist\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nLOCATION:Main St"));
    expect(e.notes).toBe("");
    expect(e.location).toBe("Main St");
  });
  it("properties of a LATER component (VTIMEZONE after END:VEVENT) don't leak in", () => {
    const text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260105\r\nUID:lk@x\r\nSUMMARY:A\r\nEND:VEVENT\r\nBEGIN:VTIMEZONE\r\nLOCATION:Nope\r\nEND:VTIMEZONE\r\nEND:VCALENDAR";
    expect(parsePlanIcs(text)[0].location).toBe("");
  });
  it("unescapes \\n, \\\\, \\, and \;", () => {
    const [e] = parsePlanIcs(cal("DTSTART;VALUE=DATE:20260105\r\nUID:esc@x\r\nSUMMARY:S\r\nDESCRIPTION:Line 1\\nLine 2\\, a\\; b \\\\ c"));
    expect(e.notes).toBe("Line 1\nLine 2, a; b \\ c");
  });
  it("missing UID → stable hash of DTSTART+SUMMARY (same across parses)", () => {
    const text = cal("DTSTART;VALUE=DATE:20260105\r\nSUMMARY:No uid");
    const a = parsePlanIcs(text)[0].uid;
    expect(a).toMatch(/^ics-/);
    expect(parsePlanIcs(text)[0].uid).toBe(a);
    expect(parsePlanIcs(cal("DTSTART;VALUE=DATE:20260105\r\nSUMMARY:Other"))[0].uid).not.toBe(a);
  });
});

describe("CAL-20 — planNthOccurrenceDate large counts", () => {
  it("weekly Mon+Wed × 500 reaches the true 500th occurrence (was truncated by the loop cap)", () => {
    const d = new Date(2026, 0, 7); d.setDate(d.getDate() + 249 * 7);
    const p = (n) => String(n).padStart(2, "0");
    expect(planNthOccurrenceDate({ date: "2026-01-05", recurrence: { freq: "weekly", interval: 1, byWeekdays: [1, 3] } }, 500))
      .toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  });
  it("daily × 3650 (the normalizeRecurrence max)", () => {
    const d = new Date(2026, 0, 1); d.setDate(d.getDate() + 3649);
    const p = (n) => String(n).padStart(2, "0");
    expect(planNthOccurrenceDate({ date: "2026-01-01", recurrence: { freq: "daily", interval: 1 } }, 3650))
      .toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  });
});
