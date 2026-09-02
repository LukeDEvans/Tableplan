import { describe, it, expect } from "vitest";
import { buildAgentContext, AGENT_CONTRACT } from "../ai-context.js";

const now = new Date("2026-09-02T08:00:00");

describe("buildAgentContext — one deterministic AI/Home context surface", () => {
  it("composes today + capabilities + the ground-rules contract", () => {
    const state = { planEvents: [{ id: "e1", title: "Dentist", date: "2026-09-02" }], mediaHistory: [], weatherLocations: [] };
    const ctx = buildAgentContext(state, now);
    expect(ctx.today.date).toBe("2026-09-02");
    expect(ctx.today.calendar.events.map((e) => e.id)).toEqual(["e1"]);
    expect(Array.isArray(ctx.capabilities)).toBe(true);
    expect(ctx.capabilities.some((c) => c.id === "sync")).toBe(true);
    expect(ctx.contract).toBe(AGENT_CONTRACT);
  });

  it("encodes the safety ground rules as data (not prose)", () => {
    expect(AGENT_CONTRACT.actThroughTypedToolsOnly).toBe(true);
    expect(AGENT_CONTRACT.confirmOutwardOrDestructive).toBe(true);
    expect(AGENT_CONTRACT.accountScoped).toBe(true);
    expect(AGENT_CONTRACT.factsAreDeterministic).toBe(true);
    expect(Object.isFrozen(AGENT_CONTRACT)).toBe(true);
  });

  it("passes through the extra.today seam and availability map", () => {
    const ctx = buildAgentContext({}, now, { today: { tasks: { due: ["t1"] } }, available: { search: true } });
    expect(ctx.today.tasks).toEqual({ due: ["t1"] });
    expect(ctx.capabilities.find((c) => c.id === "search").available).toBe(true);
  });

  it("is deterministic for a fixed now and tolerates garbage state", () => {
    expect(buildAgentContext(null, now)).toEqual(buildAgentContext(null, now));
    expect(buildAgentContext(null, now).today.calendar.events).toEqual([]);
  });
});
