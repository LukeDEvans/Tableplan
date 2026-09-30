import { describe, it, expect } from "vitest";
import {
  groceryKey, stampGroceryAdd, stampGroceryRemove, stampGroceryListDiff, isGroceryRemoved,
  mergeGroceryStamps, applyGroceryStamps, pruneGroceryStamps, normalizeGroceryStamps,
} from "../grocery-list-stamps.js";
import { unionStrings } from "../state-sync.js";

const T = (m) => `2026-09-30T10:${String(m).padStart(2, "0")}:00.000Z`;

// Mirrors mergeStates: union the lists, merge stamps, filter removed.
function merge(newer, older) {
  const stamps = mergeGroceryStamps(newer.stamps, older.stamps);
  return { list: applyGroceryStamps(unionStrings(newer.list, older.list), stamps), stamps };
}

describe("grocery list stamps — removals survive a sync", () => {
  it("normalizes like the grocery code (quantities, case, spacing)", () => {
    expect(groceryKey("2 Eggs")).toBe("eggs");
    expect(groceryKey("  Oat   Milk ")).toBe("oat milk");
  });

  it("a removal on one device isn't undone by the other device's older copy", () => {
    const phone = { list: ["eggs", "milk"], stamps: {} };
    const laptop = { list: ["eggs", "milk"], stamps: {} };
    phone.list = phone.list.filter((x) => x !== "milk");
    stampGroceryRemove(phone.stamps, "milk", T(1));
    expect(merge(phone, laptop).list).toEqual(["eggs"]);
    expect(merge(laptop, phone).list).toEqual(["eggs"]); // either merge direction
  });

  it("re-adding after a removal wins, on any device", () => {
    const a = { list: [], stamps: stampGroceryRemove({}, "milk", T(1)) };
    const b = { list: ["milk"], stamps: stampGroceryAdd({}, "Milk", T(5)) };
    expect(merge(a, b).list).toEqual(["milk"]);
    expect(merge(b, a).list).toEqual(["milk"]);
    // …and a later removal beats that add.
    const c = { list: [], stamps: stampGroceryRemove({}, "milk", T(9)) };
    expect(merge(c, merge(a, b)).list).toEqual([]);
  });

  it("items with no stamps (legacy / never removed) are untouched", () => {
    expect(applyGroceryStamps(["bread", "eggs"], {})).toEqual(["bread", "eggs"]);
    expect(isGroceryRemoved({}, "bread")).toBe(false);
  });

  it("a rename stamps the old name removed and the new one added", () => {
    const s = stampGroceryListDiff({}, ["milk", "eggs"], ["oat milk", "eggs"], T(2));
    expect(s).toEqual({ milk: { removed: T(2) }, "oat milk": { added: T(2) } });
    expect(applyGroceryStamps(["milk", "oat milk", "eggs"], s)).toEqual(["oat milk", "eggs"]);
  });

  it("merging stamps keeps the later time for each of added / removed", () => {
    const m = mergeGroceryStamps({ milk: { added: T(1), removed: T(8) } }, { milk: { added: T(4), removed: T(3) } });
    expect(m).toEqual({ milk: { added: T(4), removed: T(8) } });
  });

  it("prunes old stamps for items not listed, keeps recent ones and listed items'", () => {
    const now = "2026-12-31T00:00:00.000Z";
    const s = { old: { removed: "2026-01-01T00:00:00.000Z" }, recent: { removed: "2026-12-01T00:00:00.000Z" }, listed: { added: "2026-01-01T00:00:00.000Z" } };
    expect(Object.keys(pruneGroceryStamps(s, ["listed"], now)).sort()).toEqual(["listed", "recent"]);
  });

  it("normalize drops junk", () => {
    expect(normalizeGroceryStamps({ a: { added: "nope" }, b: null, c: { removed: T(1), x: 1 } })).toEqual({ c: { removed: T(1) } });
    expect(normalizeGroceryStamps([1, 2])).toEqual({});
  });
});
