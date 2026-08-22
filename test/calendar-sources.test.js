import { describe, it, expect } from "vitest";
import {
  registerProvider, getProvider, listProviders, providerIsReadOnly, sourceFromPlanCalendar
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
