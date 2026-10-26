import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { readReceipt, expandScanReceipt, receiptScanPrompt, receiptRecheckPrompt, readScore } = require("../receipt-scan.js");

const IMG = "data:image/jpeg;base64,AAAA";
const CATS = [{ key: "cat:g1:groc", name: "Food · Groceries" }];

// Each call returns the next reply; records which model and prompt were used.
function mockReplies(...replies) {
  const calls = [];
  const fn = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ model: body.model, prompt: body.messages[0].content[0].text });
    const text = JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const goodCostco = {
  storeName: "Costco", purchaseDate: "2026-10-23", subtotal: 13.4, discounts: 0, fees: 0, tax: 0.5, total: 13.9,
  lines: [
    { text: "KS EGGS", name: "Eggs", price: 8, b: 1 },
    { text: "/1234567", k: "d", price: 2, for: 0 },
    { text: "BREAD", name: "Bread", price: 7.4, b: 1 },
  ],
};
// The first read misses the bread line ($7.40 short).
const shortCostco = { ...goodCostco, lines: goodCostco.lines.slice(0, 2) };

afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

describe("the read prompt", () => {
  it("asks for a transcription, not arithmetic, with coupons and fees as their own lines", () => {
    const p = receiptScanPrompt(CATS, { storeHints: "Costco: …" });
    expect(p).toMatch(/Do not do any arithmetic/);
    expect(p).toMatch(/k \\?"d\\?", price NEGATIVE/);
    expect(p).toMatch(/BELOW the subtotal only/);
    expect(p).toContain("Store notes:\nCostco: …");
    expect(p).not.toContain("text recognition");
  });

  it("includes the phone's text when there is some", () => {
    expect(receiptScanPrompt([], { ocrText: "BANANAS  0.59" })).toMatch(/text recognition[\s\S]*BANANAS {2}0\.59$/);
  });

  it("the second look carries the first reading and what didn't add up", () => {
    const p = receiptRecheckPrompt([], { previous: { rawText: "{\"total\":1}", message: "The items come to $6.00, $7.40 less" } });
    expect(p).toMatch(/don't add up: The items come to \$6\.00/);
    expect(p).toMatch(/First reading: \{"total":1\}$/);
  });
});

describe("expandScanReceipt — coupons and fees", () => {
  it("a coupon line is negative, marked Savings, and takes its product's budget category", () => {
    const r = expandScanReceipt(goodCostco, CATS);
    expect(r.lineItems[1]).toMatchObject({ rawText: "/1234567", totalPrice: -2, category: "Savings", budgetCategory: "cat:g1:groc" });
    expect(r.lineItems[1]._for).toBeUndefined();
    expect(r.lineItems[1].k).toBeUndefined();
  });

  it("a fee line is marked Fee", () => {
    const r = expandScanReceipt({ lines: [{ text: "BAG FEE", k: "f", price: 0.05 }] });
    expect(r.lineItems[0]).toMatchObject({ category: "Fee", totalPrice: 0.05 });
  });
});

describe("readReceipt — reconcile, then a second look only when needed", () => {
  it("a read that adds up is kept as is (one call, status ok)", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const calls = mockReplies(goodCostco);
    const r = await readReceipt([IMG], { categories: CATS, recheck: true });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("ok");
    expect(r.rechecked).toBe(false);
  });

  it("a read that doesn't add up gets a second look with the stronger model, kept when better", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const calls = mockReplies(shortCostco, goodCostco);
    const r = await readReceipt([IMG], { categories: CATS, recheck: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].model).toBe("claude-sonnet-4-6");
    expect(calls[1].prompt).toMatch(/\$7\.40 less/);
    expect(r.rechecked).toBe(true);
    expect(r.status).toBe("ok");
    expect(r.receipt.lineItems).toHaveLength(3);
  });

  it("a worse second look is ignored; the receipt is marked for a look", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    mockReplies(shortCostco, { ...goodCostco, total: 99, lines: [] });
    const r = await readReceipt([IMG], { categories: CATS, recheck: true });
    expect(r.status).toBe("check");
    expect(r.receipt.lineItems).toHaveLength(2);
  });

  it("no second look on the synchronous path", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const calls = mockReplies(shortCostco, goodCostco);
    const r = await readReceipt([IMG], { categories: CATS, recheck: false });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("check");
  });

  it("the phone's printed total fixes a misread total; unfound prices are marked low-confidence", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    mockReplies({ ...goodCostco, total: 18.9 });
    const ocrPages = [["KS EGGS  8.00", "/1234567  2.00-", "SUBTOTAL  13.40", "TAX  0.50", "TOTAL  13.90"]];
    const r = await readReceipt([IMG], { categories: CATS, ocrPages });
    expect(r.receipt.total).toBe(13.9);
    expect(r.status).toBe("ok");
    const bread = r.receipt.lineItems.find((l) => l.rawText === "BREAD");
    expect(r.ocrUnmatchedLineIds).toEqual([bread.id]);
    expect(bread.confidenceScore).toBe(0.5);
  });

  it("readScore orders reads: adds up < smaller gap < nothing to check", () => {
    expect(readScore({ checked: true, ok: true })).toBe(0);
    expect(readScore({ checked: true, ok: false, totalGap: 0, lineGap: 1 })).toBeLessThan(readScore({ checked: true, ok: false, totalGap: 0, lineGap: 5 }));
    expect(readScore({ checked: false, ok: true })).toBeGreaterThan(100);
  });
});
