import { describe, it, expect } from "vitest";
import { listSnapshot, stampListChanges, mergeListStamps, mergeStampedList, pruneListStamps, normalizeListStamps } from "../stamped-lists.js";

const T1 = "2026-11-01T00:00:00.000Z", T2 = "2026-11-02T00:00:00.000Z", T3 = "2026-11-03T00:00:00.000Z";

describe("stamped lists", () => {
  it("an empty copy no longer erases the list", () => {
    const full = [{ id: "a" }, { id: "b" }];
    expect(mergeStampedList("radioFavorites", [], full, {})).toEqual(full);
  });

  it("a removal stamped after the add drops the item from every copy", () => {
    const stamps = { radioFavorites: { a: { added: T1, removed: T2 } } };
    expect(mergeStampedList("radioFavorites", [{ id: "b" }], [{ id: "a" }, { id: "b" }], stamps)).toEqual([{ id: "b" }]);
  });

  it("re-adding after a removal keeps it", () => {
    const stamps = mergeListStamps({ radioFavorites: { a: { removed: T2 } } }, { radioFavorites: { a: { added: T3 } } });
    expect(mergeStampedList("radioFavorites", [{ id: "a" }], [], stamps)).toEqual([{ id: "a" }]);
  });

  it("persist stamps adds and removals against the baseline", () => {
    const state = { radioFavorites: [{ id: "a" }, { id: "b" }], nextStopItems: [] };
    const base = listSnapshot(state);
    state.radioFavorites = [{ id: "b" }, { id: "c" }];
    const { changed } = stampListChanges(state, base, T2);
    expect(changed).toEqual(["radioFavorites"]);
    expect(state.mediaListStamps.radioFavorites).toEqual({ a: { removed: T2 }, c: { added: T2 } });
    expect(state.groceryNextStopStamps).toBeUndefined();
  });

  it("first copy wins for duplicate ids", () => {
    expect(mergeStampedList("nextStopItems", [{ id: "x", n: 2 }], [{ id: "x", n: 1 }], {})).toEqual([{ id: "x", n: 2 }]);
  });

  it("normalize drops junk and unknown lists; prune drops old unlisted stamps", () => {
    expect(normalizeListStamps({ other: { a: { added: T1 } }, radioFavorites: { b: { added: "nope" }, c: 3 } })).toEqual({});
    const pruned = pruneListStamps({ radioFavorites: { a: { removed: T1 }, b: { added: T1 } } }, { radioFavorites: [{ id: "b" }] }, "2027-06-01T00:00:00.000Z");
    expect(pruned).toEqual({ radioFavorites: { b: { added: T1 } } });
  });
});
