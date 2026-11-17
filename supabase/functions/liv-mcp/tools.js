// liv-mcp tools — the READ tools an outside assistant (Claude Duet first) gets on
// Liv, and the MCP plumbing around them (DUET_CONNECTOR_DESIGN.md).
//
// Pure apart from the injected `db` (see index.ts for the real one, the tests for
// a fake): no fetch, no clock reads (`now` is passed in), no globals. Bundled into
// tools.bundle.js by `npm run build:liv-mcp` so the Edge Function is one Deno file.
//
// Rules this module keeps (ARCHITECTURE.md §9, §10):
//   • Read only. There is no write tool in this version; tools/call refuses any
//     name not listed here, whatever the key's scopes say.
//   • Acts as the key's owner, in the views the app gives that person
//     (views.js availableViews / scopeForView). Never another person's Personal
//     rows; never Finance, Documents, Photos, Messages, Mail or Contacts.
//   • Reads only the JSON keys a tool needs (db.row(id, keys)), so a call moves a
//     few KB, not whole sections — and Duet checks in every few hours, not seconds.
//   • Google-backed calendars are Google's (never in Liv's synced state); this
//     reads Liv's own events. Duet reads Google through its own Google connector.

import { normalizePlanEvents } from "../../../calendar/model.js";
import { eventInstancesInRange } from "../../../calendar/projection.js";
import { normalizeDateRange, formatCalendarRange, formatTaskList, addDaysKey, weekdayLabel } from "../../../assistant-queries.js";
import { availableViews, scopeForView, rowIdForScope, VIEW_LABELS } from "../../../views.js";
import { tombstoneIdsFor } from "../../../state-sync.js";
import { deriveStatus } from "../../../travel-model.js";

export const SERVER_INFO = Object.freeze({ name: "liv", title: "Liv", version: "0.1.0" });
export const SUPPORTED_PROTOCOLS = Object.freeze(["2025-06-18", "2025-03-26", "2024-11-05"]);
export const TIME_ZONE = "America/Chicago";

const INSTRUCTIONS = [
  "Liv is Luke's family app (calendar, meal plan, tasks, shopping list, recipes, watchlist, trips).",
  "It has three views: Personal (Luke only), Household (shared with his wife Marijane) and Business.",
  "These tools are read-only. Calendar tools return Liv's own events only — Google Calendar events",
  "are not here; read those through the Google Calendar connector. Dates are in America/Chicago.",
].join(" ");

// ── Dates (America/Chicago, from an injected `now`) ──────────────────────────
export function localDateKey(now, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function weekdayOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The meal plan's week starts on Friday (app.js startOfPrepWindow).
export function prepWeekKey(dateKey) {
  const day = weekdayOf(dateKey);
  const diff = day >= 5 ? 5 - day : -(day + 2);
  return addDaysKey(dateKey, diff);
}

// app.js prepDays / doPrepDays: the planner's days, as offsets from the Friday.
const PREP_DAYS = [
  { id: "friday-start", name: "Friday", offset: 0 },
  { id: "saturday", name: "Saturday", offset: 1 },
  { id: "sunday", name: "Sunday", offset: 2 },
  { id: "monday", name: "Monday", offset: 3 },
  { id: "tuesday", name: "Tuesday", offset: 4 },
  { id: "wednesday", name: "Wednesday", offset: 5 },
  { id: "thursday", name: "Thursday", offset: 6 },
  { id: "friday-finish", name: "Friday", offset: 7 },
];
const DO_DAYS = PREP_DAYS.filter((d) => d.id !== "friday-finish");
const MEAL_COLUMNS = [
  { label: "Breakfast", members: ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"] },
  { label: "Lunch", members: ["MJ Lunch", "Luke Lunch", "Sophia Lunch"] },
  { label: "Dinner", members: ["MJ Dinner", "Luke Dinner", "Sophia Dinner"] },
];

// ── Who the key acts for ─────────────────────────────────────────────────────
// ctx = { userId, groupId, role, spaceId } — looked up once per request.
export function viewsFor(ctx) {
  const views = availableViews({ isAdmin: ctx.role === "admin" });
  return views.filter((v) => v !== "business" || ctx.spaceId);
}

function rowFor(ctx, view, section) {
  const scope = scopeForView(view, section, { hasBusiness: Boolean(ctx.spaceId) });
  const id = rowIdForScope({ stateId: ctx.groupId, userId: ctx.userId, businessId: ctx.spaceId }, section, scope);
  return id ? { id, owner: id.slice(0, id.lastIndexOf(":")) } : null;
}

// Items deleted on some device but still in a row's copy are dropped (the app's
// own merge does the same with these lists).
function live(list, row, key) {
  const dead = new Set(tombstoneIdsFor(row?.tombstones, key, row?.__owner || null).map(String));
  return (Array.isArray(list) ? list : []).filter((x) => x && !dead.has(String(x.id)));
}

async function readRow(db, ref, keys) {
  if (!ref) return null;
  const row = await db.row(ref.id, [...keys, "tombstones"]);
  return row ? { ...row, __owner: ref.owner } : null;
}

function pickView(ctx, requested, fallback = "all") {
  const mine = viewsFor(ctx);
  const want = String(requested || fallback).toLowerCase();
  if (want === "all") return { ok: true, views: mine };
  if (!mine.includes(want)) return { ok: false, error: `View "${requested}" isn't available. Available: ${mine.join(", ")}.` };
  return { ok: true, views: [want] };
}

// ── Readers ──────────────────────────────────────────────────────────────────
async function calendarEvents(db, ctx, views, start, end) {
  const out = [];
  for (const view of views) {
    const ref = rowFor(ctx, view, "plan");
    const row = await readRow(db, ref, ["planEvents"]);
    if (!row) continue;
    for (const e of live(normalizePlanEvents(row.planEvents), row, "planEvents")) {
      for (const inst of eventInstancesInRange(e, start, end)) {
        out.push({
          date: inst.date, title: e.title, allDay: e.allDay, startTime: e.startTime, endTime: e.endTime,
          notes: e.notes, location: e.location?.name || e.location?.address || "", calendarName: VIEW_LABELS[view],
        });
      }
    }
  }
  return out;
}

async function loadRecipes(db, ids = null) {
  const rows = await db.recipes(ids);
  return Array.isArray(rows) ? rows : [];
}

function decodePart(s) { try { return decodeURIComponent(s || "").trim(); } catch { return String(s || "").trim(); } }

export function slotText(entry, recipesById) {
  if (!entry) return "";
  if (Array.isArray(entry)) return entry.map((e) => slotText(e, recipesById)).filter(Boolean).join(" + ");
  if (typeof entry === "object") {
    const r = entry.recipeId ? recipesById.get(String(entry.recipeId)) : null;
    const name = r?.name || "(a recipe no longer in the box)";
    return entry.notes ? `${name} (${String(entry.notes).trim()})` : name;
  }
  const s = String(entry).trim();
  if (s.startsWith("grocery-item::")) return decodePart(s.slice(14).split("::")[0]);
  if (s.startsWith("special-meal::")) {
    const [type, note] = s.slice(14).split("::");
    return [decodePart(type) === "out" ? "Out" : "Leftovers", decodePart(note)].filter(Boolean).join(" - ");
  }
  return recipesById.get(s)?.name || s;
}

function recipeIdsIn(slots) {
  const ids = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object" && v.recipeId) ids.add(String(v.recipeId));
    else if (typeof v === "string" && v && !v.includes("::")) ids.add(v);
  };
  for (const day of Object.values(slots || {})) for (const v of Object.values(day || {})) walk(v);
  return [...ids];
}

// One line per meal: "Dinner: Tacos" when everyone has the same, else per person.
export function formatDayMeals(daySlots, recipesById, mealNotes = {}) {
  const lines = [];
  for (const col of MEAL_COLUMNS) {
    const texts = col.members.map((m) => slotText(daySlots?.[m], recipesById));
    const notes = col.members.map((m) => String(mealNotes?.[m] || "").trim()).filter(Boolean);
    if (!texts.some(Boolean) && !notes.length) continue;
    const same = texts.every((t) => t === texts[0]);
    const body = same
      ? texts[0]
      : col.members.map((m, i) => texts[i] && `${m.split(" ")[0]}: ${texts[i]}`).filter(Boolean).join("; ");
    lines.push(`${col.label}: ${body || "—"}${notes.length ? ` (note: ${[...new Set(notes)].join("; ")})` : ""}`);
  }
  return lines;
}

async function mealWeek(db, ctx, dateKey) {
  if (!viewsFor(ctx).includes("household")) return null;
  const week = prepWeekKey(dateKey);
  const row = await db.row(`${ctx.groupId}:eat`, [`plans.${week}`, `publishedWeeks.${week}`]);
  const record = row?.[`plans.${week}`] || row?.[`publishedWeeks.${week}`] || null;
  const slots = record?.slots || {};
  const recipes = await loadRecipes(db, recipeIdsIn(slots));
  return { week, slots, mealNotes: record?.mealNotes || {}, notes: String(record?.notes || "").trim(), recipesById: new Map(recipes.map((r) => [String(r.id), r])) };
}

function dayIdsFor(weekKey, dateKey) {
  return PREP_DAYS.filter((d) => addDaysKey(weekKey, d.offset) === dateKey).map((d) => d.id);
}

async function taskLists(db, ctx, view, dateKey) {
  const ref = rowFor(ctx, view, "do");
  const week = prepWeekKey(dateKey);
  const row = await readRow(db, ref, [`doPlans.${week}`, "doBacklog"]);
  const plan = row?.[`doPlans.${week}`] || {};
  const days = DO_DAYS.map((d) => ({ name: d.name, date: addDaysKey(week, d.offset), tasks: Array.isArray(plan[d.id]) ? plan[d.id] : [] }));
  const backlog = live(row?.doBacklog, row, "doBacklog").filter((t) => !t.done || !t.weekKey || t.weekKey === week);
  return { days, backlog };
}

// ── The tools ────────────────────────────────────────────────────────────────
const viewProp = (desc) => ({ type: "string", enum: ["all", "personal", "household", "business"], description: desc });
const dateProp = (desc) => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: desc });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "liv_today",
    title: "Today in Liv",
    description: "A summary of one day in Liv: Liv calendar events (all of Luke's views), the household meal plan for that day, tasks due, the shopping list size, and trips under way or starting within two weeks. Use it first for a daily check-in.",
    inputSchema: { type: "object", properties: { date: dateProp("Day to summarize, YYYY-MM-DD. Defaults to today (America/Chicago).") }, additionalProperties: false },
  },
  {
    name: "get_calendar_range",
    title: "Liv calendar",
    description: "Liv's own calendar events between two dates (at most 62 days). Google Calendar events are NOT included — use the Google Calendar connector for those.",
    inputSchema: {
      type: "object",
      properties: { start_date: dateProp("First day, YYYY-MM-DD."), end_date: dateProp("Last day, YYYY-MM-DD. Defaults to start_date."), view: viewProp("Which view's calendar. Default all.") },
      required: ["start_date"], additionalProperties: false,
    },
  },
  {
    name: "get_meal_plan",
    title: "Meal plan",
    description: "The household meal plan for the week (Friday to Friday) containing a date: each day's breakfast, lunch and dinner for MJ, Luke and Sophia, plus notes.",
    inputSchema: { type: "object", properties: { date: dateProp("Any day in the wanted week. Defaults to today.") }, additionalProperties: false },
  },
  {
    name: "list_tasks",
    title: "Tasks",
    description: "Tasks for the current planner week (Friday to Thursday) and the backlog. Personal tasks are Luke's own; Household tasks are shared.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["personal", "household"], description: "Whose tasks. Default personal (falls back to household when Personal isn't available)." },
        scope: { type: "string", enum: ["this_week", "backlog", "all"], description: "Default all." },
        include_done: { type: "boolean", description: "Include finished tasks. Default false." },
        date: dateProp("A day in the wanted week. Defaults to today."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_shopping_list",
    title: "Shopping list",
    description: "The household shopping list items added by hand in Shop. Items the meal plan generates from recipes are not included; use get_meal_plan and get_recipe for those.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_recipes",
    title: "Search recipes",
    description: "Search the household recipe box by name, tag or ingredient.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Matches name, tags or ingredients." },
        tag: { type: "string" }, ingredient: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Default 10." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_recipe",
    title: "Recipe",
    description: "One recipe from the household recipe box: ingredients, steps, servings and times.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Recipe name (exact or partial)." } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "get_watchlist",
    title: "Watchlist",
    description: "Movies and shows on a Watch list. Household is the shared list; Personal is Luke's own.",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string", enum: ["personal", "household"], description: "Default household." }, status: { type: "string", enum: ["want", "watched", "all"], description: "Default want." } },
      additionalProperties: false,
    },
  },
  {
    name: "list_trips",
    title: "Trips",
    description: "The household's trips in Explore (ideas, planning, booked, under way), with dates and destinations.",
    inputSchema: { type: "object", properties: { include_completed: { type: "boolean", description: "Default false." } }, additionalProperties: false },
  },
].map((t) => ({ ...t, annotations: READ_ONLY }));

const HANDLERS = {
  async liv_today(db, ctx, args, now) {
    const day = args.date || localDateKey(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Invalid date — use YYYY-MM-DD.";
    const parts = [`LIV — ${weekdayLabel(day)} (${day})`];
    parts.push(formatCalendarRange(await calendarEvents(db, ctx, viewsFor(ctx), day, day), day, day));
    const mw = await mealWeek(db, ctx, day);
    if (mw) {
      const lines = dayIdsFor(mw.week, day).flatMap((id) => formatDayMeals(mw.slots[id], mw.recipesById, mw.mealNotes?.[id]));
      parts.push(lines.length ? `MEALS:\n  ${[...new Set(lines)].join("\n  ")}` : "MEALS: nothing planned.");
    }
    const taskView = viewsFor(ctx).includes("personal") ? "personal" : "household";
    const lists = await taskLists(db, ctx, taskView, day);
    const today = lists.days.filter((d) => d.date === day);
    const open = today.flatMap((d) => d.tasks).filter((t) => t && !t.done && String(t.title || "").trim());
    parts.push(open.length ? `TASKS (${VIEW_LABELS[taskView]}):\n${open.map((t) => `  - ${String(t.title).trim()}`).join("\n")}` : `TASKS (${VIEW_LABELS[taskView]}): none due today.`);
    if (viewsFor(ctx).includes("household")) {
      const g = await db.row(`${ctx.groupId}:grocery`, ["persistentManualGroceries"]);
      const n = Array.isArray(g?.persistentManualGroceries) ? g.persistentManualGroceries.length : 0;
      parts.push(`SHOPPING LIST: ${n} item${n === 1 ? "" : "s"} added by hand.`);
      const trips = await tripsList(db, ctx, day, { soonDays: 14 });
      if (trips.length) parts.push(`TRIPS:\n${trips.map((t) => `  - ${t}`).join("\n")}`);
    }
    return parts.join("\n\n");
  },

  async get_calendar_range(db, ctx, args) {
    const r = normalizeDateRange(args.start_date, args.end_date);
    if (!r.ok) return r.error;
    const v = pickView(ctx, args.view);
    if (!v.ok) return v.error;
    return formatCalendarRange(await calendarEvents(db, ctx, v.views, r.start, r.end), r.start, r.end);
  },

  async get_meal_plan(db, ctx, args, now) {
    const day = args.date || localDateKey(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Invalid date — use YYYY-MM-DD.";
    const mw = await mealWeek(db, ctx, day);
    if (!mw) return "The meal plan is a Household page, and Household isn't available.";
    const lines = [`MEAL PLAN — week of ${weekdayLabel(mw.week)} (${mw.week})`];
    if (mw.notes) lines.push(`Notes: ${mw.notes}`);
    let any = false;
    for (const d of PREP_DAYS) {
      const meals = formatDayMeals(mw.slots[d.id], mw.recipesById, mw.mealNotes?.[d.id]);
      if (!meals.length) continue;
      any = true;
      const date = addDaysKey(mw.week, d.offset);
      lines.push(`\n${weekdayLabel(date)} (${date}):`, ...meals.map((m) => `  ${m}`));
    }
    if (!any) lines.push("Nothing planned yet this week.");
    return lines.join("\n");
  },

  async list_tasks(db, ctx, args, now) {
    const mine = viewsFor(ctx);
    const view = args.view || (mine.includes("personal") ? "personal" : "household");
    if (!mine.includes(view)) return `View "${view}" isn't available.`;
    const day = args.date || localDateKey(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Invalid date — use YYYY-MM-DD.";
    const scope = ["this_week", "backlog", "all"].includes(args.scope) ? args.scope : "all";
    return `${VIEW_LABELS[view]} tasks\n${formatTaskList(await taskLists(db, ctx, view, day), { scope, includeDone: args.include_done === true })}`;
  },

  async get_shopping_list(db, ctx) {
    if (!viewsFor(ctx).includes("household")) return "Shop is a Household page, and Household isn't available.";
    const g = await db.row(`${ctx.groupId}:grocery`, ["persistentManualGroceries"]);
    const items = (Array.isArray(g?.persistentManualGroceries) ? g.persistentManualGroceries : []).map(String).filter(Boolean);
    return items.length ? `SHOPPING LIST (${items.length}, added by hand):\n${items.map((i) => `  - ${i}`).join("\n")}` : "The hand-added shopping list is empty.";
  },

  async search_recipes(db, _ctx, args) {
    const q = String(args.query || "").toLowerCase().trim();
    const tag = String(args.tag || "").toLowerCase().trim();
    const ing = String(args.ingredient || "").toLowerCase().trim();
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const all = await loadRecipes(db);
    const items = (r) => (Array.isArray(r.ingredients) ? r.ingredients : []).map((i) => String(i?.item || "").toLowerCase());
    const tags = (r) => (Array.isArray(r.tags) ? r.tags : []).map((t) => String(t).toLowerCase());
    const hits = all.filter((r) => {
      if (tag && !tags(r).includes(tag)) return false;
      if (ing && !items(r).some((i) => i.includes(ing))) return false;
      if (q) return String(r.name || "").toLowerCase().includes(q) || tags(r).some((t) => t.includes(q)) || items(r).some((i) => i.includes(q));
      return true;
    });
    if (!hits.length) return "No recipes found matching those criteria.";
    const shown = hits.slice(0, limit);
    return [`Found ${hits.length} recipe${hits.length === 1 ? "" : "s"}${hits.length > shown.length ? ` (showing ${shown.length})` : ""}:`,
      ...shown.map((r) => `  - ${r.name}${r.tags?.length ? ` [${r.tags.join(", ")}]` : ""}${r.servings ? ` · ${r.servings} servings` : ""}`)].join("\n");
  },

  async get_recipe(db, _ctx, args) {
    const q = String(args.name || "").toLowerCase().trim();
    if (!q) return "No recipe name provided.";
    const all = await loadRecipes(db);
    const r = all.find((x) => String(x.name || "").toLowerCase() === q) || all.find((x) => String(x.name || "").toLowerCase().includes(q));
    if (!r) return `No recipe found matching "${args.name}".`;
    const lines = [`RECIPE: ${r.name}`];
    if (r.tags?.length) lines.push(`Tags: ${r.tags.join(", ")}`);
    lines.push(`Servings: ${Math.max(1, Number(r.servings) || 1)}`);
    const time = [r.prep_time && `${r.prep_time} prep`, r.cook_time && `${r.cook_time} cook`].filter(Boolean).join(" + ") || r.time;
    if (time) lines.push(`Time: ${time}`);
    if (r.source_url) lines.push(`Source: ${r.source_url}`);
    const ings = (Array.isArray(r.ingredients) ? r.ingredients : []).map((i) => [i?.amount, i?.quantity, i?.item, i?.prep].filter(Boolean).join(" ")).filter(Boolean);
    if (ings.length) lines.push("\nIngredients:", ...ings.map((i) => `  - ${i}`));
    const steps = String(r.steps || "").split(/\n+/).map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
    if (steps.length) lines.push("\nInstructions:", ...steps.map((s, i) => `  ${i + 1}. ${s}`));
    return lines.join("\n");
  },

  async get_watchlist(db, ctx, args) {
    const view = args.view || "household";
    if (!viewsFor(ctx).includes(view)) return `View "${view}" isn't available.`;
    const row = await readRow(db, rowFor(ctx, view, "watch"), ["watchItems"]);
    const status = ["want", "watched", "all"].includes(args.status) ? args.status : "want";
    const items = live(row?.watchItems, row, "watchItems").filter((i) => String(i.title || "").trim() && (status === "all" || (i.status === "watched" ? "watched" : "want") === status));
    if (!items.length) return `Nothing on the ${VIEW_LABELS[view]} ${status === "watched" ? "watched list" : "watchlist"}.`;
    return [`${VIEW_LABELS[view]} watchlist (${items.length}):`, ...items.map((i) => `  - ${String(i.title).trim()}${i.year ? ` (${i.year})` : ""} · ${i.type === "tv" ? "show" : "movie"}${status === "all" ? ` · ${i.status === "watched" ? "watched" : "want to watch"}` : ""}`)].join("\n");
  },

  async list_trips(db, ctx, args, now) {
    if (!viewsFor(ctx).includes("household")) return "Explore is a Household page, and Household isn't available.";
    const trips = await tripsList(db, ctx, localDateKey(now), { includeCompleted: args.include_completed === true });
    return trips.length ? `TRIPS (${trips.length}):\n${trips.map((t) => `  - ${t}`).join("\n")}` : "No trips.";
  },
};

async function tripsList(db, ctx, today, { includeCompleted = false, soonDays = null } = {}) {
  const row = await readRow(db, rowFor(ctx, "household", "travel"), ["trips"]);
  const soon = soonDays == null ? null : addDaysKey(today, soonDays);
  return live(row?.trips, row, "trips")
    .map((t) => ({ t, status: deriveStatus(t, today) }))
    .filter(({ t, status }) => (includeCompleted || status !== "completed")
      && (soon == null || status === "traveling" || (t.startDate && t.startDate >= today && t.startDate <= soon)))
    .sort((a, b) => String(a.t.startDate || "9999").localeCompare(String(b.t.startDate || "9999")))
    .map(({ t, status }) => {
      const name = String(t.name || t.destination || "Trip").trim();
      const where = t.destination && t.destination !== name ? ` — ${t.destination}` : "";
      const when = t.startDate ? ` · ${t.startDate}${t.endDate && t.endDate !== t.startDate ? ` to ${t.endDate}` : ""}` : "";
      return `${name}${where}${when} · ${status}`;
    });
}

// ── MCP (JSON-RPC 2.0 over Streamable HTTP, stateless) ───────────────────────
// Returns { status, body } where body is a JSON-RPC response object, or null for a
// notification (answered 202 with no body).
export async function handleRpc(msg, { db, ctx, now = new Date() }) {
  const isReq = msg && msg.jsonrpc === "2.0" && typeof msg.method === "string";
  if (!isReq) return { status: 400, body: rpcError(null, -32600, "Invalid request") };
  const id = msg.id;
  if (id === undefined || id === null) return { status: 202, body: null }; // notification
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
        return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
      }
      case "ping": return ok(id, {});
      case "tools/list": return ok(id, { tools: TOOLS });
      case "tools/call": {
        const name = msg.params?.name;
        const handler = Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : null;
        if (!handler) return { status: 200, body: rpcError(id, -32602, `Unknown tool: ${name}`) };
        if (!ctx.scopes?.includes("read")) return ok(id, toolResult("This key can't read Liv.", true));
        const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
        const text = await handler(db, ctx, args, now);
        return ok(id, toolResult(text, false));
      }
      default: return { status: 200, body: rpcError(id, -32601, `Method not found: ${msg.method}`) };
    }
  } catch (e) {
    console.error("[liv-mcp] tool failed:", e?.name || "error");
    if (msg.method === "tools/call") return ok(id, toolResult("Liv couldn't read that right now. Try again in a minute.", true));
    return { status: 200, body: rpcError(id, -32603, "Internal error") };
  }
}

function ok(id, result) { return { status: 200, body: { jsonrpc: "2.0", id, result } }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function toolResult(text, isError) { return { content: [{ type: "text", text: String(text) }], isError: Boolean(isError) }; }
