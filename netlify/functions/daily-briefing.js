// Scheduled daily briefing: reads user state from Supabase, generates a
// short briefing with Claude, and sends a push notification to all subscribed devices.
//
// Schedule: 13:00 UTC daily (adjust in netlify.toml to match your morning)
// To change the time, update: [functions."daily-briefing"] schedule = "0 <hour> * * *"

import webpush from "web-push";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const SECTION_NAMES = ["eat", "grocery", "do", "play", "watch", "media", "plan", "health", "inventory", "recreate", "config"];

// Prep week starts on Friday — maps JS day index to app dayId
const DAY_ID_MAP = { 0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday", 4: "thursday", 5: "friday-start", 6: "saturday" };

function dateKey(d) { return d.toISOString().slice(0, 10); }

function getPrepWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Roll back to the most recent Friday
  d.setDate(d.getDate() - (day >= 5 ? day - 5 : day + 2));
  return dateKey(d);
}

function buildBriefingContext(state) {
  const now = new Date();
  const todayKey = dateKey(now);
  const tomorrowKey = dateKey(new Date(now.getTime() + 86400000));
  const todayDayId = DAY_ID_MAP[now.getDay()];
  const weekKey = getPrepWeekKey(now);
  const lines = [];

  lines.push(`Today: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`);

  // Tasks this week
  const doPlans = typeof state.doPlans === "object" ? state.doPlans : {};
  const weekPlan = doPlans[weekKey] || {};
  const todayTasks = (weekPlan[todayDayId] || []).filter(t => !t.done && t.title);
  const allWeekTasks = Object.values(weekPlan)
    .flatMap(d => Array.isArray(d) ? d : [])
    .filter(t => !t.done && t.title);
  const backlogTasks = Array.isArray(state.doBacklog) ? state.doBacklog.filter(t => !t.done) : [];

  if (todayTasks.length) {
    lines.push(`\nTASKS TODAY (${todayTasks.length}):`);
    todayTasks.forEach(t => lines.push(`  - ${t.title}`));
  } else if (allWeekTasks.length) {
    lines.push(`\nTASKS THIS WEEK (${allWeekTasks.length} pending):`);
    allWeekTasks.slice(0, 4).forEach(t => lines.push(`  - ${t.title}`));
    if (allWeekTasks.length > 4) lines.push(`  … and ${allWeekTasks.length - 4} more`);
  }
  if (backlogTasks.length) lines.push(`  Backlog: ${backlogTasks.length} tasks`);

  // Tonight's dinner from meal plan
  const plans = typeof state.plans === "object" ? state.plans : {};
  const mealWeek = plans[weekKey];
  const todaySlots = mealWeek?.slots?.[todayDayId] || {};
  const meals = Object.entries(todaySlots)
    .flatMap(([type, val]) => (Array.isArray(val) ? val : [val]).filter(Boolean).map(v => `${type}: ${v}`));
  if (meals.length) lines.push(`\nTODAY'S MEALS: ${meals.join(" | ")}`);

  // Calendar events today + tomorrow
  const planEvents = Array.isArray(state.planEvents) ? state.planEvents : [];
  const upcomingEvents = planEvents
    .filter(e => e.date === todayKey || e.date === tomorrowKey)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));
  if (upcomingEvents.length) {
    lines.push("\nUPCOMING EVENTS:");
    upcomingEvents.forEach(e => {
      const when = e.date === todayKey ? "Today" : "Tomorrow";
      const time = e.startTime ? ` at ${e.startTime}` : "";
      lines.push(`  - ${when}: ${e.title}${time}`);
    });
  }

  // Daily dozen progress today
  const ddEntries = Array.isArray(state.dailyDozenEntries) ? state.dailyDozenEntries : [];
  const todayDD = ddEntries.filter(e => e.date === todayKey);
  const totalServings = Math.round(todayDD.reduce((s, e) => s + (Number(e.completedAmount) || 0), 0));
  const ddCategories = Array.isArray(state.dailyDozenCategories) ? state.dailyDozenCategories : [];
  const totalTarget = ddCategories.reduce((s, c) => s + (Number(c.dailyTargetServings) || 1), 0);
  if (totalTarget > 0) lines.push(`\nDAILY DOZEN: ${totalServings}/${totalTarget} servings logged today`);

  return lines.join("\n");
}

async function loadState(serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };

  // Find the most recently updated user state
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=not.in.(email_schedule_log,push_schedule_log)&select=id,updated_at&order=updated_at.desc&limit=20`,
    { headers }
  );
  if (!listRes.ok) throw new Error(`Supabase list failed: ${listRes.status}`);
  const allRows = await listRes.json();
  // Ignore infrastructure rows (Gmail tokens, mail suggestions) — they update
  // frequently and must not be mistaken for the app state
  const rows = allRows.filter(r => !/^(gmail_|mailsugg_)/.test(r.id));
  if (!rows.length) return null;

  // Find base stateId (strip :section suffix)
  const baseId = rows[0].id.includes(":") ? rows[0].id.split(":")[0] : rows[0].id;

  if (!rows[0].id.includes(":")) {
    // Old unified format
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${baseId}&select=state`, { headers });
    const [row] = await r.json();
    return row?.state || null;
  }

  // Sectioned format
  const sectionIds = SECTION_NAMES.map(s => `${baseId}:${s}`).join(",");
  const sectionRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=in.(${encodeURIComponent(sectionIds)})&select=id,state`,
    { headers }
  );
  if (!sectionRes.ok) throw new Error(`Supabase sections failed: ${sectionRes.status}`);
  const sections = await sectionRes.json();
  const assembled = {};
  for (const row of sections) {
    const { stateUpdatedAt, ...data } = row.state || {};
    Object.assign(assembled, data);
  }
  return assembled;
}

async function loadSubscriptions(serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/live_push_subscriptions?select=subscription`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" } }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map(r => r.subscription).filter(Boolean);
}

async function generateBriefing(apiKey, context) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: "You are Luke's personal assistant. Write a morning briefing as a push notification body — plain text only, no markdown, no bullet symbols, 3–5 short sentences max. Lead with the most time-sensitive item. Be warm but very concise.",
      messages: [{ role: "user", content: `CURRENT CONTEXT:\n${context}\n\n---\n\nWrite the morning briefing.` }]
    })
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || "Good morning! Open the app for your daily briefing.";
}

export const config = { schedule: "0 13 * * *" };

export default async () => {
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const vapidPublic = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const vapidPrivate = (process.env.VAPID_PRIVATE_KEY || "").trim();
  const vapidEmail = (process.env.VAPID_CONTACT_EMAIL || "").trim();

  if (!apiKey || !serviceKey || !vapidPublic || !vapidPrivate) {
    console.error("[daily-briefing] Missing required env vars.");
    return;
  }

  webpush.setVapidDetails(`mailto:${vapidEmail || "admin@example.com"}`, vapidPublic, vapidPrivate);

  try {
    const [state, subscriptions] = await Promise.all([
      loadState(serviceKey),
      loadSubscriptions(serviceKey)
    ]);

    if (!state) { console.log("[daily-briefing] No state found."); return; }
    if (!subscriptions.length) { console.log("[daily-briefing] No push subscriptions."); return; }

    // Respect the user's setting
    if (state.aiSettings?.dailyBriefingEnabled === false) {
      console.log("[daily-briefing] Daily briefing disabled by user.");
      return;
    }

    const context = buildBriefingContext(state);
    const body = await generateBriefing(apiKey, context);

    const payload = JSON.stringify({
      title: "Live — Daily Briefing",
      body,
      icon: "/favicon.svg",
      tag: "daily-briefing",
      url: "/"
    });

    const results = await Promise.allSettled(
      subscriptions.map(sub => webpush.sendNotification(sub, payload))
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;
    console.log(`[daily-briefing] Sent: ${sent}, Failed: ${failed}`);

    // Remove subscriptions that returned 410 Gone (device unsubscribed)
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        const err = results[i].reason;
        if (err?.statusCode === 410) {
          const endpoint = subscriptions[i]?.endpoint;
          if (endpoint) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/live_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
              { method: "DELETE", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
            ).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error("[daily-briefing] Error:", err.message);
  }
};
