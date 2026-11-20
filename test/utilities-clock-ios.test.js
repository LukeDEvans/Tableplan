import { describe, it, expect } from "vitest";
import { cityFromZone, zoneOffsetMinutes, worldClockSubtitle, lapExtremes, reconcileAlarms, alarmRepeatText, addRecentTimer, durationWords } from "../clock-model.js";

describe("iPhone-style Clock helpers", () => {
  it("names cities and offsets", () => {
    expect(cityFromZone("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    const jan = new Date("2026-01-15T12:00:00Z");
    expect(zoneOffsetMinutes("America/Chicago", jan)).toBe(-360);
    expect(zoneOffsetMinutes("Asia/Kolkata", jan)).toBe(330);
    expect(worldClockSubtitle("America/Chicago", "America/Chicago", jan)).toBe("Today, +0HRS");
    expect(worldClockSubtitle("Europe/Amsterdam", "America/Chicago", jan)).toBe("Today, +7HRS");
    expect(worldClockSubtitle("Asia/Kolkata", "America/Chicago", new Date("2026-01-15T20:00:00Z"))).toBe("Tomorrow, +11:30HRS");
    expect(worldClockSubtitle("America/Los_Angeles", "Asia/Tokyo", new Date("2026-01-15T16:00:00Z"))).toBe("Yesterday, −17HRS");
  });
  it("marks fastest and slowest laps once there are two different ones", () => {
    expect(lapExtremes([{ n: 1, split: 5 }])).toEqual({ best: null, worst: null });
    expect(lapExtremes([{ n: 3, split: 7 }, { n: 2, split: 4 }, { n: 1, split: 9 }])).toEqual({ best: 2, worst: 1 });
  });
  it("reconciles device alarm records with what AlarmKit will ring", () => {
    const records = [
      { id: "a", hour: 7, minute: 0, weekdays: [], enabled: true, nativeId: "N1" }, // rang (gone) → off
      { id: "b", hour: 6, minute: 30, weekdays: ["monday"], enabled: true, nativeId: "N2" }, // still set
      { id: "c", hour: 9, minute: 0, weekdays: [], enabled: false, nativeId: null },
    ];
    const native = [{ id: "N2", kind: "alarm" }, { id: "N3", kind: "alarm", hour: 5, minute: 15, label: "Gym", weekdays: [] }, { id: "T1", kind: "timer" }];
    const out = reconcileAlarms(records, native);
    expect(out.map((r) => r.id)).toEqual(["alarm-N3", "b", "a", "c"]);
    expect(out.find((r) => r.id === "a")).toMatchObject({ enabled: false, nativeId: null });
    expect(out.find((r) => r.id === "alarm-N3")).toMatchObject({ enabled: true, label: "Gym", hour: 5 });
  });
  it("words repeats, recents and durations like the iPhone", () => {
    expect(alarmRepeatText([])).toBe("");
    expect(alarmRepeatText(["monday", "tuesday", "wednesday", "thursday", "friday"])).toBe("weekdays");
    expect(alarmRepeatText(["saturday"])).toBe("every Saturday");
    expect(alarmRepeatText(["monday", "wednesday"])).toBe("Mon Wed");
    const r = addRecentTimer(addRecentTimer([], { seconds: 300 }), { seconds: 600, label: "Pasta" });
    expect(addRecentTimer(r, { seconds: 300 }).map((x) => x.seconds)).toEqual([300, 600]);
    expect(durationWords(5400)).toBe("1 hr, 30 min");
    expect(durationWords(45)).toBe("45 sec");
  });
});
