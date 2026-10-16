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
      timeoutMessage: RECEIPT_TIMEOUT_MESSAGE,
    },
  });
  const { normalizeReceipt } = await getReceiptDomain();
  // Preserve the model's RAW output + which model produced it (extraction kept
  // independent of the interpretation — re-parse later without a rescan).
  // The raw output uses the COMPACT line shape below; expandScanReceipt turns it
  // back into the record's full field names before normalizing.
  const receipt = normalizeReceipt(expandScanReceipt(parseReceiptJson(rawText), categories));
  // Keep only budget categories that exist (the model can invent keys).
  const validKeys = new Set(categories.map((c) => c.key));
  receipt.lineItems = receipt.lineItems.map((line) => ({ ...line, budgetCategory: validKeys.has(line.budgetCategory) ? line.budgetCategory : "" }));
  return { receipt, rawText, model };
}

const RECEIPT_TIMEOUT_MESSAGE = "This receipt took too long to read. Try again, or crop the photo to just the receipt.";

// The model writes one object per line, and a long grocery receipt runs 30–50
// lines, so every token per line is paid ~40 times. A 2026-10-16 scan of a 30+
// line receipt ran past Netlify's 30 s limit (504). The line shape is therefore
// compact: short keys, defaults left out, no unit price (derived from price ÷ qty
// by the normalizer), and budget categories as a list number instead of the long
// "cat:<groupId>:<categoryId>" key.
const COMPACT_LINE = { text: "", name: "", cat: "", price: 0, conf: 0.9 };

function receiptScanPrompt(categories = []) {
  const hasBudget = Array.isArray(categories) && categories.length > 0;
  const budget = hasBudget ? [
    "Also give each line \"b\": the number of the best-fitting household budget category below. Leave \"b\" out when unsure.",
    categories.map((c, i) => `${i + 1} = ${c.name}`).join("\n"),
  ] : [];
  return [
    "Extract this purchase receipt accurately (usually groceries, but any store).",
    "Return only valid JSON without markdown, on a single line with no spaces between tokens.",
    "Do not invent illegible values. Use empty strings or zero and a lower conf.",
    "Exclude payment lines and loyalty balances from line items.",
    "Keep tax and fees separate. Record visible discounts on the affected line (\"disc\", a positive amount) when possible and in receipt discounts.",
    "Use one line per purchased product. Each line has:",
    "text = the line exactly as printed; name = a clean product name; cat = a short grocery category; price = the line's total price; conf = your confidence from 0 to 1.",
    "Only when they apply, add: qty (when not 1; for weighted items the weight), unit (when not each: lb, oz, kg, or g), disc.",
    "Use this JSON shape:",
    JSON.stringify({
      storeName: "",
      purchaseDate: "",
      subtotal: 0,
      tax: 0,
      fees: 0,
      discounts: 0,
      total: 0,
      lines: [hasBudget ? { ...COMPACT_LINE, b: 1 } : COMPACT_LINE]
    }),
    ...budget
  ].join("\n");
}

// Compact model output → the receipt record's field names. Also accepts the
// older long shape (lineItems with full names), so earlier raw outputs still parse.
function expandScanReceipt(parsed, categories = []) {
  const src = parsed && typeof parsed === "object" ? parsed : {};
  const lines = Array.isArray(src.lines) ? src.lines : (Array.isArray(src.lineItems) ? src.lineItems : []);
  const { lines: _lines, ...rest } = src;
  return { ...rest, lineItems: lines.map((line) => expandScanLine(line, categories)) };
}

function expandScanLine(line, categories = []) {
  if (!line || typeof line !== "object") return line;
  const out = { ...line };
  const move = (from, to) => {
    if (out[from] !== undefined && out[to] === undefined) out[to] = out[from];
    delete out[from];
  };
  move("text", "rawText");
  move("name", "normalizedName");
  move("cat", "category");
  move("qty", "quantity");
  move("price", "totalPrice");
  move("disc", "discountAmount");
  move("conf", "confidenceScore");
  if (out.b !== undefined) {
    const index = Number(out.b);
    const category = Number.isInteger(index) && index >= 1 ? categories[index - 1] : null;
    if (out.budgetCategory === undefined) out.budgetCategory = category ? category.key : "";
    delete out.b;
  }
  return out;
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
  expandScanReceipt,
  RECEIPT_TIMEOUT_MESSAGE,
  validateImages
};
