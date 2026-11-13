import { describe, it, expect } from "vitest";
import { unionById, unionStrings, unionByKey, mergeTombstones, tombstoneSetFor, computeDirtySections, writeDirtySections, tombstoneIdsFor, effectiveTombstones, addTombstone, removeTombstone, ownedTombstoneKey } from "../state-sync.js";

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

// ── Per-view delete lists ────────────────────────────────────────────────────
// "Remove from the household list" must not remove the same id from Personal
// (ISSUES.md, 2026-10-27). HH / ME / BIZ are row owners.
describe("per-view delete lists", () => {
  const HH = "household", ME = "u-luke", BIZ = "space-1";

  it("a delete made in one view applies there and nowhere else", () => {
    const t = {};
    addTombstone(t, "podcasts", "show-1", HH);
    expect(tombstoneIdsFor(t, "podcasts", HH)).toEqual(["show-1"]);
    expect(tombstoneIdsFor(t, "podcasts", ME)).toEqual([]);
    expect(tombstoneIdsFor(t, "podcasts", BIZ)).toEqual([]);
  });

  it("is also written under the plain key, which older builds read", () => {
    const t = {};
    addTombstone(t, "podcasts", "show-1", HH);
    expect(t.podcasts).toEqual(["show-1"]);
    expect(t[ownedTombstoneKey("podcasts", HH)]).toEqual(["show-1"]);
  });

  it("a delete from before this change (plain key only) still applies in every view", () => {
    const t = { podcasts: ["old-1"] };
    addTombstone(t, "podcasts", "show-1", HH);
    expect(tombstoneIdsFor(t, "podcasts", HH).sort()).toEqual(["old-1", "show-1"]);
    expect(tombstoneIdsFor(t, "podcasts", ME)).toEqual(["old-1"]);
  });

  it("the same id deleted in both views is deleted in both", () => {
    const t = {};
    addTombstone(t, "watchItems", "w1", HH);
    addTombstone(t, "watchItems", "w1", ME);
    expect(tombstoneIdsFor(t, "watchItems", HH)).toEqual(["w1"]);
    expect(tombstoneIdsFor(t, "watchItems", ME)).toEqual(["w1"]);
    expect(tombstoneIdsFor(t, "watchItems", BIZ)).toEqual([]);
  });

  it("a row that can't be named yet holds a view's delete back rather than applying it", () => {
    const t = { podcasts: ["old-1"] };
    addTombstone(t, "podcasts", "show-1", HH);
    expect(tombstoneIdsFor(t, "podcasts", null)).toEqual(["old-1"]);
  });

  it("a key with one row for everyone is unchanged (no owner, plain list)", () => {
    const t = {};
    addTombstone(t, "recipes", "r1", null);
    expect(t).toEqual({ recipes: ["r1"] });
    expect(tombstoneIdsFor(t, "recipes", null)).toBe(t.recipes);
  });

  it("taking a delete back clears it for that view only", () => {
    const t = {};
    addTombstone(t, "watchItems", "w1", HH);
    addTombstone(t, "watchItems", "w1", ME);
    removeTombstone(t, "watchItems", "w1", ME);
    expect(tombstoneIdsFor(t, "watchItems", ME)).toEqual([]);
    expect(tombstoneIdsFor(t, "watchItems", HH)).toEqual(["w1"]);
  });

  it("keeps each list to its newest ids", () => {
    const t = {};
    for (let i = 0; i < 5; i++) addTombstone(t, "podcasts", `s${i}`, HH, 3);
    expect(t.podcasts).toEqual(["s2", "s3", "s4"]);
    expect(t[ownedTombstoneKey("podcasts", HH)]).toEqual(["s2", "s3", "s4"]);
  });

  it("survives the cross-device union (mergeTombstones keeps owned keys)", () => {
    const a = {}; addTombstone(a, "podcasts", "show-1", HH);
    const b = {}; addTombstone(b, "podcasts", "show-2", ME);
    const merged = mergeTombstones(a, b);
    expect(tombstoneIdsFor(merged, "podcasts", HH)).toEqual(["show-1"]);
    expect(tombstoneIdsFor(merged, "podcasts", ME)).toEqual(["show-2"]);
  });

  it("effectiveTombstones resolves every key for its own row", () => {
    const t = { recipes: ["r1"] };
    addTombstone(t, "podcasts", "show-1", HH);
    addTombstone(t, "watchItems", "w1", ME);
    const ownerOf = (key) => ({ podcasts: ME, watchItems: ME }[key] || null);
    expect(effectiveTombstones(t, ownerOf)).toEqual({ recipes: ["r1"], podcasts: [], watchItems: ["w1"] });
  });

  it("effectiveTombstones is the map itself when nothing is owned (no behaviour change)", () => {
    const t = { recipes: ["r1"], podcasts: ["p1"] };
    expect(effectiveTombstones(t, () => HH)).toBe(t);
    expect(effectiveTombstones(null)).toEqual({});
  });

  it("the union then filters as mergeStates does: Personal keeps what Household removed", () => {
    const t = {};
    addTombstone(t, "podcasts", "show-1", HH);
    const personal = unionById([{ id: "show-1" }], [{ id: "show-1" }, { id: "show-2" }], tombstoneSetFor(effectiveTombstones(t, () => ME), "podcasts"));
    const household = unionById([], [{ id: "show-1" }], tombstoneSetFor(effectiveTombstones(t, () => HH), "podcasts"));
    expect(personal.map((x) => x.id)).toEqual(["show-1", "show-2"]);
    expect(household).toEqual([]);
  });
});

// ── writeStateToSupabase bookkeeping (INF-1) ─────────────────────────────────
// A miniature of app.js's write path: state → dirty sections → concurrent writes
// → lastWritten recorded from what each write SENT. The regression being guarded:
// edits made while a write is in flight were marked clean and never sent.
function makeEngine(sections, initialState) {
  const state = structuredClone(initialState);
  let lastWritten = null;
  const server = {};
  const pending = [];
  const sectionJson = (keys) => JSON.stringify(Object.fromEntries(keys.filter((k) => k in state).map((k) => [k, state[k]])));
  // Deferred writer: captures the payload synchronously (like writeSectionWithMerge),
  // resolves only when the test releases it.
  const writeOne = ({ section, keys }) => {
    const sent = sectionJson(keys);
    return new Promise((resolve, reject) => {
      pending.push({ section, release: () => { server[section] = sent; resolve(sent); }, fail: () => reject(new Error(`${section} failed`)) });
    });
  };
  async function save() {
    const dirty = computeDirtySections(sections, sectionJson, lastWritten);
    if (!dirty.length) return { wrote: [] };
    const { written, error } = await writeDirtySections(dirty, writeOne);
    lastWritten = { ...(lastWritten || {}), ...written };
    return { wrote: dirty.map((d) => d.section), error };
  }
  const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));
  return { state, server, pending, save, flushMicrotasks, get lastWritten() { return lastWritten; } };
}

describe("computeDirtySections", () => {
  const sections = { a: ["x"], b: ["y"] };
  const json = (st) => (keys) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, st[k]])));
  it("null lastWritten ⇒ every section is dirty", () => {
    expect(computeDirtySections(sections, json({ x: 1, y: 2 }), null).map((d) => d.section)).toEqual(["a", "b"]);
  });
  it("only sections whose JSON differs are dirty; skip() excludes a section (finance gate)", () => {
    const st = { x: 1, y: 2 };
    const lw = { a: JSON.stringify({ x: 1 }), b: JSON.stringify({ y: 1 }) };
    expect(computeDirtySections(sections, json(st), lw).map((d) => d.section)).toEqual(["b"]);
    expect(computeDirtySections(sections, json(st), null, (s) => s === "a").map((d) => d.section)).toEqual(["b"]);
  });
  it("captures the JSON at planning time (T0)", () => {
    const st = { x: 1, y: 2 };
    const [a] = computeDirtySections({ a: ["x"] }, json(st), null);
    st.x = 99;
    expect(a.json).toBe(JSON.stringify({ x: 1 }));
  });
});

describe("writeDirtySections — in-flight edits are never marked clean (INF-1)", () => {
  it("an edit made DURING the write stays dirty and is sent by the next save", async () => {
    const eng = makeEngine({ fin: ["budget"] }, { budget: 100 });
    const p = eng.save();
    await eng.flushMicrotasks();
    eng.state.budget = 250;           // user edits while the PATCH is in flight
    eng.pending.shift().release();    // server acknowledges the T0 payload
    await p;
    expect(eng.server.fin).toBe(JSON.stringify({ budget: 100 }));
    expect(eng.lastWritten.fin).toBe(JSON.stringify({ budget: 100 })); // NOT the live 250
    const p2 = eng.save();
    await eng.flushMicrotasks();
    expect(eng.pending).toHaveLength(1); // the edit is still dirty → written
    eng.pending.shift().release();
    await p2;
    expect(eng.server.fin).toBe(JSON.stringify({ budget: 250 }));
    expect((await eng.save()).wrote).toEqual([]); // now clean
  });

  it("one failing section doesn't stop the others being marked; the failure stays dirty and is reported", async () => {
    const eng = makeEngine({ a: ["x"], b: ["y"] }, { x: 1, y: 2 });
    const p = eng.save();
    await eng.flushMicrotasks();
    const [wa, wb] = eng.pending.splice(0);
    wa.release();
    wb.fail();
    const res = await p;
    expect(res.error).toBeInstanceOf(Error);
    expect(eng.lastWritten.a).toBe(JSON.stringify({ x: 1 }));
    expect(eng.lastWritten.b).toBeUndefined();
    const p2 = eng.save();
    await eng.flushMicrotasks();
    expect(eng.pending.map((w) => w.section)).toEqual(["b"]); // only the failed one retries
    eng.pending.shift().release();
    await p2;
  });

  it("records the JSON the writer reports (a conflict-merge rewrite), falling back to the planned JSON", async () => {
    const dirty = [{ section: "a", keys: ["x"], json: "planned-a" }, { section: "b", keys: ["y"], json: "planned-b" }];
    const { written, error } = await writeDirtySections(dirty, async ({ section }) => (section === "a" ? "merged-a" : undefined));
    expect(error).toBe(null);
    expect(written).toEqual({ a: "merged-a", b: "planned-b" });
  });
});
