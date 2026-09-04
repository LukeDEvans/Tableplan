// document-scan.js — the shared DOCUMENT-EXTRACTION seam (CJS, server-side). One
// vision call for every "image/PDF → structured JSON" scanner (receipts, recipes,
// bookings today; recipes/articles later) so the plumbing — data-URL parsing,
// content-block building, the Anthropic request, output-text extraction, tolerant
// JSON parsing — lives in ONE place instead of being copy-pasted per domain.
//
// It deliberately produces the intermediate RAW output (`rawText` + `model`) and
// stops there: each domain owns its own prompt and its own normalizer (the
// "Document → Text → Specialized Parser" split). This is a thin interface, not a
// framework, and holds no domain knowledge.

const DEFAULT_SCAN_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid data URL.");
  return { media_type: match[1].toLowerCase(), data: match[2] };
}

// One image (always) or PDF (when allowPdf) → an Anthropic content block.
function buildContentBlock(dataUrl, { allowPdf = false } = {}) {
  const { media_type, data } = parseDataUrl(dataUrl);
  if (allowPdf && media_type === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (/^image\/(png|jpe?g|webp|gif)$/.test(media_type)) {
    return { type: "image", source: { type: "base64", media_type, data } };
  }
  throw new Error(allowPdf
    ? "Files must be images (PNG/JPEG/WEBP/GIF) or PDFs."
    : "Images must be PNG, JPEG, WEBP, or GIF data URLs.");
}

function validateAndBuildBlocks(items, { max = 6, allowPdf = false, noun = "image" } = {}) {
  const kind = allowPdf ? "file" : noun;
  if (!Array.isArray(items) || !items.length) throw new Error(`At least one ${kind} is required.`);
  if (items.length > max) throw new Error(`Use up to ${max} ${kind}s per scan.`);
  return items.map((item) => buildContentBlock(String(item || ""), { allowPdf }));
}

function outputText(payload) {
  return (payload?.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}

// Tolerant JSON parse: whole-string first, else the first {...} object.
function parseJsonFromText(text, emptyMessage = "The scan did not return text.") {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error(emptyMessage);
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The scan response could not be parsed.");
    return JSON.parse(match[0]);
  }
}

// The shared vision call. `items` are base64 data URLs; `prompt` is the domain
// prompt. Returns the intermediate { rawText, model } — the caller parses/normalizes.
async function scanDocument({ items, prompt, options = {} }) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(options.missingKeyMessage || "Scanning needs ANTHROPIC_API_KEY set on the server.");
  const blocks = validateAndBuildBlocks(items, { max: options.maxItems || 6, allowPdf: !!options.allowPdf, noun: options.noun || "image" });
  const model = options.model || (options.envModelVar && process.env[options.envModelVar]) || DEFAULT_SCAN_MODEL;
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (options.betaHeader) headers["anthropic-beta"] = options.betaHeader;

  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 4096,
      temperature: 0,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...blocks] }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `${options.label || "Scan"} failed with status ${response.status}`);
  return { rawText: outputText(payload), model };
}

module.exports = {
  DEFAULT_SCAN_MODEL,
  scanDocument,
  parseDataUrl,
  buildContentBlock,
  validateAndBuildBlocks,
  outputText,
  parseJsonFromText,
};
