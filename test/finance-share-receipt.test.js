import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/share-receipt.js");
const { createOAuthState } = require("../netlify/functions/_oauth-state.js");

// share-receipt: iPhone share-sheet screenshots of an order → finreceipts_ inbox
// (source "share"). Authenticated by a share token minted from a real session.
const IMG = "data:image/jpeg;base64,QUJD";
let calls, inbox, aiReply, groupFor;

function fakeFetch(url, opts = {}) {
  const u = String(url);
  calls.push({ url: u, opts });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.includes("/auth/v1/user")) {
    return opts.headers?.Authorization === "Bearer session" ? ok({ id: "u1" }) : { ok: false, status: 401, json: async () => ({}) };
  }
  if (u.includes("live_group_members")) return ok(groupFor ? [{ group_id: groupFor }] : []);
  if (u.includes("api.anthropic.com")) return ok({ content: [{ text: JSON.stringify(aiReply) }] });
  if (u.includes("id=eq.g1%3Afinance")) return ok([{ groups: [{ id: "home", label: "Home", categories: [{ id: "sup", name: "Supplies" }] }] }]);
  if (u.includes("finreceipts_g1")) {
    if (!opts.method || opts.method === "GET") return ok([{ state: { receipts: inbox }, updated_at: "2026-10-01T00:00:00Z" }]);
    const body = JSON.parse(opts.body);
    inbox = (Array.isArray(body) ? body[0] : body).state.receipts;
    return { ok: true, status: 200, json: async () => [{}], text: async () => "[{}]" };
  }
  throw new Error("unexpected fetch " + u);
}

const call = (bearer, body) => handler({ httpMethod: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
const shareToken = (overrides = {}) => createOAuthState("u1", "svc", { purpose: "receipt-share-v1", ttlMs: 60000, ...overrides });

beforeEach(() => {
  calls = []; inbox = []; groupFor = "g1";
  aiReply = { receipts: [{ merchant: "Amazon", date: "2026-10-10", total: 31.47, items: [{ name: "Paper towels", price: 24.99, category: "cat:home:sup" }, { name: "Mystery", price: null, category: "cat:nope:x" }] }] };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "key";
  globalThis.fetch = fakeFetch;
});
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ANTHROPIC_API_KEY; });

describe("share-receipt mint", () => {
  it("mints a share token for a valid session", async () => {
    const res = await call("session", { action: "mint" });
    expect(res.statusCode).toBe(200);
    const { token, expiresAt } = JSON.parse(res.body);
    expect(token.split(".")).toHaveLength(2);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 300 * 86400000);
    // …and that token works for sharing.
    expect((await call(token, { images: [IMG] })).statusCode).toBe(200);
  });

  it("refuses to mint without a valid session", async () => {
    expect((await call("garbage", { action: "mint" })).statusCode).toBe(401);
  });
});

describe("share-receipt share", () => {
  it("extracts the order into the household inbox as a share receipt", async () => {
    const res = await call(shareToken(), { images: [IMG, IMG] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).receipts).toEqual([{ merchant: "Amazon", date: "2026-10-10", total: 31.47, items: 2 }]);
    expect(inbox).toHaveLength(1);
    const [r] = inbox;
    expect(r.id).toMatch(/^shr_/);
    expect(r.source).toBe("share");
    expect(r.items[1]).toEqual({ name: "Mystery", price: 0, category: "" }); // unknown category dropped
    expect(r.portions).toEqual([{ label: "cat:home:sup", amount: 24.99 }, { label: "", amount: 6.48 }]);
    const ai = JSON.parse(calls.find((c) => c.url.includes("anthropic")).opts.body);
    expect(ai.messages[0].content.filter((c) => c.type === "image")).toHaveLength(2);
  });

  it("stores each order when a screenshot shows several", async () => {
    aiReply = { receipts: [
      { merchant: "Amazon", date: "2026-10-10", total: 31.47, items: [] },
      { merchant: "Amazon", date: "2026-10-08", total: 12.0, items: [] },
      { merchant: "Amazon", date: "2026-10-07", items: [] } // no total → skipped
    ] };
    const res = await call(shareToken(), { images: [IMG] });
    expect(JSON.parse(res.body).receipts).toHaveLength(2);
    expect(inbox).toHaveLength(2);
  });

  it("reads an order-summary PDF's text with the summary prompt (no images)", async () => {
    const summary = [
      "Final Details for Order #112-1234567-1234567",
      "Order Placed: October 10, 2026",
      "Order Total: $31.47",
      "Items Ordered Price",
      "1 of: Bounty Paper Towels, 12 Double Rolls $24.99",
      "Item(s) Subtotal: $24.99  Shipping & Handling: $0.00  Estimated tax to be collected: $6.48",
      "Grand Total: $31.47"
    ].join("\n");
    const res = await call(shareToken(), { text: summary, kind: "summary" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).receipts).toEqual([{ merchant: "Amazon", date: "2026-10-10", total: 31.47, items: 2 }]);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].source).toBe("share");
    const ai = JSON.parse(calls.find((c) => c.url.includes("anthropic")).opts.body);
    const parts = ai.messages[0].content;
    expect(parts.some((c) => c.type === "image")).toBe(false);
    expect(parts[0].text).toMatch(/order summary or invoice/);
    expect(parts[1].text.startsWith("ORDER SUMMARY TEXT:\n")).toBe(true);
    expect(parts[1].text).toContain("Grand Total: $31.47");
  });

  it("keeps the screenshot prompt when kind isn't summary, and caps very long text", async () => {
    await call(shareToken(), { text: "x".repeat(60000) });
    const ai = JSON.parse(calls.find((c) => c.url.includes("anthropic")).opts.body);
    expect(ai.messages[0].content[0].text).toMatch(/screenshots of online order pages/);
    expect(ai.messages[0].content[1].text.length).toBeLessThanOrEqual("SHARED TEXT:\n".length + 40000);
  });

  it("sharing the same order again replaces it instead of duplicating", async () => {
    await call(shareToken(), { images: [IMG] });
    await call(shareToken(), { images: [IMG] });
    expect(inbox).toHaveLength(1);
  });

  it("rejects a session token, a forged token, and an expired token", async () => {
    expect((await call("session", { images: [IMG] })).statusCode).toBe(401);
    const forged = shareToken().replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await call(forged, { images: [IMG] })).statusCode).toBe(401);
    expect((await call(shareToken({ now: Date.now() - 120000 }), { images: [IMG] })).statusCode).toBe(401);
    // An OAuth-state token for another purpose is not a share token.
    expect((await call(createOAuthState("u1", "svc"), { images: [IMG] })).statusCode).toBe(401);
    expect(inbox).toEqual([]);
  });

  it("refuses when the user no longer belongs to a household", async () => {
    groupFor = null;
    expect((await call(shareToken(), { images: [IMG] })).statusCode).toBe(403);
  });

  it("validates the payload", async () => {
    expect((await call(shareToken(), { images: ["nope"] })).statusCode).toBe(400);
    expect((await call(shareToken(), { images: [IMG, IMG, IMG, IMG, IMG] })).statusCode).toBe(400);
    expect((await call(shareToken(), { url: "https://www.amazon.com/gp/your-account/order-details" })).statusCode).toBe(400);
    expect(calls.some((c) => c.url.includes("anthropic"))).toBe(false);
  });

  it("returns an empty list when nothing readable is found", async () => {
    aiReply = { receipts: [] };
    const res = await call(shareToken(), { images: [IMG] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).receipts).toEqual([]);
    expect(inbox).toEqual([]);
  });
});

describe("share-receipt time limit", () => {
  it("answers with a clear 504 instead of running into Netlify's cutoff", async () => {
    process.env.SHARE_RECEIPT_AI_TIMEOUT_MS = "20";
    globalThis.fetch = (url, opts = {}) => {
      if (String(url).includes("api.anthropic.com")) {
        return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      }
      return fakeFetch(url, opts);
    };
    try {
      const res = await call(shareToken(), { images: [IMG] });
      expect(res.statusCode).toBe(504);
      expect(inbox).toEqual([]);
    } finally {
      delete process.env.SHARE_RECEIPT_AI_TIMEOUT_MS;
    }
  });
});
