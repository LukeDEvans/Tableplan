import { describe, it, expect } from "vitest";
import { makeEvent, appendEvent, listEvents, summarizeEvents, EVENT, DEFAULT_EVENT_CAP } from "../music/events.js";

describe("makeEvent", () => {
  it("mints id + at and keeps the type/subject/data", () => {
    const e = makeEvent({ type: EVENT.SCORE_IMPORTED, subject: "work_1", data: { title: "Etude" } });
    expect(e.id).toMatch(/^evt_/);
    expect(e.type).toBe("score-imported");
    expect(e.subject).toBe("work_1");
    expect(e.data).toEqual({ title: "Etude" });
    expect(typeof e.at).toBe("string");
    expect(e.source).toBe("app");
  });
  it("preserves an existing id/at (round-trips a synced row) and unknown types", () => {
    const e = makeEvent({ id: "evt_x", type: "brand-new-kind", at: "2026-01-01T00:00:00Z" });
    expect(e.id).toBe("evt_x");
    expect(e.type).toBe("brand-new-kind"); // open set
    expect(e.at).toBe("2026-01-01T00:00:00Z");
  });
});

describe("appendEvent", () => {
  it("appends immutably and de-dupes by id", () => {
    const a = appendEvent([], { id: "e1", type: "t", at: "1" });
    const b = appendEvent(a, { id: "e2", type: "t", at: "2" });
    expect(a).toHaveLength(1);            // original untouched
    expect(b).toHaveLength(2);
    const c = appendEvent(b, { id: "e2", type: "t", at: "2" }); // duplicate id
    expect(c).toHaveLength(2);
  });
  it("caps the log to the newest N", () => {
    let log = [];
    for (let i = 0; i < DEFAULT_EVENT_CAP + 25; i++) log = appendEvent(log, { id: `e${i}`, type: "t", at: String(i) });
    expect(log).toHaveLength(DEFAULT_EVENT_CAP);
    expect(log[0].id).toBe("e25");                       // oldest 25 dropped
    expect(log[log.length - 1].id).toBe(`e${DEFAULT_EVENT_CAP + 24}`);
  });
  it("respects a custom cap", () => {
    let log = [];
    for (let i = 0; i < 5; i++) log = appendEvent(log, { id: `e${i}`, type: "t", at: String(i) }, { cap: 3 });
    expect(log.map((e) => e.id)).toEqual(["e2", "e3", "e4"]);
  });
});

describe("two-device event history union (id-keyed merge contract)", () => {
  // Mirrors the app's unionById section-merge: both devices' events survive.
  const unionById = (a, b) => {
    const m = new Map((b || []).map((x) => [x.id, x]));
    (a || []).forEach((x) => m.set(x.id, x));
    return [...m.values()];
  };
  it("keeps events created independently on each device", () => {
    const deviceA = appendEvent([], { id: "a1", type: EVENT.PRACTICE_COMPLETED, at: "2026-08-01" });
    const deviceB = appendEvent([], { id: "b1", type: EVENT.SCORE_IMPORTED, at: "2026-08-02" });
    const merged = unionById(deviceA, deviceB);
    expect(merged).toHaveLength(2);
    expect(listEvents(merged)[0].id).toBe("b1"); // newest first
  });
});

describe("listEvents / summarizeEvents", () => {
  const log = [
    { id: "1", type: EVENT.SCORE_IMPORTED, at: "2026-08-01", subject: "w1" },
    { id: "2", type: EVENT.PRACTICE_COMPLETED, at: "2026-08-03", subject: "w1" },
    { id: "3", type: EVENT.PRACTICE_COMPLETED, at: "2026-08-02", subject: "w2" },
  ];
  it("filters by subject and type, newest first", () => {
    expect(listEvents(log, { subject: "w1" }).map((e) => e.id)).toEqual(["2", "1"]);
    expect(listEvents(log, { type: EVENT.PRACTICE_COMPLETED }).map((e) => e.id)).toEqual(["2", "3"]);
  });
  it("summarizes counts per type + last timestamp", () => {
    const s = summarizeEvents(log);
    expect(s.total).toBe(3);
    expect(s.byType[EVENT.PRACTICE_COMPLETED]).toBe(2);
    expect(s.lastAt).toBe("2026-08-03");
  });
});
