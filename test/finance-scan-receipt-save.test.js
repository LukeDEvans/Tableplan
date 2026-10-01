import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/simplefin.js");

// The header scanner calls scanReceipt with save:true so the receipt waits in
// Finance → Receipts (the finreceipts_ row) until its transaction posts.
const USER = "11111111-2222-3333-4444-555555555555";
const IMG = "data:image/jpeg;base64,QUJD";
let calls, savedState, aiReply;

function fakeFetch(url, opts = {}) {
  const u = String(url);
  calls.push({ url: u, opts });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.includes("/auth/v1/user")) return ok({ id: USER });
  if (u.includes("live_group_members")) return ok([{ group_id: "g1" }]);
  if (u.includes("api.anthropic.com")) return ok({ content: [{ text: JSON.stringify({ receipt: aiReply }) }] });
  if (u.includes("id=eq.g1%3Afinance")) return ok([{ state: { financeBudgetGroups: [{ id: "food", label: "Food", categories: [{ id: "groc", name: "Groceries" }] }] } }]);
  if (u.includes("finreceipts_g1") && (!opts.method || opts.method === "GET")) return ok([{ state: { receipts: [{ id: "gmail1", total: 5 }] }, updated_at: "t0" }]);
  if (u.includes("finreceipts_g1") && opts.method === "PATCH") { savedState = JSON.parse(opts.body).state; return ok([{}]); }
  throw new Error("unexpected fetch " + u);
}

const call = (body) => handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify({ action: "scanReceipt", ...body }) });

beforeEach(() => {
  calls = []; savedState = null;
  aiReply = { merchant: "Lunds", date: "2026-10-01", total: 23.5, items: [{ name: "Milk", price: 4, category: "cat:food:groc" }] };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "key";
  globalThis.fetch = fakeFetch;
});
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ANTHROPIC_API_KEY; });

describe("simplefin scanReceipt", () => {
  it("without save: returns the receipt and stores nothing (split-editor path)", async () => {
    const res = await call({ image: IMG });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).receipt.total).toBe(23.5);
    expect(savedState).toBeNull();
  });

  it("with save: stores it beside the email receipts with a stable scan id + image path", async () => {
    const res = await call({ images: [IMG, IMG], save: true, imagePath: `${USER}/scans/1.jpg` });
    expect(res.statusCode).toBe(200);
    const ai = calls.find((c) => c.url.includes("anthropic"));
    expect(JSON.parse(ai.opts.body).messages[0].content.filter((c) => c.type === "image")).toHaveLength(2);
    const [first, second] = savedState.receipts;
    expect(first).toMatchObject({ source: "scan", merchant: "Lunds", total: 23.5, imagePath: `${USER}/scans/1.jpg` });
    expect(first.id).toMatch(/^scan_/);
    expect(second.id).toBe("gmail1"); // existing email receipt kept
  });

  it("drops an image path that isn't a user scan path", async () => {
    await call({ image: IMG, save: true, imagePath: "../other/thing.jpg" });
    expect(savedState.receipts[0].imagePath).toBeUndefined();
  });

  it("saves nothing when no receipt could be read", async () => {
    aiReply = null;
    const res = await call({ image: IMG, save: true });
    expect(JSON.parse(res.body).receipt).toBeNull();
    expect(savedState).toBeNull();
  });

  it("rejects a non-image payload", async () => {
    expect((await call({ images: ["nope"], save: true })).statusCode).toBe(400);
  });
});
