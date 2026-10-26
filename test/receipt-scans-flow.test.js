import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import {
  emptyQueue, parseQueue, addToQueue, updateInQueue, itemsToResend, awaitingResults,
  applyScanResults, receiptFromScanResult, resultsToast, SENT_TIMEOUT_MS, UPLOAD_STALE_MS,
} from "../receipt-scan-queue.js";
import { ACCOUNT_SCOPED_STORAGE_KEYS } from "../auth-account-reset.js";

const require = createRequire(import.meta.url);
const scans = require("../netlify/functions/_receipt-scans.js");

const NOW = Date.parse("2026-10-26T18:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

describe("the phone's queue", () => {
  it("is account-scoped (cleared on sign-out)", () => {
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain("live-receipt-scans-v1");
  });

  it("parses junk safely and keeps the newest 20", () => {
    expect(parseQueue("{nope")).toEqual(emptyQueue());
    let q = emptyQueue();
    for (let i = 0; i < 25; i++) q = addToQueue(q, { id: `r${i}`, state: "sent" });
    expect(parseQueue(JSON.stringify(q)).items).toHaveLength(20);
  });

  it("resends waiting items and uploads cut off by the app closing", () => {
    let q = emptyQueue();
    q = addToQueue(q, { id: "a", state: "waiting", at: iso(NOW) });
    q = addToQueue(q, { id: "b", state: "uploading", at: iso(NOW - UPLOAD_STALE_MS - 1) });
    q = addToQueue(q, { id: "c", state: "uploading", at: iso(NOW - 5000) });
    q = addToQueue(q, { id: "d", state: "sent", at: iso(NOW) });
    expect(itemsToResend(q, NOW).map((i) => i.id)).toEqual(["a", "b"]);
    expect(awaitingResults(q)).toBe(true);
    expect(awaitingResults(updateInQueue(q, "d", { state: "failed" }))).toBe(false);
  });
});

describe("applyScanResults", () => {
  const done = (id, extra = {}) => ({ id, status: "done", at: iso(NOW), receipt: { id, storeName: "ALDI", total: 9, lineItems: [] }, ...extra });

  it("imports a finished read, takes it off the queue, keeps this phone's photo refs", () => {
    const refs = [{ index: 0, hash: "h", cloud: { bucket: "reading-content", path: "u/h" } }];
    const q = addToQueue(emptyQueue(), { id: "a", state: "sent", sentAt: iso(NOW), refs });
    const out = applyScanResults(q, [done("a")], { now: NOW, latest: "2026-10-26T18:00:01+00:00" });
    expect(out.queue.items).toEqual([]);
    expect(out.imports).toHaveLength(1);
    expect(receiptFromScanResult(out.imports[0].scan, out.imports[0].refs).imageRefs).toBe(refs);
    expect(out.queue.since).toBe("2026-10-26T18:00:01+00:00");
  });

  it("imports reads made on another device too, but never twice or after a delete", () => {
    const out = applyScanResults(emptyQueue(), [done("x"), done("y"), done("z")], {
      existingIds: new Set(["y"]), deletedIds: new Set(["z"]), now: NOW,
    });
    expect(out.imports.map((i) => i.scan.id)).toEqual(["x"]);
  });

  it("attaches this phone's photos to a receipt another device imported first", () => {
    const refs = [{ index: 0, hash: "h" }];
    const q = addToQueue(emptyQueue(), { id: "a", state: "sent", refs });
    const out = applyScanResults(q, [done("a")], { existingIds: new Set(["a"]), now: NOW });
    expect(out.attach).toEqual([{ id: "a", refs }]);
    expect(out.imports).toEqual([]);
  });

  it("a failed read stays on the queue with its message", () => {
    const q = addToQueue(emptyQueue(), { id: "a", state: "sent", sentAt: iso(NOW) });
    const out = applyScanResults(q, [{ id: "a", status: "failed", error: "Blurry" }], { now: NOW });
    expect(out.failed).toEqual(["a"]);
    expect(out.queue.items[0]).toMatchObject({ state: "failed", error: "Blurry" });
  });

  it("a read that never comes back is marked failed after the timeout", () => {
    const q = addToQueue(emptyQueue(), { id: "a", state: "sent", sentAt: iso(NOW - SENT_TIMEOUT_MS - 1) });
    const out = applyScanResults(q, [], { now: NOW });
    expect(out.queue.items[0].state).toBe("failed");
  });

  it("toasts: one ready, one needing a look, several", () => {
    expect(resultsToast([{ storeName: "Costco", total: 167.49, extraction: { status: "ok" } }])).toBe("Costco · $167.49 is in ✓ adds up");
    expect(resultsToast([{ storeName: "ALDI", total: 97.09, extraction: { status: "check" } }])).toMatch(/needs a quick look/);
    expect(resultsToast([{ extraction: { status: "ok" } }, { extraction: { status: "check" } }])).toBe("2 receipts are in — 1 needs a quick look");
  });
});

describe("server: photo refs, OCR bounds", () => {
  const uid = "11111111-2222-3333-4444-555555555555";
  const hash = "a".repeat(64);

  it("accepts only photos in the caller's own folder", () => {
    const ok = scans.validPhotoRefs([
      { bucket: "reading-content", path: `${uid}/${hash}`, mimeType: "image/jpeg" },
      { bucket: "reading-content", path: `someone-else/${hash}` },
      { bucket: "recipe-photos", path: `${uid}/${hash}` },
      { bucket: "reading-content", path: `${uid}/../x` },
    ], uid);
    expect(ok).toEqual([{ bucket: "reading-content", path: `${uid}/${hash}`, mimeType: "image/jpeg" }]);
  });

  it("bounds the OCR rows", () => {
    const big = [Array.from({ length: 1000 }, () => "x".repeat(100))];
    const out = scans.cleanOcrPages(big);
    expect(out[0].length).toBe(400);
    expect(scans.cleanOcrPages("nope")).toBe(null);
  });
});

describe("server: scan-receipt-background and receipt-scans", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ANTHROPIC_API_KEY; });

  const uid = "11111111-2222-3333-4444-555555555555";
  const hash = "b".repeat(64);
  const good = {
    storeName: "Costco", purchaseDate: "2026-10-23", subtotal: 13.4, tax: 0.5, total: 13.9,
    lines: [{ text: "EGGS", name: "Eggs", price: 8 }, { text: "/123", k: "d", price: 2, for: 0 }, { text: "BREAD", name: "Bread", price: 7.4 }],
  };

  function fakeBackend() {
    const writes = [];
    const deletes = [];
    const fn = vi.fn(async (url, init = {}) => {
      const u = String(url);
      const ok = (body, status = 200) => ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new TextEncoder().encode("jpegbytes").buffer });
      if (u.includes("/auth/v1/user")) return ok({ id: uid });
      if (u.includes("live_group_members")) return ok([{ group_id: "g1" }]);
      if (u.includes("/storage/v1/object/reading-content/")) return ok({});
      if (u.includes("id=eq.g1%3Afinance")) return ok([{ groups: [] }]);
      if (u.includes("api.anthropic.com")) return ok({ content: [{ type: "text", text: JSON.stringify(good) }] });
      if (u.includes("tableplan_states?on_conflict=id") && init.method === "POST") { writes.push(JSON.parse(init.body)); return ok(null, 201); }
      if (u.includes("tableplan_states?id=like.") && init.method === "DELETE") { deletes.push(u); return ok(null, 204); }
      if (u.includes("tableplan_states?id=like.")) {
        return ok(writes.map((w) => ({ state: w.state, updated_at: w.updated_at })));
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fn);
    return { writes, deletes, fn };
  }

  it("reads the receipt and saves a 'done' result under the household", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    process.env.ANTHROPIC_API_KEY = "k";
    const be = fakeBackend();
    const { handler } = require("../netlify/functions/scan-receipt-background.js");
    await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ receiptId: "receipt-abc123", photos: [{ bucket: "reading-content", path: `${uid}/${hash}`, mimeType: "image/jpeg" }], ocrPages: [["TOTAL  13.90"]] }),
    });
    expect(be.writes).toHaveLength(1);
    const row = be.writes[0];
    expect(row.id).toBe("receiptscan_g1_receipt-abc123");
    expect(row.state).toMatchObject({ id: "receipt-abc123", status: "done", by: uid, verdict: { ok: true } });
    expect(row.state.receipt).toMatchObject({ id: "receipt-abc123", source: "scan", extraction: { status: "ok" } });
    expect(row.state.receipt.imageRefs[0].cloud).toEqual({ bucket: "reading-content", path: `${uid}/${hash}` });
    expect(be.deletes).toHaveLength(1); // housekeeping of old results
    // The phone asks for results since its last look and gets this one.
    const list = require("../netlify/functions/receipt-scans.js");
    const res = await list.handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ since: "2026-10-01T00:00:00Z" }) });
    const body = JSON.parse(res.body);
    expect(body.scans.map((s) => s.id)).toEqual(["receipt-abc123"]);
    expect(body.latest).toBeTruthy();
    const listUrl = be.fn.mock.calls.map((c) => String(c[0])).find((u) => u.includes("id=like.") && u.includes("select=state"));
    expect(listUrl).toContain("updated_at=gt.");
  });

  it("photos outside the caller's folder → a 'failed' result, no AI call", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    process.env.ANTHROPIC_API_KEY = "k";
    const be = fakeBackend();
    const { handler } = require("../netlify/functions/scan-receipt-background.js");
    await handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ receiptId: "receipt-abc124", photos: [{ bucket: "reading-content", path: `other/${hash}` }] }) });
    expect(be.writes[0].state).toMatchObject({ status: "failed" });
    expect(be.fn.mock.calls.some((c) => String(c[0]).includes("anthropic"))).toBe(false);
  });
});
