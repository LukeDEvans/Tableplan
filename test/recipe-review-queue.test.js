// Recipe Box review queue: recipes that weren't typed in by hand wait here until
// they're reviewed + saved. Pure queue logic + the function handler (network mocked).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const R = require("../netlify/functions/_recipe-review.js");

const item = (id, recipe, source = "gmail") => R.normalizeQueueItem({ id, source, recipe }, { now: "2026-09-29T00:00:00Z" });

describe("_recipe-review pure logic", () => {
  it("uses a service-only row id (no ':' so client RLS never matches)", () => {
    expect(R.reviewRowId("abc")).toBe("recipereview_abc");
    expect(R.reviewRowId("abc")).not.toContain(":");
  });

  it("normalizes items, bounding fields and defaulting unknown sources", () => {
    const it1 = R.normalizeQueueItem({ source: "bogus", recipe: { name: "  Soup  ", steps: ["a", "b"], servings: "4", extra: "x" } }, { createId: () => "new-id" });
    expect(it1.id).toBe("new-id");
    expect(it1.source).toBe("other");
    expect(it1.recipe.name).toBe("Soup");
    expect(it1.recipe.steps).toBe("a\nb");
    expect(it1.recipe.servings).toBe(4);
    expect(it1.recipe).not.toHaveProperty("extra");
  });

  it("adds newest-first and de-duplicates on the canonical source URL", () => {
    let state = R.addToQueue({}, item("1", { name: "A", sourceUrl: "https://ex.com/r/1?utm_source=x" }));
    state = R.addToQueue(state, item("2", { name: "B", sourceUrl: "https://ex.com/r/2" }));
    state = R.addToQueue(state, item("3", { name: "A again", sourceUrl: "https://EX.com/r/1/" }));
    expect(state.items.map((i) => i.id)).toEqual(["3", "2"]);
  });

  it("rejects an item with nothing reviewable", () => {
    expect(R.addToQueue({}, item("1", { name: "", ingredients: [], steps: "" }))).toBeNull();
  });

  it("caps the queue", () => {
    let state = {};
    for (let n = 0; n < R.MAX_ITEMS + 5; n++) state = R.addToQueue(state, item(String(n), { name: `R${n}` }));
    expect(state.items).toHaveLength(R.MAX_ITEMS);
    expect(state.items[0].id).toBe(String(R.MAX_ITEMS + 4));
  });

  it("removes by id, and skips the write when nothing matched", () => {
    const state = { items: [item("1", { name: "A" }), item("2", { name: "B" })] };
    expect(R.removeFromQueue(state, ["1"]).items.map((i) => i.id)).toEqual(["2"]);
    expect(R.removeFromQueue(state, ["nope"])).toBeNull();
  });
});

describe("recipe-review handler", () => {
  let rowState;
  let rowUpdatedAt;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    rowState = null;
    rowUpdatedAt = "t0";
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (u.includes("/auth/v1/user")) return ok({ id: "user-1" });
      if (u.includes("tableplan_states")) {
        const method = opts.method || "GET";
        const rowId = method === "POST" ? JSON.parse(opts.body).id : decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]);
        if (rowId !== "recipereview_user-1") throw new Error(`wrong row ${rowId}`);
        if (method === "GET") return ok(rowState ? [{ state: rowState, updated_at: rowUpdatedAt }] : []);
        const body = JSON.parse(opts.body);
        if (method === "POST") { rowState = body.state; return ok([]); }
        if (method === "PATCH") { rowState = body.state; rowUpdatedAt = body.updated_at; return ok([{ id: "row" }]); }
      }
      throw new Error(`unexpected fetch ${u}`);
    });
  });
  afterEach(() => { globalThis.fetch = origFetch; });

  const call = async (body, token = "tok") => {
    const { handler } = require("../netlify/functions/recipe-review.js");
    const res = await handler({ httpMethod: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  it("requires auth", async () => {
    expect((await call({ action: "list" }, "")).status).toBe(401);
  });

  it("add → list → remove round-trips through the user's row", async () => {
    const added = await call({ action: "add", source: "extension", recipe: { name: "Chili", sourceUrl: "https://ex.com/chili", ingredients: [{ item: "beans" }] } });
    expect(added.body.error || "").toBe("");
    expect(added.status).toBe(200);
    expect(added.body.items).toHaveLength(1);
    expect(added.body.items[0].source).toBe("extension");

    const listed = await call({ action: "list" });
    expect(listed.body.items.map((i) => i.recipe.name)).toEqual(["Chili"]);

    const removed = await call({ action: "remove", ids: [added.body.id] });
    expect(removed.body.items).toEqual([]);
    expect(rowState.items).toEqual([]);
  });

  it("rejects an empty recipe with 400", async () => {
    expect((await call({ action: "add", recipe: {} })).status).toBe(400);
  });
});
