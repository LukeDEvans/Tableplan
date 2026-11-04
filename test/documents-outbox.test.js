// The receipts outbox (documents/outbox.js): bounded queue, names from the receipt
// read, JPEG pages → one PDF with a correct cross-reference table, filing that
// keeps an entry until it's stored.

import { describe, it, expect } from "vitest";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import {
  createReceiptOutbox, receiptLabel, jpegSize, jpegsToPdf, receiptDocuments, fileReceipts,
  OUTBOX_MAX, OUTBOX_MAX_AGE_DAYS,
} from "../documents/outbox.js";

// A minimal JPEG: SOI, an APP0 segment, a baseline frame header (SOF0) and EOI.
function fakeJpeg(width, height, comps = 3, pad = 0) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 8 + comps * 3, 8, height >> 8, height & 255, width >> 8, width & 255, comps, ...Array(comps * 3).fill(1)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...Array(pad).fill(0), 0xff, 0xd9]);
}

const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("JPEG pages → PDF", () => {
  it("reads a JPEG's size from its frame header", () => {
    expect(jpegSize(fakeJpeg(1200, 1600))).toEqual({ width: 1200, height: 1600, comps: 3 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(null);
  });

  it("builds a PDF whose cross-reference table points at every object", () => {
    const pdf = jpegsToPdf([fakeJpeg(800, 1000), fakeJpeg(800, 1100, 1), fakeJpeg(600, 900)]);
    const text = latin1(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 3");
    expect((text.match(/\/Type \/Page /g) || []).length).toBe(3);
    expect(text).toContain("/ColorSpace /DeviceGray"); // the one-channel page
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const rows = text.slice(startxref).split("\n").slice(3).filter((l) => / 00000 n $/.test(l));
    expect(rows.length).toBe(2 + 3 * 3);
    rows.forEach((row, i) => expect(text.slice(Number(row.slice(0, 10)), Number(row.slice(0, 10)) + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // Each image stream is exactly the JPEG's bytes.
    expect(text).toContain(`/Filter /DCTDecode /Length ${fakeJpeg(800, 1000).length}`);
    expect(pdf.subarray(9, 15)).toEqual(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  });

  it("several JPEG pages become one PDF; other kinds stay one document per page", () => {
    const jpg = { bytes: fakeJpeg(10, 10), type: "image/jpeg" };
    const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), type: "image/png" };
    expect(receiptDocuments({ pages: [jpg, jpg] })).toMatchObject([{ mime: "application/pdf", pages: 2 }]);
    expect(receiptDocuments({ pages: [jpg] })).toMatchObject([{ mime: "image/jpeg", pages: 1 }]);
    expect(receiptDocuments({ pages: [jpg, png] }).map((d) => d.mime)).toEqual(["image/jpeg", "image/png"]);
  });
});

describe("names", () => {
  const at = Date.parse("2026-11-03T18:00:00Z");
  const receipts = [
    { storeName: "Costco", purchaseDate: "2026-11-02", createdAt: "2026-11-03T18:01:10Z", source: "scan" },
    { storeName: "Amazon", purchaseDate: "2026-11-03", createdAt: "2026-11-03T18:00:30Z", source: "email" },
    { storeName: "Aldi", purchaseDate: "2026-10-01", createdAt: "2026-10-01T10:00:00Z", source: "scan" },
  ];
  it("takes the store and date from the scan read right after it", () => {
    expect(receiptLabel(at, receipts)).toEqual({ name: "Costco · 2026-11-02", documentDate: "2026-11-02" });
  });
  it("falls back to 'Receipt · <date>' (never an emailed receipt, never one from another day)", () => {
    expect(receiptLabel(at, receipts.slice(1)).name).toMatch(/^Receipt · 2026-11-0[34]$/);
  });
});

describe("the outbox", () => {
  const page = (n = 1000) => ({ bytes: new Uint8Array(n).fill(7), type: "image/jpeg" });

  it("keeps entries in order and only images", async () => {
    let clock = 1000;
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => clock });
    expect(await box.queue([{ bytes: new Uint8Array([1]), type: "text/html" }])).toBe(null);
    await box.queue([page()]); clock += 10;
    await box.queue([page(), page()]);
    const list = await box.entries();
    expect(list.map((e) => e.pages.length)).toEqual([1, 2]);
  });

  it("is bounded: at most OUTBOX_MAX entries, nothing older than the age limit", async () => {
    let clock = Date.parse("2026-01-01T00:00:00Z");
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => clock });
    for (let i = 0; i < OUTBOX_MAX + 5; i++) { await box.queue([page(10)]); clock += 1000; }
    expect((await box.entries()).length).toBe(OUTBOX_MAX);
    clock += (OUTBOX_MAX_AGE_DAYS + 1) * 24 * 3600 * 1000;
    await box.queue([page(10)]);
    expect((await box.entries()).length).toBe(1);
  });

  it("files each receipt into the folder and removes it only once stored", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()));
    await box.queue([{ bytes: fakeJpeg(10, 10), type: "image/jpeg" }, { bytes: fakeJpeg(10, 12), type: "image/jpeg" }]);
    await box.queue([{ bytes: fakeJpeg(10, 10), type: "image/jpeg" }]);
    const added = [];
    let failNext = true;
    const library = {
      async addFile(scope, args) {
        if (failNext) { failNext = false; throw new Error("network"); }
        added.push({ scope, ...args });
        return "id";
      },
    };
    await expect(fileReceipts({ outbox: box, library, scope: "g", folderId: "rf" })).rejects.toThrow("network");
    expect((await box.entries()).length).toBe(2); // nothing lost
    expect(await fileReceipts({ outbox: box, library, scope: "g", folderId: "rf" })).toBe(2);
    expect((await box.entries()).length).toBe(0);
    expect(added.map((a) => [a.folderId, a.meta.mime, a.meta.pages])).toEqual([["rf", "application/pdf", 2], ["rf", "image/jpeg", 1]]);
    expect(added[0].meta.name).toMatch(/^Receipt · \d{4}-\d{2}-\d{2}$/);
    expect(added[0].meta.tags).toEqual(["receipt"]);
  });
});
