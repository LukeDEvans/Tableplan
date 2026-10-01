// receipt-scan.js — receipt domain adapter over the shared document-scan seam.
// Owns the receipt PROMPT + normalization; the vision plumbing lives in
// document-scan.js. Returns the intermediate { receipt, rawText, model } so the
// client keeps the extraction (raw output) independent of the interpretation.
const { scanDocument, parseJsonFromText, validateAndBuildBlocks } = require("./document-scan");

let _receiptDomain = null;
async function getReceiptDomain() {
  if (!_receiptDomain) _receiptDomain = await import("./receipt-domain.js");
  return _receiptDomain;
}

async function scanReceiptFromImages(images, options = {}) {
  const { categories = [], ...scanOptions } = options;
  const { rawText, model } = await scanDocument({
    items: images,
    prompt: receiptScanPrompt(categories),
    options: {
      ...scanOptions,
      maxItems: 6,
      noun: "receipt image",
      label: "Receipt scan",
      envModelVar: "ANTHROPIC_RECEIPT_SCAN_MODEL",
      missingKeyMessage: "Receipt scanning needs ANTHROPIC_API_KEY set on the server.",
    },
  });
  const { normalizeReceipt } = await getReceiptDomain();
  // Preserve the model's RAW output + which model produced it (extraction kept
  // independent of the interpretation — re-parse later without a rescan).
  const receipt = normalizeReceipt(parseReceiptJson(rawText));
  // Keep only budget categories that exist (the model can invent keys).
  const validKeys = new Set(categories.map((c) => c.key));
  receipt.lineItems = receipt.lineItems.map((line) => ({ ...line, budgetCategory: validKeys.has(line.budgetCategory) ? line.budgetCategory : "" }));
  return { receipt, rawText, model };
}

function receiptScanPrompt(categories = []) {
  const budget = Array.isArray(categories) && categories.length ? [
    "Also give each line item a budgetCategory: the best-fitting key from this household budget list, or \"\" when unsure.",
    categories.map((c) => `${c.key} = ${c.name}`).join("\n"),
  ] : [];
  return [
    "Extract this purchase receipt accurately (usually groceries, but any store).",
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
        confidenceScore: 0.8,
        ...(budget.length ? { budgetCategory: "" } : {})
      }]
    }),
    ...budget
  ].join("\n");
}

// Back-compat thin wrappers (kept for existing importers/tests).
function parseReceiptJson(text) {
  return parseJsonFromText(text, "The receipt scan did not return text.");
}
function validateImages(images) {
  validateAndBuildBlocks(images, { max: 6, allowPdf: false, noun: "receipt image" });
  return images.map((image) => String(image));
}

module.exports = {
  scanReceiptFromImages,
  parseReceiptJson,
  receiptScanPrompt,
  validateImages
};
