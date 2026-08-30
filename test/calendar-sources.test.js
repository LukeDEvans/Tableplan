import { describe, it, expect } from "vitest";
import {
  registerProvider, getProvider, listProviders, providerIsReadOnly, sourceFromPlanCalendar, detectProvider, isGoogleCalendarUrl
} from "../calendar/sources.js";
import { externalEventId, normalizeExternalEvent, normalizeExternalEvents } from "../calendar/normalize.js";

describe("provider registry (§10-11)", () => {
  it("ships with the built-in read-only ICS provider", () => {
    expect(getProvider("ics")).toMatchObject({ id: "ics", readOnly: true });
    expect(listProviders().some((p) => p.id === "ics")).toBe(true);
  });
  it("registerProvider defaults to read-only and requires an id", () => {
    const p = registerProvider({ id: "test-prov", label: "Test" });
    expect(p).toMatchObject({ id: "test-prov", readOnly: true, writable: false });
    expect(() => registerProvider({})).toThrow();
  });
  it("a writable provider is recorded as such", () => {
    registerProvider({ id: "rw-prov", label: "RW", readOnly: false, writable: true });
    expect(providerIsReadOnly("rw-prov")).toBe(false);
  });
  it("unknown providers are treated as read-only (safe default)", () => {
    expect(providerIsReadOnly("nope")).toBe(true);
  });
  it("ships the read-only Amion provider alongside ICS (§12)", () => {
    expect(getProvider("amion")).toMatchObject({ id: "amion", readOnly: true });
  });
});

describe("detectProvider — Amion reuses the ICS pipeline (§12)", () => {
  it("recognizes the Amion on-call VCal endpoint by host and by the Vcal param", () => {
    expect(detectProvider("https://www.amion.com/cgi-bin/ocs?Vcal=7.1500&Lo=3umnpeds&Jd=10758")).toBe("amion");
    expect(detectProvider("https://amion.com/cgi-bin/ocs?Jd=1")).toBe("amion");
    expect(detectProvider("https://feeds.example.com/x?Vcal=7.1")).toBe("amion");
  });
  it("treats any other iCal URL as generic ICS", () => {
    expect(detectProvider("https://calendar.google.com/…/basic.ics")).toBe("ics");
    expect(detectProvider("")).toBe("ics");
    expect(detectProvider(null)).toBe("ics");
  });
  it("does not misfire on lookalike hosts", () => {
    expect(detectProvider("https://notamion.com.evil.test/f.ics")).toBe("ics");
  });
  it("a subscription with an Amion URL is modeled as the amion provider (still ICS pipeline)", () => {
    const src = sourceFromPlanCalendar({ id: "c1", name: "On-call", url: "https://www.amion.com/cgi-bin/ocs?Vcal=7.1500&Lo=x&Jd=1" });
    expect(src.provider).toBe("amion");
    expect(src.readOnly).toBe(true);
  });
});

describe("isGoogleCalendarUrl — routes the unified add flow to the right backend", () => {
  it("recognizes a Google Calendar iCal URL", () => {
    expect(isGoogleCalendarUrl("https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-x/basic.ics")).toBe(true);
    expect(isGoogleCalendarUrl("https://www.google.com/calendar/ical/x/basic.ics")).toBe(true);
  });
  it("rejects non-Google, non-ical, non-https, and Amion URLs", () => {
    expect(isGoogleCalendarUrl("https://calendar.google.com/calendar/embed?src=x")).toBe(false); // not /ical/
    expect(isGoogleCalendarUrl("http://calendar.google.com/calendar/ical/x/basic.ics")).toBe(false); // not https
    expect(isGoogleCalendarUrl("https://feeds.example.com/x.ics")).toBe(false);
    expect(isGoogleCalendarUrl("https://www.amion.com/cgi-bin/ocs?Vcal=7.1")).toBe(false);
    expect(isGoogleCalendarUrl("")).toBe(false);
    expect(isGoogleCalendarUrl("not a url")).toBe(false);
  });
});

describe("sourceFromPlanCalendar (bridge, no data migration)", () => {
  it("maps a stored subscription into a CalendarSource", () => {
    const src = sourceFromPlanCalendar({ id: "cal1", name: "Work", color: "#39f", url: "https://x/f.ics", enabled: true, lastFetched: "2026-08-21T00:00:00Z" });
    expect(src).toMatchObject({
      id: "cal1", provider: "ics", calendarId: "cal1", name: "Work",
      color: "#39f", url: "https://x/f.ics", enabled: true, readOnly: true,
      syncState: { lastFetched: "2026-08-21T00:00:00Z" }
    });
  });
  it("treats a subscription without enabled:false as enabled", () => {
    expect(sourceFromPlanCalendar({ id: "c", name: "X" }).enabled).toBe(true);
    expect(sourceFromPlanCalendar({ id: "c", name: "X", enabled: false }).enabled).toBe(false);
  });
});

describe("normalizeExternalEvent (§13-14) — canonical convergence + identity", () => {
  const source = sourceFromPlanCalendar({ id: "cal1", name: "Work", color: "#39f", url: "u", enabled: true });
  const raw = {
    uid: "abc@host", title: "Standup", date: "2026-01-05", startTime: "09:00",
    endTime: "09:15", endDate: null, allDay: false, notes: "n", location: "l",
    recurrence: { freq: "weekly", interval: 1 }, exceptions: ["2026-01-12"]
  };

  it("produces the same stable id the old render path built (cal.id:uid)", () => {
    const ev = normalizeExternalEvent(raw, source);
    expect(ev.id).toBe("cal1:abc@host");
    expect(externalEventId("cal1", "abc@host")).toBe("cal1:abc@host");
  });
  it("adds identity + source metadata while preserving all raw fields", () => {
    const ev = normalizeExternalEvent(raw, source);
    expect(ev).toMatchObject({
      externalId: "abc@host", sourceId: "cal1", provider: "ics", readOnly: true,
      source: "ical", calendarId: "cal1", calendarName: "Work", color: "#39f",
      title: "Standup", date: "2026-01-05", startTime: "09:00", notes: "n",
      recurrence: { freq: "weekly", interval: 1 }, exceptions: ["2026-01-12"]
    });
  });
  it("re-normalizing the same raw event yields the same id (no duplication on re-import)", () => {
    expect(normalizeExternalEvent(raw, source).id).toBe(normalizeExternalEvent(raw, source).id);
  });
  it("normalizeExternalEvents maps a whole feed", () => {
    const evs = normalizeExternalEvents([raw, { ...raw, uid: "def" }], source);
    expect(evs.map((e) => e.id)).toEqual(["cal1:abc@host", "cal1:def"]);
  });
});
