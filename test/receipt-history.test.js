const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeReceipt,
  applyReceiptMappings,
  correctedMappingsFromReceipt,
  priceHistoryFromReceipt,
  estimateFromHistory,
  estimateGroceryListFromHistory
} = require("../receipt-domain");
const { parseReceiptJson, validateImages } = require("../receipt-scan");

let id = 0;
const createId = (prefix) => `${prefix}-${++id}`;

test("receipt upload accepts image data and rejects unsupported input", () => {
  assert.equal(validateImages(["data:image/jpeg;base64,abc"]).length, 1);
  assert.throws(() => validateImages([]), /At least one/);
  assert.throws(() => validateImages(["data:text/plain;base64,abc"]), /must be PNG/);
});

test("OCR parsing handles a JSON result embedded in response text", () => {
  const parsed = parseReceiptJson(`result: {"storeName":"ALDI","purchaseDate":"2026-06-05","lineItems":[{"rawText":"BANANAS 1.29","normalizedName":"Bananas","totalPrice":1.29}]}`);
  assert.equal(parsed.storeName, "ALDI");
  assert.equal(parsed.lineItems[0].totalPrice, 1.29);
});

test("user corrections become reusable mappings", () => {
  const receipt = normalizeReceipt({
    storeName: "Target",
    purchaseDate: "2026-06-05",
    lineItems: [{
      rawText: "ORG BNNA 4011",
      normalizedName: "Bananas",
      category: "Produce",
      totalPrice: 1.5,
      userCorrected: true
    }]
  }, createId);
  const mappings = correctedMappingsFromReceipt(receipt);
  const next = normalizeReceipt({
    storeName: "Target",
    purchaseDate: "2026-06-06",
    lineItems: [{ rawText: "ORG BNNA 4011", normalizedName: "ORG BNNA", totalPrice: 1.6 }]
  }, createId);
  const corrected = applyReceiptMappings(next, mappings);
  assert.equal(corrected.lineItems[0].normalizedName, "Bananas");
  assert.equal(corrected.lineItems[0].category, "Produce");
});

test("saving a corrected receipt creates price history records", () => {
  const receipt = normalizeReceipt({
    storeName: "Whole Foods",
    storeId: "whole-foods",
    purchaseDate: "2026-06-05",
    lineItems: [{
      rawText: "APPLE 2LB",
      normalizedName: "Apples",
      category: "Produce",
      quantity: 2,
      unit: "lb",
      totalPrice: 5,
      unitPrice: 2.5,
      userCorrected: true
    }]
  }, createId);
  const history = priceHistoryFromReceipt(receipt, createId);
  assert.equal(history.length, 1);
  assert.equal(history[0].unitPrice, 2.5);
  assert.equal(history[0].source, "receipt");
  assert.equal(history[0].confidenceScore, 1);
});

test("price history lookup returns the newest matching store observation", () => {
  const history = [
    { storeId: "aldi", normalizedItemName: "Milk", packagePrice: 2.99, observedAt: "2026-05-01" },
    { storeId: "aldi", normalizedItemName: "Milk", packagePrice: 3.19, observedAt: "2026-06-01" },
    { storeId: "target", normalizedItemName: "Milk", packagePrice: 3.09, observedAt: "2026-06-02" }
  ];
  assert.equal(estimateFromHistory(history, "milk", "aldi", 1000).packagePrice, 3.19);
});

test("grocery list estimates ignore stores without receipt history", () => {
  const history = [
    { storeId: "aldi", normalizedItemName: "Apples", packagePrice: 3, observedAt: "2026-06-01" },
    { storeId: "target", normalizedItemName: "Apples", packagePrice: 4, observedAt: "2026-06-02" }
  ];
  const result = estimateGroceryListFromHistory(
    [{ name: "Apples" }, { name: "Bananas" }],
    history,
    ["aldi", "target", "costco"]
  );
  assert.equal(result[0].bestEstimate.storeId, "aldi");
  assert.equal(result[0].estimates.some((entry) => entry.storeId === "costco"), false);
  assert.equal(result[1].bestEstimate, null);
});
