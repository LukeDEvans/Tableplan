import { describe, it, expect } from "vitest";
import { unionById, unionStrings, unionByKey, mergeTombstones, tombstoneSetFor } from "../state-sync.js";

describe("unionById — the core cross-device list merge", () => {
  it("unions by id, newer (a) winning on collision", () => {
    const older = [{ id: "1", v: "old1" }, { id: "2", v: "old2" }];
    const newer = [{ id: "2", v: "new2" }, { id: "3", v: "new3" }];
    const out = unionById(newer, older);
    expect(out.map((x) => x.id).sort()).toEqual(["1", "2", "3"]);
    expect(out.find((x) => x.id === "2").v).toBe("new2"); // newer wins
  });
  it("EMPTY-NEVER-ERASES: an empty newer keeps all of older (the data-loss guard)", () => {
    const older = [{ id: "1" }, { id: "2" }];
    expect(unionById([], older)).toHaveLength(2);
    expect(unionById(null, older)).toHaveLength(2);
  });
  it("drops records without a stable id (can't be merged safely)", () => {
    expect(unionById([{ v: "x" }], [{ id: "1" }])).toEqual([{ id: "1" }]);
  });
  it("a tombstoned id is removed even if present on either side (deletion propagates)", () => {
    const older = [{ id: "1" }, { id: "2" }];
    const newer = [{ id: "2" }, { id: "3" }];
    const out = unionById(newer, older, new Set(["2"]));
    expect(out.map((x) => x.id).sort()).toEqual(["1", "3"]);
  });
});

describe("unionStrings", () => {
  it("de-dupes, strips empty strings, keeps a-then-b order (faithful to mergeStates)", () => {
    expect(unionStrings(["a", "b", ""], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("empty newer keeps older", () => {
    expect(unionStrings([], ["x", "y"])).toEqual(["x", "y"]);
  });
});

describe("unionByKey", () => {
  it("unions keys, newer wins on conflict; empty newer keeps older (empty-never-erases)", () => {
    expect(unionByKey({ b: "new" }, { a: "old", b: "old" })).toEqual({ a: "old", b: "new" });
    expect(unionByKey({}, { a: 1 })).toEqual({ a: 1 });
    expect(unionByKey(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("mergeTombstones", () => {
  it("unions each key's id list across both sides", () => {
    const out = mergeTombstones({ recipes: ["1", "2"] }, { recipes: ["2", "3"], watchItems: ["9"] });
    expect(out.recipes.sort()).toEqual(["1", "2", "3"]);
    expect(out.watchItems).toEqual(["9"]);
  });
  it("handles missing/empty inputs", () => {
    expect(mergeTombstones(null, null)).toEqual({});
  });
});

describe("tombstoneSetFor + unionById together (mergeStates delegation path)", () => {
  it("resolves a per-key tombstone set and applies it", () => {
    const tombstones = { recipes: ["2"] };
    const set = tombstoneSetFor(tombstones, "recipes");
    expect(unionById([{ id: "2" }], [{ id: "1" }], set).map((x) => x.id)).toEqual(["1"]);
    expect(tombstoneSetFor(tombstones, "watchItems")).toBe(null); // no tombstones for key
    expect(tombstoneSetFor({}, "recipes")).toBe(null);
  });
});
