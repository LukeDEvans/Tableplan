const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!anthropicKey) return jsonResponse(503, { error: "ANTHROPIC_API_KEY not configured." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (body.step === "questions") {
    let currentPrefs = "";
    if (serviceKey) {
      const appState = await loadStateFromSupabase(serviceKey).catch(() => null);
      currentPrefs = String(appState?.emailPrefs || "").trim();
    }
    const raw = await claudeCall(anthropicKey, {
      system: `You help Luke configure a personal weekly email digest from his life-management app.
The email covers: recipes added, meal plan, exercise logs, to-do progress, watch list, calendar events.
Generate exactly 6 short, specific questions to understand his preferences for tone, structure, and content.
Return ONLY a valid JSON array of 6 strings — no explanation, no markdown fences, no keys, just the array.`,
      user: currentPrefs ? `Current preferences:\n${currentPrefs}` : "No preferences set yet."
    });
    let questions;
    try { questions = JSON.parse(raw.trim()); } catch { questions = raw.split("\n").filter(Boolean).slice(0, 6); }
    return jsonResponse(200, { questions });

  } else if (body.step === "update") {
    const qa = (body.questions || []).map((q, i) => `Q: ${q}\nA: ${(body.answers || [])[i] || "(no answer)"}`).join("\n\n");
    let currentPrefs = "";
    if (serviceKey) {
      const appState = await loadStateFromSupabase(serviceKey).catch(() => null);
      currentPrefs = String(appState?.emailPrefs || "").trim();
    }
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

async function loadStateFromSupabase(serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.personal&select=state`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Supabase load failed: ${res.status}`);
  const rows = await res.json();
  return rows[0]?.state || null;
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
