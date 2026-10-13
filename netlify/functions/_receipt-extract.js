// Receipt extraction helpers shared by simplefin (scanReceipt / importReceipt)
// and share-receipt (screenshots from the iPhone share sheet). Moved here
// unchanged from simplefin.js; the multi-order helpers below are new.
function receiptPrompt(sourceKind, categories) {
  return [
    `You extract itemized purchase receipts from ${sourceKind} for a household budget app.`,
    'Reply with ONLY valid JSON, no markdown: {"receipt": {...}} or {"receipt": null} if no readable receipt.',
    'Receipt shape: {"merchant": "...", "date": "YYYY-MM-DD", "total": 12.34, "items": [{"name": "...", "price": 1.23, "category": "<key>" or null}]}',
    "total = the final amount charged (after tax and discounts).",
    "Assign each item the best-fitting budget category key from this list; use null when unsure:",
    categories.map((c) => `${c.key} = ${c.name}`).join("\n")
  ].join("\n");
}

async function modelText(aiResponse) {
  const data = await aiResponse.json().catch(() => null);
  return data?.content?.map((c) => c.text || "").join("") || "";
}

// Parses the model reply and normalizes into { merchant, date, total, items,
// portions } — per-category item sums plus one unlabeled remainder portion
// (tax/shipping/uncertain items) so portions always cover the total.
function receiptFromModel(text, categories) {
  const jm = String(text || "").match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = jm ? JSON.parse(jm[0]) : null; } catch { return null; }
  const r = parsed?.receipt;
  if (!r || !Number(r.total)) return null;
  const validKeys = new Set(categories.map((c) => c.key));
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 80).map((it) => ({
    name: String(it.name || "").slice(0, 80),
    price: Math.round((Number(it.price) || 0) * 100) / 100,
    category: validKeys.has(it.category) ? it.category : ""
  }));
  const byCat = {};
  let assigned = 0;
  for (const it of items) {
    if (!it.category || !it.price) continue;
    byCat[it.category] = Math.round(((byCat[it.category] || 0) + it.price) * 100) / 100;
    assigned += it.price;
  }
  const portions = Object.entries(byCat).map(([label, amount]) => ({ label, amount }));
  const remainder = Math.round((Number(r.total) - assigned) * 100) / 100;
  if (remainder > 0.02) portions.push({ label: "", amount: remainder });
  return {
    merchant: String(r.merchant || "").slice(0, 60),
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "",
    total: Math.round(Number(r.total) * 100) / 100,
    items,
    portions,
    at: new Date().toISOString()
  };
}

// Stable id from merchant+date+total, so re-importing the same receipt
// replaces it instead of adding a duplicate.
function receiptFingerprint(receipt) {
  let h = 0;
  const fp = `${receipt.merchant}|${receipt.date}|${receipt.total}`;
  for (let i = 0; i < fp.length; i++) h = (h * 31 + fp.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function saveImportedReceipt(serviceKey, groupId, receipt) {
  const { updateRawRow } = require("./_state-sections.js");
  await updateRawRow(serviceKey, `finreceipts_${groupId}`, (s) => {
    const existing = s.receipts || [];
    return { receipts: [receipt, ...existing.filter((r) => r.id !== receipt.id)].slice(0, 40) };
  });
}

// Order screenshots (Amazon order details / "Your Orders", other stores'
// purchase history) can show several orders at once, so this prompt asks for
// a list — one entry per order.
function orderScreenshotPrompt(categories) {
  return [
    "You extract purchases from screenshots of online order pages (Amazon order details, \"Your Orders\" lists, other stores' order history) for a household budget app.",
    "The screenshots belong together (one long page captured in several shots). Each distinct order becomes one entry.",
    'Reply with ONLY valid JSON, no markdown: {"receipts": [...]} — an empty list if no order is readable.',
    'Entry shape: {"merchant": "...", "date": "YYYY-MM-DD", "total": 12.34, "items": [{"name": "...", "price": 1.23, "category": "<key>" or null}]}',
    "merchant = the store (\"Amazon\" for Amazon, even for third-party sellers).",
    "date = the date the order was placed. Use the year shown; if no year is shown, assume the most recent past date.",
    "total = the order's grand total charged (after tax, shipping and discounts). Skip an order whose total is not visible.",
    "price = the item's line price (price × quantity) when shown; use null when the page shows no price for that item. Shorten long product titles to a few clear words.",
    "Assign each item the best-fitting budget category key from this list; use null when unsure:",
    categories.map((c) => `${c.key} = ${c.name}`).join("\n")
  ].join("\n");
}

// Parses {"receipts": [...]} (or a single {"receipt": ...}) into normalized
// receipts, dropping entries without a total.
function receiptsFromModel(text, categories) {
  const jm = String(text || "").match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = jm ? JSON.parse(jm[0]) : null; } catch { return []; }
  const list = Array.isArray(parsed?.receipts) ? parsed.receipts : (parsed?.receipt ? [parsed.receipt] : []);
  return list.slice(0, 10)
    .map((r) => receiptFromModel(JSON.stringify({ receipt: r }), categories))
    .filter(Boolean);
}

module.exports = { receiptPrompt, modelText, receiptFromModel, receiptFingerprint, saveImportedReceipt, orderScreenshotPrompt, receiptsFromModel };
