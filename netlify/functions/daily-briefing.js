// Scheduled daily briefing: reads user state from Supabase, generates a
// short briefing with Claude, and sends a push notification to all subscribed devices.
//
// Schedule: 13:00 UTC daily (adjust in netlify.toml to match your morning)
// To change the time, update: [functions."daily-briefing"] schedule = "0 <hour> * * *"

import webpush from "web-push";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const SECTION_NAMES = ["eat", "grocery", "do", "play", "watch", "media", "plan", "health", "inventory", "recreate", "config"]; // NOTE: "finance" is intentionally excluded — never feed financial data into AI prompts

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
  // Ignore infrastructure/personal/backup rows when hunting the group id —
  // they update frequently and must not be mistaken for the household state
  const rows = allRows.filter(r => !/^(gmail_|mailsugg_|mailai_|u-|backup-)/.test(r.id) && r.id.includes(":"));
  if (!rows.length) return null;

  const baseId = rows[0].id.split(":")[0];

  // Household rows overlaid with the admin's PERSONAL rows — most day-to-day
  // data lives in the member's personal store now, and the briefing is for
  // the admin, so their personal data wins per key when it has content.
  const adminUid = await getAdminUid(headers, baseId);
  const ids = [
    ...SECTION_NAMES.map(s => `${baseId}:${s}`),
    ...(adminUid ? SECTION_NAMES.map(s => `u-${adminUid}:${s}`) : []),
  ].join(",");
  const sectionRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=in.(${encodeURIComponent(ids)})&select=id,state`,
    { headers }
  );
  if (!sectionRes.ok) throw new Error(`Supabase sections failed: ${sectionRes.status}`);
  const sections = await sectionRes.json();
  const assembled = {};
  const overlay = {};
  for (const row of sections) {
    const { stateUpdatedAt, ...data } = row.state || {};
    Object.assign(row.id.startsWith("u-") ? overlay : assembled, data);
  }
  for (const [k, v] of Object.entries(overlay)) {
    const empty = v == null || (Array.isArray(v) && !v.length) ||
      (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    if (!empty || !(k in assembled)) assembled[k] = v;
  }
  return assembled;
}

async function getAdminUid(headers, groupId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${encodeURIComponent(groupId)}&role=eq.admin&select=user_id&limit=1`,
      { headers }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0]?.user_id || null;
  } catch { return null; }
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

// TTS audio is a regenerable cache: article MP3s in the article-audio bucket
// are cheap to recreate on demand, so anything older than 30 days is swept
// daily. This bounds the bucket to ~a month of listening instead of growing
// forever toward the storage quota.
async function cleanupOldTtsAudio(serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
  const list = async (prefix) => {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/article-audio`, {
      method: "POST", headers,
      body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } })
    });
    return r.ok ? r.json() : [];
  };
  const cutoff = Date.now() - 30 * 86400000;
  const folders = await list("");
  for (const f of folders) {
    if (f.id) continue; // root-level file, not an article folder
    const files = await list(f.name + "/");
    const paths = files.filter((x) => x.id).map((x) => `${f.name}/${x.name}`);
    if (!paths.length) continue;
    const newest = Math.max(...files.map((x) => new Date(x.updated_at || x.created_at || 0).getTime()));
    if (newest >= cutoff) continue;
    const del = await fetch(`${SUPABASE_URL}/storage/v1/object/article-audio`, {
      method: "DELETE", headers, body: JSON.stringify({ prefixes: paths })
    });
    console.log(`[tts-cleanup] ${f.name}: ${del.ok ? "removed" : "delete failed"} (${paths.length} files)`);
  }
}

// ── Daily finance balance snapshot ───────────────────────────────────────────
// For each household with a SimpleFIN link: record every tracked account's
// balance (live for linked accounts, manual otherwise) plus the net-worth sum
// into the service-only row finhist_<groupId>. Clients read it through the
// simplefin function's "history" action; they can never write or clobber it.
function sbHeaders(serviceKey) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json", "x-live-writer": "2" };
}

function splitAccessUrl(accessUrl) {
  try {
    const u = new URL(accessUrl);
    const auth = (u.username || u.password)
      ? Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")
      : null;
    u.username = ""; u.password = "";
    return { url: u.toString().replace(/\/+$/, ""), auth };
  } catch { return { url: accessUrl, auth: null }; }
}

const numOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

async function snapshotFinanceBalances(serviceKey) {
  const headers = sbHeaders(serviceKey);
  const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=like.simplefin*&select=id,state`, { headers });
  if (!linkRes.ok) throw new Error(`simplefin rows ${linkRes.status}`);
  for (const linkRow of await linkRes.json()) {
    const groupId = linkRow.id.replace(/^simplefin_/, "");
    const accessUrl = linkRow.state?.accessUrl;
    if (!accessUrl || groupId === linkRow.id) continue;
    try {
      const { url, auth } = splitAccessUrl(accessUrl);
      // 45-day window: same as the interactive endpoint, so this one daily
      // bridge call can pre-warm that endpoint's finaccts_ cache (below) and
      // interactive phone loads never need their own bridge hit — which is
      // what was generating a "new IP" email on nearly every phone visit
      // (each Netlify egress IP differs). Bank data only changes once a day,
      // so a single daily pull loses nothing.
      const start = Math.floor(Date.now() / 1000) - 45 * 86400;
      const bridge = await fetch(`${url}/accounts?start-date=${start}`, {
        headers: { accept: "application/json", ...(auth ? { authorization: `Basic ${auth}` } : {}) }
      });
      if (!bridge.ok) { console.error(`[fin-snapshot] bridge ${bridge.status} for group`); continue; }
      const data = await bridge.json().catch(() => null);
      const liveById = new Map((data?.accounts || []).map((a) => [String(a.id || ""), a]));

      // Pre-warm the interactive accounts cache with the same normalized shape
      // simplefin.js writes, so a phone load served from here is identical to a
      // live fetch. Best-effort — a snapshot failure must not block the cache
      // write, and vice versa.
      if (Array.isArray(data?.accounts)) {
        const normalized = data.accounts.map((a) => ({
          id: String(a.id || ""),
          org: a.org?.name || a.org?.domain || "",
          name: a.name || "",
          currency: a.currency || "USD",
          balance: numOrNull(a.balance),
          available: numOrNull(a["available-balance"]),
          balanceDate: a["balance-date"] ? new Date(a["balance-date"] * 1000).toISOString() : null,
          transactions: (a.transactions || []).map((t) => ({
            id: String(t.id || ""),
            posted: t.posted ? new Date(t.posted * 1000).toISOString() : null,
            amount: numOrNull(t.amount),
            description: String(t.description || "").slice(0, 200),
            pending: Boolean(t.pending)
          }))
        }));
        const errors = Array.isArray(data.errors) ? data.errors.map(String).slice(0, 5) : [];
        await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
          method: "POST",
          headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id: `finaccts_${groupId}`, state: { accounts: normalized, errors, fetchedAt: new Date().toISOString() }, updated_at: new Date().toISOString() })
        }).then((r) => { if (!r.ok) console.error(`[fin-snapshot] cache warm ${r.status}`); }).catch((e) => console.error("[fin-snapshot] cache warm threw", e.name || "error"));
      }

      const finRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(groupId + ":finance")}&select=state`, { headers });
      const finRows = finRes.ok ? await finRes.json() : [];

      // Rolling daily backup of the household finance section, so budget
      // categories and transaction annotations are always recoverable if any
      // client ever wipes them. A snapshot that is EMPTIER than the newest
      // stored one is skipped, so a wipe can never poison the backup — the last
      // healthy copy survives. Kept per date; window trimmed to ~21 days.
      try { await backupFinanceSection(headers, groupId, finRows[0]?.state); }
      catch (e) { console.error("[fin-backup] failed:", e.name || "error"); }

      const accounts = finRows[0]?.state?.financeAccounts || [];

      const balances = {};
      let netWorth = 0, any = false;
      for (const a of accounts) {
        const live = a.linkedId ? liveById.get(a.linkedId) : null;
        const bal = live && live.balance != null ? parseFloat(live.balance)
          : (a.manualBalance != null && a.manualBalance !== "" ? Number(a.manualBalance) : null);
        if (bal === null || !Number.isFinite(bal)) continue;
        balances[a.id] = Math.round(bal * 100) / 100;
        netWorth += bal; any = true;
      }
      if (!any) continue;

      const histId = `finhist_${groupId}`;
      const histRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(histId)}&select=state`, { headers });
      const histRows = histRes.ok ? await histRes.json() : [];
      const days = (histRows[0]?.state?.days && typeof histRows[0].state.days === "object") ? histRows[0].state.days : {};
      days[dateKey(new Date())] = { netWorth: Math.round(netWorth * 100) / 100, balances };
      const keys = Object.keys(days).sort();
      for (let i = 0; i < keys.length - 730; i++) delete days[keys[i]];

      const up = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
        method: "POST",
        headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: histId, state: { days }, updated_at: new Date().toISOString() })
      });
      if (!up.ok) console.error(`[fin-snapshot] save ${up.status}`);
      else console.log(`[fin-snapshot] recorded ${Object.keys(balances).length} balances`);
    } catch (e) {
      console.error("[fin-snapshot] group failed:", e.name || "error"); // names only — no URLs in logs
    }
  }
}

// How "rich" a finance state is — used to refuse backing up a wipe over a
// healthy snapshot. Counts budget categories + every transaction-annotation
// entry + manual transactions.
function financeRichness(fin) {
  if (!fin || typeof fin !== "object") return 0;
  let n = 0;
  for (const g of (Array.isArray(fin.financeBudgetGroups) ? fin.financeBudgetGroups : [])) {
    n += Array.isArray(g?.categories) ? g.categories.length : 0;
  }
  for (const k of ["financeTxnLabels", "financeTxnRules", "financeTxnNoteOverrides",
    "financeTxnNoteCounts", "financeTxnLinks", "financeTxnSignFlips", "financeMerchantNames",
    "financeAccountSubLabels", "financeMonthActuals"]) {
    const v = fin[k];
    if (v && typeof v === "object") n += Object.keys(v).length;
  }
  for (const k of ["financeManualTxns", "financeAccountLabels"]) {
    if (Array.isArray(fin[k])) n += fin[k].length;
  }
  return n;
}

async function backupFinanceSection(headers, groupId, finState) {
  if (!finState || typeof finState !== "object") return;
  const id = `finbackup_${groupId}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(id)}&select=state`, { headers, cache: "no-store" });
  const rows = res.ok ? await res.json() : [];
  const snaps = (rows[0]?.state?.snapshots && typeof rows[0].state.snapshots === "object") ? rows[0].state.snapshots : {};

  // Never let a wipe overwrite a healthier copy: skip if today's data is
  // emptier than the newest snapshot we already hold.
  const newestKey = Object.keys(snaps).sort().at(-1);
  const newestRichness = newestKey ? financeRichness(snaps[newestKey]) : -1;
  const todayRichness = financeRichness(finState);
  if (todayRichness < newestRichness) {
    console.log(`[fin-backup] skipped — today (${todayRichness}) poorer than newest (${newestRichness})`);
    return;
  }

  const today = dateKey(new Date());
  snaps[today] = finState;
  for (const k of Object.keys(snaps).sort().slice(0, -21)) delete snaps[k]; // keep newest ~21 days

  const up = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, state: { snapshots: snaps }, updated_at: new Date().toISOString() })
  });
  if (!up.ok) console.error(`[fin-backup] save ${up.status}`);
  else console.log(`[fin-backup] stored ${today} (richness ${todayRichness}, ${Object.keys(snaps).length} days kept)`);
}

export default async () => {
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (serviceKey) {
    try { await cleanupOldTtsAudio(serviceKey); }
    catch (e) { console.error("[tts-cleanup] failed:", e.message); }
    try { await snapshotFinanceBalances(serviceKey); }
    catch (e) { console.error("[fin-snapshot] failed:", e.message); }
  }
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
