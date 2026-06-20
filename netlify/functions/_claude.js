// Shared Claude API helper for Netlify functions.
// Files prefixed with _ are not deployed as individual functions.

async function claudeCall(apiKey, { system, user, maxTokens = 1024, model = "claude-haiku-4-5-20251001" }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error?.message || `Anthropic API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

module.exports = { claudeCall };
