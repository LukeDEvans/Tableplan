import { describe, it, expect } from "vitest";
import { boughtCyclesByKey, manualItemCarry, resetBoughtMarks, CARRY_FROM_CYCLE } from "../grocery-bought.js";

// Cycle keys are the shopping range's end date (normally the upcoming Friday).
const FRI_1 = "2026-10-09";
const FRI_2 = "2026-10-16";
const FRI_3 = "2026-10-23";

describe("bought manual grocery items don't come back unchecked", () => {
  it("indexes checked and swept marks by row, ignoring false marks", () => {
    const index = boughtCyclesByKey(
      { [`${FRI_1}|milk`]: true, [`${FRI_2}|milk`]: false, [`${FRI_1}|egg`]: true, "week|bread": true },
      { [`${FRI_2}::battery`]: true, [`${FRI_1}::milk`]: true, [`${FRI_1}::egg`]: false }
    );
    expect([...index.get("milk")]).toEqual([FRI_1]);
    expect([...index.get("egg")]).toEqual([FRI_1]);
    expect([...index.get("battery")]).toEqual([FRI_2]);
    expect([...index.get("bread")]).toEqual(["week"]);
    expect(boughtCyclesByKey(null, undefined).size).toBe(0);
  });

  it("the Friday rollover: checked off last cycle → retired, not listed again", () => {
    // Checked Thursday in the cycle ending Fri Oct 9; opened Friday (cycle is now Oct 16).
    expect(manualItemCarry(new Set([FRI_1]), { currentCycle: FRI_2, today: FRI_1 })).toBe("retire");
    expect(manualItemCarry(new Set([FRI_1]), { currentCycle: FRI_2, today: "2026-10-12" })).toBe("retire");
  });

  it("a mark in the current cycle is the normal case — nothing carries", () => {
    expect(manualItemCarry(new Set([FRI_2]), { currentCycle: FRI_2, today: "2026-10-12" })).toBe("");
    expect(manualItemCarry(new Set(), { currentCycle: FRI_2, today: "2026-10-12" })).toBe("");
    expect(manualItemCarry(undefined, { currentCycle: FRI_2, today: "2026-10-12" })).toBe("");
  });

  it("moving the date range: bought in a cycle that hasn't ended stays bought", () => {
    // Bought with the range ending Oct 16, then the range was stretched to Oct 23.
    expect(manualItemCarry(new Set([FRI_2]), { currentCycle: FRI_3, today: "2026-10-12" })).toBe("bought");
    // …and once that cycle is over it is retired.
    expect(manualItemCarry(new Set([FRI_2]), { currentCycle: FRI_3, today: FRI_2 })).toBe("retire");
  });

  it("marks from before the item was added again don't count", () => {
    // Bought in the Oct 9 cycle, typed in again on Oct 12: the old mark is stale.
    expect(manualItemCarry(new Set([FRI_1]), { currentCycle: FRI_2, today: "2026-10-12", addedDay: "2026-10-12" })).toBe("");
    // Added on Oct 7, bought in the Oct 9 cycle: the mark is after the add.
    expect(manualItemCarry(new Set([FRI_1]), { currentCycle: FRI_2, today: "2026-10-12", addedDay: "2026-10-07" })).toBe("retire");
  });

  it("nothing checked off before the rule existed is removed", () => {
    expect(CARRY_FROM_CYCLE).toBe(FRI_1);
    expect(manualItemCarry(new Set(["2026-09-25", "2026-10-02"]), { currentCycle: FRI_2, today: "2026-10-12" })).toBe("");
    expect(manualItemCarry(new Set(["week"]), { currentCycle: FRI_2, today: "2026-10-12" })).toBe("");
  });

  it("resetBoughtMarks turns one row's marks off in every cycle, leaving others", () => {
    const checked = { [`${FRI_1}|milk`]: true, [`${FRI_2}|milk`]: true, [`${FRI_1}|egg`]: true, [`${FRI_1}|oat milk`]: true };
    const cleared = { [`${FRI_1}::milk`]: true, [`${FRI_1}::egg`]: true };
    expect(resetBoughtMarks(checked, cleared, "milk")).toBe(true);
    expect(checked).toEqual({ [`${FRI_1}|milk`]: false, [`${FRI_2}|milk`]: false, [`${FRI_1}|egg`]: true, [`${FRI_1}|oat milk`]: true });
    expect(cleared).toEqual({ [`${FRI_1}::milk`]: false, [`${FRI_1}::egg`]: true });
    expect(boughtCyclesByKey(checked, cleared).has("milk")).toBe(false);
    expect(resetBoughtMarks(checked, cleared, "milk")).toBe(false); // nothing left to change
    expect(resetBoughtMarks(null, undefined, "milk")).toBe(false);
  });
});
