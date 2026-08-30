import { describe, it, expect } from "vitest";
import {
  normalizeRecurrence,
  expandRecurringOccurrences,
  planNthOccurrenceDate,
  planNthWeekdayDate
} from "../calendar/recurrence.js";

// Helper: build a minimal event with a recurrence rule.
const ev = (date, rule, exceptions = []) => ({
  id: "e1", date, recurrence: normalizeRecurrence(rule), exceptions
});

describe("normalizeRecurrence", () => {
  it("rejects non-objects and unknown frequencies", () => {
    expect(normalizeRecurrence(null)).toBe(null);
    expect(normalizeRecurrence({})).toBe(null);
    expect(normalizeRecurrence({ freq: "hourly" })).toBe(null);
  });
  it("clamps interval into [1,365] and defaults to 1", () => {
    expect(normalizeRecurrence({ freq: "daily", interval: 0 }).interval).toBe(1);
    expect(normalizeRecurrence({ freq: "daily", interval: 999 }).interval).toBe(365);
    expect(normalizeRecurrence({ freq: "daily", interval: 3 }).interval).toBe(3);
  });
  it("keeps a valid until and rejects a malformed one", () => {
    expect(normalizeRecurrence({ freq: "daily", until: "2026-03-01" }).until).toBe("2026-03-01");
    expect(normalizeRecurrence({ freq: "daily", until: "March" }).until).toBe(null);
  });
  it("keeps count only when a positive integer ≤ 3650", () => {
    expect(normalizeRecurrence({ freq: "daily", count: 5 }).count).toBe(5);
    expect(normalizeRecurrence({ freq: "daily", count: 0 }).count).toBe(null);
    expect(normalizeRecurrence({ freq: "daily", count: 99999 }).count).toBe(null);
  });
  it("dedupes and sorts weekly byWeekdays, ignoring out-of-range", () => {
    expect(normalizeRecurrence({ freq: "weekly", byWeekdays: [3, 1, 1, 9, 5] }).byWeekdays).toEqual([1, 3, 5]);
  });
  it("byWeekdays only applies to weekly", () => {
    expect(normalizeRecurrence({ freq: "daily", byWeekdays: [1] }).byWeekdays).toBe(null);
  });
  it("monthly nthWeekday needs a valid byWeekday, else falls back to dayOfMonth", () => {
    const good = normalizeRecurrence({ freq: "monthly", monthMode: "nthWeekday", byWeekday: 5, bySetPos: 3 });
    expect(good).toMatchObject({ monthMode: "nthWeekday", byWeekday: 5, bySetPos: 3 });
    const bad = normalizeRecurrence({ freq: "monthly", monthMode: "nthWeekday", bySetPos: 3 });
    expect(bad.monthMode).toBe("dayOfMonth");
    expect(bad.bySetPos).toBe(null);
  });
  it("accepts -1 (last) as a bySetPos", () => {
    expect(normalizeRecurrence({ freq: "monthly", monthMode: "nthWeekday", byWeekday: 5, bySetPos: -1 }).bySetPos).toBe(-1);
  });
});

describe("planNthWeekdayDate", () => {
  it("finds the 3rd Friday of Aug 2026 (2026-08-21)", () => {
    // month is 0-indexed: 7 = August; weekday 5 = Friday
    const d = planNthWeekdayDate(2026, 7, 5, 3);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(21);
  });
  it("finds the last Friday of Aug 2026 (2026-08-28)", () => {
    const d = planNthWeekdayDate(2026, 7, 5, -1);
    expect(d.getDate()).toBe(28);
  });
  it("returns null when the Nth weekday doesn't exist (5th Monday of Feb 2026)", () => {
    expect(planNthWeekdayDate(2026, 1, 1, 5)).toBe(null);
  });
});

describe("expandRecurringOccurrences — daily", () => {
  it("every day within the window", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-01", { freq: "daily" }), "2026-01-01", "2026-01-05");
    expect(occ).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });
  it("interval of 3 days", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-01", { freq: "daily", interval: 3 }), "2026-01-01", "2026-01-10");
    expect(occ).toEqual(["2026-01-01", "2026-01-04", "2026-01-07", "2026-01-10"]);
  });
  it("fast-forwards from an old start into a later window preserving phase", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-01", { freq: "daily", interval: 3 }), "2026-01-05", "2026-01-11");
    expect(occ).toEqual(["2026-01-07", "2026-01-10"]);
  });
  it("honors until", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-01", { freq: "daily", until: "2026-01-03" }), "2026-01-01", "2026-01-10");
    expect(occ).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });
  it("drops exception dates", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-01", { freq: "daily" }, ["2026-01-03"]), "2026-01-01", "2026-01-04");
    expect(occ).toEqual(["2026-01-01", "2026-01-02", "2026-01-04"]);
  });
});

describe("expandRecurringOccurrences — weekly", () => {
  it("every week on the anchor weekday", () => {
    // 2026-01-01 is a Thursday
    const occ = expandRecurringOccurrences(ev("2026-01-01", { freq: "weekly" }), "2026-01-01", "2026-01-31");
    expect(occ).toEqual(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
  });
  it("selected weekdays (Mon & Wed) every week", () => {
    // window Jan 5 (Mon) .. Jan 16 (Fri)
    const occ = expandRecurringOccurrences(ev("2026-01-05", { freq: "weekly", byWeekdays: [1, 3] }), "2026-01-05", "2026-01-16");
    expect(occ).toEqual(["2026-01-05", "2026-01-07", "2026-01-12", "2026-01-14"]);
  });
  it("selected weekdays every 2 weeks skips the off week", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-05", { freq: "weekly", interval: 2, byWeekdays: [1, 3] }), "2026-01-05", "2026-01-30");
    // week of Jan 5 on, week of Jan 12 off, week of Jan 19 on, week of Jan 26 off
    expect(occ).toEqual(["2026-01-05", "2026-01-07", "2026-01-19", "2026-01-21"]);
  });
});

describe("expandRecurringOccurrences — monthly", () => {
  it("same day-of-month each month", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-15", { freq: "monthly" }), "2026-01-01", "2026-04-30");
    expect(occ).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });
  it("SKIPS months without the 31st rather than rolling into the next month", () => {
    const occ = expandRecurringOccurrences(ev("2026-01-31", { freq: "monthly" }), "2026-01-01", "2026-05-31");
    // Feb (28), Apr (30) have no 31st → skipped; Mar & May do
    expect(occ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });
  it("nth weekday: 3rd Friday each month", () => {
    const occ = expandRecurringOccurrences(
      ev("2026-01-16", { freq: "monthly", monthMode: "nthWeekday", byWeekday: 5, bySetPos: 3 }),
      "2026-01-01", "2026-03-31"
    );
    expect(occ).toEqual(["2026-01-16", "2026-02-20", "2026-03-20"]);
  });
  it("nth weekday: last Monday each month", () => {
    const occ = expandRecurringOccurrences(
      ev("2026-01-26", { freq: "monthly", monthMode: "nthWeekday", byWeekday: 1, bySetPos: -1 }),
      "2026-01-01", "2026-03-31"
    );
    expect(occ).toEqual(["2026-01-26", "2026-02-23", "2026-03-30"]);
  });
});

describe("expandRecurringOccurrences — yearly", () => {
  it("same date each year", () => {
    const occ = expandRecurringOccurrences(ev("2024-03-10", { freq: "yearly" }), "2024-01-01", "2027-12-31");
    expect(occ).toEqual(["2024-03-10", "2025-03-10", "2026-03-10", "2027-03-10"]);
  });
  it("Feb 29 yearly only lands on leap years", () => {
    const occ = expandRecurringOccurrences(ev("2024-02-29", { freq: "yearly" }), "2024-01-01", "2032-12-31");
    expect(occ).toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
  });
});

describe("planNthOccurrenceDate (count → until derivation)", () => {
  it("returns the date of the Nth daily occurrence", () => {
    const base = { date: "2026-01-01", recurrence: normalizeRecurrence({ freq: "daily" }) };
    expect(planNthOccurrenceDate(base, 1)).toBe("2026-01-01");
    expect(planNthOccurrenceDate(base, 5)).toBe("2026-01-05");
  });
  it("returns the Nth weekly-on-weekdays occurrence", () => {
    const base = { date: "2026-01-05", recurrence: normalizeRecurrence({ freq: "weekly", byWeekdays: [1, 3] }) };
    // Mon Jan5, Wed Jan7, Mon Jan12, Wed Jan14 → 4th = Jan14
    expect(planNthOccurrenceDate(base, 4)).toBe("2026-01-14");
  });
  it("returns null without a recurrence or a positive count", () => {
    expect(planNthOccurrenceDate({ date: "2026-01-01", recurrence: null }, 3)).toBe(null);
    expect(planNthOccurrenceDate({ date: "2026-01-01", recurrence: normalizeRecurrence({ freq: "daily" }) }, 0)).toBe(null);
  });
});

describe("no recurrence / bad input", () => {
  it("returns no occurrences when the event has no rule", () => {
    expect(expandRecurringOccurrences({ date: "2026-01-01", recurrence: null }, "2026-01-01", "2026-12-31")).toEqual([]);
  });
  it("returns no occurrences for an unparseable date", () => {
    expect(expandRecurringOccurrences(ev("not-a-date", { freq: "daily" }), "2026-01-01", "2026-12-31")).toEqual([]);
  });
});
