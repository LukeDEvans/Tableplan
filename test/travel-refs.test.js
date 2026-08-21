import { describe, it, expect } from "vitest";
import {
  REF_KINDS, makeRef, addRef, removeRef, hasRef, refsOfKind, groupByKind,
  shopByBucket, rankCandidates,
} from "../travel-refs.js";

describe("makeRef / addRef dedupe", () => {
  it("references a canonical object by id, never copies", () => {
    const r = makeRef(REF_KINDS.WATCH, { refId: "watch_1", title: "Rome, Open City" });
    expect(r.kind).toBe("watch");
    expect(r.refId).toBe("watch_1");
  });
  it("addRef is idempotent by kind+refId and non-mutating", () => {
    const a = makeRef(REF_KINDS.WATCH, { refId: "w1", title: "A" });
    let refs = addRef([], a);
    const before = refs;
    refs = addRef(refs, makeRef(REF_KINDS.WATCH, { refId: "w1", title: "A again" }));
    expect(refs).toHaveLength(1);
    expect(before).toHaveLength(1); // original array untouched
  });
  it("free-form refs dedupe by kind+title", () => {
    let refs = addRef([], makeRef(REF_KINDS.NOTE, { title: "Try the gelato" }));
    refs = addRef(refs, makeRef(REF_KINDS.NOTE, { title: "try the GELATO" }));
    expect(refs).toHaveLength(1);
  });
  it("different kinds with same title coexist", () => {
    let refs = addRef([], makeRef(REF_KINDS.NOTE, { title: "Louvre" }));
    refs = addRef(refs, makeRef(REF_KINDS.LINK, { title: "Louvre", url: "http://x" }));
    expect(refs).toHaveLength(2);
  });
});

describe("removeRef / query", () => {
  it("removes by id", () => {
    const a = makeRef(REF_KINDS.SHOP, { title: "Sunscreen" });
    const refs = removeRef([a], a.id);
    expect(refs).toHaveLength(0);
  });
  it("refsOfKind and groupByKind", () => {
    const refs = [makeRef(REF_KINDS.WATCH, { refId: "1" }), makeRef(REF_KINDS.SHOP, { title: "x" }), makeRef(REF_KINDS.WATCH, { refId: "2" })];
    expect(refsOfKind(refs, "watch")).toHaveLength(2);
    expect(Object.keys(groupByKind(refs)).sort()).toEqual(["shop", "watch"]);
  });
});

describe("shopByBucket", () => {
  it("groups shop refs into three buckets, unknown → before", () => {
    const refs = [
      makeRef(REF_KINDS.SHOP, { title: "Adapter", bucket: "before" }),
      makeRef(REF_KINDS.SHOP, { title: "Snacks", bucket: "during" }),
      makeRef(REF_KINDS.SHOP, { title: "Gifts", bucket: "bring-home" }),
      makeRef(REF_KINDS.SHOP, { title: "Mystery", bucket: "???" }),
    ];
    const b = shopByBucket(refs);
    expect(b.before.map(r => r.title)).toEqual(["Adapter", "Mystery"]);
    expect(b.during).toHaveLength(1);
    expect(b["bring-home"]).toHaveLength(1);
  });
});

describe("rankCandidates", () => {
  const items = [
    { title: "The Paris Review", createdAt: "2026-01-01" },
    { title: "Tokyo Vice", createdAt: "2026-06-01" },
    { title: "A history of Rome", createdAt: "2026-03-01" },
  ];
  it("floats destination matches, then most recent", () => {
    const ranked = rankCandidates(items, "Rome, Italy", { limit: 3 });
    expect(ranked[0].item.title).toBe("A history of Rome");
    expect(ranked[0].matched).toBe(true);
  });
  it("falls back to recency when nothing matches", () => {
    const ranked = rankCandidates(items, "Reykjavik", { limit: 2 });
    expect(ranked[0].item.title).toBe("Tokyo Vice"); // newest
    expect(ranked).toHaveLength(2);
  });
  it("handles empty destination and empty list", () => {
    expect(rankCandidates([], "X")).toEqual([]);
    expect(rankCandidates(items, "").length).toBe(3);
  });
});
