// liv-mcp: the Edge Function that lets Claude Duet (or any MCP client) read Liv.
// Runs the real index.ts (bundled) against a fake Supabase over fetch, so the key
// check, the view rules and every tool are exercised end to end.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { bundleLivMcp } from "../scripts/build-liv-mcp.mjs";
import { prepWeekKey, localDateKey, slotText, formatDayMeals, TOOLS } from "../supabase/functions/liv-mcp/tools.js";

const URL_BASE = "https://noyocjcltrenwdovqrql.supabase.co";
const LUKE = "11111111-1111-4111-8111-111111111111";
const MJ = "22222222-2222-4222-8222-222222222222";
const G = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
const SPACE = "33333333-3333-4333-8333-333333333333";
const KEY_ID = "44444444-4444-4444-8444-444444444444";
const MJ_KEY_ID = "55555555-5555-4555-8555-555555555555";
const SECRET = "s".repeat(43);
const sha = (s) => createHash("sha256").update(s).digest("hex");
// Tue 2026-11-17, 10:00 in Minneapolis. The prep week starts Fri 2026-11-13.
const NOW = new Date("2026-11-17T16:00:00Z");

let handle, realFetch, db, keys, readsOf, limited;
const realDate = Date;

function install() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (u.pathname === "/rest/v1/rpc/assistant_connector_check") {
      const { p_key, p_secret_hash } = JSON.parse(init.body);
      const k = keys[p_key];
      if (!k || k.hash !== p_secret_hash || k.revoked) return json([]);
      return json([{ user_id: k.user, scopes: k.scopes, limited }]);
    }
    if (u.pathname === "/rest/v1/rpc/assistant_state_read") {
      const { p_row, p_paths } = JSON.parse(init.body);
      readsOf.push(p_row);
      const st = db[p_row];
      if (!st) return json(null);
      const out = {};
      for (const p of p_paths) out[p] = p.split(".").reduce((v, k) => (v == null ? undefined : v[k]), st) ?? null;
      return json(out);
    }
    if (u.pathname === "/rest/v1/live_group_members") {
      const uid = u.searchParams.get("user_id").replace("eq.", "");
      return json(uid === LUKE ? [{ group_id: G, role: "admin" }] : uid === MJ ? [{ group_id: G, role: "member" }] : []);
    }
    if (u.pathname === "/rest/v1/live_space_members") {
      const uid = u.searchParams.get("user_id").replace("eq.", "");
      return json(uid === LUKE ? [{ space_id: SPACE }] : []);
    }
    if (u.pathname === "/rest/v1/eat_recipes") {
      const idf = u.searchParams.get("id");
      const ids = idf ? idf.slice(4, -1).split(",").map((s) => s.replace(/"/g, "")) : null;
      return json(db.recipes.filter((r) => !ids || ids.includes(r.id)));
    }
    return json({ message: `unexpected ${u.pathname}` }, 500);
  };
}

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: "svc" })[k] } };
  const out = await build({ entryPoints: [fileURLToPath(new URL("../supabase/functions/liv-mcp/index.ts", import.meta.url))], bundle: true, format: "esm", write: false, platform: "neutral", logLevel: "silent" });
  ({ handle } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`));
  // The function reads the clock once per request (`new Date()`); pin it.
  globalThis.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [NOW.getTime()])); } static now() { return NOW.getTime(); } };
});
afterAll(() => { globalThis.fetch = realFetch; delete globalThis.Deno; globalThis.Date = realDate; });

beforeEach(() => {
  limited = false;
  readsOf = [];
  keys = {
    [KEY_ID]: { user: LUKE, hash: sha(SECRET), scopes: ["read"] },
    [MJ_KEY_ID]: { user: MJ, hash: sha(SECRET), scopes: ["read"] },
  };
  db = {
    recipes: [
      { id: "r-tacos", name: "Fish Tacos", servings: 4, tags: ["dinner"], ingredients: [{ amount: "1", quantity: "lb", item: "cod" }], steps: "1. Season fish\n2. Grill", prep_time: "10 min", cook_time: "15 min" },
      { id: "r-oats", name: "Overnight Oats", servings: 2, tags: ["breakfast"], ingredients: [{ amount: "1", quantity: "C", item: "oats" }], steps: "" },
    ],
    [`u-${LUKE}:plan`]: { planEvents: [
      { id: "e1", title: "Dentist", date: "2026-11-17", startTime: "14:00", endTime: "15:00", allDay: false },
      { id: "e-gone", title: "Deleted thing", date: "2026-11-17" },
      { id: "e-weekly", title: "Dutch lesson", date: "2026-11-03", recurrence: { freq: "weekly", days: [2] } },
    ], tombstones: { planEvents: ["e-gone"] } },
    [`${G}:plan`]: { planEvents: [{ id: "h1", title: "Sophia swim", date: "2026-11-17", startTime: "17:30", allDay: false }] },
    [`${SPACE}:plan`]: { planEvents: [{ id: "b1", title: "Supplier call", date: "2026-11-18", startTime: "09:00", allDay: false }] },
    [`u-${MJ}:plan`]: { planEvents: [{ id: "m1", title: "MJ private", date: "2026-11-17" }] },
    [`${G}:eat`]: { plans: { "2026-11-13": {
      notes: "Busy week",
      slots: {
        tuesday: {
          "MJ Breakfast": "r-oats", "Luke Breakfast": "r-oats", "Sophia Breakfast": "r-oats",
          "MJ Dinner": { recipeId: "r-tacos", plannedServings: 4 }, "Luke Dinner": { recipeId: "r-tacos" }, "Sophia Dinner": "grocery-item::Mac%20and%20cheese::1",
          "Luke Lunch": "special-meal::out::Chipotle",
        },
      },
    } } },
    [`u-${LUKE}:do`]: { doPlans: { "2026-11-13": { tuesday: [{ id: "t1", title: "Call plumber", done: false }, { id: "t2", title: "Done thing", done: true }] } }, doBacklog: [{ id: "b1", title: "Fix gate", done: false }] },
    [`${G}:do`]: { doPlans: { "2026-11-13": { tuesday: [{ id: "ht", title: "Take out trash", done: false }] } }, doBacklog: [] },
    [`${G}:grocery`]: { persistentManualGroceries: ["Milk", "Coffee"] },
    [`${G}:watch`]: { watchItems: [{ id: "w1", title: "Severance", type: "tv", status: "want" }, { id: "w2", title: "Dune", type: "movie", status: "watched", year: "2021" }] },
    [`${G}:travel`]: { trips: [
      { id: "tr1", name: "Duluth weekend", destination: "Duluth, MN", startDate: "2026-11-27", endDate: "2026-11-29", status: "booked" },
      { id: "tr2", name: "Netherlands", status: "idea" },
      { id: "tr3", name: "Old trip", startDate: "2025-06-01", endDate: "2025-06-05" },
    ] },
  };
  install();
});

const post = (body, { key = `${KEY_ID}.${SECRET}`, how = "bearer", method = "POST" } = {}) => {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  let url = `${URL_BASE}/functions/v1/liv-mcp`;
  if (key && how === "bearer") headers.authorization = `Bearer ${key}`;
  if (key && how === "x-api-key") headers["x-api-key"] = key;
  if (key && how === "path") url += `/k/${key}`;
  return handle(new Request(url, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined }));
};
const call = async (name, args = {}, opts) => {
  const res = await post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, opts);
  const body = await res.json();
  return { res, body, text: body.result?.content?.[0]?.text ?? "" };
};

describe("the bundle", () => {
  it("is up to date with tools.js", async () => {
    const committed = readFileSync(new URL("../supabase/functions/liv-mcp/tools.bundle.js", import.meta.url), "utf8");
    expect(committed).toBe(await bundleLivMcp());
  });
  it("needs nothing Deno lacks (no node:, no DOM)", () => {
    const text = readFileSync(new URL("../supabase/functions/liv-mcp/tools.bundle.js", import.meta.url), "utf8");
    expect(text).not.toMatch(/from\s+["']node:|require\(|document\.|window\.|localStorage/);
  });
});

describe("keys", () => {
  it("refuses a call with no key, a malformed key, a wrong secret or a revoked key", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { key: "" })).status).toBe(401);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { key: "nope" })).status).toBe(401);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { key: `${KEY_ID}.${"x".repeat(43)}` })).status).toBe(401);
    keys[KEY_ID].revoked = true;
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
  });
  it("takes the key as a bearer header, x-api-key or the URL path", async () => {
    for (const how of ["bearer", "x-api-key", "path"]) expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { how })).status).toBe(200);
  });
  it("answers 429 when the database says the key is over its limit", async () => {
    limited = true;
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
  });
  it("only accepts POST", async () => {
    expect((await post(null, { method: "GET" })).status).toBe(405);
  });
});

describe("MCP protocol", () => {
  it("initializes, echoing a supported protocol version", async () => {
    const body = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } } })).json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.serverInfo.name).toBe("liv");
  });
  it("answers a notification with 202 and no body", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
  it("lists only read-only tools", async () => {
    const body = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of body.result.tools) expect(t.annotations.readOnlyHint).toBe(true);
  });
  it("rejects an unknown tool and an unknown method", async () => {
    expect((await call("delete_everything")).body.error.code).toBe(-32602);
    expect((await (await post({ jsonrpc: "2.0", id: 3, method: "resources/list" })).json()).error.code).toBe(-32601);
  });
  it("refuses batches", async () => {
    expect((await post([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status).toBe(400);
  });
});

describe("tools (Luke: all three views)", () => {
  it("liv_today summarizes the day across his views", async () => {
    const { text } = await call("liv_today");
    expect(text).toContain("2026-11-17");
    expect(text).toContain("Dentist");
    expect(text).toContain("Dutch lesson"); // weekly on Tuesdays
    expect(text).toContain("Sophia swim");
    expect(text).not.toContain("Deleted thing"); // tombstoned
    expect(text).not.toContain("MJ private");
    expect(text).toContain("Breakfast: Overnight Oats");
    expect(text).toMatch(/Dinner: MJ: Fish Tacos; Luke: Fish Tacos; Sophia: Mac and cheese/);
    expect(text).toContain("Lunch: Luke: Out - Chipotle");
    expect(text).toContain("Call plumber");
    expect(text).not.toContain("Done thing");
    expect(text).toContain("SHOPPING LIST: 2 items");
    expect(text).toContain("Duluth weekend");
    expect(text).not.toContain("Netherlands"); // undated idea isn't "soon"
  });
  it("get_calendar_range filters by view and validates dates", async () => {
    expect((await call("get_calendar_range", { start_date: "2026-11-18", view: "business" })).text).toContain("Supplier call");
    expect((await call("get_calendar_range", { start_date: "2026-11-17", end_date: "2026-11-18", view: "household" })).text).not.toContain("Supplier call");
    expect((await call("get_calendar_range", { start_date: "11/17" })).text).toMatch(/Invalid start_date/);
    expect((await call("get_calendar_range", { start_date: "2026-01-01", end_date: "2026-12-31" })).text).toMatch(/Range too long/);
  });
  it("get_meal_plan shows the Friday-to-Friday week", async () => {
    const { text } = await call("get_meal_plan", { date: "2026-11-15" });
    expect(text).toContain("week of");
    expect(text).toContain("2026-11-13");
    expect(text).toContain("Notes: Busy week");
    expect(text).toContain("(2026-11-17)");
  });
  it("list_tasks defaults to Personal and can show Household", async () => {
    expect((await call("list_tasks")).text).toContain("Fix gate");
    const hh = (await call("list_tasks", { view: "household" })).text;
    expect(hh).toContain("Take out trash");
    expect(hh).not.toContain("Call plumber");
  });
  it("shopping list, recipes, watchlist and trips", async () => {
    expect((await call("get_shopping_list")).text).toContain("Coffee");
    expect((await call("search_recipes", { ingredient: "cod" })).text).toContain("Fish Tacos");
    const r = (await call("get_recipe", { name: "tacos" })).text;
    expect(r).toContain("1 lb cod");
    expect(r).toContain("2. Grill");
    expect((await call("get_watchlist")).text).toContain("Severance");
    expect((await call("get_watchlist")).text).not.toContain("Dune");
    expect((await call("get_watchlist", { status: "watched" })).text).toContain("Dune (2021)");
    const trips = (await call("list_trips")).text;
    expect(trips).toContain("Netherlands");
    expect(trips).not.toContain("Old trip");
    expect((await call("list_trips", { include_completed: true })).text).toContain("Old trip · 2025-06-01 to 2025-06-05 · completed");
  });
});

describe("view rules (a household member without Personal/Business)", () => {
  const mj = { key: `${MJ_KEY_ID}.${SECRET}` };
  it("never reads anyone's Personal rows or the business space", async () => {
    await call("liv_today", {}, mj);
    await call("get_calendar_range", { start_date: "2026-11-17", end_date: "2026-11-18" }, mj);
    await call("list_tasks", {}, mj);
    expect(readsOf.some((id) => id.startsWith("u-"))).toBe(false);
    expect(readsOf.some((id) => id.startsWith(SPACE))).toBe(false);
  });
  it("can't ask for a view she doesn't have", async () => {
    expect((await call("get_calendar_range", { start_date: "2026-11-17", view: "personal" }, mj)).text).toMatch(/isn't available/);
    expect((await call("get_watchlist", { view: "personal" }, mj)).text).toMatch(/isn't available/);
  });
  it("Luke's key reads only his own Personal rows", async () => {
    await call("liv_today");
    expect(readsOf.filter((id) => id.startsWith("u-")).every((id) => id.startsWith(`u-${LUKE}:`))).toBe(true);
  });
});

describe("pure helpers", () => {
  it("prepWeekKey finds the Friday that starts the meal-plan week", () => {
    expect(prepWeekKey("2026-11-13")).toBe("2026-11-13"); // Fri
    expect(prepWeekKey("2026-11-14")).toBe("2026-11-13"); // Sat
    expect(prepWeekKey("2026-11-19")).toBe("2026-11-13"); // Thu
    expect(prepWeekKey("2026-11-20")).toBe("2026-11-20"); // next Fri
  });
  it("localDateKey uses Minneapolis time", () => {
    expect(localDateKey(new realDate("2026-11-18T03:00:00Z"))).toBe("2026-11-17");
  });
  it("slotText reads every slot encoding", () => {
    const byId = new Map([["r1", { name: "Soup" }]]);
    expect(slotText("r1", byId)).toBe("Soup");
    expect(slotText({ recipeId: "r1", notes: "double" }, byId)).toBe("Soup (double)");
    expect(slotText({ recipeId: "gone" }, byId)).toMatch(/no longer/);
    expect(slotText("grocery-item::Frozen%20pizza::2", byId)).toBe("Frozen pizza");
    expect(slotText("special-meal::leftovers::", byId)).toBe("Leftovers");
    expect(slotText(["r1", "Salad"], byId)).toBe("Soup + Salad");
  });
  it("formatDayMeals collapses a meal everyone shares", () => {
    const byId = new Map();
    expect(formatDayMeals({ "MJ Dinner": "Pizza", "Luke Dinner": "Pizza", "Sophia Dinner": "Pizza" }, byId)).toEqual(["Dinner: Pizza"]);
  });
});
