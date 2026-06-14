const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const items = Array.isArray(body.items) ? body.items.map(s => String(s).trim()).filter(Boolean) : [];
  if (!items.length) return jsonResponse(400, { error: "No items provided." });

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "ANTHROPIC_API_KEY not configured." });

  let raw;
  try {
    raw = await claudeCall(apiKey, {
      system: `You are a nutrition tagger for the Daily Dozen eating plan. Given a list of grocery items, return a JSON object mapping each item name (exactly as given) to an array of Daily Dozen category IDs.
Valid category IDs: beans, berries, other-fruits, cruciferous-vegetables, greens, other-vegetables, flaxseed, nuts-seeds, herbs-spices, whole-grains, beverages
Rules:
- Only include items that clearly fit a category. Omit items that don't belong to any Daily Dozen category (meat, dairy, eggs, processed food, oil, sugar, condiments, etc.).
- An item may have multiple category IDs (e.g. kale → ["cruciferous-vegetables", "greens"]).
- Return ONLY valid JSON — no explanation, no markdown fences.`,
      user: `Tag these grocery items:\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}`,
      maxTokens: 2048
    });
  } catch (err) {
    return jsonResponse(502, { error: err.message });
  }

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let tags;
  try { tags = JSON.parse(cleaned); } catch { return jsonResponse(500, { error: "AI returned invalid JSON." }); }
  return jsonResponse(200, { tags });
};

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

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}
