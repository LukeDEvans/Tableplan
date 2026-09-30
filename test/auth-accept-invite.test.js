import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/accept-invite.js");

afterEach(() => { vi.unstubAllGlobals(); });

describe("accept-invite marks the resolved invite accepted (SRV-13)", () => {
  it("tokenless fallback PATCHes id=eq.<invite.id>, not id=eq.undefined", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk";
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, method: init.method || "GET" });
      if (u.includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: "u1", email: "a@b.com" }) };
      if (u.includes("live_group_invites") && !init.method) {
        return { ok: true, json: async () => [{ id: "inv-42", group_id: "g1", email: "a@b.com", accepted_at: null, expires_at: null }] };
      }
      if (u.includes("live_group_members") && !init.method) return { ok: true, json: async () => [{ user_id: "u1" }] };
      if (u.includes("live_groups")) return { ok: true, json: async () => [{ id: "g1", disabled_pages: [] }] };
      return { ok: true, json: async () => ({}) };
    }));
    const res = await handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({}) });
    expect(res.statusCode).toBe(200);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.url).toContain("live_group_invites?id=eq.inv-42");
    expect(patch.url).not.toContain("undefined");
  });
});
