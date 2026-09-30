import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/auto-tag-grocery.js");

afterEach(() => { vi.unstubAllGlobals(); });

describe("auto-tag-grocery input caps + timeout (GRO-18)", () => {
  it("caps item count and drops over-long names; passes an abort signal", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk";
    process.env.ANTHROPIC_API_KEY = "ak";
    let aiInit;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).includes("/auth/v1/user")) return { ok: true };
      aiInit = init;
      return { ok: true, json: async () => ({ content: [{ text: "{}" }] }) };
    }));
    const items = ["x".repeat(101), ...Array.from({ length: 500 }, (_, i) => `item${i}`)];
    const res = await handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ items }) });
    expect(res.statusCode).toBe(200);
    const user = JSON.parse(aiInit.body).messages[0].content;
    expect(user).not.toContain("x".repeat(101));
    expect(user).toContain("300. item299");
    expect(user).not.toContain("item300");
    expect(aiInit.signal).toBeInstanceOf(AbortSignal);
  });
});
