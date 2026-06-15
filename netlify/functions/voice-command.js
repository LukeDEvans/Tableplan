const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

const prepDays = [
  { id: "friday-start",  name: "Friday",    offset: 0 },
  { id: "saturday",      name: "Saturday",  offset: 1 },
  { id: "sunday",        name: "Sunday",    offset: 2 },
  { id: "monday",        name: "Monday",    offset: 3 },
  { id: "tuesday",       name: "Tuesday",   offset: 4 },
  { id: "wednesday",     name: "Wednesday", offset: 5 },
  { id: "thursday",      name: "Thursday",  offset: 6 },
  { id: "friday-finish", name: "Friday",    offset: 7 },
];

const mealSlots = {
  breakfast: ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"],
  lunch:     ["MJ Lunch",     "Luke Lunch",     "Sophia Lunch"],
  dinner:    ["MJ Dinner",    "Luke Dinner",    "Sophia Dinner"],
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResponse(204, {}, corsHeaders());
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { console.log("VOICE: invalid JSON", event.body); return jsonResponse(400, { error: "Invalid JSON." }); }

  const transcript = String(body.transcript || "").trim();
  console.log("VOICE: transcript=", JSON.stringify(transcript), "householdId=", JSON.stringify(body.householdId), "secret=", body.secret ? "(set)" : "(missing)");
  if (!transcript) return jsonResponse(400, { error: "No transcript provided." });

  const householdId = String(body.householdId || "").trim();
  if (!householdId) return jsonResponse(400, { error: "householdId is required." });

  const providedSecret = String(body.secret || "");

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { console.log("VOICE: missing ANTHROPIC_API_KEY"); return jsonResponse(503, { error: "ANTHROPIC_API_KEY not configured." }); }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("VOICE: missing SUPABASE_SERVICE_ROLE_KEY"); return jsonResponse(503, { error: "SUPABASE_SERVICE_ROLE_KEY not configured." }); }

  // Compute today's day context
  const now = new Date();
  const today = isoDate(now);
  const weekStart = startOfPrepWindow(now);
  const currentWeekKey = isoDate(weekStart);
  const todayDayId = resolveTodayDayId(now, weekStart);

  // Parse intent with Claude
  let actions;
  try {
    actions = await parseIntent(apiKey, transcript, today, todayDayId, currentWeekKey);
  } catch (err) {
    return jsonResponse(502, { error: "AI parsing failed: " + err.message }, corsHeaders());
  }

  const real = actions.filter((a) => a.action !== "unknown");
  const unknown = actions.find((a) => a.action === "unknown");
  if (!real.length) {
    return jsonResponse(200, { message: unknown?.message || "I didn't understand that command." }, corsHeaders());
  }

  // Apply mutations to Supabase state (secret validated inside)
  try {
    await applyToSupabase(real, householdId, providedSecret, serviceKey, currentWeekKey);
  } catch (err) {
    console.log("VOICE: applyToSupabase error:", err.message);
    if (err.message === "UNAUTHORIZED") return jsonResponse(401, { error: "Invalid passphrase." }, corsHeaders());
    return jsonResponse(500, { error: "Failed to update: " + err.message }, corsHeaders());
  }

  const confirmation = real.map((a) => describeAction(a)).join(". ");
  console.log("VOICE: success:", confirmation);
  return jsonResponse(200, { message: confirmation + ".", actions: real }, corsHeaders());
};

async function parseIntent(apiKey, transcript, today, todayDayId, currentWeekKey) {
  const dayList = prepDays
    .filter((d) => d.id !== "friday-finish")
    .map((d) => `"${d.id}" = ${d.name}`)
    .join(", ");

  const raw = await claudeCall(apiKey, {
    system: `You are a voice command parser for a personal life-management app.
Today is ${today}. Today's day ID is "${todayDayId}", week key is "${currentWeekKey}".

Valid day IDs: ${dayList}

Return ONLY a JSON array of actions — no explanation, no markdown.

Set a meal on a day:
{"action":"setMeal","dayId":"<day id>","mealType":"breakfast|lunch|dinner","recipeName":"<spoken name>"}
- Infer mealType: soup/pasta/chicken/steak/fish → dinner; eggs/oatmeal/pancakes/waffles → breakfast; sandwich/salad/wrap/soup → lunch. Default dinner.
- "today" → dayId="${todayDayId}"
- "this weekend" → two actions (saturday + sunday)

Add a misc grocery item:
{"action":"addGrocery","item":"<item name>"}

Add a task:
{"action":"addTask","title":"<task>","dayId":"<day id or backlog>","weekKey":"${currentWeekKey}"}
- "today" → dayId="${todayDayId}"
- No specific day mentioned → dayId="backlog"

Add a book to the reading list:
{"action":"addBook","title":"<book title>","authors":["<author name>"]}
- Use for any request to add/save/remember a book, or "add to my reading list"
- authors should be an array of strings; use [] if unknown

Update a book's reading status:
{"action":"markBookStatus","title":"<book title>","status":"reading|read"}
- "reading" = currently reading; "read" = finished
- Match to the title the user names

Add a movie or TV show to the watchlist:
{"action":"addWatch","title":"<title>","watchType":"movie|tv"}
- Use "tv" for series/shows; "movie" for films
- Default to "movie" if unclear

Mark a movie or TV show as watched:
{"action":"markWatched","title":"<title>"}

Complete (tick off) a task:
{"action":"completeTask","title":"<task title>"}
- Match to the task title the user names

Remove an item from the grocery list:
{"action":"removeGrocery","item":"<item name>"}

Add a workout to the exercise library:
{"action":"addWorkout","title":"<workout or exercise name>"}

Add a song to the piano practice list:
{"action":"addPianoSong","title":"<song title>"}

If unclear:
{"action":"unknown","message":"<brief explanation>"}

Multiple commands in one sentence → multiple actions.`,
    user: transcript,
    maxTokens: 768,
  });

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function applyToSupabase(actions, householdId, providedSecret, serviceKey, currentWeekKey) {
  // Load current state
  const loadRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(householdId)}&select=state`,
    { headers: serviceHeaders(serviceKey), cache: "no-store" }
  );
  if (!loadRes.ok) throw new Error(`State load failed (${loadRes.status})`);
  const rows = await loadRes.json();
  const state = rows[0]?.state;
  if (!state) throw new Error("No state found for this household.");

  // Validate passphrase against the value stored in the app's own state
  const storedSecret = String(state.voiceCommandSecret || "");
  if (!storedSecret || storedSecret !== providedSecret) throw new Error("UNAUTHORIZED");

  for (const action of actions) {
    if (action.action === "addTask") {
      const dayId = String(action.dayId || "backlog");
      const wk = String(action.weekKey || currentWeekKey);
      const task = { id: newId(), title: String(action.title || ""), done: false, createdAt: new Date().toISOString() };
      if (dayId === "backlog" || !prepDays.some((d) => d.id === dayId)) {
        if (!Array.isArray(state.doBacklog)) state.doBacklog = [];
        state.doBacklog.push({ ...task, weekKey: wk });
      } else {
        if (!state.doPlans) state.doPlans = {};
        if (!state.doPlans[wk]) state.doPlans[wk] = {};
        if (!Array.isArray(state.doPlans[wk][dayId])) state.doPlans[wk][dayId] = [];
        state.doPlans[wk][dayId].push(task);
      }
    } else if (action.action === "addGrocery") {
      const item = String(action.item || "").trim();
      if (!item) continue;
      if (!Array.isArray(state.persistentManualGroceries)) state.persistentManualGroceries = [];
      const norm = (s) => s.toLowerCase().trim();
      if (!state.persistentManualGroceries.some((e) => norm(e) === norm(item))) {
        state.persistentManualGroceries.push(item);
        state.persistentManualGroceries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      }
    } else if (action.action === "addBook") {
      const title = String(action.title || "").trim();
      if (!title) continue;
      const authors = Array.isArray(action.authors) ? action.authors.map((a) => String(a)).filter(Boolean) : [];
      if (!Array.isArray(state.readingItems)) state.readingItems = [];
      state.readingItems.push({
        id: newId(),
        title,
        authors,
        status: "want",
        googleBooksId: null,
        coverUrl: null,
        year: null,
        pageCount: null,
        overview: null,
        format: null,
        readDate: null,
        rating: null,
        readNotes: null,
        categories: [],
        createdAt: new Date().toISOString(),
      });
    } else if (action.action === "addWatch") {
      const title = String(action.title || "").trim();
      if (!title) continue;
      const type = action.watchType === "tv" ? "tv" : "movie";
      if (!Array.isArray(state.watchItems)) state.watchItems = [];
      state.watchItems.push({
        id: newId(), type, title, status: "want",
        tmdbId: null, posterPath: null, year: null, overview: null,
        streamingProviders: null, providersUpdatedAt: null,
        totalSeasons: null, totalEpisodes: null, runtime: null, avgEpisodeRuntime: null,
        watchedDate: null, rating: null, watchNotes: null,
        seasonProgress: {}, episodeData: {}, categories: [],
        createdAt: new Date().toISOString(),
      });
    } else if (action.action === "markWatched") {
      const target = norm(action.title);
      const item = (state.watchItems || []).find((i) => norm(i.title).includes(target) || target.includes(norm(i.title)));
      if (item) {
        item.status = "watched";
        if (!item.watchedDate) item.watchedDate = new Date().toISOString().slice(0, 10);
      }
    } else if (action.action === "markBookStatus") {
      const validStatus = ["reading", "read"].includes(action.status) ? action.status : null;
      if (!validStatus) continue;
      const target = norm(action.title);
      const item = (state.readingItems || []).find((i) => norm(i.title).includes(target) || target.includes(norm(i.title)));
      if (item) {
        item.status = validStatus;
        if (validStatus === "read" && !item.readDate) item.readDate = new Date().toISOString().slice(0, 10);
      }
    } else if (action.action === "completeTask") {
      const target = norm(action.title);
      const backlogTask = (state.doBacklog || []).find((t) => !t.done && norm(t.title).includes(target));
      if (backlogTask) {
        backlogTask.done = true;
      } else {
        const weekPlans = state.doPlans?.[currentWeekKey] || {};
        outer: for (const dayId of Object.keys(weekPlans)) {
          for (const task of (weekPlans[dayId] || [])) {
            if (!task.done && norm(task.title).includes(target)) { task.done = true; break outer; }
          }
        }
      }
    } else if (action.action === "removeGrocery") {
      const target = norm(action.item);
      if (Array.isArray(state.persistentManualGroceries)) {
        state.persistentManualGroceries = state.persistentManualGroceries.filter((i) => norm(i) !== target);
      }
    } else if (action.action === "addWorkout") {
      const title = String(action.title || "").trim();
      if (!title) continue;
      if (!Array.isArray(state.workouts)) state.workouts = [];
      state.workouts.push({
        id: newId(), title, type: "timed",
        exerciseDetails: {
          type: "timed",
          timed: { hours: "0", minutes: "30", seconds: "00", distanceWhole: "16", distanceDecimal: "00", distanceUnit: "km" },
          reps: [], gameNotes: "",
        },
        notes: "", logs: [], createdAt: new Date().toISOString(),
      });
    } else if (action.action === "addPianoSong") {
      const title = String(action.title || "").trim();
      if (!title) continue;
      if (!Array.isArray(state.pianoSongs)) state.pianoSongs = [];
      state.pianoSongs.push({ id: newId(), title, learned: false, sheetMusicUrl: "" });
    } else if (action.action === "setMeal") {
      const { dayId, mealType, recipeName } = action;
      const slots = mealSlots[(mealType || "").toLowerCase()];
      if (!slots || !dayId) continue;
      if (!state.plans) state.plans = {};
      if (!state.plans[currentWeekKey]) {
        state.plans[currentWeekKey] = { notes: "", manualGroceries: [], mealPlanView: "edit", slots: {}, combinedMealSections: {}, publishedCombinedMealSections: {} };
      }
      if (!state.plans[currentWeekKey].slots) state.plans[currentWeekKey].slots = {};
      if (!state.plans[currentWeekKey].slots[dayId]) state.plans[currentWeekKey].slots[dayId] = {};
      for (const slot of slots) {
        const existing = state.plans[currentWeekKey].slots[dayId][slot];
        // Append as array entry if slot already has content
        if (Array.isArray(existing)) {
          state.plans[currentWeekKey].slots[dayId][slot] = [...existing, recipeName || ""];
        } else if (existing) {
          state.plans[currentWeekKey].slots[dayId][slot] = [existing, recipeName || ""];
        } else {
          state.plans[currentWeekKey].slots[dayId][slot] = recipeName || "";
        }
      }
    }
  }

  state.stateUpdatedAt = new Date().toISOString();

  const writeRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...serviceHeaders(serviceKey), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: householdId, state, updated_at: new Date().toISOString() }),
  });
  if (!writeRes.ok) throw new Error(`State write failed (${writeRes.status})`);
}

function describeAction(action) {
  if (action.action === "addTask") {
    const day = prepDays.find((d) => d.id === action.dayId);
    return day
      ? `Added "${action.title}" to ${day.name}'s to-do list`
      : `Added "${action.title}" to your backlog`;
  }
  if (action.action === "addGrocery") return `Added ${action.item} to your grocery list`;
  if (action.action === "removeGrocery") return `Removed ${action.item} from your grocery list`;
  if (action.action === "addBook") {
    const by = action.authors?.length ? ` by ${action.authors.join(", ")}` : "";
    return `Added "${action.title}"${by} to your reading list`;
  }
  if (action.action === "markBookStatus") {
    return action.status === "read" ? `Marked "${action.title}" as finished` : `Marked "${action.title}" as currently reading`;
  }
  if (action.action === "addWatch") {
    const kind = action.watchType === "tv" ? "TV show" : "movie";
    return `Added ${kind} "${action.title}" to your watchlist`;
  }
  if (action.action === "markWatched") return `Marked "${action.title}" as watched`;
  if (action.action === "completeTask") return `Completed task "${action.title}"`;
  if (action.action === "addWorkout") return `Added "${action.title}" to your exercise library`;
  if (action.action === "addPianoSong") return `Added "${action.title}" to your piano practice list`;
  if (action.action === "setMeal") {
    const day = prepDays.find((d) => d.id === action.dayId);
    return `Added ${action.recipeName} to ${day?.name || action.dayId} ${action.mealType}`;
  }
  return "Done";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function startOfPrepWindow(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow >= 5 ? 5 - dow : -(dow + 2);
  d.setDate(d.getDate() + diff);
  return d;
}

function resolveTodayDayId(now, weekStart) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const day of prepDays) {
    if (day.id === "friday-finish") continue;
    const d = new Date(weekStart);
    d.setDate(d.getDate() + day.offset);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return day.id;
  }
  return "friday-start";
}

function isoDate(date) {
  return date.toISOString().split("T")[0];
}

function newId() {
  return crypto.randomUUID();
}

async function claudeCall(apiKey, { system, user, maxTokens = 512 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error?.message || `Anthropic API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function serviceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
  };
}

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}
