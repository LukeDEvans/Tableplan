// Netlify Scheduled Function — runs every 15 minutes.
// Checks if the user's email schedule matches the current time, then sends
// the weekly email via Resend if it does. Requires SUPABASE_SERVICE_ROLE_KEY,
// ANTHROPIC_API_KEY and RESEND_API_KEY in Netlify environment variables.
// Recipient comes from the app owner's auth account (see _recipient.js).

const { buildWeeklyContext } = require("./build-weekly-context");
const { claudeCall } = require("./_claude");
const { resolveRecipientEmail } = require("./_recipient");
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEFAULT_FROM_EMAIL = "Live App <onboarding@resend.dev>";

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[scheduled-email] No SUPABASE_SERVICE_ROLE_KEY"); return ok(); }

  // Piggybacked on this 15-min schedule: return due snoozed emails to the
  // inbox. Runs every invocation, before the weekly-email early returns.
  try {
    const { processDueSnoozes } = require("./_gmail-shared");
    await processDueSnoozes(serviceKey);
  } catch (e) {
    console.error("[scheduled-email] snooze wake failed:", e.message);
  }

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
    const to = await resolveRecipientEmail(serviceKey);
    if (!to) { console.log("[scheduled-email] No recipient email could be determined"); return ok(); }
    const html = await generateEmailHtml(anthropicKey, appState);
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

const SECTION_NAMES = ["eat", "grocery", "do", "play", "watch", "media", "plan", "health", "inventory", "recreate", "config"]; // NOTE: "finance" is intentionally excluded — never feed financial data into AI prompts

async function loadLatestState(serviceKey) {
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" };

  // Find the most recently updated row to determine the base stateId
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=not.in.(email_schedule_log)&select=id,state,updated_at&order=updated_at.desc&limit=20`,
    { headers }
  );
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
  const allRows = await res.json();
  // Ignore infrastructure/personal/backup rows — they update frequently and
  // must not be mistaken for the household state
  const rows = allRows.filter(r => !/^(gmail_|mailsugg_|mailai_|u-|backup-|email_schedule_log|push_schedule_log)/.test(r.id) && r.id.includes(":"));
  if (!rows.length) return null;

  // Sort by inner stateUpdatedAt to find the most current base state
  const sorted = rows
    .filter(r => r.state)
    .sort((a, b) => {
      const ta = a.state.stateUpdatedAt || a.updated_at || "";
      const tb = b.state.stateUpdatedAt || b.updated_at || "";
      return tb.localeCompare(ta);
    });
  if (!sorted.length) return null;

  const latestRow = sorted[0];
  // Extract base stateId — strip ":section" suffix if present
  const baseId = latestRow.id.includes(":") ? latestRow.id.split(":")[0] : latestRow.id;

  if (!latestRow.id.includes(":")) {
    // Old unified format — return state directly
    return latestRow.state;
  }

  // Sectioned format: household rows overlaid with the admin's PERSONAL rows
  // (day-to-day data lives in the member's personal store now; the email goes
  // to the admin, so their personal data wins per key when it has content).
  let adminUid = null;
  try {
    const ar = await fetch(
      `${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${encodeURIComponent(baseId)}&role=eq.admin&select=user_id&limit=1`,
      { headers }
    );
    if (ar.ok) adminUid = (await ar.json())[0]?.user_id || null;
  } catch { /* household-only */ }

  const sectionIds = [
    ...SECTION_NAMES.map(s => `${baseId}:${s}`),
    ...(adminUid ? SECTION_NAMES.map(s => `u-${adminUid}:${s}`) : []),
  ].join(",");
  const sectionRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=in.(${sectionIds})&select=id,state`,
    { headers }
  );
  if (!sectionRes.ok) throw new Error(`Supabase section load failed: ${sectionRes.status}`);
  const sectionRows = await sectionRes.json();

  const assembled = {};
  const overlay = {};
  let latestTs = "";
  for (const row of sectionRows) {
    const { stateUpdatedAt, ...data } = row.state || {};
    Object.assign(row.id.startsWith("u-") ? overlay : assembled, data);
    if (stateUpdatedAt && stateUpdatedAt > latestTs) latestTs = stateUpdatedAt;
  }
  for (const [k, v] of Object.entries(overlay)) {
    const empty = v == null || (Array.isArray(v) && !v.length) ||
      (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    if (!empty || !(k in assembled)) assembled[k] = v;
  }
  if (latestTs) assembled.stateUpdatedAt = latestTs;
  return assembled;
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

  return await claudeCall(apiKey, {
    model: "claude-sonnet-4-6",
    maxTokens: 2048,
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
    user: context
  }) || "<p>Could not generate email.</p>";
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

function ok() { return { statusCode: 200 }; }
