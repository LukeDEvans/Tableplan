import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/simplefin.js");

// simplefin scanReceipt: the split editor's photo → categorized portions. It
// stores nothing — scanned receipts live in the one receipts list (state.receipts).
const IMG = "data:image/jpeg;base64,QUJD";
let calls, writes, aiReply;

function fakeFetch(url, opts = {}) {
  const u = String(url);
  calls.push({ url: u, opts });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (opts.method && opts.method !== "GET" && u.includes("supabase.co")) writes.push(u);
  if (u.includes("/auth/v1/user")) return ok({ id: "u1" });
  if (u.includes("live_group_members")) return ok([{ group_id: "g1" }]);
  if (u.includes("api.anthropic.com")) return ok({ content: [{ text: JSON.stringify({ receipt: aiReply }) }] });
  if (u.includes("id=eq.g1%3Afinance")) return ok([{ state: { financeBudgetGroups: [{ id: "food", label: "Food", categories: [{ id: "groc", name: "Groceries" }] }] } }]);
  throw new Error("unexpected fetch " + u);
}
const call = (body) => handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify({ action: "scanReceipt", ...body }) });

beforeEach(() => {
  calls = []; writes = [];
  aiReply = { merchant: "Lunds", date: "2026-10-01", total: 23.5, items: [{ name: "Milk", price: 4, category: "cat:food:groc" }] };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "key";
  globalThis.fetch = fakeFetch;
});
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ANTHROPIC_API_KEY; });

describe("simplefin scanReceipt", () => {
  it("returns categorized portions and stores nothing", async () => {
    const res = await call({ image: IMG });
    expect(res.statusCode).toBe(200);
    const { receipt } = JSON.parse(res.body);
    expect(receipt.portions).toEqual([{ label: "cat:food:groc", amount: 4 }, { label: "", amount: 19.5 }]);
    expect(writes).toEqual([]);
  });

  it("sends every photo of a multi-photo receipt in one read", async () => {
    await call({ images: [IMG, IMG] });
    const ai = calls.find((c) => c.url.includes("anthropic"));
    expect(JSON.parse(ai.opts.body).messages[0].content.filter((c) => c.type === "image")).toHaveLength(2);
  });

  it("rejects a non-image payload", async () => {
    expect((await call({ images: ["nope"] })).statusCode).toBe(400);
  });
});
