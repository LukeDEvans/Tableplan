import { describe, it, expect } from "vitest";
import { unionById, unionStrings, unionByKey, mergeTombstones, tombstoneSetFor, computeDirtySections, writeDirtySections } from "../state-sync.js";

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
