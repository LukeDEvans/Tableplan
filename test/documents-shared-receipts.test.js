// Order screenshots / PDFs shared from other apps (App Group handoff): which receipt
// they belong to, and the outbox taking a PDF and the time they were shared.
import { describe, it, expect } from "vitest";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createReceiptOutbox, sharedReceiptTarget, SHARED_RECEIPT_WAIT_MS } from "../documents/outbox.js";

const NOW = Date.parse("2026-11-12T22:00:00Z");
const receipts = [
  { id: "receipt-share-shr_abc", source: "share", storeName: "Amazon", total: 37.45, purchaseDate: "2026-11-10" },
  { id: "receipt-share-shr_def", source: "share", storeName: "Target", total: 63.22, purchaseDate: "2026-11-11" },
  { id: "receipt-scan-1", source: "scan", storeName: "Aldi", total: 37.45, purchaseDate: "2026-11-10" },
];

describe("sharedReceiptTarget", () => {
  it("uses the id share-receipt answered", () => {
    expect(sharedReceiptTarget({ at: NOW, receipts: [{ id: "shr_def", total: 63.22 }] }, receipts, NOW)).toEqual({ receiptId: "receipt-share-shr_def" });
  });
  it("matches a shared receipt by total and date when there's no id", () => {
    expect(sharedReceiptTarget({ at: NOW, receipts: [{ merchant: "Amazon", date: "2026-11-10", total: 37.45 }] }, receipts, NOW)).toEqual({ receiptId: "receipt-share-shr_abc" });
  });
  it("waits for the receipt to arrive, then files without it after a day", () => {
    const entry = { at: NOW, receipts: [{ merchant: "Costco", date: "2026-11-12", total: 214.18 }] };
    expect(sharedReceiptTarget(entry, receipts, NOW + 60_000)).toBeNull();
    expect(sharedReceiptTarget(entry, receipts, NOW + SHARED_RECEIPT_WAIT_MS + 1)).toEqual({ receiptId: "" });
  });
  it("files at once when share-receipt gave no receipt", () => {
    expect(sharedReceiptTarget({ at: NOW, receipts: [] }, receipts, NOW)).toEqual({ receiptId: "" });
  });
});

describe("outbox: shared files", () => {
  it("keeps a PDF and the time it was shared", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => NOW });
    const key = await box.queue([{ bytes: new Uint8Array([37, 80, 68, 70]), type: "application/pdf" }], { scope: "g1", receiptId: "r1", at: NOW - 3600_000 });
    expect(key).toBeTruthy();
    const entry = await box.get(key);
    expect(entry).toMatchObject({ at: NOW - 3600_000, scope: "g1", receiptId: "r1" });
    expect(entry.pages[0].type).toBe("application/pdf");
  });
  it("ignores a share time in the future", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => NOW });
    const key = await box.queue([{ bytes: new Uint8Array([1, 2]), type: "image/jpeg" }], { scope: "g1", at: NOW + 999 });
    expect((await box.get(key)).at).toBe(NOW);
  });
  it("still refuses other kinds of file", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => NOW });
    expect(await box.queue([{ bytes: new Uint8Array([1]), type: "text/html" }], { scope: "g1" })).toBeNull();
  });
});
