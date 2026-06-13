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
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const transcript = String(body.transcript || "").trim();
  if (!transcript) return jsonResponse(400, { error: "No transcript provided." });

  const householdId = String(body.householdId || "").trim();
  if (!householdId) return jsonResponse(400, { error: "householdId is required." });

  const providedSecret = String(body.secret || "");

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "ANTHROPIC_API_KEY not configured." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "SUPABASE_SERVICE_ROLE_KEY not configured." });

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
    if (err.message === "UNAUTHORIZED") return jsonResponse(401, { error: "Invalid passphrase." }, corsHeaders());
    return jsonResponse(500, { error: "Failed to update: " + err.message }, corsHeaders());
  }

  const confirmation = real.map((a) => describeAction(a)).join(". ");
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

If unclear:
{"action":"unknown","message":"<brief explanation>"}

Multiple commands in one sentence → multiple actions.`,
    user: transcript,
    maxTokens: 512,
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
  if (action.action === "setMeal") {
    const day = prepDays.find((d) => d.id === action.dayId);
    return `Added ${action.recipeName} to ${day?.name || action.dayId} ${action.mealType}`;
  }
  return "Done";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
