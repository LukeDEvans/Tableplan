const { buildWeeklyContext } = require("./build-weekly-context");
const { claudeCall } = require("./_claude");
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEFAULT_TO_EMAIL = "mrlukedevans@gmail.com";
const DEFAULT_FROM_EMAIL = "Live App <onboarding@resend.dev>";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  if (event.httpMethod === "GET") {
    return jsonResponse(200, {
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      hasResendKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      hasEmailTo: true,
      emailTo: process.env.WEEKLY_REVIEW_TO || DEFAULT_TO_EMAIL
    });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!anthropicKey) return jsonResponse(503, { error: "ANTHROPIC_API_KEY not configured in Netlify." });

  const appState = await loadStateFromSupabase(serviceKey);
  if (!appState) return jsonResponse(503, { error: "Could not load app state from Supabase." });

  const prefs = String(appState.emailPrefs || "").trim();
  const notes = String(body.notes || "").trim();
  const context = buildWeeklyContext(appState, notes);
  const prefsSection = prefs ? `\n\nSTANDING PREFERENCES FROM LUKE:\n${prefs}` : "";

  const appUrl = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");

  const html = await claudeCall(anthropicKey, {
    maxTokens: 2048,
    model: "claude-sonnet-4-6",
    system: `You are a personal assistant writing a weekly digest email for a life-management app called "Live". The user is Luke.
Write a warm, personal, helpful email in clean HTML with inline styles (for email client compatibility).
Style: body background #FFFDF6, font Arial/sans-serif, max-width 600px centered, headings color #92400E, body text #1C1917.
Structure: warm greeting → week recap (recipes, meals, exercise, to-do, watching, calendar) → anything flagged ⚠️ needing attention → brief look ahead.
Tone: like a thoughtful friend reviewing the week with Luke, not a corporate newsletter. Conversational, encouraging, scannable.
${appUrl ? `When referencing something that needs action in the app, include a clickable hyperlink to the app. Use these URLs:
- Update pantry / grocery list: ${appUrl}/#shop
- Review meal plan: ${appUrl}/#nourish
- Add workouts: ${appUrl}/#sweat
- Check to-do list: ${appUrl}/#maintain
Format links like: <a href="URL" style="color:#92400E">link text</a>` : ""}
Output ONLY the HTML body content (start with a <div> or <table>, no doctype/html/head/body tags).${prefsSection}`,
    user: context
  });

  if (body.preview) return jsonResponse(200, { html: html || "<p>Could not generate email content.</p>" });

  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (!resendKey) return jsonResponse(503, { error: "RESEND_API_KEY not configured in Netlify." });

  const to = process.env.WEEKLY_REVIEW_TO || DEFAULT_TO_EMAIL;
  const from = process.env.WEEKLY_REVIEW_FROM || DEFAULT_FROM_EMAIL;
  const subject = `Your Weekly Review – ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  await sendResendEmail({ resendKey, from, to, subject, html });
  return jsonResponse(200, { ok: true, to });
};

const SECTION_NAMES = ["eat", "grocery", "do", "play", "watch", "media", "plan", "health", "inventory", "recreate", "config"];

async function loadStateFromSupabase(serviceKey) {
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" };
  const stateId = "personal";
  const sectionIds = SECTION_NAMES.map(s => `${stateId}:${s}`).join(",");

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=in.(${sectionIds})&select=id,state`,
    { headers }
  );
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
  const rows = await res.json();

  if (rows.length > 0) {
    const assembled = {};
    let latestTs = "";
    for (const row of rows) {
      const { stateUpdatedAt, ...data } = row.state || {};
      Object.assign(assembled, data);
      if (stateUpdatedAt && stateUpdatedAt > latestTs) latestTs = stateUpdatedAt;
    }
    if (latestTs) assembled.stateUpdatedAt = latestTs;
    return assembled;
  }

  // Migration fallback: load old unified row
  const fallback = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.personal&select=state`,
    { headers }
  );
  if (!fallback.ok) throw new Error(`Supabase load failed: ${fallback.status}`);
  const fallbackRows = await fallback.json();
  return fallbackRows[0]?.state || null;
}

async function sendResendEmail({ resendKey, from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}



function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}
