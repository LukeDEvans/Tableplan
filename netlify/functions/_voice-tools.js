// Server-side appliers for the assistant tools the Siri voice shortcut may use
// (voice → the same assistant: assistant-tools.js specs, same memory). Each tool
// maps to the state section its data lives in and a PURE applier
// (state, input, ctx) → result text, run inside _state-sections.updateSection's
// locked read-modify-write — so no fetches here.
//
// ctx = { weekKey, todayKey, newId(), now (ISO), stamps (grocery-list-stamps.js),
//         memory (assistant-memory.js) } — the ESM helpers are injected by the
// handler (dynamic import), keeping this module plain CJS and unit-testable.
//
// Deletions are deliberately NOT voice tools: they're confirmation-first in the
// app (assistant-tools.js risk:"destructive"), and a spoken command can't show a
// Confirm card.

const prepDays = [
  { id: "friday-start", name: "Friday" }, { id: "saturday", name: "Saturday" }, { id: "sunday", name: "Sunday" },
  { id: "monday", name: "Monday" }, { id: "tuesday", name: "Tuesday" }, { id: "wednesday", name: "Wednesday" },
  { id: "thursday", name: "Thursday" },
];
const mealSlots = {
  breakfast: ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"],
  lunch: ["MJ Lunch", "Luke Lunch", "Sophia Lunch"],
  dinner: ["MJ Dinner", "Luke Dinner", "Sophia Dinner"],
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s) => String(s || "").toLowerCase().trim();
const str = (v) => String(v == null ? "" : v).trim();
const dayName = (id) => prepDays.find((d) => d.id === id)?.name;
const matches = (title, q) => { const t = norm(title), x = norm(q); return !!x && (t.includes(x) || x.includes(t)); };

const VOICE_TOOLS = {
  add_task: {
    section: "do",
    apply(state, input, ctx) {
      const title = str(input.title);
      if (!title) return "No task title given.";
      const dayId = str(input.day_id) || "backlog";
      const task = { id: ctx.newId(), title, done: false, createdAt: ctx.now };
      if (!dayName(dayId)) {
        if (!Array.isArray(state.doBacklog)) state.doBacklog = [];
        state.doBacklog.push({ ...task, weekKey: ctx.weekKey });
        return `Task added to backlog: "${title}"`;
      }
      state.doPlans = state.doPlans || {};
      state.doPlans[ctx.weekKey] = state.doPlans[ctx.weekKey] || {};
      if (!Array.isArray(state.doPlans[ctx.weekKey][dayId])) state.doPlans[ctx.weekKey][dayId] = [];
      state.doPlans[ctx.weekKey][dayId].push(task);
      return `Task added to ${dayName(dayId)}: "${title}"`;
    },
  },
  complete_task: {
    section: "do",
    apply(state, input, ctx) {
      const q = input.title;
      const hit = (state.doBacklog || []).find((t) => !t.done && matches(t.title, q))
        || Object.values(state.doPlans?.[ctx.weekKey] || {}).flat().find((t) => t && !t.done && matches(t.title, q));
      if (!hit) return `No open task matching "${str(q)}".`;
      hit.done = true;
      return `Marked done: "${hit.title}"`;
    },
  },
  add_grocery_item: {
    section: "grocery",
    apply(state, input, ctx) {
      const item = str(input.item);
      if (!item) return "No item name given.";
      if (!Array.isArray(state.persistentManualGroceries)) state.persistentManualGroceries = [];
      state.persistentManualGroceryStamps = ctx.stamps.stampGroceryAdd(state.persistentManualGroceryStamps || {}, item, ctx.now);
      if (!state.persistentManualGroceries.some((e) => ctx.stamps.groceryKey(e) === ctx.stamps.groceryKey(item))) {
        state.persistentManualGroceries.push(item);
        state.persistentManualGroceries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      }
      return `Added to grocery list: "${item}"`;
    },
  },
  remove_grocery_item: {
    section: "grocery",
    apply(state, input, ctx) {
      const item = str(input.item);
      const before = state.persistentManualGroceries || [];
      state.persistentManualGroceries = before.filter((e) => ctx.stamps.groceryKey(e) !== ctx.stamps.groceryKey(item));
      if (state.persistentManualGroceries.length === before.length) return `"${item}" wasn't on the grocery list.`;
      // Stamped, or a device's older copy would add it back on the next sync.
      state.persistentManualGroceryStamps = ctx.stamps.stampGroceryRemove(state.persistentManualGroceryStamps || {}, item, ctx.now);
      return `Removed "${item}" from the grocery list.`;
    },
  },
  set_meal: {
    section: "eat",
    apply(state, input, ctx) {
      const slots = mealSlots[norm(input.meal_type)];
      const dayId = str(input.day_id);
      const name = str(input.recipe_name);
      if (!slots || !dayName(dayId) || !name) return "I need a day, a meal (breakfast/lunch/dinner) and a recipe.";
      state.plans = state.plans || {};
      const week = state.plans[ctx.weekKey] = state.plans[ctx.weekKey]
        || { notes: "", manualGroceries: [], mealPlanView: "edit", slots: {}, combinedMealSections: {}, publishedCombinedMealSections: {} };
      week.slots = week.slots || {};
      week.slots[dayId] = week.slots[dayId] || {};
      for (const slot of slots) {
        const cur = week.slots[dayId][slot];
        week.slots[dayId][slot] = Array.isArray(cur) ? [...cur, name] : cur ? [cur, name] : name;
      }
      return `Added ${name} to ${dayName(dayId)} ${norm(input.meal_type)}`;
    },
  },
  add_to_watchlist: {
    section: "watch",
    apply(state, input, ctx) {
      const title = str(input.title);
      if (!title) return "No title given.";
      const type = input.type === "tv" ? "tv" : "movie";
      if (!Array.isArray(state.watchItems)) state.watchItems = [];
      state.watchItems.push({
        id: ctx.newId(), type, title, status: "want",
        tmdbId: null, posterPath: null, year: null, overview: null,
        streamingProviders: null, providersUpdatedAt: null,
        totalSeasons: null, totalEpisodes: null, runtime: null, avgEpisodeRuntime: null,
        watchedDate: null, rating: null, watchNotes: null,
        seasonProgress: {}, episodeData: {}, categories: [], createdAt: ctx.now,
      });
      return `Added ${type === "tv" ? "TV show" : "movie"} "${title}" to the watchlist.`;
    },
  },
  mark_watched: {
    section: "watch",
    apply(state, input, ctx) {
      const item = (state.watchItems || []).find((i) => matches(i.title, input.title));
      if (!item) return `Nothing on the watchlist matches "${str(input.title)}".`;
      item.status = "watched";
      if (!item.watchedDate) item.watchedDate = ctx.todayKey;
      return `Marked "${item.title}" as watched.`;
    },
  },
  add_book: {
    section: "media",
    apply(state, input, ctx) {
      const title = str(input.title);
      if (!title) return "No book title given.";
      const authors = Array.isArray(input.authors) ? input.authors.map(str).filter(Boolean) : [];
      if (!Array.isArray(state.readingItems)) state.readingItems = [];
      state.readingItems.push({
        id: ctx.newId(), title, authors, status: "want",
        googleBooksId: null, coverUrl: null, year: null, pageCount: null,
        overview: null, format: null, readDate: null, rating: null, readNotes: null, categories: [], createdAt: ctx.now,
      });
      return `Added "${title}" to the reading list.`;
    },
  },
  update_book_status: {
    section: "media",
    apply(state, input, ctx) {
      const status = ["want", "reading", "read"].includes(input.status) ? input.status : null;
      if (!status) return `Unknown status "${str(input.status)}".`;
      const book = (state.readingItems || []).find((i) => matches(i.title, input.title));
      if (!book) return `No book matches "${str(input.title)}".`;
      book.status = status;
      if (status === "read" && !book.readDate) book.readDate = ctx.todayKey;
      return `Marked "${book.title}" as ${status === "read" ? "finished" : status === "reading" ? "currently reading" : "want to read"}.`;
    },
  },
  add_event: {
    section: "plan",
    apply(state, input, ctx) {
      const title = str(input.title);
      const date = str(input.date);
      if (!title || !DATE_RE.test(date)) return "I need an event title and a date.";
      const startTime = str(input.start_time) || null;
      if (!Array.isArray(state.planEvents)) state.planEvents = [];
      state.planEvents.push({
        id: ctx.newId(), createdAt: ctx.now, title, date, allDay: !startTime,
        startTime, endTime: startTime ? (str(input.end_time) || null) : null,
        notes: str(input.notes), color: "#4285f4", calendarId: null,
      });
      return `Added "${title}" on ${date}${startTime ? ` at ${startTime}` : ""}.`;
    },
  },
  log_meal: {
    section: "health",
    apply(state, input, ctx) {
      const displayName = str(input.name);
      if (!displayName) return "No food given.";
      const mealType = ["breakfast", "lunch", "dinner", "snack"].includes(input.meal_type) ? input.meal_type : "snack";
      const date = DATE_RE.test(str(input.date)) ? str(input.date) : ctx.todayKey;
      const members = Array.isArray(state.familyMembers) ? state.familyMembers : [];
      const memberId = members.find((m) => norm(m.name).includes("luke"))?.id || members[0]?.id || "";
      if (!memberId) return "No family member to log it for.";
      if (!Array.isArray(state.foodLogEntries)) state.foodLogEntries = [];
      state.foodLogEntries.push({
        id: ctx.newId(), familyMemberId: memberId, date, sourceType: "manual", sourceId: "", displayName,
        servingMultiplier: 1, mealType, notes: "", leftovers: false, nutritionSnapshot: {}, checklistContributions: [],
      });
      return `Logged "${displayName}" as ${mealType} on ${date}.`;
    },
  },
  add_workout: {
    section: "play",
    apply(state, input, ctx) {
      const title = str(input.title);
      if (!title) return "No workout name given.";
      if (!Array.isArray(state.workouts)) state.workouts = [];
      if (state.workouts.some((w) => norm(w.title) === norm(title))) return `"${title}" is already in the exercise library.`;
      state.workouts.push({
        id: ctx.newId(), title, type: "timed",
        exerciseDetails: { type: "timed", timed: { hours: "0", minutes: "30", seconds: "00", distanceWhole: "16", distanceDecimal: "00", distanceUnit: "km" }, reps: [], gameNotes: "" },
        notes: "", logs: [], createdAt: ctx.now,
      });
      return `Added "${title}" to the exercise library.`;
    },
  },
  add_piano_song: {
    section: "recreate",
    apply(state, input, ctx) {
      const title = str(input.title);
      if (!title) return "No song title given.";
      if (!Array.isArray(state.pianoSongs)) state.pianoSongs = [];
      state.pianoSongs.push({ id: ctx.newId(), title, learned: false, sheetMusicUrl: "" });
      return `Added "${title}" to the piano practice list.`;
    },
  },
  write_note: {
    section: "config",
    apply(state, input, ctx) {
      const { notes, message } = ctx.memory.addNote(state.aiNotes, str(input.category), input.note, { makeId: () => ctx.newId(), now: ctx.now });
      state.aiNotes = notes;
      return message;
    },
  },
};

const VOICE_TOOL_NAMES = Object.keys(VOICE_TOOLS);

// Which row a section's voice write goes to, matching app.js SECTION_SCOPE:
// household-only sections (meal plan, health/food log, config/memory) → the group
// row; personal-only and toggleable ones → the household admin's personal row
// (toggleable sections default to personal). The old voice path sent the food log
// to the personal row, which the app never reads for the household "health" section.
const HOUSEHOLD_SECTIONS = new Set(["eat", "config", "health", "inventory", "finance", "contacts"]);
function ownerFor(section, householdId, adminUid) {
  return HOUSEHOLD_SECTIONS.has(section) || !adminUid ? householdId : `u-${adminUid}`;
}

module.exports = { VOICE_TOOLS, VOICE_TOOL_NAMES, ownerFor, prepDays, mealSlots };
