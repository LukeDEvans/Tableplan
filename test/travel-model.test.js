import { describe, it, expect } from "vitest";
import {
  TRIP_STATUS, deriveStatus, isIdea, isTraveling, isCompleted, startsWithin,
  compareForHome, migrateIdeasToTrips,
} from "../travel-model.js";

const TODAY = "2026-06-18";

describe("deriveStatus", () => {
  it("keeps an idea an idea regardless of dates", () => {
    expect(deriveStatus({ status: "idea" }, TODAY)).toBe(TRIP_STATUS.IDEA);
  });
  it("reads traveling when today falls in the window, even if stored planning", () => {
    expect(deriveStatus({ status: "planning", startDate: "2026-06-17", endDate: "2026-06-20" }, TODAY)).toBe(TRIP_STATUS.TRAVELING);
  });
  it("reads completed when the window has passed", () => {
    expect(deriveStatus({ status: "booked", startDate: "2026-06-01", endDate: "2026-06-05" }, TODAY)).toBe(TRIP_STATUS.COMPLETED);
  });
  it("keeps booked for a future dated trip", () => {
    expect(deriveStatus({ status: "booked", startDate: "2026-07-01", endDate: "2026-07-10" }, TODAY)).toBe(TRIP_STATUS.BOOKED);
  });
  it("defaults undated non-idea trips to planning", () => {
    expect(deriveStatus({ status: "" }, TODAY)).toBe(TRIP_STATUS.PLANNING);
  });
  it("handles a single-day trip (no endDate)", () => {
    expect(deriveStatus({ status: "planning", startDate: TODAY }, TODAY)).toBe(TRIP_STATUS.TRAVELING);
  });
});

describe("predicates", () => {
  it("isIdea / isTraveling / isCompleted", () => {
    expect(isIdea({ status: "idea" })).toBe(true);
    expect(isTraveling({ startDate: "2026-06-17", endDate: "2026-06-19" }, TODAY)).toBe(true);
    expect(isCompleted({ startDate: "2026-01-01", endDate: "2026-01-02" }, TODAY)).toBe(true);
  });
});

describe("startsWithin", () => {
  it("true within window, false outside", () => {
    expect(startsWithin({ startDate: "2026-06-19" }, 1, TODAY)).toBe(true);
    expect(startsWithin({ startDate: "2026-06-25" }, 1, TODAY)).toBe(false);
    expect(startsWithin({ startDate: "2026-06-10" }, 1, TODAY)).toBe(false); // already started
    expect(startsWithin({}, 3, TODAY)).toBe(false);
  });
});

describe("compareForHome", () => {
  it("orders traveling first, completed last", () => {
    const trips = [
      { id: "done", startDate: "2026-01-01", endDate: "2026-01-02" },
      { id: "now", startDate: "2026-06-17", endDate: "2026-06-20" },
      { id: "idea", status: "idea" },
      { id: "soon", startDate: "2026-07-01", endDate: "2026-07-05" },
    ];
    const sorted = [...trips].sort((a, b) => compareForHome(a, b, TODAY)).map(t => t.id);
    expect(sorted[0]).toBe("now");
    expect(sorted[sorted.length - 1]).toBe("done");
  });
});

describe("migrateIdeasToTrips", () => {
  it("converts ideas into idea-trips non-destructively", () => {
    const state = { trips: [], travelIdeas: [{ id: "i1", destination: "Germany", description: "castles", tags: ["fall"], createdAt: "2026-05-01T00:00:00Z" }] };
    const added = migrateIdeasToTrips(state, { now: "2026-06-18T00:00:00Z" });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: "trip_idea_i1", name: "Germany", status: "idea", fromIdeaId: "i1", notes: "castles" });
    // original ideas untouched
    expect(state.travelIdeas).toHaveLength(1);
  });
  it("is idempotent — re-running adds nothing", () => {
    const state = { trips: [{ id: "trip_idea_i1" }], travelIdeas: [{ id: "i1", destination: "Germany" }] };
    expect(migrateIdeasToTrips(state)).toHaveLength(0);
  });
  it("returns [] when there are no ideas", () => {
    expect(migrateIdeasToTrips({ trips: [], travelIdeas: [] })).toEqual([]);
    expect(migrateIdeasToTrips({})).toEqual([]);
  });
});
