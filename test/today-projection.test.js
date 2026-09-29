import { describe, it, expect } from "vitest";
import { dayKey, projectCalendar, projectMediaContinue, projectWeather, projectToday } from "../today-projection.js";

const at = (s) => new Date(s);

describe("dayKey", () => {
  it("formats a local YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 8, 2, 13, 0, 0))).toBe("2026-09-02"); // month is 0-based
  });
});

describe("projectCalendar (deterministic, pure)", () => {
  const state = {
    planEvents: [
      { id: "e1", title: "Dentist", date: "2026-09-02", startTime: "09:00" },
      { id: "e2", title: "Other day", date: "2026-09-03" },
      { id: "e3", title: "Standup", date: "2026-09-01", recurrence: { freq: "daily", interval: 1 } },
    ],
  };

  it("returns only events occurring on now's local day", () => {
    const p = projectCalendar(state, at("2026-09-02T12:00:00"));
    const ids = p.events.map((e) => e.id).sort();
    expect(p.date).toBe("2026-09-02");
    expect(ids).toContain("e1");   // one-off today
    expect(ids).toContain("e3");   // daily recurrence covers today
    expect(ids).not.toContain("e2"); // different day
  });

  it("is a pure function of its inputs (same now → same facts)", () => {
    // The projected facts (which events, in which order) are deterministic. (The
    // normalizer stamps createdAt=now on events that lack one — real events have it;
    // that's a normalize concern, not a projection one — so compare the facts.)
    const a = projectCalendar(state, at("2026-09-02T12:00:00"));
    const b = projectCalendar(state, at("2026-09-02T12:00:00"));
    expect(a.date).toBe(b.date);
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
  });

  it("empty/absent planEvents → empty", () => {
    expect(projectCalendar({}, at("2026-09-02T00:00:00")).events).toEqual([]);
    expect(projectCalendar(null, at("2026-09-02T00:00:00")).events).toEqual([]);
  });
});

describe("projectMediaContinue", () => {
  it("returns recent history entries, capped by limit", () => {
    const state = { mediaHistory: [
      { id: "h1", at: "2026-09-01T10:00:00Z" },
      { id: "h2", at: "2026-09-02T10:00:00Z" },
    ] };
    const p = projectMediaContinue(state, at("2026-09-02T12:00:00"), { limit: 1 });
    expect(p.recent.length).toBe(1);
  });
  it("no history → empty", () => {
    expect(projectMediaContinue({}, at("2026-09-02T00:00:00")).recent).toEqual([]);
  });
});

describe("projectWeather", () => {
  it("picks the active location, else the first", () => {
    const state = { weatherLocations: [{ id: "a", name: "Home" }, { id: "b", name: "Work" }], weatherActiveLocationId: "b" };
    expect(projectWeather(state).location.id).toBe("b");
    expect(projectWeather({ weatherLocations: [{ id: "a" }] }).location.id).toBe("a");
    expect(projectWeather({}).hasLocation).toBe(false);
  });
});

describe("projectToday (thin composition)", () => {
  it("composes the domain projections and merges injected extras", () => {
    const state = { planEvents: [{ id: "e1", title: "Dentist", date: "2026-09-02" }], mediaHistory: [], weatherLocations: [] };
    const now = at("2026-09-02T08:00:00");
    const ctx = projectToday(state, now, { tasks: { due: ["t1"] } });
    expect(ctx.date).toBe("2026-09-02");
    expect(ctx.calendar.events.map((e) => e.id)).toEqual(["e1"]);
    expect(ctx.mediaContinue.recent).toEqual([]);
    expect(ctx.weather.hasLocation).toBe(false);
    expect(ctx.tasks).toEqual({ due: ["t1"] }); // injected extra composed in
  });

  it("is deterministic for a fixed now (no hidden clock reads)", () => {
    const state = { planEvents: [], mediaHistory: [] };
    const now = at("2026-09-02T08:00:00");
    expect(projectToday(state, now)).toEqual(projectToday(state, now));
  });

  it("tolerates garbage state", () => {
    const ctx = projectToday(null, at("2026-09-02T00:00:00"));
    expect(ctx.calendar.events).toEqual([]);
    expect(ctx.mediaContinue.recent).toEqual([]);
  });
});
