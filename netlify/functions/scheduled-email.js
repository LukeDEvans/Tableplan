// Netlify Scheduled Function — runs every 15 minutes.
// Checks if the user's email schedule matches the current time, then sends
// the weekly email via Resend if it does. Requires SUPABASE_SERVICE_ROLE_KEY,
// ANTHROPIC_API_KEY, RESEND_API_KEY, and optionally WEEKLY_REVIEW_TO /
// WEEKLY_REVIEW_FROM to be set in Netlify environment variables.

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEFAULT_TO_EMAIL = "mrlukedevans@gmail.com";
const DEFAULT_FROM_EMAIL = "Live App <onboarding@resend.dev>";

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[scheduled-email] No SUPABASE_SERVICE_ROLE_KEY"); return ok(); }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (!anthropicKey || !resendKey) { console.log("[scheduled-email] Missing API keys"); return ok(); }

  const appState = await loadLatestState(serviceKey);
  if (!appState) { console.log("[scheduled-email] No state found"); return ok(); }

  const sched = appState.weeklyEmailSettings?.emailSchedule;
  if (!sched?.enabled || !sched.days?.length) { console.log("[scheduled-email] Schedule disabled or no days"); return ok(); }

  if (!shouldSendNow(sched)) { console.log("[scheduled-email] Not time to send"); return ok(); }

  const lastSentAt = await readLastSentAt(serviceKey);
  const now = Date.now();
  if (lastSentAt && now - new Date(lastSentAt).getTime() < 23 * 60 * 60 * 1000) {
    console.log("[scheduled-email] Already sent within 23 hours, skipping");
    return ok();
  }

  console.log("[scheduled-email] Sending email…");
  try {
    const html = await generateEmailHtml(anthropicKey, appState);
    const to = process.env.WEEKLY_REVIEW_TO || DEFAULT_TO_EMAIL;
    const from = process.env.WEEKLY_REVIEW_FROM || DEFAULT_FROM_EMAIL;
    const subject = `Your Weekly Review – ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    await sendResendEmail({ resendKey, from, to, subject, html });
    await writeLastSentAt(serviceKey, new Date().toISOString());
    console.log(`[scheduled-email] Sent to ${to}`);
  } catch (e) {
    console.error("[scheduled-email] Failed:", e.message);
  }
  return ok();
};

function shouldSendNow(sched) {
  const tz = sched.timezone || "UTC";
  const [scheduledHour, scheduledMin] = (sched.time || "08:00").split(":").map(Number);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const dayAbbr = parts.find((p) => p.type === "weekday")?.value?.toLowerCase().slice(0, 3);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value, 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value, 10);
  if (!sched.days.includes(dayAbbr)) return false;
  const totalNow = hour * 60 + minute;
  const totalSched = scheduledHour * 60 + scheduledMin;
  return Math.abs(totalNow - totalSched) < 8;
}

async function loadLatestState(serviceKey) {
  // Read the most recently updated row to handle both "personal" and group-UUID states.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?select=state,updated_at&order=updated_at.desc&limit=10`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
  const rows = await res.json();
  // Prefer the row whose inner stateUpdatedAt is most recent.
  return rows
    .filter((r) => r.state)
    .sort((a, b) => {
      const ta = a.state.stateUpdatedAt || a.updated_at || "";
      const tb = b.state.stateUpdatedAt || b.updated_at || "";
      return tb.localeCompare(ta);
    })[0]?.state || null;
}

async function readLastSentAt(serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.email_schedule_log&select=state`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.state?.lastSentAt || null;
}

async function writeLastSentAt(serviceKey, isoString) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: "email_schedule_log", state: { lastSentAt: isoString }, updated_at: isoString })
  });
}

async function generateEmailHtml(apiKey, appState) {
  const prefs = String(appState.emailPrefs || "").trim();
  const context = buildWeeklyContext(appState);
  const prefsSection = prefs ? `\n\nSTANDING PREFERENCES FROM LUKE:\n${prefs}` : "";
  const appUrl = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: `You are a personal assistant writing a weekly digest email for a life-management app called "Live". The user is Luke.
Write a warm, personal, helpful email in clean HTML with inline styles (for email client compatibility).
Style: body background #FFFDF6, font Arial/sans-serif, max-width 600px centered, headings color #92400E, body text #1C1917.
Structure: warm greeting → week recap (recipes, meals, exercise, to-do, watching, calendar) → anything flagged ⚠️ needing attention → brief look ahead.
Tone: like a thoughtful friend reviewing the week with Luke, not a corporate newsletter. Conversational, encouraging, scannable.
${appUrl ? `When referencing something that needs action in the app, include a clickable hyperlink. Use these URLs:
- Update pantry / grocery list: ${appUrl}/#shop
- Review meal plan: ${appUrl}/#nourish
- Add workouts: ${appUrl}/#sweat
- Check to-do list: ${appUrl}/#maintain
Format links like: <a href="URL" style="color:#92400E">link text</a>` : ""}
Output ONLY the HTML body content (start with a <div> or <table>, no doctype/html/head/body tags).${prefsSection}`,
      messages: [{ role: "user", content: context }]
    })
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error?.message || `Anthropic error ${res.status}`); }
  const data = await res.json();
  return data.content?.[0]?.text || "<p>Could not generate email.</p>";
}

async function sendResendEmail({ resendKey, from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
}

function buildWeeklyContext(state) {
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const nextWeekStart = new Date(weekEnd); nextWeekStart.setDate(weekEnd.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
  const startKey = dateKey(weekStart), endKey = dateKey(weekEnd);
  const nextStartKey = dateKey(nextWeekStart), nextEndKey = dateKey(nextWeekEnd);
  const twoWeeksAgo = dateKey(new Date(Date.now() - 14 * 86400000));
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const lines = [];

  lines.push(`WEEKLY REVIEW — ${weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`);
  lines.push(`Generated: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`);
  lines.push("");

  const recipes = Array.isArray(state.recipes) ? state.recipes : [];
  const recentRecipes = recipes.filter((r) => dateKey(new Date(r.createdAt || 0)) >= twoWeeksAgo);
  lines.push("=== RECIPES (added in last 14 days) ===");
  if (recentRecipes.length) {
    recentRecipes.forEach((r) => {
      const source = r.sourceUrl ? ` [imported from ${hostname(r.sourceUrl)}]` : " [manually added]";
      const ingredients = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
      const hasSteps = String(r.steps || "").trim().length > 20;
      lines.push(`- "${r.name || "Untitled"}"${source}`);
      lines.push((r.sourceUrl && (ingredients < 3 || !hasSteps))
        ? `  ⚠️ NEEDS REVIEW: ${ingredients} ingredient(s), steps: ${hasSteps ? "present" : "missing"}`
        : `  ✓ ${ingredients} ingredients`);
    });
  } else { lines.push("No new recipes added."); }
  lines.push("");

  lines.push("=== MEAL PLAN ===");
  const plans = typeof state.plans === "object" ? state.plans : {};
  const mealRows = [], nextMealRows = [];
  Object.entries(plans).forEach(([weekKey, weekPlan]) => {
    if (typeof weekPlan !== "object") return;
    Object.entries(weekPlan).forEach(([dayOffset, entries]) => {
      if (!Array.isArray(entries) || !entries.length) return;
      try {
        const d = new Date(weekKey + "T00:00:00"); d.setDate(d.getDate() + Number(dayOffset));
        const key = dateKey(d);
        const names = entries.map((e) => e.name || e.recipeName || "").filter(Boolean);
        if (!names.length) return;
        const row = `- ${dayNames[d.getDay()]}: ${names.join(", ")}`;
        if (key >= startKey && key <= endKey) mealRows.push(row);
        else if (key >= nextStartKey && key <= nextEndKey) nextMealRows.push(row);
      } catch {}
    });
  });
  if (mealRows.length) mealRows.forEach((r) => lines.push(r)); else lines.push("Nothing planned this week.");
  if (nextMealRows.length) { lines.push("Next week:"); nextMealRows.forEach((r) => lines.push(r)); }
  lines.push("");

  lines.push("=== EXERCISE ===");
  const workouts = Array.isArray(state.workouts) ? state.workouts : [];
  const exLogs = [];
  workouts.forEach((w) => {
    (Array.isArray(w.logs) ? w.logs : []).forEach((log) => {
      if (log.date < startKey || log.date > endKey) return;
      const details = [];
      if (log.timedMinutes && log.timedMinutes !== "0") details.push(`${log.timedMinutes} min`);
      if (log.distanceWhole && log.distanceWhole !== "0") details.push(`${log.distanceWhole}${log.distanceDecimal ? `.${log.distanceDecimal}` : ""} ${log.distanceUnit || "km"}`);
      exLogs.push(`- ${log.date}: ${w.title || "Workout"}${details.length ? ` (${details.join(", ")})` : ""}`);
    });
  });
  if (exLogs.length) exLogs.forEach((r) => lines.push(r)); else lines.push("No workouts logged.");
  lines.push("");

  lines.push("=== TO DO ===");
  const allTasks = [...(Array.isArray(state.doTasks) ? state.doTasks : []),
    ...Object.values(state.doPlans || {}).flatMap((d) => Object.values(d || {}).flat())];
  const done = allTasks.filter((t) => t?.done);
  const pending = allTasks.filter((t) => t && !t.done && (t.title || t.text || t.name));
  if (done.length) { lines.push(`Completed: ${done.length}`); done.slice(0, 5).forEach((t) => lines.push(`  ✓ "${t.title || t.text || t.name}"`)); }
  if (pending.length) { lines.push(`Pending: ${pending.length}`); pending.slice(0, 5).forEach((t) => lines.push(`  - "${t.title || t.text || t.name}"`)); }
  if (!done.length && !pending.length) lines.push("No tasks found.");
  lines.push("");

  lines.push("=== WATCH LIST ===");
  const watchItems = Array.isArray(state.watchItems) ? state.watchItems : [];
  const watched = watchItems.filter((w) => (w.logs || []).some((l) => l.date >= startKey && l.date <= endKey));
  if (watched.length) { lines.push("Watched this week:"); watched.forEach((w) => lines.push(`  - "${w.title || w.name}"`)); }
  else lines.push("No watch activity this week.");
  lines.push("");

  const planEvents = Array.isArray(state.planEvents) ? state.planEvents : [];
  const calThis = planEvents.filter((e) => e.date >= startKey && e.date <= endKey);
  const calNext = planEvents.filter((e) => e.date >= nextStartKey && e.date <= nextEndKey);
  if (calThis.length || calNext.length) {
    lines.push("=== CALENDAR ===");
    if (calThis.length) { lines.push("This week:"); calThis.forEach((e) => lines.push(`  - ${e.date}: ${e.title}${e.startTime ? ` at ${e.startTime}` : ""}`)); }
    if (calNext.length) { lines.push("Next week:"); calNext.forEach((e) => lines.push(`  - ${e.date}: ${e.title}${e.startTime ? ` at ${e.startTime}` : ""}`)); }
  }

  return lines.join("\n");
}

function dateKey(date) { return date.toISOString().slice(0, 10); }
function hostname(url) { try { return new URL(url).hostname; } catch { return url; } }
function ok() { return { statusCode: 200 }; }
