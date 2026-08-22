import { describe, it, expect } from "vitest";
import {
  reconcile, applyOverride, resetOverrideField, applyExclusions, hiddenIdSet, toggleExclusion
} from "../calendar/reconcile.js";

const ev = (id, over = {}) => ({
  id, title: "Call", date: "2026-01-05", startTime: "09:00", endTime: "09:30",
  endDate: null, allDay: false, notes: "", location: "", recurrence: null, exceptions: [], ...over
});

describe("reconcile — initial + repeat import (§14 duplicate prevention)", () => {
  it("initial import: everything is added", () => {
    const r = reconcile([], [ev("s:1"), ev("s:2")]);
    expect(r.added.sort()).toEqual(["s:1", "s:2"]);
    expect(r.updated).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.events.map((e) => e.id)).toEqual(["s:1", "s:2"]);
  });
  it("repeat import with identical events: no duplicates, all unchanged", () => {
    const prev = [ev("s:1"), ev("s:2")];
    const r = reconcile(prev, [ev("s:1"), ev("s:2")]);
    expect(r.added).toEqual([]);
    expect(r.unchanged.sort()).toEqual(["s:1", "s:2"]);
    expect(r.events).toHaveLength(2);
  });
});

describe("reconcile — change + deletion detection", () => {
  it("a changed source field marks the event updated", () => {
    const r = reconcile([ev("s:1", { title: "Call" })], [ev("s:1", { title: "Pediatric Call" })]);
    expect(r.updated).toEqual(["s:1"]);
    expect(r.unchanged).toEqual([]);
  });
  it("an event gone from the source is reported removed (true deletion)", () => {
    const r = reconcile([ev("s:1"), ev("s:2")], [ev("s:1")]);
    expect(r.removed).toEqual(["s:2"]);
    expect(r.events.map((e) => e.id)).toEqual(["s:1"]);
  });
});

describe("local exclusions (§16) — hide survives re-sync", () => {
  it("an excluded event stays out even though the source keeps sending it", () => {
    const incoming = [ev("s:1"), ev("s:2")];
    const r1 = reconcile([], incoming, { exclusions: ["s:2"] });
    expect(r1.events.map((e) => e.id)).toEqual(["s:1"]);
    // next sync: source still has s:2, exclusion still applies
    const r2 = reconcile(incoming, incoming, { exclusions: ["s:2"] });
    expect(r2.events.map((e) => e.id)).toEqual(["s:1"]);
    // but it is NOT reported as a source deletion — the source still has it
    expect(r2.removed).toEqual([]);
  });
  it("applyExclusions works standalone with a Set or an array", () => {
    expect(applyExclusions([ev("a"), ev("b")], new Set(["b"])).map((e) => e.id)).toEqual(["a"]);
    expect(applyExclusions([ev("a"), ev("b")], ["a"]).map((e) => e.id)).toEqual(["b"]);
    expect(applyExclusions([ev("a")], null).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("local overrides (§15) — local edit survives, source fields still update", () => {
  it("overridden title wins while other source fields refresh on sync", () => {
    const overrides = { "s:1": { title: "Pediatric Call" } };
    // source changes the time but not the title
    const r = reconcile([ev("s:1")], [ev("s:1", { startTime: "10:00" })], { overrides });
    const out = r.events.find((e) => e.id === "s:1");
    expect(out.title).toBe("Pediatric Call"); // local override wins
    expect(out.startTime).toBe("10:00");       // source-controlled field updated
    expect(out._overriddenFields).toEqual(["title"]);
  });
  it("applyOverride is a no-op without an override", () => {
    const e = ev("s:1");
    expect(applyOverride(e, null)).toBe(e);
    expect(applyOverride(e, {})).toBe(e);
  });
  it("resetOverrideField removes a field and nulls out an emptied override", () => {
    expect(resetOverrideField({ title: "X", notes: "Y" }, "title")).toEqual({ notes: "Y" });
    expect(resetOverrideField({ title: "X" }, "title")).toBe(null);
  });
});

describe("hide/unhide toggle list (§16) — the persisted exclusion records", () => {
  it("hiddenIdSet collects only the records currently hidden", () => {
    const recs = [{ id: "a", hidden: true }, { id: "b", hidden: false }, { id: "c", hidden: true }, { id: "", hidden: true }];
    expect([...hiddenIdSet(recs)].sort()).toEqual(["a", "c"]);
    expect(hiddenIdSet(null).size).toBe(0);
  });
  it("toggleExclusion upserts a new hidden record, keeping the title", () => {
    const out = toggleExclusion([], "s:1", true, "Standup");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "s:1", hidden: true, title: "Standup" });
  });
  it("toggling an existing id flips hidden without duplicating (hide → unhide → re-hide)", () => {
    let recs = toggleExclusion([], "s:1", true, "X");
    recs = toggleExclusion(recs, "s:1", false); // unhide
    expect(recs).toHaveLength(1);
    expect(hiddenIdSet(recs).size).toBe(0);
    recs = toggleExclusion(recs, "s:1", true); // re-hide — still one record, now hidden
    expect(recs).toHaveLength(1);
    expect(hiddenIdSet(recs).has("s:1")).toBe(true);
  });
  it("never mutates the input list", () => {
    const input = [{ id: "s:1", hidden: true }];
    const out = toggleExclusion(input, "s:2", true);
    expect(input).toHaveLength(1);
    expect(out).toHaveLength(2);
  });
});

describe("reconcile — robustness", () => {
  it("handles null/empty inputs", () => {
    const r = reconcile(null, null);
    expect(r).toMatchObject({ events: [], added: [], updated: [], unchanged: [], removed: [] });
  });
  it("accepts a Map as previous", () => {
    const prev = new Map([["s:1", ev("s:1")]]);
    const r = reconcile(prev, [ev("s:1", { title: "Changed" })]);
    expect(r.updated).toEqual(["s:1"]);
  });
});
