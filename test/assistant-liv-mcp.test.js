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

let handle, realFetch, db, keys, readsOf, limited, health, healthCalls, changes, writes;
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
    if (u.pathname === "/rest/v1/rpc/assistant_health") {
      healthCalls.push(JSON.parse(init.body).p_user);
      return json(health);
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
      // Prod's real columns (2026-11-17) — PostgREST answers 400 for any other.
      const PROD_COLUMNS = ["id", "name", "time", "prep_time", "cook_time", "servings", "folder_id", "source_url", "photo_url", "ingredients", "steps", "created_at", "updated_at", "tags", "nutrition", "cook_log", "nutrition_estimate", "ingredient_nutrition_matches"];
      if (u.searchParams.get("select").split(",").some((c) => !PROD_COLUMNS.includes(c))) return json({ message: "column does not exist" }, 400);
      const idf = u.searchParams.get("id");
      const ids = idf ? idf.slice(4, -1).split(",").map((s) => s.replace(/"/g, "")) : null;
      return json(db.recipes.filter((r) => !ids || ids.includes(r.id)));
    }
    if (u.pathname === "/rest/v1/tableplan_states") {
      const idq = u.searchParams.get("id")?.replace("eq.", "");
      const method = init.method || "GET";
      if (method === "GET") return json(db[idq] ? [{ state: db[idq], updated_at: db.__stamps?.[idq] || "2026-11-01T00:00:00Z" }] : []);
      const body = JSON.parse(init.body);
      db.__stamps = db.__stamps || {};
      if (method === "PATCH") {
        const want = u.searchParams.get("updated_at")?.replace("eq.", "");
        if ((db.__stamps[idq] || "2026-11-01T00:00:00Z") !== want) return json([]);
        db[idq] = body.state; db.__stamps[idq] = body.updated_at; writes.push(idq);
        return json([{ updated_at: body.updated_at }]);
      }
      if (method === "POST") { if (db[body.id]) return json([]); db[body.id] = body.state; db.__stamps[body.id] = body.updated_at; writes.push(body.id); return json([{ updated_at: body.updated_at }]); }
    }
    if (u.pathname === "/rest/v1/assistant_changes") {
      const method = init.method || "GET";
      if (method === "POST") { const row = { id: `c${changes.length + 1}`.padEnd(8, "0") + "-0000-4000-8000-000000000000", created_at: new Date().toISOString(), undone_at: null, ...JSON.parse(init.body) }; changes.unshift(row); return json([{ id: row.id }]); }
      if (method === "PATCH") { const id = u.searchParams.get("id").replace("eq.", ""); const r = changes.find((c) => c.id === id); if (r) r.undone_at = new Date().toISOString(); return new Response(null, { status: 204 }); }
      const idq = u.searchParams.get("id")?.replace("eq.", "");
      const uid = u.searchParams.get("user_id").replace("eq.", "");
      return json(changes.filter((c) => c.user_id === uid && (!idq || c.id === idq)).slice(0, Number(u.searchParams.get("limit") || 30)));
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
  changes = [];
  writes = [];
  readsOf = [];
  healthCalls = [];
  health = {
    checkedAt: "2026-11-17T16:00:00Z",
    rows: [{ section: "plan", scope: "personal", bytes: 40000, updatedAt: "2026-11-17T15:50:00Z" }, { section: "eat", scope: "household", bytes: 380000, updatedAt: "2026-11-17T12:00:00Z" }],
    historyWrites: { last24h: 11, last7d: 69 },
    financeNightly: { startedAt: "2026-11-17T11:40:00Z", finishedAt: "2026-11-17T11:40:27Z", ok: true, lastGood: "2026-11-17T11:40:27Z" },
    newsFeeds: { runAt: "2026-11-17T15:07:00Z", total: 40, failing: [{ paper: "startribune", status: 429 }, { paper: "startribune", status: 429 }, { paper: "athletic", status: 404 }] },
    newsLatest: "2026-11-17T15:00:00Z",
    mailSweep: { enabled: true, lastSweepAt: "2026-11-17T15:30:00Z", lockedAt: null },
    googleCalendar: [{ updatedAt: "2026-11-17T15:00:00Z", tokenExpiresAt: "2026-11-17T16:00:00Z" }],
    photos: { items: 1200, withThumb: 1190, newestAdded: "2026-11-17T14:00:00Z", devices: [{ name: "Luke's iPhone", lastUsedAt: "2026-11-17T14:00:00Z" }] },
    pushSubscriptions: 2,
    assistantKeys: [{ name: "Claude Duet", lastUsedAt: "2026-11-17T16:00:00Z" }],
  };
  keys = {
    [KEY_ID]: { user: LUKE, hash: sha(SECRET), scopes: ["read"] },
    [MJ_KEY_ID]: { user: MJ, hash: sha(SECRET), scopes: ["read"] },
  };
  db = {
    recipes: [
      { id: "r-tacos", name: "Fish Tacos", servings: 4, tags: ["dinner"], ingredients: [{ amount: "1", quantity: "lb", item: "cod" }], steps: "1. Season fish\n2. Grill", time: "25 min" },
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

describe("liv_health", () => {
  it("leads with the problems it finds, then the readings", async () => {
    const { text } = await call("liv_health");
    expect(healthCalls).toEqual([LUKE]);
    expect(text).toMatch(/^LIV HEALTH — 1 problem:/);
    expect(text).toContain("3 of 40 news feeds failing: 2× startribune (429), 1× athletic (404)");
    expect(text).toContain("Finance nightly: ok");
    expect(text).toContain("Photos: 1200 in the library");
    expect(text).toContain("Writes: 11 state snapshots in 24 h");
  });
  it("flags stuck jobs, a save loop, a huge row and a silent phone", async () => {
    health.financeNightly = { ok: false, error: "TypeError", finishedAt: "2026-11-15T11:40:00Z", lastGood: "2026-11-14T11:40:00Z" };
    health.mailSweep = { enabled: true, lastSweepAt: "2026-11-17T09:00:00Z", lockedAt: "2026-11-17T14:00:00Z" };
    health.historyWrites = { last24h: 900, last7d: 1200 };
    health.rows.push({ section: "media", scope: "household", bytes: 2_400_000, updatedAt: "2026-11-17T10:00:00Z" });
    health.photos.devices = [{ name: "Luke's iPhone", lastUsedAt: "2026-11-12T10:00:00Z" }];
    const { text } = await call("liv_health");
    expect(text).toContain("Finance nightly job's last run failed (TypeError)");
    expect(text).toContain("Finance nightly job last ran 2 days ago");
    expect(text).toContain("Mail sweep last ran 7 h ago");
    expect(text).toContain("locked since 2 h ago (stuck?)");
    expect(text).toContain("900 state snapshots in 24 h");
    expect(text).toContain("household media row is 2.4 MB");
    expect(text).toContain('Photo sync device "Luke\'s iPhone" last synced 5 days ago');
  });
  it("is the admin's only — a member's key gets no health", async () => {
    const { text } = await call("liv_health", {}, { key: `${MJ_KEY_ID}.${SECRET}` });
    expect(text).toMatch(/admin only/);
    expect(healthCalls).toEqual([]);
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

describe("write tools (a key with the write scope)", () => {
  const W = { scopes: ["read", "write"] };
  beforeEach(() => { keys[KEY_ID].scopes = ["read", "write"]; });

  it("a read-only key isn't shown them and can't call them", async () => {
    keys[KEY_ID].scopes = ["read"];
    const list = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    expect(list.result.tools.map((t) => t.name)).not.toContain("add_event");
    const r = await call("add_event", { title: "X", date: "2026-11-20" });
    expect(r.body.result.isError).toBe(true);
    expect(writes).toEqual([]);
  });

  it("lists them for a write key", async () => {
    const list = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    const names = list.result.tools.map((t) => t.name);
    for (const n of ["add_event", "update_event", "delete_event", "add_task", "complete_task", "delete_task", "add_shopping_items", "remove_shopping_items", "set_meal", "clear_meal", "add_watch_item", "set_watch_status", "remove_watch_item", "add_trip", "list_recent_changes", "undo_change"]) expect(names).toContain(n);
  });

  it("adds an event to the right row, stamped newer, and logs an undoable change", async () => {
    const r = await call("add_event", { title: "Haircut", date: "2026-11-20", start_time: "09:30", view: "household" });
    expect(r.text).toMatch(/Added to the Household calendar: "Haircut"/);
    const ev = db[`${G}:plan`].planEvents.find((e) => e.title === "Haircut");
    expect(ev).toMatchObject({ date: "2026-11-20", startTime: "09:30", allDay: false });
    expect(db[`${G}:plan`].stateUpdatedAt).toBe(NOW.toISOString());
    expect(changes[0]).toMatchObject({ tool: "add_event", user_id: LUKE, key_id: KEY_ID });
    const u = await call("undo_change", {});
    expect(u.text).toMatch(/Removed it again/);
    expect(db[`${G}:plan`].planEvents.some((e) => e.title === "Haircut")).toBe(false);
    expect(db[`${G}:config`].tombstones["planEvents@household"]).toContain(ev.id);
  });

  it("updates an event by title and date, and undo puts it back", async () => {
    const r = await call("update_event", { title: "dentist", date: "2026-11-17", new_date: "2026-11-19", start_time: "10:00" });
    expect(r.text).toMatch(/Updated "Dentist"/);
    expect(db[`u-${LUKE}:plan`].planEvents.find((e) => e.id === "e1")).toMatchObject({ date: "2026-11-19", startTime: "10:00" });
    await call("undo_change", {});
    expect(db[`u-${LUKE}:plan`].planEvents.find((e) => e.id === "e1")).toMatchObject({ date: "2026-11-17", startTime: "14:00" });
  });

  it("deletes an event with a per-view tombstone; undo re-adds it under a new id", async () => {
    const r = await call("delete_event", { title: "Sophia swim", view: "household" });
    expect(r.text).toMatch(/Deleted "Sophia swim"/);
    expect(db[`${G}:plan`].planEvents).toHaveLength(0);
    expect(db[`${G}:config`].tombstones["planEvents@household"]).toEqual(["h1"]);
    await call("undo_change", {});
    const back = db[`${G}:plan`].planEvents[0];
    expect(back.title).toBe("Sophia swim");
    expect(back.id).not.toBe("h1");
  });

  it("asks for more when a title is ambiguous, and changes nothing", async () => {
    db[`u-${LUKE}:plan`].planEvents.push({ id: "e9", title: "Dentist", date: "2026-12-01" });
    const r = await call("delete_event", { title: "Dentist" });
    expect(r.text).toMatch(/2 events match/);
    expect(writes).toEqual([]);
  });

  it("adds, completes and deletes tasks", async () => {
    expect((await call("add_task", { title: "Buy stamps", date: "2026-11-19" })).text).toMatch(/Thu, Nov 19/);
    expect(db[`u-${LUKE}:do`].doPlans["2026-11-13"].thursday.map((t) => t.title)).toContain("Buy stamps");
    expect((await call("add_task", { title: "Someday" })).text).toMatch(/backlog/);
    expect((await call("complete_task", { title: "call plumber" })).text).toMatch(/Marked done: "Call plumber"/);
    expect(db[`u-${LUKE}:do`].doPlans["2026-11-13"].tuesday[0].done).toBe(true);
    expect((await call("delete_task", { title: "Fix gate" })).text).toMatch(/Deleted task "Fix gate"/);
    expect(db[`${G}:config`].tombstones[`doBacklog@u-${LUKE}`]).toEqual(["b1"]);
  });

  it("adds and removes shopping items with the app's stamps", async () => {
    const r = await call("add_shopping_items", { items: ["Eggs", "milk"] });
    expect(r.text).toMatch(/Added to the shopping list: Eggs \(already there: milk\)/);
    const g = db[`${G}:grocery`];
    expect(g.persistentManualGroceries).toEqual(["Coffee", "Eggs", "Milk"]);
    expect(g.persistentManualGroceryStamps.eggs.added).toBe(NOW.toISOString());
    await call("remove_shopping_items", { items: ["coffee"] });
    expect(db[`${G}:grocery`].persistentManualGroceries).not.toContain("Coffee");
    expect(db[`${G}:grocery`].persistentManualGroceryStamps.coffee.removed).toBe(NOW.toISOString());
    await call("undo_change", {});
    expect(db[`${G}:grocery`].persistentManualGroceries).toContain("coffee");
  });

  it("plans a meal from the recipe box, as text, or out; clears one; undo restores", async () => {
    expect((await call("set_meal", { date: "2026-11-18", meal: "dinner", recipe: "fish tacos" })).text).toMatch(/Dinner on Wed, Nov 18 for everyone: Fish Tacos/);
    expect(db[`${G}:eat`].plans["2026-11-13"].slots.wednesday).toMatchObject({ "MJ Dinner": "r-tacos", "Luke Dinner": "r-tacos", "Sophia Dinner": "r-tacos" });
    await call("set_meal", { date: "2026-11-18", meal: "lunch", who: "Luke", special: "out", note: "Pho" });
    expect(db[`${G}:eat`].plans["2026-11-13"].slots.wednesday["Luke Lunch"]).toBe("special-meal::out::Pho");
    await call("set_meal", { date: "2026-11-21", meal: "breakfast", who: "Sophia", text: "Pancakes" });
    expect(db[`${G}:eat`].plans["2026-11-20"].slots.saturday["Sophia Breakfast"]).toBe("grocery-item::Pancakes::1");
    await call("clear_meal", { date: "2026-11-17", meal: "breakfast" });
    expect(db[`${G}:eat`].plans["2026-11-13"].slots.tuesday["MJ Breakfast"]).toBe("");
    await call("undo_change", {});
    expect(db[`${G}:eat`].plans["2026-11-13"].slots.tuesday["MJ Breakfast"]).toBe("r-oats");
  });

  it("adds, marks and removes Watch items", async () => {
    expect((await call("add_watch_item", { title: "Shogun", type: "tv" })).text).toMatch(/Added to the Household Watch list: "Shogun"/);
    expect((await call("add_watch_item", { title: "severance" })).text).toMatch(/already on/);
    expect((await call("set_watch_status", { title: "Severance", status: "watched" })).text).toMatch(/marked watched/);
    expect(db[`${G}:watch`].watchItems.find((w) => w.id === "w1")).toMatchObject({ status: "watched", watchedDate: "2026-11-17" });
    await call("remove_watch_item", { title: "Dune" });
    expect(db[`${G}:config`].tombstones["watchItems@household"]).toContain("w2");
  });

  it("adds a trip to the household's list", async () => {
    expect((await call("add_trip", { name: "Ely cabin", start_date: "2027-02-12", end_date: "2027-02-14", status: "booked" })).text).toMatch(/Trip added/);
    expect(db[`${G}:travel`].trips.at(-1)).toMatchObject({ name: "Ely cabin", status: "booked", startDate: "2027-02-12" });
  });

  it("retries when a phone saved the row in between", async () => {
    let first = true;
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (first && (init.method === "PATCH") && String(url).includes("tableplan_states")) {
        first = false;
        const id = new URL(String(url)).searchParams.get("id").replace("eq.", "");
        db[id] = { ...db[id], watchItems: [...db[id].watchItems, { id: "phone", title: "From phone" }] };
        db.__stamps = { ...(db.__stamps || {}), [id]: "2026-11-17T15:59:00Z" };
      }
      return inner(url, init);
    };
    try { await call("add_watch_item", { title: "Arrival" }); } finally { globalThis.fetch = inner; }
    const titles = db[`${G}:watch`].watchItems.map((w) => w.title);
    expect(titles).toContain("From phone");
    expect(titles).toContain("Arrival");
  });

  it("MJ's write key can't touch Luke's Personal rows", async () => {
    keys[MJ_KEY_ID].scopes = ["read", "write"];
    const r = await call("add_event", { title: "X", date: "2026-11-20", view: "personal" }, { key: `${MJ_KEY_ID}.${SECRET}` });
    expect(r.text).toMatch(/isn't available/);
    expect(writes).toEqual([]);
  });

  it("lists recent changes with ids", async () => {
    await call("add_shopping_items", { items: ["Bread"] });
    const r = await call("list_recent_changes", {});
    expect(r.text).toMatch(/Recent changes/);
    expect(r.text).toMatch(/Bread/);
  });
});
