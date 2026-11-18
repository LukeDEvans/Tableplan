// liv-mcp WRITE tools (DUET_CONNECTOR_DESIGN.md §7) — Luke, 2026-11-17: "my app is
// intended to be used with an AI with full access"; first set = calendar, tasks,
// shopping list, meal plan, Watch, trips. Finance, Mail, Documents, Photos and
// Messages stay out.
//
// How a write stays safe with the app's sync (ARCHITECTURE.md §5):
//   • It changes one section row the same way a phone would: read the row, change
//     the list in JS, write it back only if nobody wrote in between (updated_at
//     match, db.update retries), and stamp stateUpdatedAt so the app's merge counts
//     this copy as the newer one.
//   • Adds use new ids, and the app's merge unions these lists by id, so an add
//     survives any device. Deletes also record a tombstone in the household config
//     row (same key and owner the app uses — state-sync.js addTombstone), so a
//     device that still holds the item can't bring it back. Shopping-list items get
//     the add/remove stamps the app makes (grocery-list-stamps.js).
//   • Known limit (same as two phones today): an EDIT to an existing item can lose
//     to a device that saves its older copy of that item within the same minute.
//   • Every change is logged (db.log) with how to undo it; undo_change re-adds a
//     deleted item under a new id (a tombstoned id can't come back).
//
// Pure apart from the injected `db` and `newId`: no fetch, no clock reads.

import { normalizePlanEvents } from "../../../calendar/model.js";
import { scopeForView, rowIdForScope, VIEW_LABELS, availableViews } from "../../../views.js";
import { addTombstone } from "../../../state-sync.js";
import { stampGroceryAdd, stampGroceryRemove, groceryKey } from "../../../grocery-list-stamps.js";
import { resetBoughtMarks } from "../../../grocery-bought.js";
import { addDaysKey, weekdayLabel } from "../../../assistant-queries.js";

// Sections whose rows differ per view; their deletes are recorded per owner.
const TOGGLE_SECTIONS = new Set(["grocery", "do", "watch", "media", "plan", "travel", "finance"]);
const MAX_TOMBSTONES_PER_KEY = 200; // app.js MAX_TOMBSTONES_PER_KEY

const PREP_DAYS = [
  ["friday-start", 0], ["saturday", 1], ["sunday", 2], ["monday", 3],
  ["tuesday", 4], ["wednesday", 5], ["thursday", 6], ["friday-finish", 7],
];
const MEAL_MEMBERS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const PEOPLE = { luke: "Luke", mj: "MJ", marijane: "MJ", sophia: "Sophia" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (v) => clean(v).toLowerCase();

function weekdayOf(key) { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
// The meal-plan / task week starts on Friday (tools.js prepWeekKey).
function prepWeekKey(dateKey) { const day = weekdayOf(dateKey); return addDaysKey(dateKey, day >= 5 ? 5 - day : -(day + 2)); }
function dayIdFor(dateKey) {
  const week = prepWeekKey(dateKey);
  const hit = PREP_DAYS.find(([, off]) => addDaysKey(week, off) === dateKey);
  return { week, dayId: hit ? hit[0] : null };
}

function viewsFor(ctx) { return availableViews({ isAdmin: ctx.role === "admin" }).filter((v) => v !== "business" || ctx.spaceId); }
function checkView(ctx, view, allowed) {
  if (!allowed.includes(view)) return `View must be one of: ${allowed.join(", ")}.`;
  if (!viewsFor(ctx).includes(view)) return `View "${view}" isn't available to this account.`;
  return null;
}
function rowRef(ctx, view, section) {
  const scope = scopeForView(view, section, { hasBusiness: Boolean(ctx.spaceId) });
  const id = rowIdForScope({ stateId: ctx.groupId, userId: ctx.userId, businessId: ctx.spaceId }, section, scope);
  const owner = !TOGGLE_SECTIONS.has(section) ? null
    : scope === "personal" ? `u-${ctx.userId}` : scope === "business" ? ctx.spaceId : "household";
  return { id, owner, scope };
}
const configRow = (ctx) => `${ctx.groupId}:config`;

async function tombstone(db, ctx, key, ids, owner) {
  if (!ids.length) return;
  await db.update(configRow(ctx), (state) => {
    if (!state.tombstones || typeof state.tombstones !== "object") state.tombstones = {};
    for (const id of ids) addTombstone(state.tombstones, key, id, owner, MAX_TOMBSTONES_PER_KEY);
    return { changed: true };
  });
}

// One match by title (case-insensitive; exact beats contains), optionally narrowed.
function findOne(list, title, extra = () => true, label = "item") {
  const q = norm(title);
  if (!q) return { error: `No ${label} title given.` };
  const pool = list.filter((x) => x && extra(x));
  const exact = pool.filter((x) => norm(x.title || x.name) === q);
  const hits = exact.length ? exact : pool.filter((x) => norm(x.title || x.name).includes(q));
  if (!hits.length) return { error: `No ${label} matching "${clean(title)}".` };
  if (hits.length > 1) return { error: `${hits.length} ${label}s match "${clean(title)}": ${hits.slice(0, 6).map((x) => `"${clean(x.title || x.name, 60)}"${x.date ? ` (${x.date})` : ""}`).join(", ")}. Be more specific${label === "event" ? " or give the date" : ""}.` };
  return { item: hits[0] };
}

// ── Calendar ────────────────────────────────────────────────────────────────
function eventFields(args, base = {}) {
  const out = { ...base };
  if (args.title != null || args.new_title != null) out.title = clean(args.new_title ?? args.title, 200);
  const date = args.new_date ?? (base.id ? undefined : args.date);
  if (date != null) { if (!DATE_RE.test(date)) return { error: "Dates are YYYY-MM-DD." }; out.date = date; }
  if (args.end_date != null) { if (args.end_date && !DATE_RE.test(args.end_date)) return { error: "end_date is YYYY-MM-DD." }; out.endDate = args.end_date || null; }
  for (const [k, f] of [["start_time", "startTime"], ["end_time", "endTime"]]) {
    if (args[k] == null) continue;
    if (args[k] && !TIME_RE.test(args[k])) return { error: `${k} is HH:MM, 24-hour.` };
    out[f] = args[k] || null;
  }
  if (args.all_day === true) { out.allDay = true; out.startTime = null; out.endTime = null; }
  else if (out.startTime) out.allDay = false;
  if (args.notes != null) out.notes = clean(args.notes, 2000);
  if (args.location != null) out.location = clean(args.location) ? { name: clean(args.location) } : null;
  return { event: out };
}

async function addEvent(db, ctx, args, { newId, now }) {
  const view = args.view || "personal";
  const bad = checkView(ctx, view, ["personal", "household", "business"]); if (bad) return { text: bad };
  if (!clean(args.title)) return { text: "An event needs a title." };
  if (!DATE_RE.test(args.date || "")) return { text: "An event needs a date (YYYY-MM-DD)." };
  const f = eventFields(args); if (f.error) return { text: f.error };
  const [event] = normalizePlanEvents([{ ...f.event, id: newId("plan-evt"), allDay: !f.event.startTime, createdAt: now.toISOString() }]);
  const ref = rowRef(ctx, view, "plan");
  await db.update(ref.id, (state) => { state.planEvents = [...(Array.isArray(state.planEvents) ? state.planEvents : []), event]; return { changed: true }; });
  return {
    text: `Added to the ${VIEW_LABELS[view]} calendar: "${event.title}" on ${weekdayLabel(event.date)}${event.startTime ? ` at ${event.startTime}` : ""}.`,
    undo: { kind: "remove", row: ref.id, key: "planEvents", id: event.id, owner: ref.owner },
  };
}

async function updateEvent(db, ctx, args) {
  const view = args.view || "personal";
  const bad = checkView(ctx, view, ["personal", "household", "business"]); if (bad) return { text: bad };
  const ref = rowRef(ctx, view, "plan");
  let text = ""; let undo = null;
  await db.update(ref.id, (state) => {
    const list = Array.isArray(state.planEvents) ? state.planEvents : [];
    const m = findOne(list, args.title, (e) => !args.date || e.date === args.date || (e.endDate && e.date <= args.date && args.date <= e.endDate), "event");
    if (m.error) { text = m.error; return { changed: false }; }
    const f = eventFields({ ...args, title: undefined }, m.item);
    if (f.error) { text = f.error; return { changed: false }; }
    const [next] = normalizePlanEvents([f.event]);
    state.planEvents = list.map((e) => (e === m.item ? next : e));
    undo = { kind: "replace", row: ref.id, key: "planEvents", id: m.item.id, before: m.item };
    text = `Updated "${next.title}" (${weekdayLabel(next.date)}${next.startTime ? ` ${next.startTime}` : ""})${m.item.recurrence ? " — it repeats, so the whole series changed" : ""}.`;
    return { changed: true };
  });
  return { text, undo };
}

async function deleteFrom(db, ctx, { view, section, key, title, extra, label, describe }) {
  const ref = rowRef(ctx, view, section);
  let text = ""; let removed = null;
  await db.update(ref.id, (state) => {
    const list = Array.isArray(state[key]) ? state[key] : [];
    const m = findOne(list, title, extra, label);
    if (m.error) { text = m.error; return { changed: false }; }
    removed = m.item;
    state[key] = list.filter((x) => x !== m.item);
    text = describe(m.item);
    return { changed: true };
  });
  if (!removed) return { text };
  await tombstone(db, ctx, key, [removed.id], ref.owner);
  return { text, undo: { kind: "restore", row: ref.id, key, item: removed } };
}

// ── Tasks ───────────────────────────────────────────────────────────────────
async function addTask(db, ctx, args, { newId, now, today }) {
  const view = args.view || (viewsFor(ctx).includes("personal") ? "personal" : "household");
  const bad = checkView(ctx, view, ["personal", "household"]); if (bad) return { text: bad };
  const title = clean(args.title, 200); if (!title) return { text: "A task needs a title." };
  const ref = rowRef(ctx, view, "do");
  const task = { id: newId("task"), title, done: false, createdAt: now.toISOString() };
  if (args.date && args.date !== "backlog") {
    if (!DATE_RE.test(args.date)) return { text: "date is YYYY-MM-DD, or \"backlog\"." };
    const { week, dayId } = dayIdFor(args.date);
    const day = dayId === "friday-finish" ? "friday-start" : dayId;
    const wk = dayId === "friday-finish" ? addDaysKey(week, 7) : week;
    await db.update(ref.id, (state) => {
      if (!state.doPlans || typeof state.doPlans !== "object") state.doPlans = {};
      const w = state.doPlans[wk] && typeof state.doPlans[wk] === "object" ? state.doPlans[wk] : (state.doPlans[wk] = {});
      w[day] = [...(Array.isArray(w[day]) ? w[day] : []), task];
      return { changed: true };
    });
    return { text: `Task added for ${weekdayLabel(args.date)} (${VIEW_LABELS[view]}): "${title}".`, undo: { kind: "removeTask", row: ref.id, id: task.id, owner: ref.owner } };
  }
  task.weekKey = prepWeekKey(today);
  await db.update(ref.id, (state) => { state.doBacklog = [...(Array.isArray(state.doBacklog) ? state.doBacklog : []), task]; return { changed: true }; });
  return { text: `Task added to the ${VIEW_LABELS[view]} backlog: "${title}".`, undo: { kind: "remove", row: ref.id, key: "doBacklog", id: task.id, owner: ref.owner } };
}

// Every task in a do row with where it lives: { task, where: "backlog" | [week, day] }.
function allTasks(state) {
  const out = (Array.isArray(state.doBacklog) ? state.doBacklog : []).map((task) => ({ task, where: "backlog" }));
  for (const [wk, days] of Object.entries(state.doPlans || {})) {
    for (const [day, list] of Object.entries(days || {})) for (const task of Array.isArray(list) ? list : []) out.push({ task, where: [wk, day] });
  }
  return out;
}

async function setTaskDone(db, ctx, args) {
  const view = args.view || (viewsFor(ctx).includes("personal") ? "personal" : "household");
  const bad = checkView(ctx, view, ["personal", "household"]); if (bad) return { text: bad };
  const ref = rowRef(ctx, view, "do");
  const done = args.done !== false;
  let text = ""; let undo = null;
  await db.update(ref.id, (state) => {
    const entries = allTasks(state).filter((e) => Boolean(e.task?.done) !== done);
    const m = findOne(entries.map((e) => e.task), args.title, () => true, "task");
    if (m.error) { text = m.error; return { changed: false }; }
    m.item.done = done;
    if (done) m.item.completedAt = new Date().toISOString(); else delete m.item.completedAt;
    undo = { kind: "taskDone", row: ref.id, id: m.item.id, done: !done };
    text = `${done ? "Marked done" : "Marked not done"}: "${m.item.title}".`;
    return { changed: true };
  });
  return { text, undo };
}

async function deleteTask(db, ctx, args) {
  const view = args.view || (viewsFor(ctx).includes("personal") ? "personal" : "household");
  const bad = checkView(ctx, view, ["personal", "household"]); if (bad) return { text: bad };
  const ref = rowRef(ctx, view, "do");
  let text = ""; let removed = null;
  await db.update(ref.id, (state) => {
    const entries = allTasks(state);
    const m = findOne(entries.map((e) => e.task), args.title, () => true, "task");
    if (m.error) { text = m.error; return { changed: false }; }
    const entry = entries.find((e) => e.task === m.item);
    if (entry.where === "backlog") state.doBacklog = state.doBacklog.filter((t) => t !== m.item);
    else { const [wk, day] = entry.where; state.doPlans[wk][day] = state.doPlans[wk][day].filter((t) => t !== m.item); }
    removed = entry;
    text = `Deleted task "${m.item.title}".`;
    return { changed: true };
  });
  if (!removed) return { text };
  await tombstone(db, ctx, removed.where === "backlog" ? "doBacklog" : "doPlanTasks", [removed.task.id], ref.owner);
  return { text, undo: { kind: "restoreTask", row: ref.id, task: removed.task, where: removed.where } };
}

// ── Shopping list (the household's hand-added list) ─────────────────────────
async function shopping(db, ctx, args, { now }, add) {
  if (!viewsFor(ctx).includes("household")) return { text: "Shop is a Household page, and Household isn't available." };
  const items = (Array.isArray(args.items) ? args.items : [args.items]).map((i) => clean(i, 120)).filter(Boolean).slice(0, 50);
  if (!items.length) return { text: "No items given." };
  const ref = rowRef(ctx, "household", "grocery");
  const iso = now.toISOString();
  let changedItems = [];
  await db.update(ref.id, (state) => {
    const list = Array.isArray(state.persistentManualGroceries) ? [...state.persistentManualGroceries] : [];
    const stamps = state.persistentManualGroceryStamps && typeof state.persistentManualGroceryStamps === "object" ? state.persistentManualGroceryStamps : {};
    changedItems = [];
    for (const item of items) {
      const has = list.some((e) => groceryKey(e) === groceryKey(item));
      if (add) {
        stampGroceryAdd(stamps, item, iso);
        if (!has) { list.push(item); changedItems.push(item); }
        // Needed now, even if it was ticked off before: drop its bought marks. The
        // app keys rows by the catalog's canonical name; the plain lower-case name
        // matches it for ordinary items (best effort — no catalog on the server).
        if (state.checkedGroceries && state.groceryCleared) resetBoughtMarks(state.checkedGroceries, state.groceryCleared, groceryKey(item));
      } else if (has) {
        stampGroceryRemove(stamps, item, iso);
        const keyOf = groceryKey(item);
        for (let i = list.length - 1; i >= 0; i--) if (groceryKey(list[i]) === keyOf) list.splice(i, 1);
        changedItems.push(item);
      }
    }
    if (!changedItems.length && !add) return { changed: false };
    list.sort((a, b) => groceryKey(a).localeCompare(groceryKey(b)));
    state.persistentManualGroceries = list;
    state.persistentManualGroceryStamps = stamps;
    return { changed: true };
  });
  if (add) {
    const already = items.filter((i) => !changedItems.includes(i));
    return {
      text: `Added to the shopping list: ${changedItems.join(", ") || "nothing new"}${already.length ? ` (already there: ${already.join(", ")})` : ""}.`,
      undo: changedItems.length ? { kind: "shopping", add: false, items: changedItems } : null,
    };
  }
  const missing = items.filter((i) => !changedItems.includes(i));
  return {
    text: changedItems.length ? `Removed from the shopping list: ${changedItems.join(", ")}${missing.length ? ` (not on it: ${missing.join(", ")})` : ""}.` : `None of those were on the shopping list.`,
    undo: changedItems.length ? { kind: "shopping", add: true, items: changedItems } : null,
  };
}

// ── Meal plan ───────────────────────────────────────────────────────────────
function slotNames(meal, who) {
  const m = MEAL_MEMBERS[norm(meal)];
  if (!m) return { error: "meal is breakfast, lunch or dinner." };
  const w = norm(who || "all");
  if (w === "all" || w === "everyone") return { slots: ["MJ", "Luke", "Sophia"].map((p) => `${p} ${m}`) };
  const p = PEOPLE[w];
  return p ? { slots: [`${p} ${m}`] } : { error: "who is all, Luke, MJ or Sophia." };
}

async function setMeal(db, ctx, args, _env, clear = false) {
  if (!viewsFor(ctx).includes("household")) return { text: "The meal plan is a Household page, and Household isn't available." };
  if (!DATE_RE.test(args.date || "")) return { text: "date is YYYY-MM-DD." };
  const s = slotNames(args.meal, args.who); if (s.error) return { text: s.error };
  let value = "";
  let label = "";
  if (!clear) {
    const special = norm(args.special);
    if (special === "out" || special === "leftovers") {
      value = `special-meal::${encodeURIComponent(special)}::${encodeURIComponent(clean(args.note, 200))}`;
      label = special === "out" ? "Out" : "Leftovers";
    } else if (clean(args.recipe)) {
      const recipes = await db.recipes(null);
      const m = findOne((recipes || []).map((r) => ({ ...r, title: r.name })), args.recipe, () => true, "recipe");
      if (m.error) return { text: `${m.error} (Use "text" for something that isn't in the recipe box.)` };
      value = String(m.item.id); label = m.item.name;
    } else if (clean(args.text)) {
      value = `grocery-item::${encodeURIComponent(clean(args.text, 120))}::1`; label = clean(args.text, 120);
    } else return { text: "Give a recipe (name from the recipe box), text, or special: out / leftovers." };
  }
  const { week, dayId } = dayIdFor(args.date);
  const ref = { id: `${ctx.groupId}:eat` };
  let before = {};
  await db.update(ref.id, (state) => {
    if (!state.plans || typeof state.plans !== "object") state.plans = {};
    const w = state.plans[week] && typeof state.plans[week] === "object"
      ? state.plans[week]
      : (state.plans[week] = { notes: "", manualGroceries: [], mealPlanView: "edit", publishedSlots: null, combinedMealSections: {}, publishedCombinedMealSections: {}, mealNotes: {}, slots: {} });
    if (!w.slots || typeof w.slots !== "object") w.slots = {};
    const day = w.slots[dayId] && typeof w.slots[dayId] === "object" ? w.slots[dayId] : (w.slots[dayId] = {});
    before = Object.fromEntries(s.slots.map((k) => [k, day[k] ?? ""]));
    for (const k of s.slots) day[k] = value;
    return { changed: true };
  });
  const whoText = s.slots.length > 1 ? "everyone" : s.slots[0].split(" ")[0];
  const text = clear
    ? `Cleared ${norm(args.meal)} on ${weekdayLabel(args.date)} for ${whoText}. (A phone that still shows the old meal can put it back; clearing is safest in the app.)`
    : `${MEAL_MEMBERS[norm(args.meal)]} on ${weekdayLabel(args.date)} for ${whoText}: ${label}.`;
  return { text, undo: { kind: "slots", row: ref.id, week, dayId, before } };
}

// ── Watch ───────────────────────────────────────────────────────────────────
async function addWatch(db, ctx, args, { newId, now }) {
  const view = args.view || "household";
  const bad = checkView(ctx, view, ["personal", "household"]); if (bad) return { text: bad };
  const title = clean(args.title, 200); if (!title) return { text: "A title is needed." };
  const type = args.type === "tv" ? "tv" : "movie";
  const year = Number.isInteger(args.year) ? args.year : null;
  const ref = rowRef(ctx, view, "watch");
  const item = {
    id: newId("watch"), type, title, status: "want",
    tmdbId: null, posterPath: null, year, overview: null,
    streamingProviders: null, providersUpdatedAt: null,
    totalSeasons: null, totalEpisodes: null, runtime: null, avgEpisodeRuntime: null,
    watchedDate: null, rating: null, watchNotes: null, seasonProgress: {}, categories: [],
    createdAt: now.toISOString(),
  };
  let dup = null;
  await db.update(ref.id, (state) => {
    const list = Array.isArray(state.watchItems) ? state.watchItems : [];
    dup = list.find((w) => norm(w.title) === norm(title) && (!year || !w.year || w.year === year)) || null;
    if (dup) return { changed: false };
    state.watchItems = [...list, item];
    return { changed: true };
  });
  if (dup) return { text: `"${dup.title}" is already on the ${VIEW_LABELS[view]} list.` };
  return { text: `Added to the ${VIEW_LABELS[view]} Watch list: "${title}" (${type === "tv" ? "show" : "movie"}). Poster and where-to-watch fill in when the app next opens it.`, undo: { kind: "remove", row: ref.id, key: "watchItems", id: item.id, owner: ref.owner } };
}

async function setWatchStatus(db, ctx, args, { today }) {
  const view = args.view || "household";
  const bad = checkView(ctx, view, ["personal", "household"]); if (bad) return { text: bad };
  const status = args.status === "want" ? "want" : "watched";
  const ref = rowRef(ctx, view, "watch");
  let text = ""; let undo = null;
  await db.update(ref.id, (state) => {
    const list = Array.isArray(state.watchItems) ? state.watchItems : [];
    const m = findOne(list, args.title, () => true, "title");
    if (m.error) { text = m.error; return { changed: false }; }
    undo = { kind: "replace", row: ref.id, key: "watchItems", id: m.item.id, before: { ...m.item } };
    m.item.status = status;
    m.item.watchedDate = status === "watched" ? (m.item.watchedDate || today) : null;
    text = `"${m.item.title}" marked ${status === "watched" ? "watched" : "want to watch"} (${VIEW_LABELS[view]}).`;
    return { changed: true };
  });
  return { text, undo };
}

// ── Trips ───────────────────────────────────────────────────────────────────
async function addTrip(db, ctx, args, { newId, now }) {
  if (!viewsFor(ctx).includes("household")) return { text: "Explore is a Household page, and Household isn't available." };
  const name = clean(args.name, 120); if (!name) return { text: "A trip needs a name." };
  for (const k of ["start_date", "end_date"]) if (args[k] && !DATE_RE.test(args[k])) return { text: `${k} is YYYY-MM-DD.` };
  const status = ["idea", "planning", "booked"].includes(args.status) ? args.status : "planning";
  const ref = rowRef(ctx, "household", "travel");
  const iso = now.toISOString();
  const trip = {
    id: newId("trip"), name, destination: clean(args.destination, 160), status,
    startDate: args.start_date || "", endDate: args.end_date || "", party: ["Luke"], currency: "USD",
    itinerary: [], logistics: [], expenses: [], packingList: [], notes: clean(args.notes, 2000), saved: [], refs: [],
    createdAt: iso, updatedAt: iso,
  };
  await db.update(ref.id, (state) => { state.trips = [...(Array.isArray(state.trips) ? state.trips : []), trip]; return { changed: true }; });
  return { text: `Trip added to Explore: "${name}"${trip.destination ? ` — ${trip.destination}` : ""}${trip.startDate ? `, ${trip.startDate}${trip.endDate ? ` to ${trip.endDate}` : ""}` : ""} (${status}).`, undo: { kind: "remove", row: ref.id, key: "trips", id: trip.id, owner: ref.owner } };
}

// ── Undo ────────────────────────────────────────────────────────────────────
export async function applyUndo(db, ctx, undo, { newId }) {
  switch (undo?.kind) {
    case "remove": {
      let found = false;
      await db.update(undo.row, (state) => {
        const list = Array.isArray(state[undo.key]) ? state[undo.key] : [];
        found = list.some((x) => x?.id === undo.id);
        if (!found) return { changed: false };
        state[undo.key] = list.filter((x) => x?.id !== undo.id);
        return { changed: true };
      });
      if (found) await tombstone(db, ctx, undo.key, [undo.id], undo.owner);
      return found ? "Removed it again." : "It was already gone.";
    }
    case "removeTask": {
      let found = false;
      await db.update(undo.row, (state) => {
        for (const days of Object.values(state.doPlans || {})) for (const [day, list] of Object.entries(days || {})) {
          if (Array.isArray(list) && list.some((t) => t?.id === undo.id)) { days[day] = list.filter((t) => t?.id !== undo.id); found = true; }
        }
        return { changed: found };
      });
      if (found) await tombstone(db, ctx, "doPlanTasks", [undo.id], undo.owner);
      return found ? "Removed the task again." : "The task was already gone.";
    }
    case "restore": {
      const item = { ...undo.item, id: newId(String(undo.item?.id || "item").split("-")[0] || "item") };
      await db.update(undo.row, (state) => { state[undo.key] = [...(Array.isArray(state[undo.key]) ? state[undo.key] : []), item]; return { changed: true }; });
      return `Put "${clean(item.title || item.name, 80)}" back.`;
    }
    case "restoreTask": {
      const task = { ...undo.task, id: newId("task") };
      await db.update(undo.row, (state) => {
        if (undo.where === "backlog") state.doBacklog = [...(Array.isArray(state.doBacklog) ? state.doBacklog : []), task];
        else {
          const [wk, day] = undo.where;
          if (!state.doPlans || typeof state.doPlans !== "object") state.doPlans = {};
          const w = state.doPlans[wk] || (state.doPlans[wk] = {});
          w[day] = [...(Array.isArray(w[day]) ? w[day] : []), task];
        }
        return { changed: true };
      });
      return `Put the task "${clean(task.title, 80)}" back.`;
    }
    case "replace": {
      let found = false;
      await db.update(undo.row, (state) => {
        const list = Array.isArray(state[undo.key]) ? state[undo.key] : [];
        found = list.some((x) => x?.id === undo.id);
        if (!found) return { changed: false };
        state[undo.key] = list.map((x) => (x?.id === undo.id ? undo.before : x));
        return { changed: true };
      });
      return found ? "Changed it back." : "That item is gone now, so there was nothing to change back.";
    }
    case "taskDone": {
      let found = false;
      await db.update(undo.row, (state) => {
        const e = allTasks(state).find((x) => x.task?.id === undo.id);
        if (!e) return { changed: false };
        found = true; e.task.done = undo.done; if (!undo.done) delete e.task.completedAt;
        return { changed: true };
      });
      return found ? "Changed the task back." : "The task is gone now.";
    }
    case "shopping": {
      const r = await shopping(db, ctx, { items: undo.items }, { now: new Date() }, undo.add);
      return r.text;
    }
    case "slots": {
      await db.update(undo.row, (state) => {
        const day = state.plans?.[undo.week]?.slots?.[undo.dayId];
        if (!day) return { changed: false };
        Object.assign(day, undo.before);
        return { changed: true };
      });
      return "Put the meal plan back as it was.";
    }
    default: return "That change can't be undone.";
  }
}

// ── Tool list ───────────────────────────────────────────────────────────────
const dateP = (d) => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: d });
const timeP = (d) => ({ type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: d });
const calView = { type: "string", enum: ["personal", "household", "business"], description: "Which calendar. Default personal." };
const taskView = { type: "string", enum: ["personal", "household"], description: "Whose tasks. Default personal." };
const watchView = { type: "string", enum: ["personal", "household"], description: "Household = shared list (default); Personal = Luke's own." };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { ...WRITE, destructiveHint: true };

export const WRITE_TOOLS = [
  { name: "add_event", title: "Add calendar event", annotations: WRITE,
    description: "Add an event to a Liv calendar (not Google). Times are America/Chicago, 24-hour HH:MM; leave times out for an all-day event.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title", "date"], properties: {
      title: { type: "string" }, date: dateP("Day, YYYY-MM-DD."), start_time: timeP("Start, HH:MM."), end_time: timeP("End, HH:MM."),
      end_date: dateP("Last day for a multi-day event."), notes: { type: "string" }, location: { type: "string" }, view: calView } } },
  { name: "update_event", title: "Change calendar event", annotations: WRITE,
    description: "Change a Liv calendar event found by title (and date, if several share the title). Only the fields given change. A repeating event changes as a whole series.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: {
      title: { type: "string", description: "Current title (exact or part)." }, date: dateP("Its current date, to pick the right one."),
      new_title: { type: "string" }, new_date: dateP("Move it to this day."), start_time: timeP("New start, HH:MM (empty string clears)."), end_time: timeP("New end, HH:MM."),
      all_day: { type: "boolean" }, end_date: dateP("New last day."), notes: { type: "string" }, location: { type: "string" }, view: calView } } },
  { name: "delete_event", title: "Delete calendar event", annotations: DESTRUCTIVE,
    description: "Delete a Liv calendar event found by title (and date). A repeating event is deleted as a whole series. Undo with undo_change.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, date: dateP("Its date, to pick the right one."), view: calView } } },
  { name: "add_task", title: "Add task", annotations: WRITE,
    description: "Add a task for a day (YYYY-MM-DD) or to the backlog.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD, or \"backlog\" (default)." }, view: taskView } } },
  { name: "complete_task", title: "Complete task", annotations: WRITE,
    description: "Mark a task done (or not done with done=false), found by title.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, done: { type: "boolean", description: "Default true." }, view: taskView } } },
  { name: "delete_task", title: "Delete task", annotations: DESTRUCTIVE,
    description: "Delete a task found by title. Undo with undo_change.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, view: taskView } } },
  { name: "add_shopping_items", title: "Add to shopping list", annotations: WRITE,
    description: "Add items to the household's hand-added shopping list (Shop).",
    inputSchema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "string" }, maxItems: 50 } } } },
  { name: "remove_shopping_items", title: "Remove from shopping list", annotations: DESTRUCTIVE,
    description: "Remove items from the hand-added shopping list (bought, or not needed).",
    inputSchema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "string" }, maxItems: 50 } } } },
  { name: "set_meal", title: "Plan a meal", annotations: WRITE,
    description: "Put a meal on the household meal plan: a recipe from the recipe box (by name), free text, or out / leftovers. who: all (default), Luke, MJ or Sophia.",
    inputSchema: { type: "object", additionalProperties: false, required: ["date", "meal"], properties: {
      date: dateP("Day, YYYY-MM-DD."), meal: { type: "string", enum: ["breakfast", "lunch", "dinner"] }, who: { type: "string", enum: ["all", "Luke", "MJ", "Sophia"] },
      recipe: { type: "string", description: "Recipe name (exact or part)." }, text: { type: "string", description: "Something not in the recipe box, e.g. \"Frozen pizza\"." },
      special: { type: "string", enum: ["out", "leftovers"] }, note: { type: "string", description: "With special: where / what." } } } },
  { name: "clear_meal", title: "Clear a meal", annotations: DESTRUCTIVE,
    description: "Empty a meal on the meal plan.",
    inputSchema: { type: "object", additionalProperties: false, required: ["date", "meal"], properties: { date: dateP("Day."), meal: { type: "string", enum: ["breakfast", "lunch", "dinner"] }, who: { type: "string", enum: ["all", "Luke", "MJ", "Sophia"] } } } },
  { name: "add_watch_item", title: "Add to Watch list", annotations: WRITE,
    description: "Add a movie or show to a Watch list.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, type: { type: "string", enum: ["movie", "tv"] }, year: { type: "integer" }, view: watchView } } },
  { name: "set_watch_status", title: "Mark watched", annotations: WRITE,
    description: "Mark a Watch list title watched (or back to want).",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, status: { type: "string", enum: ["watched", "want"] }, view: watchView } } },
  { name: "remove_watch_item", title: "Remove from Watch list", annotations: DESTRUCTIVE,
    description: "Remove a title from a Watch list. Undo with undo_change.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" }, view: watchView } } },
  { name: "add_trip", title: "Add trip", annotations: WRITE,
    description: "Add a trip to Explore (the household's shared trips).",
    inputSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" }, destination: { type: "string" }, start_date: dateP("YYYY-MM-DD."), end_date: dateP("YYYY-MM-DD."), status: { type: "string", enum: ["idea", "planning", "booked"] }, notes: { type: "string" } } } },
  { name: "list_recent_changes", title: "Recent changes", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "The last changes made through this connector, newest first, with ids for undo_change.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 30 } } } },
  { name: "undo_change", title: "Undo a change", annotations: WRITE,
    description: "Undo a change made through this connector (id from list_recent_changes; default the most recent).",
    inputSchema: { type: "object", additionalProperties: false, properties: { change_id: { type: "string" } } } },
];

const WRITE_HANDLERS = {
  add_event: addEvent,
  update_event: updateEvent,
  delete_event: (db, ctx, a) => {
    const view = a.view || "personal";
    const bad = checkView(ctx, view, ["personal", "household", "business"]); if (bad) return { text: bad };
    return deleteFrom(db, ctx, { view, section: "plan", key: "planEvents", title: a.title, label: "event",
      extra: (e) => !a.date || e.date === a.date || (e.endDate && e.date <= a.date && a.date <= e.endDate),
      describe: (e) => `Deleted "${e.title}" (${weekdayLabel(e.date)})${e.recurrence ? " — the whole repeating series" : ""} from the ${VIEW_LABELS[view]} calendar.` });
  },
  add_task: addTask,
  complete_task: setTaskDone,
  delete_task: deleteTask,
  add_shopping_items: (db, ctx, a, env) => shopping(db, ctx, a, env, true),
  remove_shopping_items: (db, ctx, a, env) => shopping(db, ctx, a, env, false),
  set_meal: (db, ctx, a, env) => setMeal(db, ctx, a, env, false),
  clear_meal: (db, ctx, a, env) => setMeal(db, ctx, a, env, true),
  add_watch_item: addWatch,
  set_watch_status: setWatchStatus,
  remove_watch_item: (db, ctx, a) => {
    const view = a.view || "household";
    const bad = checkView(ctx, view, ["personal", "household"]); if (bad) return { text: bad };
    return deleteFrom(db, ctx, { view, section: "watch", key: "watchItems", title: a.title, label: "title",
      describe: (w) => `Removed "${w.title}" from the ${VIEW_LABELS[view]} Watch list.` });
  },
  add_trip: addTrip,
};

// Runs a write tool: the change, then its log line. Returns the text for Duet.
export async function runWriteTool(name, db, ctx, args, env) {
  if (name === "list_recent_changes") {
    const rows = await db.changes(Math.min(30, Math.max(1, Number(args.limit) || 10)));
    if (!rows?.length) return "No changes made through this connector yet.";
    return ["Recent changes (newest first):", ...rows.map((r) => `  - [${r.id}] ${r.created_at.slice(0, 16).replace("T", " ")} UTC · ${r.summary}${r.undone_at ? " (undone)" : r.undo ? "" : " (can't be undone)"}`)].join("\n");
  }
  if (name === "undo_change") {
    const row = args.change_id ? await db.change(String(args.change_id)) : (await db.changes(1))?.[0];
    if (!row) return "No such change.";
    if (row.undone_at) return "That change was already undone.";
    if (!row.undo) return "That change can't be undone.";
    const text = await applyUndo(db, ctx, row.undo, env);
    await db.markUndone(row.id);
    await db.log({ tool: "undo_change", summary: `Undid: ${row.summary}`, undo: null });
    return text;
  }
  const handler = WRITE_HANDLERS[name];
  const { text, undo } = await handler(db, ctx, args, env);
  if (undo) {
    const change = await db.log({ tool: name, summary: text.slice(0, 300), undo });
    return change?.id ? `${text} [change ${change.id}]` : text;
  }
  return text;
}

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
