const DEFAULT_SCAN_MODEL = "claude-haiku-4-5-20251001";
const { normalizeReceipt } = require("./receipt-domain");

async function scanReceiptFromImages(images, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Receipt scanning needs ANTHROPIC_API_KEY set on the server.");
  const cleanImages = validateImages(images);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || process.env.ANTHROPIC_RECEIPT_SCAN_MODEL || DEFAULT_SCAN_MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: receiptScanPrompt() },
          ...cleanImages.map((image) => {
            const { media_type, data } = parseDataUrl(image);
            return { type: "image", source: { type: "base64", media_type, data } };
          })
        ]
      }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Receipt scan failed with status ${response.status}`);
  return normalizeReceipt(parseReceiptJson(outputText(payload)));
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid image data URL.");
  return { media_type: match[1].toLowerCase(), data: match[2] };
}

function validateImages(images) {
  if (!Array.isArray(images) || !images.length) throw new Error("At least one receipt image is required.");
  if (images.length > 3) throw new Error("Use up to 3 images for one receipt.");
  return images.map((image) => {
    const value = String(image || "");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
      throw new Error("Receipt images must be PNG, JPEG, WEBP, or GIF data URLs.");
    }
    return value;
  });
}

function receiptScanPrompt() {
  return [
    "Extract this grocery receipt accurately.",
    "Return only valid JSON without markdown.",
    "Do not invent illegible values. Use empty strings or zero and lower confidence.",
    "Exclude payment lines and loyalty balances from grocery line items.",
    "Keep tax and fees separate. Record visible discounts on the affected line when possible and in receipt discounts.",
    "For weighted items, use the purchased weight as quantity and lb, oz, kg, or g as unit.",
    "Use one line item per purchased product.",
    "Use this JSON shape exactly:",
    JSON.stringify({
      storeName: "",
      purchaseDate: "",
      subtotal: 0,
      tax: 0,
      fees: 0,
      discounts: 0,
      total: 0,
      lineItems: [{
        rawText: "",
        normalizedName: "",
        category: "",
        quantity: 1,
        unit: "each",
        totalPrice: 0,
        unitPrice: 0,
        discountAmount: 0,
        confidenceScore: 0.8
      }]
    })
  ].join("\n");
}

function outputText(payload) {
  return (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}

function parseReceiptJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("The receipt scan did not return text.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The receipt scan response could not be parsed.");
    return JSON.parse(match[0]);
  }
}

module.exports = {
  scanReceiptFromImages,
  parseReceiptJson,
  receiptScanPrompt,
  validateImages
};
