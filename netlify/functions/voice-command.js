// Siri voice shortcut → the Live assistant (Luke, 2026-09-29: "route voice through
// the assistant"). The dictated transcript goes to Claude with the SAME tool
// specs as the in-app chat (assistant-tools.js, restricted to the voice-safe set
// in _voice-tools.js) and the same saved memory (aiNotes); each tool call is
// applied server-side to its state section under updateSection's optimistic lock,
// so a syncing device is never clobbered. The reply is one spoken sentence.
//
// Auth: the household's voice passphrase (config.voiceCommandSecret) is checked
// BEFORE any model call. Deletions aren't voice tools (the app confirms them).
const { SUPABASE_URL, loadSection, updateSection } = require("./_state-sections.js");
const { VOICE_TOOLS, VOICE_TOOL_NAMES, ownerFor, prepDays } = require("./_voice-tools.js");

const VOICE_MODEL_DEFAULT = "claude-haiku-4-5-20251001"; // fast enough for Siri; override with VOICE_ASSISTANT_MODEL
const MAX_ROUNDS = 4;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResponse(204, {}, corsHeaders());
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { console.log("VOICE: invalid JSON"); return jsonResponse(400, { error: "Invalid JSON." }); }

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

  // Passphrase first — never spend a model call on an unauthenticated request.
  let config;
  try {
    const configRow = await loadSection(serviceKey, householdId, "config");
    config = configRow?.state || {};
    const storedSecret = String(config.voiceCommandSecret || "");
    if (!storedSecret || storedSecret !== providedSecret) return jsonResponse(401, { error: "Invalid passphrase." }, corsHeaders());
  } catch (err) {
    console.log("VOICE: config load error:", err.message);
    return jsonResponse(500, { error: "Failed to check passphrase: " + err.message }, corsHeaders());
  }

  const now = new Date();
  const todayKey = isoDate(now);
  const weekStart = startOfPrepWindow(now);
  const weekKey = isoDate(weekStart);
  const todayDayId = resolveTodayDayId(now, weekStart);

  // The shared ESM modules (registry, grocery stamps, memory) — dynamic import from CJS.
  const [tools, stamps, memory] = await Promise.all([
    import("../../assistant-tools.js"),
    import("../../grocery-list-stamps.js"),
    import("../../assistant-memory.js"),
  ]);
  const specs = tools.toolSpecsForRequest({}).filter((t) => VOICE_TOOL_NAMES.includes(t.name));
  const system = voiceSystemPrompt({ now, todayKey, todayDayId, weekStart, memoryText: memory.formatNotesContext(config.aiNotes) });
  const adminUid = await getGroupAdminUserId(serviceKey, householdId);
  const model = (process.env.VOICE_ASSISTANT_MODEL || "").trim() || VOICE_MODEL_DEFAULT;

  const messages = [{ role: "user", content: transcript }];
  const applied = [];
  let reply = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await claudeMessages(apiKey, { model, system, tools: specs, messages });
      const uses = (res.content || []).filter((b) => b.type === "tool_use");
      const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      if (!uses.length) { reply = text; break; }
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const use of uses) {
        const result = await applyVoiceTool(serviceKey, householdId, adminUid, use, { weekKey, todayKey, stamps, memory });
        if (VOICE_TOOLS[use.name]) applied.push({ tool: use.name, input: use.input, result });
        results.push({ type: "tool_result", tool_use_id: use.id, content: result });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    console.log("VOICE: assistant error:", err.message);
    // Anything already applied stays applied — say so rather than claim failure.
    const done = applied.map((a) => a.result).join(" ");
    return jsonResponse(done ? 200 : 502, done ? { message: done, actions: applied } : { error: "Assistant failed: " + err.message }, corsHeaders());
  }
  if (!reply) reply = applied.length ? applied.map((a) => a.result).join(" ") : "Sorry, I didn't catch that.";

  await logVoiceCommands(serviceKey, householdId, transcript, applied, reply);
  console.log("VOICE: done:", reply);
  return jsonResponse(200, { message: reply, actions: applied }, corsHeaders());
};

// One tool call → its section, applied under the optimistic lock. Unchanged state
// isn't rewritten. Returns the result text for the model (and the voice log).
async function applyVoiceTool(serviceKey, householdId, adminUid, use, ctxBase) {
  const tool = VOICE_TOOLS[use.name];
  if (!tool) return `"${use.name}" isn't available by voice — use the app for that.`;
  let result = "";
  try {
    await updateSection(serviceKey, ownerFor(tool.section, householdId, adminUid), tool.section, (state) => {
      const before = JSON.stringify(state);
      result = tool.apply(state, use.input || {}, { ...ctxBase, newId, now: new Date().toISOString() });
      return JSON.stringify(state) === before ? null : state;
    });
  } catch (err) {
    console.log("VOICE: section update error:", use.name, err.message);
    result = `Couldn't save that (${err.message}).`;
  }
  return result;
}

function voiceSystemPrompt({ now, todayKey, todayDayId, weekStart, memoryText }) {
  const weekday = (d) => d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const days = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    days.push(`${weekday(d)} ${isoDate(d)}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`);
  }
  const dayIds = prepDays.filter((d) => d.id !== "friday-finish").map((d) => d.id).join(", ");
  return `You are Luke's assistant in his life app "Live", taking a spoken command from his iPhone (Siri). \
Use the tools to do what he asked — one tool call per thing (several requests → several calls). \
Then reply with ONE short sentence confirming what you did, to be read aloud: no markdown, no lists, no questions (he can't answer). \
If something can't be done by voice, say so briefly.

Dates: today is ${todayKey}. Next days: ${days.join("; ")}.
Task and meal-plan day_id values are the current planning week (starts Friday ${isoDate(weekStart)}): ${dayIds}. Today's day_id is "${todayDayId}". Tasks with no day go to "backlog".
Meals: infer breakfast/lunch/dinner from the food if he doesn't say (default dinner). "Log" or "I ate/had" means log_meal (the food log), not the meal plan.
Events need a YYYY-MM-DD date; include start_time (24h HH:MM) only when he gives a time.
${memoryText ? `\n${memoryText}` : ""}`;
}

async function claudeMessages(apiKey, { model, system, tools, messages }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1024, system, tools, messages }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error?.message || `Anthropic API error ${res.status}`);
  }
  return res.json();
}

// Keeps a 30-day command history in its own row ("<groupId>:voicelog"), outside
// the synced sections so it never contends with device writes. Best-effort.
async function logVoiceCommands(serviceKey, householdId, transcript, actions, confirmation) {
  try {
    const rowId = `${householdId}:voicelog`;
    const existing = await loadSection(serviceKey, householdId, "voicelog").catch(() => null);
    const log = Array.isArray(existing?.state?.entries) ? existing.state.entries : [];
    log.push({
      id: newId(),
      timestamp: new Date().toISOString(),
      transcript,
      description: confirmation,
      actions,
    });
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const entries = log.filter((e) => e.timestamp >= cutoff);
    await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
      method: "POST",
      headers: { ...serviceHeaders(serviceKey), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: rowId, state: { entries }, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.log("VOICE: log write failed:", err.message);
  }
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

async function getGroupAdminUserId(serviceKey, groupId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${encodeURIComponent(groupId)}&role=eq.admin&select=user_id&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.user_id || null;
  } catch { return null; }
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
