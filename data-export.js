// data-export.js — "Export my data": one lossless JSON + derived CSV/ICS/vCard files.
//
// Design (DATA_EXPORT.md):
//   • ONE source of truth. The export reads the in-memory `state` (plus the scope-
//     inactive shadow sections and the relational rows the caller fetched) and
//     DERIVES every file from it at export time. Nothing here collects data on its
//     own — there is no parallel "CSV collection" path to drift from the real data.
//   • live-export.json is lossless and restorable: it carries `state` at the top
//     level so the existing Restore dialog (normalizeRestoreState reads `.state`)
//     accepts it unchanged. Secrets (cookies, tokens, keys) are REMOVED, not kept.
//   • CSVs are for spreadsheets/analysis: one table per record type, columns
//     discovered from the data (so a new field shows up without touching this file),
//     with a readable column order and id→name lookups where they help.
//   • Pure: no DOM/storage/network. The caller gathers inputs and triggers the
//     download; zipping is done by the caller with fflate (see buildExportZip).

const CSV_FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

// Keys whose string values are credentials. Matched case-insensitively against the
// key name anywhere in the state tree; the key is dropped from the export entirely.
const SECRET_KEY = /(cookie|token|secret|password|passwd|api[_-]?key|access[_-]?key|authorization|credential|private[_-]?key)/i;

// ── CSV primitives ──────────────────────────────────────────────────────────────

// One cell. Arrays of primitives join with "; ", objects/arrays of objects become
// compact JSON, and text that a spreadsheet would run as a formula (a bank
// description starting with "=" / "+" / "@") is prefixed with ' — numbers such as
// "-12.50" are left alone.
export function csvCell(value) {
  let s;
  if (value == null) s = "";
  else if (typeof value === "string") s = value;
  else if (typeof value === "number") s = Number.isFinite(value) ? String(value) : "";
  else if (typeof value === "boolean") s = value ? "true" : "false";
  else if (value instanceof Date) s = Number.isNaN(value.getTime()) ? "" : value.toISOString();
  else if (Array.isArray(value) && value.every((v) => v == null || typeof v !== "object")) s = value.filter((v) => v != null && v !== "").join("; ");
  else s = JSON.stringify(value);
  if (CSV_FORMULA_START.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Rows → CSV text. Columns: `preferred` first (only those that occur, unless
// `keepEmpty`), then every other key seen, in first-seen order. `omit` drops keys.
export function toCsv(rows, { preferred = [], omit = [] } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");
  const skip = new Set(omit);
  const seen = new Set();
  const discovered = [];
  for (const r of list) for (const k of Object.keys(r)) {
    if (skip.has(k) || seen.has(k)) continue;
    seen.add(k);
    discovered.push(k);
  }
  const lead = preferred.filter((k) => seen.has(k));
  const columns = [...lead, ...discovered.filter((k) => !lead.includes(k))];
  const lines = [columns.map(csvCell).join(",")];
  for (const r of list) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  // BOM so Excel opens UTF-8 (accents, emoji, "·") correctly; CRLF per RFC 4180.
  return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", columns, rowCount: list.length };
}

// ── Secret redaction ────────────────────────────────────────────────────────────

// Deep copy with every credential-named key removed. Returns { value, removed }
// where `removed` lists the dotted paths that were dropped (for the manifest).
export function redactSecrets(input) {
  const removed = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (SECRET_KEY.test(k) && typeof val === "string" && val !== "") {
        removed.push(p);
        continue;
      }
      out[k] = walk(val, p);
    }
    return out;
  };
  return { value: walk(input, ""), removed };
}

// ── Row helpers ─────────────────────────────────────────────────────────────────

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Flatten each parent's child array into rows carrying selected parent fields.
export function explode(parents, childKey, parentFields = {}) {
  const out = [];
  for (const p of arr(parents)) {
    for (const c of arr(p?.[childKey])) {
      const row = {};
      for (const [as, from] of Object.entries(parentFields)) row[as] = p?.[from];
      out.push({ ...row, ...(c && typeof c === "object" ? c : { value: c }) });
    }
  }
  return out;
}

const byId = (list, name = "name") => {
  const m = new Map();
  for (const x of arr(list)) if (x?.id != null) m.set(String(x.id), x[name] ?? x.title ?? x.label ?? "");
  return m;
};

// Add `<field>Name` next to id fields, looked up from another list in state.
function withLookups(rows, lookups) {
  if (!lookups) return rows;
  const maps = Object.fromEntries(Object.entries(lookups).map(([field, map]) => [field, map]));
  return rows.map((r) => {
    const out = { ...r };
    for (const [field, map] of Object.entries(maps)) {
      if (r[field] == null || r[field] === "") continue;
      out[`${field.replace(/Id$/, "")}Name`] = map.get(String(r[field])) ?? "";
    }
    return out;
  });
}

const addDays = (dateKey, n) => {
  const d = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Planner weeks: { weekKey: { dayId: [task] } } → one row per task with its date.
function weekDayRows(plans, prepDays, childOf = (day) => day) {
  const offsets = new Map(arr(prepDays).map((d) => [d.id, d]));
  const out = [];
  for (const [week, days] of Object.entries(obj(plans))) {
    for (const [dayId, value] of Object.entries(obj(childOf(days)))) {
      if (dayId.startsWith("__")) continue;
      const day = offsets.get(dayId);
      for (const t of arr(value)) out.push({ week, date: day ? addDays(week, day.offset) : "", day: day?.name || dayId, ...t });
    }
  }
  return out;
}

// Meal plan: plans[week].slots[dayId][meal] = "" | recipeId | free text | entry | [entries]
function mealPlanRows(plans, prepDays, recipes) {
  const offsets = new Map(arr(prepDays).map((d) => [d.id, d]));
  const recipeNames = byId(recipes);
  const out = [];
  for (const [week, record] of Object.entries(obj(plans))) {
    const notes = obj(record?.mealNotes);
    for (const [dayId, meals] of Object.entries(obj(record?.slots))) {
      const day = offsets.get(dayId);
      for (const [meal, value] of Object.entries(obj(meals))) {
        const entries = Array.isArray(value) ? value : (value ? [value] : []);
        entries.forEach((entry, position) => {
          if (!entry) return;
          const isObj = typeof entry === "object";
          const recipeId = isObj ? String(entry.recipeId || "") : (recipeNames.has(String(entry)) ? String(entry) : "");
          out.push({
            week,
            date: day ? addDays(week, day.offset) : (isObj ? entry.date || "" : ""),
            day: day?.name || dayId,
            meal,
            position,
            recipeId,
            recipeName: recipeId ? recipeNames.get(recipeId) || "" : "",
            text: !isObj && !recipeId ? String(entry) : (isObj ? entry.name || entry.title || "" : ""),
            servings: isObj ? entry.servings ?? entry.plannedServings ?? "" : "",
            note: obj(notes[dayId])[meal] || "",
            ...(isObj ? { detail: entry } : {}),
          });
        });
      }
    }
  }
  return out;
}

// financeMonthActuals: { "2026-08": { cats: {"gid:cid": n}, income, incomeBy } }
function financeActualRows(actuals, groups, people) {
  const catName = new Map();
  for (const g of arr(groups)) for (const c of arr(g?.categories)) catName.set(`${g.id}:${c.id}`, [g.label, c.name]);
  const personName = byId(people);
  const out = [];
  for (const [month, entry] of Object.entries(obj(actuals)).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [key, amount] of Object.entries(obj(entry?.cats))) {
      const [group = "", category = ""] = catName.get(key) || [];
      out.push({ month, kind: "spending", group, category, key, amount });
    }
    for (const [key, amount] of Object.entries(obj(entry?.incomeBy))) {
      const pid = key.startsWith("income:") ? key.slice(7) : "";
      out.push({ month, kind: "income", group: "Income", category: pid ? personName.get(pid) || "" : "", key, amount });
    }
    if (!Object.keys(obj(entry?.incomeBy)).length && entry?.income) {
      out.push({ month, kind: "income", group: "Income", category: "", key: "income", amount: entry.income });
    }
  }
  return out;
}

function financeBudgetRows(groups) {
  const out = [];
  for (const g of arr(groups)) for (const c of arr(g?.categories)) {
    const { id, name, ...rest } = c || {};
    out.push({ groupId: g.id, group: g.label, categoryId: id, category: name, ...rest });
  }
  return out;
}

function contactRows(contacts) {
  const join = (list) => arr(list).map((x) => (x?.label ? `${x.label}: ${x.value ?? ""}` : x?.value ?? "")).filter(Boolean).join("; ");
  return arr(contacts).map((c) => {
    const { phones, emails, addresses, dates, photo, ...rest } = c || {};
    return { ...rest, phones: join(phones), emails: join(emails), addresses: join(addresses), dates: join(dates), hasPhoto: Boolean(photo) };
  });
}

// ── Table registry ──────────────────────────────────────────────────────────────
// Each table: { name, section, rows(ctx), preferred?, omit? }. `section` ties it to
// STATE_SECTIONS so the scope-inactive (shadow) copy of a toggleable section can be
// exported with the same definitions. `ctx` = { state, prepDays, finance, history }.

const LEAD = ["id", "date", "title", "name"];

export const EXPORT_TABLES = [
  // Recipes cluster
  { name: "recipes", section: "eat", rows: ({ state }) => arr(state.recipes), preferred: ["id", "name", "tags", "servings", "prepTime", "cookTime", "ingredients", "steps", "source", "url", "photoUrl", "createdAt", "updatedAt"], omit: ["cookLog"] },
  { name: "recipe_cook_log", section: "eat", rows: ({ state }) => explode(state.recipes, "cookLog", { recipeId: "id", recipeName: "name" }), preferred: ["recipeId", "recipeName", "cookedAt"] },
  { name: "recipes_trashed", section: "eat", rows: ({ state }) => arr(state.trashedRecipes), preferred: LEAD },
  { name: "meal_plan", section: "eat", rows: ({ state, prepDays }) => mealPlanRows(state.plans, prepDays, state.recipes) },
  // Groceries
  { name: "grocery_list", section: "grocery", rows: ({ state }) => arr(state.persistentManualGroceries), preferred: LEAD },
  { name: "grocery_stores", section: "grocery", rows: ({ state }) => arr(state.groceryStores), preferred: LEAD },
  { name: "grocery_receipts", section: "grocery", rows: ({ state }) => arr(state.receipts), preferred: ["id", "date", "storeName", "total", "subtotal", "tax"], omit: ["lineItems", "extraction"] },
  { name: "grocery_receipt_items", section: "grocery", rows: ({ state }) => explode(state.receipts, "lineItems", { receiptId: "id", receiptDate: "date", storeName: "storeName" }), preferred: ["receiptId", "receiptDate", "storeName"] },
  { name: "grocery_price_history", section: "grocery", rows: ({ state }) => arr(state.priceHistory), preferred: ["observedAt", "storeName", "normalizedItemName", "unitPrice", "packagePrice", "quantity", "unit"] },
  { name: "grocery_price_observations", section: "grocery", rows: ({ state }) => withLookups(arr(state.groceryPriceObservations), { storeId: byId(state.groceryStores) }), preferred: ["observedAt", "itemName", "storeId", "storeName", "price", "unitPrice"] },
  { name: "pantry", section: "grocery", rows: ({ state }) => (Array.isArray(state.pantry) ? state.pantry : Object.entries(obj(state.pantry)).map(([key, v]) => ({ key, ...(v && typeof v === "object" ? v : { value: v }) }))), preferred: LEAD },
  // Tasks
  { name: "tasks_planned", section: "do", rows: ({ state, prepDays }) => weekDayRows(state.doPlans, prepDays), preferred: ["week", "date", "day", "title", "done", "taskType", "time", "notes"] },
  { name: "tasks_backlog", section: "do", rows: ({ state }) => arr(state.doBacklog), preferred: LEAD },
  { name: "tasks_recurring", section: "do", rows: ({ state }) => arr(state.recurringTasks), preferred: LEAD },
  { name: "tasks_completed", section: "do", rows: ({ state }) => arr(state.doArchive), preferred: ["id", "title", "archivedAt", "createdAt", "taskType", "notes"] },
  // Exercise
  { name: "workouts", section: "play", rows: ({ state }) => arr(state.workouts), preferred: ["id", "title", "type", "notes", "createdAt"], omit: ["logs"] },
  { name: "workout_logs", section: "play", rows: ({ state }) => explode(state.workouts, "logs", { workoutId: "id", workout: "title" }), preferred: ["workoutId", "workout", "date", "time", "weight"] },
  { name: "exercise_planned", section: "play", rows: ({ state, prepDays }) => weekDayRows(state.playPlans, prepDays), preferred: ["week", "date", "day", "title"] },
  // Watch / read / listen
  { name: "watch_list", section: "watch", rows: ({ state }) => arr(state.watchItems), preferred: LEAD },
  { name: "reading_list", section: "media", rows: ({ state }) => arr(state.readingItems), preferred: LEAD },
  { name: "saved_articles", section: "media", rows: ({ state }) => arr(state.savedArticles), preferred: ["id", "title", "url", "publication", "savedAt"], omit: ["text", "html", "body", "content"] },
  { name: "podcasts", section: "media", rows: ({ state }) => arr(state.podcasts), preferred: ["id", "title", "author", "feedUrl"], omit: ["episodes"] },
  { name: "podcast_saved_episodes", section: "media", rows: ({ state }) => arr(state.podcastSaved), preferred: LEAD, omit: ["description", "content"] },
  { name: "article_history_recent", section: "media", rows: ({ state }) => arr(state.articleHistory), preferred: ["date", "title", "url", "id"] },
  { name: "media_history_recent", section: "media", rows: ({ state }) => arr(state.mediaHistory).map((h) => ({ ...h, at: Number.isFinite(h?.at) ? new Date(h.at).toISOString() : h?.at })), preferred: ["at", "kind", "title", "subtitle", "id"] },
  { name: "music_library", section: "media", rows: ({ state }) => (Array.isArray(state.musicLibrary) ? state.musicLibrary : arr(obj(state.musicLibrary).tracks)), preferred: LEAD },
  { name: "radio_favorites", section: "media", rows: ({ state }) => arr(state.radioFavorites), preferred: LEAD },
  // Calendar
  { name: "calendar_events", section: "plan", rows: ({ state }) => withLookups(arr(state.planEvents), { calendarId: new Map([...byId(state.planCalendars), ...byId(state.calendars)]) }), preferred: ["id", "date", "endDate", "startTime", "endTime", "allDay", "title", "calendarId", "calendarName", "location", "notes", "recurrence"] },
  { name: "calendars", section: "plan", rows: ({ state }) => [...arr(state.calendars).map((c) => ({ list: "calendars", ...c })), ...arr(state.planCalendars).map((c) => ({ list: "planCalendars", ...c }))], preferred: ["list", "id", "name"] },
  // Health
  { name: "family_members", section: "health", rows: ({ state }) => arr(state.familyMembers), preferred: LEAD },
  { name: "daily_dozen", section: "health", rows: ({ state }) => withLookups(arr(state.dailyDozenEntries), { familyMemberId: byId(state.familyMembers), categoryId: byId(state.dailyDozenCategories) }), preferred: ["date", "familyMemberId", "familyMemberName", "categoryId", "categoryName", "servingsCompleted", "sourceType", "notes"] },
  { name: "daily_checklist", section: "health", rows: ({ state }) => withLookups(arr(state.dailyChecklistEntries), { familyMemberId: byId(state.familyMembers) }), preferred: ["date", "familyMemberId", "familyMemberName"] },
  { name: "food_log", section: "health", rows: ({ state }) => withLookups(arr(state.foodLogEntries), { familyMemberId: byId(state.familyMembers) }), preferred: ["date", "familyMemberId", "familyMemberName"] },
  // Inventory
  { name: "inventory_containers", section: "inventory", rows: ({ state }) => arr(state.inventoryBoxes), preferred: LEAD },
  { name: "inventory_items", section: "inventory", rows: ({ state }) => withLookups(arr(state.inventoryItems), { boxId: byId(state.inventoryBoxes) }), preferred: ["id", "name", "boxId", "boxName", "quantity"] },
  // Recreate + Cadence
  { name: "sailing_log", section: "recreate", rows: ({ state }) => withLookups(arr(state.sailingLog), { boatId: byId(state.sailingBoats) }), preferred: LEAD },
  { name: "sailing_boats", section: "recreate", rows: ({ state }) => arr(state.sailingBoats), preferred: LEAD },
  { name: "piano_log", section: "recreate", rows: ({ state }) => arr(state.pianoLog), preferred: ["date", "minutes", "notes"] },
  { name: "piano_songs", section: "recreate", rows: ({ state }) => arr(state.pianoSongs), preferred: LEAD },
  { name: "practice_works", section: "cadence", rows: ({ state }) => arr(state.cadenceWorks), preferred: LEAD },
  { name: "practice_sessions", section: "cadence", rows: ({ state }) => withLookups(arr(state.cadenceSessions), { workId: byId(state.cadenceWorks, "title") }), preferred: ["id", "workId", "workName", "startedAt", "endedAt"] },
  // Travel
  { name: "trips", section: "travel", rows: ({ state }) => arr(state.trips), preferred: ["id", "name", "destination", "status", "startDate", "endDate", "notes"] },
  { name: "trip_ideas", section: "travel", rows: ({ state }) => arr(state.travelIdeas), preferred: LEAD },
  // Finance
  { name: "finance_transactions", section: "finance", rows: ({ finance }) => arr(finance?.transactions), preferred: ["date", "merchant", "description", "amount", "category", "account", "labelSource", "note", "pending", "source", "status", "id"] },
  { name: "finance_month_totals", section: "finance", rows: ({ state }) => financeActualRows(state.financeMonthActuals, state.financeBudgetGroups, state.financePeople) },
  { name: "finance_budget", section: "finance", rows: ({ state }) => financeBudgetRows(state.financeBudgetGroups) },
  { name: "finance_accounts", section: "finance", rows: ({ state }) => arr(state.financeAccounts), preferred: LEAD },
  { name: "finance_recurring", section: "finance", rows: ({ state }) => arr(state.financeRecurring), preferred: LEAD },
  { name: "finance_goals", section: "finance", rows: ({ state }) => arr(state.financeGoals), preferred: LEAD },
  // Contacts
  { name: "contacts", section: "contacts", rows: ({ state }) => contactRows(state.contacts), preferred: ["id", "name", "firstName", "lastName", "phones", "emails", "birthday", "addresses", "groups", "notes"] },
  // Permanent history (live_history table) — all kinds, newest first.
  { name: "history", section: null, rows: ({ history }) => arr(history).map((h) => ({ occurredAt: h.occurred_at, kind: h.kind, title: h.title, refId: h.ref_id, payload: h.payload, id: h.id })) },
];

// ── Attachments (links only) ────────────────────────────────────────────────────
// Every photo/receipt/attachment reference found anywhere in state, as a flat index.
// Embedded data: URLs are noted, not copied (they're already in live-export.json).
const ATTACH_KEY = /(photo|image|attachment|file[_-]?ref|storage[_-]?path|audio[_-]?url|blob[_-]?path|^fileUrl$|^pdfUrl$)/i;
const LOOKS_LINKED = /^(https?:|data:|blob:)|\//;

export function collectAttachmentLinks(state) {
  const out = [];
  // `owner` = the nearest attachment-named key above this value (so the url inside
  // `attachment: { url, name }` is found too); only link-like strings count there.
  const walk = (v, path, key, owner) => {
    if (typeof v === "string") {
      const direct = ATTACH_KEY.test(key);
      if (!v || !(direct || (owner && LOOKS_LINKED.test(v)))) return;
      out.push({ path, key: direct ? key : `${owner}.${key}`, link: v.startsWith("data:") ? `(embedded ${v.slice(5, v.indexOf(";")) || "data"} — see live-export.json)` : v });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, key, owner)); return; }
    if (v && typeof v === "object") {
      const nextOwner = ATTACH_KEY.test(key) ? key : owner;
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, k, nextOwner);
    }
  };
  walk(state, "", "", "");
  return out.map((r) => ({ area: r.path.split(/[.[]/)[0], ...r }));
}

// ── ICS (user-created calendar events) ──────────────────────────────────────────

const icsEscape = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsDate = (d) => String(d || "").replace(/-/g, "");
const icsDateTime = (d, t) => `${icsDate(d)}T${String(t || "00:00").replace(/:/g, "").padEnd(4, "0").slice(0, 4)}00`;
const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// RFC 5545 line folding at 75 octets (approximated by characters).
const fold = (line) => {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join("\r\n");
};

export function rruleFor(r) {
  if (!r?.freq) return "";
  const parts = [`FREQ=${String(r.freq).toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${icsDate(r.until)}`);
  if (r.freq === "weekly" && arr(r.byWeekdays).length) parts.push(`BYDAY=${r.byWeekdays.map((n) => WEEKDAY[n]).join(",")}`);
  if (r.monthMode === "nthWeekday" && Number.isInteger(r.byWeekday)) parts.push(`BYDAY=${r.bySetPos ?? 1}${WEEKDAY[r.byWeekday]}`);
  return parts.join(";");
}

export function planEventsToIcs(events, { calendarName = "Live", stamp = new Date().toISOString() } = {}) {
  const dtstamp = stamp.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Live//Data export//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(calendarName)}`];
  for (const e of arr(events)) {
    if (!e?.date || !e?.title) continue;
    lines.push("BEGIN:VEVENT", `UID:${icsEscape(e.id || `${e.date}-${e.title}`)}@live`, `DTSTAMP:${dtstamp}`);
    const timed = e.allDay === false && e.startTime;
    if (timed) {
      lines.push(`DTSTART:${icsDateTime(e.date, e.startTime)}`);
      if (e.endTime) lines.push(`DTEND:${icsDateTime(e.endDate || e.date, e.endTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(e.endDate || e.date, 1))}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.notes) lines.push(`DESCRIPTION:${icsEscape(e.notes)}`);
    const loc = e.location && (e.location.name || e.location.address || e.location.label);
    if (loc) lines.push(`LOCATION:${icsEscape(loc)}`);
    const rrule = rruleFor(e.recurrence);
    if (rrule) lines.push(`RRULE:${rrule}`);
    for (const x of arr(e.exceptions)) lines.push(timed ? `EXDATE:${icsDateTime(x, e.startTime)}` : `EXDATE;VALUE=DATE:${icsDate(x)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ── Bundle ──────────────────────────────────────────────────────────────────────

// input = {
//   state,            // in-memory state (active scope of every section)
//   shadowSections,   // { section: { key: value } } — the scope NOT being shown
//   scopes,           // { section: "household" | "personal" } — active scope per section
//   stateSections,    // STATE_SECTIONS
//   prepDays,         // [{ id, name, offset }] — planner day offsets from the week key
//   finance,          // { transactions: [...] } from the finance module
//   history,          // live_history rows
//   contactsVcf,      // prebuilt vCard text (contacts module owns the format)
//   exportedAt, appVersion, schemaVersion, notes: [string]
// }
// Returns { files: [{ path, text }], manifest }.
export function buildExportFiles(input) {
  const exportedAt = input.exportedAt || new Date().toISOString();
  const { value: cleanState, removed: removedState } = redactSecrets(input.state || {});
  const { value: cleanShadow, removed: removedShadow } = redactSecrets(input.shadowSections || {});
  const ctx = { state: cleanState, prepDays: input.prepDays || [], finance: input.finance || {}, history: input.history || [] };
  const files = [];
  const tables = [];

  const addTables = (context, prefix, sectionFilter) => {
    for (const t of EXPORT_TABLES) {
      if (sectionFilter && !sectionFilter(t.section)) continue;
      let rows;
      try { rows = t.rows(context); } catch (e) { tables.push({ file: `${prefix}${t.name}.csv`, error: String(e?.message || e) }); continue; }
      if (!rows?.length) continue;
      const { csv, columns, rowCount } = toCsv(rows, { preferred: t.preferred, omit: t.omit });
      files.push({ path: `${prefix}${t.name}.csv`, text: csv });
      tables.push({ file: `${prefix}${t.name}.csv`, section: t.section, rows: rowCount, columns: columns.length });
    }
  };

  addTables(ctx, "csv/", null);

  // The other scope of each toggleable section (e.g. household tasks while viewing
  // personal) — same tables, filed under csv/<scope>/.
  const scopes = input.scopes || {};
  for (const [section, data] of Object.entries(obj(cleanShadow))) {
    if (!data || !Object.keys(data).length) continue;
    const other = scopes[section] === "household" ? "personal" : "household";
    addTables({ ...ctx, state: { ...cleanState, ...data }, finance: {}, history: [] }, `csv/${other}/`, (s) => s === section);
  }

  const attachments = collectAttachmentLinks(cleanState);
  if (attachments.length) {
    const { csv, rowCount } = toCsv(attachments, { preferred: ["area", "key", "link", "path"] });
    files.push({ path: "attachments.csv", text: csv });
    tables.push({ file: "attachments.csv", rows: rowCount });
  }

  const userEvents = arr(cleanState.planEvents);
  if (userEvents.length) files.push({ path: "calendar.ics", text: planEventsToIcs(userEvents, { stamp: exportedAt }) });
  if (input.contactsVcf) files.push({ path: "contacts.vcf", text: input.contactsVcf });

  const manifest = {
    format: "live-export",
    formatVersion: 1,
    exportedAt,
    appVersion: input.appVersion || "",
    schemaVersion: input.schemaVersion ?? null,
    scopes,
    redactedKeys: [...removedState, ...removedShadow.map((p) => `shadowSections.${p}`)],
    notes: input.notes || [],
    counts: {
      stateKeys: Object.keys(cleanState).length,
      financeTransactions: arr(ctx.finance.transactions).length,
      historyRows: ctx.history.length,
      attachments: attachments.length,
      calendarEvents: userEvents.length,
    },
    files: tables,
  };

  // `state` at the top level is what the Restore dialog reads (normalizeRestoreState).
  const json = {
    format: "live-export",
    formatVersion: 1,
    exportedAt,
    state: cleanState,
    shadowSections: cleanShadow,
    scopes,
    relational: { financeTransactions: arr(ctx.finance.transactions), history: ctx.history },
  };
  files.unshift(
    { path: "README.txt", text: readmeText(manifest) },
    { path: "manifest.json", text: JSON.stringify(manifest, null, 2) },
    { path: "live-export.json", text: JSON.stringify(json) },
  );
  return { files, manifest };
}

function readmeText(m) {
  return [
    "Live — data export",
    `Exported ${m.exportedAt}`,
    "",
    "live-export.json   Everything, lossless. Settings › Restore accepts this file.",
    "                   Secrets (logins, tokens, keys) are removed — after a FULL",
    "                   restore, re-enter them in Settings. A merge restore keeps them.",
    "csv/               One spreadsheet per record type (UTF-8, opens in Excel/Numbers/Sheets).",
    "csv/household/, csv/personal/   The other view of pages with a household/personal toggle.",
    "calendar.ics       Your own calendar events (subscribed calendars are not included).",
    "contacts.vcf       Contacts as vCards.",
    "attachments.csv    Where each photo/receipt/attachment lives (links only, not the files).",
    "manifest.json      Row counts per file, redacted keys, and notes about this export.",
    "",
    ...(m.notes.length ? ["Notes:", ...m.notes.map((n) => `  - ${n}`), ""] : []),
  ].join("\r\n");
}

// Zip the files with an injected fflate ({ zipSync, strToU8 }) so this module stays
// dependency-free and testable. Returns a Uint8Array.
export function buildExportZip(files, { zipSync, strToU8 }, root = "live-export") {
  const tree = {};
  for (const f of files) tree[`${root}/${f.path}`] = strToU8(f.text);
  return zipSync(tree, { level: 6 });
}
