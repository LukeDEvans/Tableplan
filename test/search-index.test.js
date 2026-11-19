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
    for (const t of ["recipe", "article", "task", "contact", "trip", "event", "watch", "podcast", "shop"]) expect(types.has(t)).toBe(true);
  });
});

// ── Universal search (UNIVERSAL_SEARCH_DESIGN.md, phase 1) ───────────────────
import { tokenize, fold, toSearchDocsForViews, createIndexCache, groupResults, SOURCES, SOURCE_TYPES } from "../search-index.js";

describe("text handling", () => {
  it("folds accents and keeps letters from any script", () => {
    expect(fold("Café Één")).toBe("cafe een");
    expect(tokenize("Jalapeño-poppers, crème brûlée")).toEqual(["jalapeno", "poppers", "creme", "brulee"]);
    expect(tokenize("Groß straße")).toEqual(["groß", "straße"]);
  });
  it("keeps single digits (e.g. 'Part 2') but drops single letters", () => {
    expect(tokenize("Part 2 a")).toEqual(["part", "2"]);
  });
  it("finds accented titles from plain typing and the reverse", () => {
    const idx = buildIndex(toSearchDocs({ recipes: [{ id: "r", name: "Café au lait" }], doBacklog: [{ id: "t", title: "Buy cafe filters" }] }));
    expect(search(idx, "cafe").map((r) => r.id).sort()).toEqual(["r", "t"]);
    expect(search(idx, "café").map((r) => r.id).sort()).toEqual(["r", "t"]);
  });
});

describe("sources", () => {
  const data = {
    recipes: [{ id: "r1", name: "Lentil soup", tags: ["soup"], ingredients: [{ item: "red lentils" }, { item: "lemon" }] }],
    doPlans: { "2026-11-13": { tuesday: [{ id: "t1", title: "Call plumber" }], "friday-start": [{ id: "t0", title: "Groceries run", done: true }] } },
    doBacklog: [{ id: "b1", title: "Fix gate" }],
    planEvents: [{ id: "e1", title: "Sophia swim", date: "2026-11-17", location: { name: "Gopher Swim School" } }],
    trips: [{ id: "tr1", name: "Duluth weekend", destination: "Duluth, MN", startDate: "2026-11-27" }],
    watchItems: [{ id: "w1", title: "Severance", type: "tv", status: "want" }],
    podcasts: [{ id: "p1", title: "The Rest Is History", author: "Goalhanger" }],
    persistentManualGroceries: ["Milk", "Oat milk"],
    contacts: [{ id: "c1", name: "Dr. Patel", phones: [{ value: "612-555-0100" }], emails: [{ value: "patel@example.com" }], photo: "data:image/png;base64,AAAA" }],
  };

  it("covers every source type", () => {
    const types = new Set(toSearchDocs(data).map((d) => d.type));
    for (const t of ["recipe", "task", "event", "trip", "watch", "podcast", "shop", "contact"]) expect(types.has(t)).toBe(true);
    expect(SOURCE_TYPES).toContain("trip_idea");
  });
  it("dates planner tasks by their day in the Friday-start week", () => {
    const docs = toSearchDocs(data, { types: ["task"] });
    expect(docs.find((d) => d.id === "t1").date).toBe("2026-11-17");
    expect(docs.find((d) => d.id === "t0")).toMatchObject({ date: "2026-11-13", detail: "done" });
    expect(docs.find((d) => d.id === "b1")).toMatchObject({ date: null, detail: "backlog" });
  });
  it("searches ingredients, event places and contact details, never photo data", () => {
    const idx = buildIndex(toSearchDocs(data));
    expect(search(idx, "lemon")[0].id).toBe("r1");
    expect(search(idx, "gopher")[0].id).toBe("e1");
    expect(search(idx, "612")[0].id).toBe("c1");
    expect(search(idx, "base64")).toEqual([]);
  });
  it("gives shopping items a stable id from their name", () => {
    expect(toSearchDocs(data, { types: ["shop"] }).map((d) => d.id)).toEqual(["shop:milk", "shop:oat milk"]);
  });
  it("every source names a section and keys (liv-mcp reads just those)", () => {
    for (const s of SOURCES) { expect(typeof s.section).toBe("string"); expect(s.keys.length).toBeGreaterThan(0); }
    expect(SOURCES.find((s) => s.type === "podcast").server).toBe(false);
  });
});

describe("ranking and results", () => {
  it("ranks docs matching every word above docs matching some", () => {
    const idx = buildIndex(toSearchDocs({ recipes: [{ id: "a", name: "Lentil curry" }, { id: "b", name: "Lentil soup" }, { id: "c", name: "Tomato soup" }] }));
    expect(search(idx, "lentil soup").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
  it("tags results with view and ref, and prefers the asked-for view", () => {
    const docs = toSearchDocsForViews([
      { view: "household", data: { planEvents: [{ id: "h", title: "Dentist", date: "2026-11-20" }] } },
      { view: "personal", data: { planEvents: [{ id: "p", title: "Dentist", date: "2026-11-20" }] } },
    ]);
    const idx = buildIndex(docs);
    const res = search(idx, "dentist", { view: "personal" });
    expect(res[0]).toMatchObject({ id: "p", view: "personal", ref: { type: "event", id: "p", view: "personal" } });
    expect(search(idx, "dentist", { view: "household" })[0].id).toBe("h");
  });
  it("prefers upcoming over long-past dated items", () => {
    const idx = buildIndex(toSearchDocs({ planEvents: [{ id: "old", title: "Swim class", date: "2025-01-10" }, { id: "soon", title: "Swim class", date: "2026-11-24" }] }));
    expect(search(idx, "swim", { today: "2026-11-19" })[0].id).toBe("soon");
  });
  it("groups results by type with a 'more' count", () => {
    const g = groupResults([{ type: "recipe", id: 1 }, { type: "task", id: 2 }, { type: "recipe", id: 3 }, { type: "recipe", id: 4 }], 2);
    expect(g.map((x) => [x.type, x.label, x.items.length, x.more])).toEqual([["recipe", "Recipe", 2, 1], ["task", "Task", 1, 0]]);
  });
});

describe("createIndexCache", () => {
  it("rebuilds only when the state stamp or view changes", () => {
    const get = createIndexCache();
    const s1 = { stateUpdatedAt: "1", recipes: [{ id: "r", name: "Pho" }] };
    const a = get(s1, { view: "household" });
    expect(get(s1, { view: "household" })).toBe(a);
    expect(get(s1, { view: "personal" })).not.toBe(a);
    const s2 = { ...s1, stateUpdatedAt: "2", recipes: [{ id: "r", name: "Ramen" }] };
    expect(search(get(s2, { view: "household" }), "ramen").length).toBe(1);
  });
});
