import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { scanReceiptFromImages, expandScanReceipt, receiptScanPrompt, RECEIPT_TIMEOUT_MESSAGE } = require("../receipt-scan.js");
const { scanDocument } = require("../document-scan.js");

// 2026-10-16: a 30+ line receipt ran past Netlify's 30 s limit (bare 504). The
// scan now asks for a compact line shape and stops waiting before the limit.
const IMG = "data:image/jpeg;base64,AAAA";
const CATS = [
  { key: "cat:g1:groc", name: "Food · Groceries" },
  { key: "cat:g1:home", name: "Home · Supplies" },
];

function mockAnthropic(text) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("compact receipt lines", () => {
  it("prompt asks for short keys and no unit price", () => {
    const p = receiptScanPrompt(CATS);
    expect(p).toContain('"lines"');
    expect(p).not.toContain("unitPrice");
    expect(p).not.toContain("normalizedName");
    expect(p).toContain("2 = Home · Supplies");
  });

  it("expands short keys, defaults and budget numbers into the record's fields", () => {
    const r = expandScanReceipt({
      storeName: "Aldi", total: 9,
      lines: [
        { text: "BANANAS", name: "Bananas", cat: "produce", qty: 2.1, unit: "lb", price: 1.2, conf: 0.95, b: 1 },
        { text: "PPR TWL", name: "Paper towels", price: 5, conf: 0.8, disc: 1, b: 2 },
        { text: "MYSTERY", name: "?", price: 2, conf: 0.4, b: 9 },
      ],
    }, CATS);
    expect(r.lines).toBeUndefined();
    expect(r.lineItems[0]).toEqual({ rawText: "BANANAS", normalizedName: "Bananas", category: "produce", quantity: 2.1, unit: "lb", totalPrice: 1.2, confidenceScore: 0.95, budgetCategory: "cat:g1:groc" });
    expect(r.lineItems[1]).toMatchObject({ discountAmount: 1, budgetCategory: "cat:g1:home" });
    expect(r.lineItems[1].quantity).toBeUndefined();
    expect(r.lineItems[2].budgetCategory).toBe(""); // out-of-range number
  });

  it("still reads the older long shape", () => {
    const r = expandScanReceipt({ lineItems: [{ rawText: "MILK", normalizedName: "Milk", totalPrice: 3, budgetCategory: "cat:g1:groc" }] }, CATS);
    expect(r.lineItems[0]).toEqual({ rawText: "MILK", normalizedName: "Milk", totalPrice: 3, budgetCategory: "cat:g1:groc" });
  });

  it("end to end: compact reply → normalized receipt with derived unit price", async () => {
    vi.stubGlobal("fetch", mockAnthropic(JSON.stringify({
      storeName: "Aldi", purchaseDate: "2026-10-16", total: 6.2,
      lines: [
        { text: "BANANAS", name: "Bananas", cat: "produce", qty: 2, unit: "lb", price: 1.2, conf: 0.95, b: 1 },
        { text: "PPR TWL", name: "Paper towels", price: 5, conf: 0.8, b: 2 },
      ],
    })));
    const { receipt } = await scanReceiptFromImages([IMG], { categories: CATS, apiKey: "k" });
    expect(receipt.lineItems).toHaveLength(2);
    const [a, b] = receipt.lineItems;
    expect([a.rawText, a.normalizedName, a.quantity, a.unit, a.totalPrice, a.unitPrice, a.budgetCategory])
      .toEqual(["BANANAS", "Bananas", 2, "lb", 1.2, 0.6, "cat:g1:groc"]);
    expect([b.quantity, b.unit, b.unitPrice, b.discountAmount, b.budgetCategory]).toEqual([1, "each", 5, 0, "cat:g1:home"]);
  });
});

describe("scan deadline", () => {
  it("aborts the AI call at timeoutMs with a clear message", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const err = await scanReceiptFromImages([IMG], { apiKey: "k", timeoutMs: 20 }).catch((e) => e);
    expect(err.code).toBe("SCAN_TIMEOUT");
    expect(err.message).toBe(RECEIPT_TIMEOUT_MESSAGE);
  });

  it("without timeoutMs there is no abort signal (other scanners unchanged)", async () => {
    const fetchMock = mockAnthropic("{}");
    vi.stubGlobal("fetch", fetchMock);
    await scanDocument({ items: [IMG], prompt: "x", options: { apiKey: "k" } });
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });

  it("other errors pass through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const err = await scanDocument({ items: [IMG], prompt: "x", options: { apiKey: "k", timeoutMs: 5000 } }).catch((e) => e);
    expect(err.message).toBe("network down");
    expect(err.code).toBeUndefined();
  });
});
