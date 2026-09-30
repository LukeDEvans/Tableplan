// Siri voice → the assistant (netlify/functions/voice-command.js + _voice-tools.js).
// A fake PostgREST (tableplan_states GET / upsert POST / conditional PATCH, the
// admin lookup) and scripted Claude replies drive the real handler end to end.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const voice = require("../netlify/functions/voice-command.js");
const { VOICE_TOOLS, VOICE_TOOL_NAMES, ownerFor } = require("../netlify/functions/_voice-tools.js");

const HH = "g1";
let rows, stamp, anthropicCalls, script;
const realFetch = globalThis.fetch;
const json = (b, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status }));

function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  const method = opts.method || "GET";
  if (u.hostname === "api.anthropic.com") {
    anthropicCalls.push(JSON.parse(opts.body));
    return json(script.shift() || { content: [{ type: "text", text: "(no script)" }], stop_reason: "end_turn" });
  }
  if (u.pathname.endsWith("/live_group_members")) return json([{ user_id: "admin1" }]);
  const id = decodeURIComponent((u.searchParams.get("id") || "").replace(/^eq\./, ""));
  if (method === "GET") return json(rows.has(id) ? [rows.get(id)] : []);
  const body = JSON.parse(opts.body || "{}");
  if (method === "POST") { rows.set(body.id, { state: body.state, updated_at: `t${++stamp}` }); return Promise.resolve(new Response(null, { status: 201 })); }
  if (method === "PATCH") {
    const want = decodeURIComponent((u.searchParams.get("updated_at") || "").replace(/^eq\./, ""));
    const row = rows.get(id);
    if (!row || row.updated_at !== want) return json([]);
    rows.set(id, { state: body.state, updated_at: `t${++stamp}` });
    return json([rows.get(id)]);
  }
  throw new Error(`unexpected ${method} ${url}`);
}

const call = (b) => voice.handler({ httpMethod: "POST", body: JSON.stringify({ householdId: HH, secret: "open sesame", ...b }) });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "s";
  rows = new Map([
    [`${HH}:config`, { state: { voiceCommandSecret: "open sesame", aiNotes: { userPreferences: [{ id: "n1", text: "Luke calls oat milk 'milk'." }] } }, updated_at: "t0" }],
    [`u-admin1:grocery`, { state: { persistentManualGroceries: ["eggs", "milk"] }, updated_at: "t0" }],
    [`u-admin1:do`, { state: { doPlans: {}, doBacklog: [] }, updated_at: "t0" }],
    [`${HH}:health`, { state: { familyMembers: [{ id: "m1", name: "Luke" }], foodLogEntries: [] }, updated_at: "t0" }],
  ]);
  stamp = 0; anthropicCalls = []; script = [];
  globalThis.fetch = fakeFetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("Siri → assistant", () => {
  it("rejects a wrong passphrase before any model call", async () => {
    const r = await call({ transcript: "add bread", secret: "nope" });
    expect(r.statusCode).toBe(401);
    expect(anthropicCalls).toHaveLength(0);
  });

  it("runs the assistant's tools server-side and returns one spoken sentence", async () => {
    script.push(
      { content: [toolUse("a", "add_grocery_item", { item: "bread" }), toolUse("b", "remove_grocery_item", { item: "milk" }), toolUse("c", "add_task", { title: "Call plumber", day_id: "backlog" })], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Added bread, took milk off the list, and added Call plumber to your backlog." }], stop_reason: "end_turn" },
    );
    const r = await call({ transcript: "add bread, remove milk, and remind me to call the plumber" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).message).toBe("Added bread, took milk off the list, and added Call plumber to your backlog.");

    const grocery = rows.get("u-admin1:grocery").state;
    expect(grocery.persistentManualGroceries).toEqual(["bread", "eggs"]);
    // The removal is stamped, so a device's older copy can't bring milk back.
    expect(grocery.persistentManualGroceryStamps.milk.removed).toBeTruthy();
    expect(grocery.persistentManualGroceryStamps.bread.added).toBeTruthy();
    expect(rows.get("u-admin1:do").state.doBacklog.map((t) => t.title)).toEqual(["Call plumber"]);

    // Same assistant: the registry's specs (voice subset) + saved memory in the prompt.
    const first = anthropicCalls[0];
    expect(first.tools.map((t) => t.name).sort()).toEqual([...VOICE_TOOL_NAMES].sort());
    expect(first.system).toContain("Luke calls oat milk");
    expect(first.messages[0]).toEqual({ role: "user", content: "add bread, remove milk, and remind me to call the plumber" });
    // Tool results went back to the model.
    expect(anthropicCalls[1].messages.at(-1).content.map((c) => c.type)).toEqual(["tool_result", "tool_result", "tool_result"]);
    // Logged for the app's voice history.
    expect(rows.get(`${HH}:voicelog`).state.entries[0].actions.map((a) => a.tool)).toEqual(["add_grocery_item", "remove_grocery_item", "add_task"]);
  });

  it("food log goes to the household health row (the app's scope), not a personal one", async () => {
    script.push(
      { content: [toolUse("a", "log_meal", { name: "oatmeal", meal_type: "breakfast" })], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Logged oatmeal for breakfast." }], stop_reason: "end_turn" },
    );
    await call({ transcript: "I had oatmeal for breakfast" });
    expect(rows.get(`${HH}:health`).state.foodLogEntries.map((e) => e.displayName)).toEqual(["oatmeal"]);
    expect(rows.has("u-admin1:health")).toBe(false);
  });

  it("a tool voice can't use is reported back, not run; unchanged state isn't rewritten", async () => {
    script.push(
      { content: [toolUse("a", "delete_task", { title: "x" }), toolUse("b", "complete_task", { title: "nothing like this" })], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "I can't delete by voice, and I couldn't find that task." }], stop_reason: "end_turn" },
    );
    const before = rows.get("u-admin1:do").updated_at;
    await call({ transcript: "delete x and finish nothing" });
    const results = anthropicCalls[1].messages.at(-1).content.map((c) => c.content);
    expect(results[0]).toMatch(/isn't available by voice/);
    expect(results[1]).toMatch(/No open task/);
    expect(rows.get("u-admin1:do").updated_at).toBe(before);
  });

  it("memory: write_note saves to the household config's aiNotes", async () => {
    script.push(
      { content: [toolUse("a", "write_note", { category: "userPreferences", note: "Luke prefers dinners under 30 minutes." })], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Got it." }], stop_reason: "end_turn" },
    );
    await call({ transcript: "remember I like quick dinners" });
    const prefs = rows.get(`${HH}:config`).state.aiNotes.userPreferences.map((n) => n.text);
    expect(prefs).toContain("Luke prefers dinners under 30 minutes.");
    expect(rows.get(`${HH}:config`).state.voiceCommandSecret).toBe("open sesame"); // rest of config intact
  });
});

describe("_voice-tools", () => {
  const ctx = { weekKey: "2026-09-25", todayKey: "2026-09-30", now: "2026-09-30T12:00:00.000Z", newId: (() => { let i = 0; return () => `id${++i}`; })(), stamps: null, memory: null };
  it("every voice tool is a real assistant tool, and no destructive one is included", async () => {
    const reg = await import("../assistant-tools.js");
    for (const name of VOICE_TOOL_NAMES) {
      expect(reg.assistantTool(name), name).toBeTruthy();
      expect(reg.requiresConfirmation(name), name).toBe(false);
    }
  });
  it("routes household sections to the group row, others to the admin's", () => {
    expect(ownerFor("eat", "g", "a")).toBe("g");
    expect(ownerFor("health", "g", "a")).toBe("g");
    expect(ownerFor("config", "g", "a")).toBe("g");
    expect(ownerFor("grocery", "g", "a")).toBe("u-a");
    expect(ownerFor("grocery", "g", null)).toBe("g");
  });
  it("set_meal fills each dinner slot for the day in the current week", () => {
    const st = {};
    expect(VOICE_TOOLS.set_meal.apply(st, { recipe_name: "Tacos", day_id: "monday", meal_type: "dinner" }, ctx)).toMatch(/Added Tacos to Monday dinner/);
    expect(st.plans["2026-09-25"].slots.monday).toEqual({ "MJ Dinner": "Tacos", "Luke Dinner": "Tacos", "Sophia Dinner": "Tacos" });
  });
  it("add_event validates the date; add_workout skips duplicates", () => {
    expect(VOICE_TOOLS.add_event.apply({}, { title: "Dentist", date: "tomorrow" }, ctx)).toMatch(/need an event title and a date/);
    const st = { workouts: [{ title: "Run" }] };
    expect(VOICE_TOOLS.add_workout.apply(st, { title: "run" }, ctx)).toMatch(/already/);
  });
});
