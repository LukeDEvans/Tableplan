const { getUserIdFromToken, getUserGroupId, loadSection } = require("./_state-sections.js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  const userId = await getUserIdFromToken(accessToken, serviceKey);
  if (!userId) return jsonResponse(401, { error: "Invalid session." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!anthropicKey) return jsonResponse(503, { error: "ANTHROPIC_API_KEY not configured." });

  if (body.step === "questions") {
    const currentPrefs = await loadEmailPrefs(serviceKey, userId);
    const raw = await claudeCall(anthropicKey, {
      system: `You help Luke configure a personal weekly email digest from his life-management app.
The email covers: recipes added, meal plan, exercise logs, to-do progress, watch list, calendar events.
Generate exactly 6 short, specific questions to understand his preferences for tone, structure, and content.
Return ONLY a valid JSON array of 6 strings — no explanation, no markdown fences, no keys, just the array.`,
      user: currentPrefs ? `Current preferences:\n${currentPrefs}` : "No preferences set yet."
    });
    let questions;
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try { questions = JSON.parse(cleaned); } catch { questions = cleaned.split("\n").map((s) => s.trim().replace(/^["'\d.\s-]+/, "").replace(/[",]+$/, "").trim()).filter((s) => s.length > 10).slice(0, 6); }
    return jsonResponse(200, { questions });

  } else if (body.step === "update") {
    const qa = (body.questions || []).map((q, i) => `Q: ${q}\nA: ${(body.answers || [])[i] || "(no answer)"}`).join("\n\n");
    const currentPrefs = await loadEmailPrefs(serviceKey, userId);
    const newPrefs = await claudeCall(anthropicKey, {
      system: `You are rewriting a personal email-preferences file for Luke's weekly digest.
Output ONLY clean markdown — a short intro comment line starting with #, then bullet points.
Each bullet should be a specific, actionable instruction for future emails.
Incorporate the existing preferences unless an answer contradicts them.
Do not include the Q&A themselves. No preamble, no explanation — just the markdown file content.`,
      user: `Interview answers:\n\n${qa}${currentPrefs ? `\n\nCurrent preferences:\n${currentPrefs}` : ""}`
    });
    return jsonResponse(200, { prefs: newPrefs.trim() });

  } else {
    return jsonResponse(400, { error: "Invalid step. Use 'questions' or 'update'." });
  }
};

async function loadEmailPrefs(serviceKey, userId) {
  try {
    const groupId = await getUserGroupId(serviceKey, userId);
    if (!groupId) return "";
    const row = await loadSection(serviceKey, groupId, "config");
    return String(row?.state?.emailPrefs || "").trim();
  } catch { return ""; }
}

async function claudeCall(apiKey, { system, user, maxTokens = 1024 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error?.message || `Anthropic API error ${res.status}`); }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

