import { describe, it, expect } from "vitest";
import { toSearchDocs, buildIndex, indexFromState, isStale, search, SEARCHABLE } from "../search-index.js";

const state = {
  stateUpdatedAt: "2026-09-02T00:00:00Z",
  recipes: [{ id: "r1", name: "Chicken Curry", tags: ["dinner", "spicy"] }, { id: "r2", name: "Pancakes" }],
  savedArticles: [{ id: "a1", title: "The Future of Curry", author: "Jane", publication: "Food" }],
  doTasks: [{ id: "t1", title: "Buy chicken" }],
  contacts: [{ id: "c1", name: "Curry House", phone: "555" }],
  trips: [{ id: "tr1", destination: "Tokyo" }],
  planEvents: [{ id: "e1", title: "Dinner party", notes: "make curry" }],
  mediaSaved: [],
};

describe("toSearchDocs (projection)", () => {
  it("projects curated collections into {id,type,title,text} docs", () => {
    const docs = toSearchDocs(state);
    const byType = docs.reduce((m, d) => ((m[d.type] = (m[d.type] || 0) + 1), m), {});
    expect(byType.recipe).toBe(2);
    expect(byType.article).toBe(1);
    expect(byType.task).toBe(1);
    expect(docs.find((d) => d.id === "r1").text).toContain("dinner");
  });
  it("skips records without an id or a title", () => {
    const docs = toSearchDocs({ recipes: [{ tags: ["x"] }, { id: "r9" /* no name */ }, { id: "r8", name: "Ok" }] });
    expect(docs.map((d) => d.id)).toEqual(["r8"]);
  });
  it("tolerates garbage state", () => {
    expect(toSearchDocs(null)).toEqual([]);
    expect(toSearchDocs({ recipes: "nope" })).toEqual([]);
  });
});

describe("search (ranked, cross-domain)", () => {
  const index = indexFromState(state);

  it("finds matches across domains, title matches ranked higher", () => {
    const res = search(index, "curry");
    const ids = res.map((r) => r.id);
    expect(ids).toContain("r1");  // recipe name
    expect(ids).toContain("a1");  // article title
    expect(ids).toContain("c1");  // contact name
    expect(ids).toContain("e1");  // event notes ("make curry")
    // title/name matches (r1, a1, c1) outrank a text-only match (e1)
    expect(res.findIndex((r) => r.id === "r1")).toBeLessThan(res.findIndex((r) => r.id === "e1"));
  });

  it("supports prefix matching for partial typing", () => {
    const res = search(index, "chick"); // "chicken"
    expect(res.map((r) => r.id)).toEqual(expect.arrayContaining(["r1", "t1"]));
  });

  it("filters by type", () => {
    const res = search(index, "curry", { types: ["recipe"] });
    expect(res.every((r) => r.type === "recipe")).toBe(true);
  });

  it("empty/whitespace query → no results", () => {
    expect(search(index, "")).toEqual([]);
    expect(search(index, "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(search(index, "curry", { limit: 1 }).length).toBe(1);
  });
});

describe("index lifecycle (rebuildable, invalidatable)", () => {
  it("isStale detects state advancing past the index stamp", () => {
    const index = indexFromState(state);
    expect(isStale(index, state)).toBe(false);
    expect(isStale(index, { ...state, stateUpdatedAt: "2026-09-03T00:00:00Z" })).toBe(true);
    expect(isStale(null, state)).toBe(true);
  });

  it("rebuild reflects new data", () => {
    const withNew = { ...state, stateUpdatedAt: "2026-09-03T00:00:00Z", recipes: [...state.recipes, { id: "r3", name: "Ramen" }] };
    const res = search(indexFromState(withNew), "ramen");
    expect(res.map((r) => r.id)).toContain("r3");
  });

  it("SEARCHABLE covers the expected high-value domains", () => {
    const types = new Set(SEARCHABLE.map((s) => s.type));
    for (const t of ["recipe", "article", "task", "contact", "trip", "event", "media"]) expect(types.has(t)).toBe(true);
  });
});
