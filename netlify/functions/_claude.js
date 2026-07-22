// Shared Claude API helper for Netlify functions.
// Files prefixed with _ are not deployed as individual functions.

async function claudeRequest(apiKey, { system, messages, maxTokens = 1024, model = "claude-haiku-4-5-20251001", thinking }) {
  const body = { model, max_tokens: maxTokens, system, messages };
  // Thinking-capable models (e.g. Sonnet 5) may emit a leading "thinking"
  // content block; pass { type: "disabled" } for mechanical tasks that don't
  // need it (faster, cheaper, and no thinking block to skip over).
  if (thinking) body.thinking = thinking;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error?.message || `Anthropic API error ${res.status}`);
  }
  const data = await res.json();
  // Concatenate every text block — never assume content[0] is text, since a
  // thinking block can precede it and would otherwise read back as empty.
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, stopReason: data.stop_reason || null };
}

async function claudeCall(apiKey, { system, user, maxTokens = 1024, model = "claude-haiku-4-5-20251001", thinking }) {
  const { text } = await claudeRequest(apiKey, {
    system, messages: [{ role: "user", content: user }], maxTokens, model, thinking
  });
  return text;
}

// Like claudeCall, but if the model stops because it hit the max_tokens ceiling,
// it continues generation — prefilling the assistant turn with what's produced
// so far — until the model finishes on its own (stop_reason other than
// "max_tokens"). This guarantees long outputs, e.g. a full newsletter reproduced
// verbatim for the Media reader, are never clipped mid-sentence. maxRounds caps
// total work so a runaway generation can't loop forever.
async function claudeCallComplete(apiKey, { system, user, maxTokens = 4096, model = "claude-haiku-4-5-20251001", maxRounds = 5, thinking }) {
  let full = "";
  for (let round = 0; round < maxRounds; round++) {
    const messages = [{ role: "user", content: user }];
    // The API rejects an assistant message that ends in whitespace, so trim the
    // prefill; the model resumes cleanly from the last non-space character.
    const prefill = full.replace(/[ \t\r\n]+$/, "");
    if (prefill) messages.push({ role: "assistant", content: prefill });
    const { text, stopReason } = await claudeRequest(apiKey, { system, messages, maxTokens, model, thinking });
    full = prefill + text;
    if (stopReason !== "max_tokens") break;
  }
  return full;
}

module.exports = { claudeCall, claudeCallComplete };
