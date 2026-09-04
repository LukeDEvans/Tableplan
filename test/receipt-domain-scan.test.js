import { describe, it, expect } from "vitest";
import { normalizeReceipt } from "../receipt-domain.js";

const baseLine = { rawText: "X", normalizedName: "X", totalPrice: 1 };

describe("normalizeReceipt — source image preservation (imageRefs)", () => {
  it("normalizes object + bare-string refs and drops junk", () => {
    const r = normalizeReceipt({
      storeName: "Store", purchaseDate: "2026-09-01", lineItems: [baseLine],
      imageRefs: [
        { index: 0, hash: "abc", size: 1234, mimeType: "image/jpeg", cloud: { bucket: "reading-content", path: "u/abc" } },
        "def",              // bare-hash string form → index inferred
        { nonsense: true },  // no hash/cloud → dropped
      ],
    });
    expect(r.imageRefs.length).toBe(2);
    expect(r.imageRefs[0]).toMatchObject({ index: 0, hash: "abc", size: 1234, mimeType: "image/jpeg", cloud: { bucket: "reading-content", path: "u/abc" } });
    expect(r.imageRefs[1]).toMatchObject({ index: 1, hash: "def", cloud: null });
  });
  it("defaults missing imageRefs to []", () => {
    expect(normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", lineItems: [baseLine] }).imageRefs).toEqual([]);
  });
});

describe("normalizeReceipt — extraction record (independent of interpretation)", () => {
  it("normalizes engine/model/rawOutput/status and clamps confidence", () => {
    const r = normalizeReceipt({
      storeName: "S", purchaseDate: "2026-09-01", lineItems: [baseLine],
      extraction: { engine: "claude-vision", model: "claude-haiku-4-5", kind: "receipt", rawOutput: '{"x":1}', extractedAt: "2026-09-03T00:00:00Z", status: "ok", confidence: 5 },
    });
    expect(r.extraction).toMatchObject({ engine: "claude-vision", model: "claude-haiku-4-5", kind: "receipt", status: "ok" });
    expect(r.extraction.rawOutput).toBe('{"x":1}');
    expect(r.extraction.confidence).toBe(1); // clamped
  });
  it("defaults missing extraction to null; kind defaults to receipt", () => {
    expect(normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", lineItems: [baseLine] }).extraction).toBeNull();
    expect(normalizeReceipt({ storeName: "S", purchaseDate: "2026-09-01", lineItems: [baseLine], extraction: { engine: "x" } }).extraction.kind).toBe("receipt");
  });
});

describe("corrections stay non-destructive (task requirement)", () => {
  it("a user-corrected price/name keeps the original rawText + userCorrected flag", () => {
    const r = normalizeReceipt({
      storeName: "S", purchaseDate: "2026-09-01",
      lineItems: [{ rawText: "ORGANIC BANANAS 2.49", normalizedName: "Organic Bananas", totalPrice: 2.79, userCorrected: true }],
    });
    expect(r.lineItems[0].rawText).toBe("ORGANIC BANANAS 2.49"); // source retained
    expect(r.lineItems[0].totalPrice).toBe(2.79);                // corrected value
    expect(r.lineItems[0].userCorrected).toBe(true);             // marked as human-edited
  });
});
