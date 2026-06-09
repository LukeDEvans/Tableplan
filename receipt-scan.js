const DEFAULT_SCAN_MODEL = "gpt-4.1-mini";
const { normalizeReceipt } = require("./receipt-domain");

async function scanReceiptFromImages(images, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Receipt scanning needs OPENAI_API_KEY set on the server.");
  const cleanImages = validateImages(images);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || process.env.OPENAI_RECEIPT_SCAN_MODEL || DEFAULT_SCAN_MODEL,
      temperature: 0,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: receiptScanPrompt() },
          ...cleanImages.map((image) => ({ type: "input_image", image_url: image, detail: "high" }))
        ]
      }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI receipt scan failed with status ${response.status}`);
  return normalizeReceipt(parseReceiptJson(outputText(payload)));
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
  if (payload.output_text) return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
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
