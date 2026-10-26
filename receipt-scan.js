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
let _reconcile = null;
async function getReconcile() {
  if (!_reconcile) _reconcile = await import("./receipt-reconcile.js");
  return _reconcile;
}

// The stronger model for the second look, used only when the first read doesn't
// add up (RECEIPTS.md "Reading a receipt").
const RECHECK_MODEL_DEFAULT = "claude-sonnet-4-6";

// Synchronous path (scan-receipt; older app builds): one read, no second look —
// it has to finish inside Netlify's 30 s.
async function scanReceiptFromImages(images, options = {}) {
  const result = await readReceipt(images, { ...options, recheck: false });
  return { receipt: result.receipt, rawText: result.rawText, model: result.model, verdict: result.verdict, status: result.status };
}

// The whole read: AI transcribes → code reconciles → (only if it doesn't add up)
// a second look with a stronger model, kept only when it adds up better.
//   ocrPages: optional per-page rows from the phone's text recognition.
//   recheck:  allow the second look (background path: no 30 s limit).
async function readReceipt(images, options = {}) {
  const { categories = [], ocrPages = null, recheck = false, recheckModel, ...scanOptions } = options;
  const R = await getReconcile();
  const ocrRows = Array.isArray(ocrPages) ? ocrPages.flat().filter((r) => typeof r === "string") : [];
  const ocrText = ocrRows.length ? R.ocrTranscript(ocrPages) : "";
  const first = await readOnce(images, { categories, ocrText, ocrRows, scanOptions, R });
  let best = first;
  let rechecked = false;
  if (recheck && !first.verdict.ok) {
    try {
      const second = await readOnce(images, {
        categories, ocrText, ocrRows, R,
        scanOptions: { ...scanOptions, model: recheckModel || process.env.ANTHROPIC_RECEIPT_RECHECK_MODEL || RECHECK_MODEL_DEFAULT },
        previous: { rawText: first.rawText, message: first.verdict.message },
      });
      rechecked = true;
      if (readScore(second.verdict) < readScore(first.verdict)) best = second;
    } catch (error) {
      // The first read stands; the receipt is marked for a look.
      console.warn("[receipt-scan] second look failed:", error?.message || error);
    }
  }
  const status = best.verdict.ok && best.verdict.checked ? "ok" : "check";
  return { ...best, status, rechecked, ocrUnmatchedLineIds: best.ocrUnmatchedLineIds };
}

async function readOnce(images, { categories, ocrText, ocrRows, scanOptions, previous, R }) {
  const { rawText, model } = await scanDocument({
    items: images,
    prompt: previous
      ? receiptRecheckPrompt(categories, { ocrText, previous, storeHints: R.storeHintsForPrompt() })
      : receiptScanPrompt(categories, { ocrText, storeHints: R.storeHintsForPrompt() }),
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
  let receipt = normalizeReceipt(expandScanReceipt(parseReceiptJson(rawText), categories));
  // Keep only budget categories that exist (the model can invent keys).
  const validKeys = new Set(categories.map((c) => c.key));
  receipt.lineItems = receipt.lineItems.map((line) => ({ ...line, budgetCategory: validKeys.has(line.budgetCategory) ? line.budgetCategory : "" }));
  let ocrUnmatchedLineIds = [];
  if (ocrRows.length) {
    // The phone's digits are exact: take its printed subtotal/tax/total when the
    // AI's don't add up and those do, and mark prices it can't find anywhere.
    receipt = R.applyOcrHeader(receipt, ocrRows);
    const cross = R.crossCheckWithOcr(receipt, ocrRows);
    ocrUnmatchedLineIds = cross.unmatchedLineIds;
    const misses = new Set(ocrUnmatchedLineIds);
    receipt.lineItems = receipt.lineItems.map((line) => (misses.has(line.id) ? { ...line, confidenceScore: Math.min(line.confidenceScore, 0.5) } : line));
  }
  const verdict = R.reconcileReceipt(receipt);
  return { receipt, rawText, model, verdict, ocrUnmatchedLineIds };
}

// Lower is better: a read that adds up beats one that doesn't; otherwise the
// smaller gap wins. A read with nothing printed to check against ranks last.
function readScore(verdict) {
  if (!verdict.checked) return 1e6;
  if (verdict.ok) return 0;
  return 1 + Math.abs(verdict.totalGap || 0) * 2 + Math.abs(verdict.lineGap || 0);
}

const RECEIPT_TIMEOUT_MESSAGE = "This receipt took too long to read. Try again, or crop the photo to just the receipt.";

// The model writes one object per line, and a long grocery receipt runs 30–50
// lines, so every token per line is paid ~40 times. A 2026-10-16 scan of a 30+
// line receipt ran past Netlify's 30 s limit (504). The line shape is therefore
// compact: short keys, defaults left out, no unit price (derived from price ÷ qty
// by the normalizer), and budget categories as a list number instead of the long
// "cat:<groupId>:<categoryId>" key.
//
// 2026-10-26: the model TRANSCRIBES and never does arithmetic. Coupons and fees
// printed among the items are their own lines (k "d" / k "f"), and the summary
// numbers are copied as printed; receipt-reconcile.js does the math. Netting a
// coupon into a price, or deciding whether savings count before or after the
// subtotal, is what made correct receipts read as "doesn't add up".
const COMPACT_LINE = { text: "", name: "", cat: "", price: 0, conf: 0.9 };

function receiptScanInstructions(categories = [], { ocrText = "", storeHints = "" } = {}) {
  const hasBudget = Array.isArray(categories) && categories.length > 0;
  const budget = hasBudget ? [
    "Also give each product line \"b\": the number of the best-fitting household budget category below. Leave \"b\" out when unsure.",
    categories.map((c, i) => `${i + 1} = ${c.name}`).join("\n"),
  ] : [];
  return [
    "Transcribe this purchase receipt exactly as printed (usually groceries, but any store). Do not do any arithmetic: the app checks the math itself.",
    "Return only valid JSON without markdown, on a single line with no spaces between tokens.",
    "Never invent illegible values. Use empty strings or 0 and a lower conf.",
    "lines: every priced line printed between the store header and the SUBTOTAL, top to bottom, one entry per printed price:",
    "- products (leave k out). Never skip a line, even one that repeats the line above: buying two of something prints it twice.",
    "- coupons, instant savings, member, Circle or Prime offers printed among the items: k \"d\", price NEGATIVE, and \"for\" = the index in lines of the product it applies to, when clear. Never net a coupon into a product's price.",
    "- fees, deposits or bags printed among the items: k \"f\".",
    "Leave out payment, change, card, loyalty-balance and \"you saved\" summary lines.",
    "Then copy the summary numbers exactly as printed (0 when not printed): subtotal; discounts = savings printed BELOW the subtotal only (for example RedCard 5%); fees = fees printed below the subtotal only; tax = the tax lines (add them if there are several); total = the amount charged.",
    "Each line: text = the line as printed; name = a clean product name; cat = a short grocery category; price = the amount printed for that line; conf = your confidence from 0 to 1.",
    "Only when they apply, add: qty (when not 1; for weighed items the weight), unit (when not each: lb, oz, kg, or g), k, for.",
    ...(storeHints ? ["Store notes:", storeHints] : []),
    "Use this JSON shape:",
    JSON.stringify({
      storeName: "",
      purchaseDate: "",
      subtotal: 0,
      discounts: 0,
      fees: 0,
      tax: 0,
      total: 0,
      lines: [hasBudget ? { ...COMPACT_LINE, b: 1 } : COMPACT_LINE]
    }),
    ...budget,
    ...(ocrText ? [
      "The phone's own text recognition read the text below from the same receipt. Its digits are reliable, but rows may be split or out of order. Use it to get every price and summary number exactly right:",
      ocrText,
    ] : []),
  ];
}

function receiptScanPrompt(categories = [], options = {}) {
  return receiptScanInstructions(categories, options).join("\n");
}

// The second look: same instructions, plus the first reading and what didn't add up.
function receiptRecheckPrompt(categories = [], { ocrText = "", storeHints = "", previous = {} } = {}) {
  return [
    ...receiptScanInstructions(categories, { ocrText, storeHints }),
    "You read this receipt once already (below), but its numbers don't add up: " + String(previous.message || "the lines, subtotal and total disagree.").slice(0, 400),
    "Look at the receipt again line by line and return the complete corrected JSON in the same shape. Fix only what was misread or missed: a skipped line, a misread price, a coupon or fee left out or put in the wrong place, or a summary number misread.",
    "First reading: " + String(previous.rawText || "").slice(0, 12000),
  ].join("\n");
}

// Compact model output → the receipt record's field names. Also accepts the
// older long shape (lineItems with full names), so earlier raw outputs still parse.
function expandScanReceipt(parsed, categories = []) {
  const src = parsed && typeof parsed === "object" ? parsed : {};
  const lines = Array.isArray(src.lines) ? src.lines : (Array.isArray(src.lineItems) ? src.lineItems : []);
  const { lines: _lines, ...rest } = src;
  const lineItems = lines.map((line) => expandScanLine(line, categories));
  lineItems.forEach((line) => {
    if (!line || line._for === undefined) return;
    const target = lineItems[line._for];
    if (target && target !== line && !line.budgetCategory && target.budgetCategory) line.budgetCategory = target.budgetCategory;
    delete line._for;
  });
  return { ...rest, lineItems };
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
  // Coupons / fees printed among the items (k "d" / "f"): their own lines, so the
  // reconciler can see them. A coupon is always negative and takes the budget
  // category of the product it applies to ("for"), so Finance's split nets it.
  const kind = out.k;
  delete out.k;
  const forIndex = out.for;
  delete out.for;
  if (kind === "d") {
    out.category = "Savings";
    if (typeof out.totalPrice === "number" || out.totalPrice) out.totalPrice = -Math.abs(Number(out.totalPrice) || 0);
    if (Number.isInteger(forIndex) && forIndex >= 0) out._for = forIndex;
  } else if (kind === "f") {
    out.category = "Fee";
  }
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
  readReceipt,
  receiptRecheckPrompt,
  readScore,
  parseReceiptJson,
  receiptScanPrompt,
  expandScanReceipt,
  RECEIPT_TIMEOUT_MESSAGE,
  validateImages
};
