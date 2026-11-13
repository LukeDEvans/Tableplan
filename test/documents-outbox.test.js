// The receipts outbox (documents/outbox.js): bounded queue, names from the receipt
// read, JPEG pages → one PDF with a correct cross-reference table, filing that
// keeps an entry until it's stored.

import { describe, it, expect } from "vitest";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createReceiptOutbox, receiptLabel, jpegSize, jpegsToPdf, receiptDocuments, fileReceipts,
  OUTBOX_MAX, OUTBOX_MAX_AGE_DAYS, OUTBOX_MAX_ATTEMPTS, OUTBOX_DB,
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

  it("camera JPEG pages become one PDF; photos (which may carry a rotation tag) and other kinds stay one document per page", () => {
    const jpg = { bytes: fakeJpeg(10, 10), type: "image/jpeg" };
    const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), type: "image/png" };
    expect(receiptDocuments({ camera: true, pages: [jpg, jpg] })).toMatchObject([{ mime: "application/pdf", pages: 2 }]);
    expect(receiptDocuments({ camera: false, pages: [jpg, jpg] }).map((d) => d.mime)).toEqual(["image/jpeg", "image/jpeg"]);
    expect(receiptDocuments({ camera: true, pages: [jpg] })).toMatchObject([{ mime: "image/jpeg", pages: 1 }]);
    expect(receiptDocuments({ camera: true, pages: [jpg, png] }).map((d) => d.mime)).toEqual(["image/jpeg", "image/png"]);
  });
});

describe("names", () => {
  const at = Date.parse("2026-11-03T18:00:00Z");
  const receipts = [
    { id: "c", storeName: "Costco", purchaseDate: "2026-11-02", createdAt: "2026-11-03T18:01:10Z", source: "scan" },
    { id: "a", storeName: "Amazon", purchaseDate: "2026-11-03", createdAt: "2026-11-03T18:00:30Z", source: "email" },
    { id: "l", storeName: "Aldi", purchaseDate: "2026-10-01", createdAt: "2026-10-01T10:00:00Z", source: "scan" },
    { id: "t", storeName: "Target", purchaseDate: "2026-11-03", createdAt: "2026-11-03T17:55:00Z", source: "scan" },
  ];
  it("takes the store and date from the scan read right after it (not one saved before)", () => {
    expect(receiptLabel(at, receipts)).toEqual({ receiptId: "c", name: "Costco · 2026-11-02", documentDate: "2026-11-02" });
  });
  it("a scan that knows its receipt uses that one, never a neighbour in time", () => {
    // Target was saved before the scan and would never be picked by time.
    expect(receiptLabel(at, receipts, new Set(), "t")).toEqual({ receiptId: "t", name: "Target · 2026-11-03", documentDate: "2026-11-03" });
    // The read hasn't come back yet: keep the id, name it by date, don't borrow Costco.
    const waiting = receiptLabel(at, receipts, new Set(), "not-read-yet");
    expect(waiting.receiptId).toBe("not-read-yet");
    expect(waiting.name).toMatch(/^Receipt · /);
  });
  it("a read names only one receipt in a run", () => {
    const used = new Set();
    expect(receiptLabel(at, receipts, used).name).toBe("Costco · 2026-11-02");
    expect(receiptLabel(at + 1000, receipts, used).name).toMatch(/^Receipt · /);
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
    expect(await box.queue([{ bytes: new Uint8Array([1]), type: "text/html" }], { scope: "g" })).toBe(null);
    expect(await box.queue([page()])).toBe(null); // no household: nothing kept
    await box.queue([page()], { scope: "g" }); clock += 10;
    await box.queue([page(), { ...page(), type: "image/jpg" }], { scope: "g" });
    const list = await box.entries();
    expect(list.map((e) => e.pages.length)).toEqual([1, 2]);
    expect(list[1].pages[1].type).toBe("image/jpeg");
  });

  it("is bounded: at most OUTBOX_MAX entries, nothing older than the age limit", async () => {
    let clock = Date.parse("2026-01-01T00:00:00Z");
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => clock });
    for (let i = 0; i < OUTBOX_MAX + 5; i++) { await box.queue([page(10)], { scope: "g" }); clock += 1000; }
    expect((await box.entries()).length).toBe(OUTBOX_MAX);
    clock += (OUTBOX_MAX_AGE_DAYS + 1) * 24 * 3600 * 1000;
    await box.queue([page(10)], { scope: "g" });
    expect((await box.entries()).length).toBe(1);
  });

  // A library stand-in that stores by id (like the real one) and can fail on demand.
  function fakeLibrary() {
    const stored = new Map();
    const lib = {
      stored, failIf: () => false, failOnce: 0,
      async has(scope, id) { return stored.has(`${scope}/${id}`); },
      async addFile(scope, args) {
        if (lib.failOnce > 0) { lib.failOnce--; throw new Error("network"); }
        if (lib.failIf(args)) throw new Error("too large");
        if (stored.has(`${scope}/${args.id}`)) throw new Error("duplicate key"); // as the table's primary key does
        stored.set(`${scope}/${args.id}`, args);
        return args.id;
      },
    };
    return lib;
  }
  const jpg = (w, h) => ({ bytes: fakeJpeg(w, h), type: "image/jpeg" });
  let n = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  it("files each receipt into the folder of ITS household, and removes it only once stored", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()));
    await box.queue([jpg(10, 10), jpg(10, 12)], { scope: "g", camera: true });
    await box.queue([jpg(10, 10)], { scope: "g" });
    await box.queue([jpg(10, 10)], { scope: "other-household" });
    const lib = fakeLibrary();
    lib.failOnce = 1;
    expect(await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids })).toEqual({ filed: 1, failed: 1, dropped: 0 });
    expect((await box.entries()).length).toBe(2); // the failed one waits; the other household's is untouched
    expect(await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids })).toEqual({ filed: 1, failed: 0, dropped: 0 });
    expect((await box.entries()).map((e) => e.scope)).toEqual(["other-household"]);
    const added = [...lib.stored.values()];
    expect(added.map((a) => [a.folderId, a.meta.mime, a.meta.pages])).toEqual([["rf", "image/jpeg", 1], ["rf", "application/pdf", 2]]);
    expect(added[0].meta.tags).toEqual(["receipt"]);
  });

  it("a filed receipt points at its receipt record", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()));
    await box.queue([jpg(10, 10)], { scope: "g", receiptId: "receipt-1" });
    await box.queue([jpg(10, 10)], { scope: "g" });
    const lib = fakeLibrary();
    await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids });
    expect([...lib.stored.values()].map((a) => a.source)).toEqual([{ receiptId: "receipt-1" }, null]);
  });

  it("a run after a crash between storing and removing files nothing twice", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()));
    await box.queue([jpg(10, 10)], { scope: "g" });
    const lib = fakeLibrary();
    const realRemove = box.remove;
    box.remove = async () => { throw new Error("crash"); }; // stored, then the app died
    await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids });
    box.remove = realRemove;
    expect(lib.stored.size).toBe(1);
    await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids });
    expect(lib.stored.size).toBe(1);
    expect((await box.entries()).length).toBe(0);
  });

  it("two runs at once (two tabs) file each receipt once", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()));
    for (let i = 0; i < 3; i++) await box.queue([jpg(10, 10)], { scope: "g" });
    const lib = fakeLibrary();
    let chain = Promise.resolve();
    const lock = (fn) => (chain = chain.then(fn, fn)); // what Web Locks does in the app
    await Promise.all([
      fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", lock, newId: ids }),
      fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", lock, newId: ids }),
    ]);
    expect(lib.stored.size).toBe(3);
  });

  it("one receipt that keeps failing doesn't block the others, and is dropped after the attempt limit", async () => {
    let clock = 1000;
    const box = createReceiptOutbox(createKeystore(memoryBackend()), { now: () => (clock += 1000) });
    const bad = fakeJpeg(10, 10, 3, 50); // a different size marks the one that always fails
    await box.queue([{ bytes: bad, type: "image/jpeg" }], { scope: "g" });
    await box.queue([jpg(10, 10)], { scope: "g" });
    const lib = fakeLibrary();
    lib.failIf = (args) => args.content.length === bad.length;
    expect(await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids })).toMatchObject({ filed: 1, failed: 1 });
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) await fileReceipts({ outbox: box, library: lib, scope: "g", folderId: "rf", newId: ids });
    expect((await box.entries()).length).toBe(0);
  });

  it("pages Documents can't keep are dropped and reported, never counted as filed", async () => {
    const box = createReceiptOutbox(createKeystore(memoryBackend()));
    await box.queue([{ bytes: new Uint8Array([1, 2, 3]), type: "image/tiff" }], { scope: "g" });
    const out = await fileReceipts({ outbox: box, library: fakeLibrary(), scope: "g", folderId: "rf", mimeOk: (m) => m !== "image/tiff", newId: ids });
    expect(out).toEqual({ filed: 0, failed: 0, dropped: 1 });
    expect((await box.entries()).length).toBe(0);
  });
});

describe("the app's side (app.js)", () => {
  const app = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  it("the header scanner queues every scan with its household, and the camera's as camera pages", () => {
    const fn = app.slice(app.indexOf("function scanReceiptFromHeader("), app.indexOf("let receiptOutboxPromise"));
    expect(fn).toMatch(/const receiptId = openReceiptScanWithFiles\(images, scanOptions\);\s+queueReceiptForDocuments\(images, \{ camera, receiptId \}\)/);
    expect(app).toMatch(/scanReceiptFromHeader\(scannedPagesToFiles\(result\?\.pages\), \{[^}]*camera: true \}\)/);
    expect(app).toMatch(/\.queue\(pages, \{ scope, camera, receiptId, at \}\)/);
  });
  it("sign-out deletes the outbox", () => {
    expect(app).toContain(`deleteMessagingStore("${OUTBOX_DB}")`);
  });
});
