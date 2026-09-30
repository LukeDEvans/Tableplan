import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mod = require("../netlify/functions/voice-command.js");
const { passphraseMatches } = mod._test;

function post(body) {
  return { httpMethod: "POST", body: JSON.stringify(body) };
}

describe("voice-command auth ordering (SRV-6 / MED-3)", () => {
  let calls;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "ak";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk";
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes("anthropic.com")) throw new Error("paid AI call must not happen");
      return { ok: true, status: 200, json: async () => [{ state: { voiceCommandSecret: "open sesame" } }] };
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("rejects a wrong passphrase with 401 before calling Claude", async () => {
    const res = await mod.handler(post({ transcript: "add milk", householdId: "h1", secret: "nope" }));
    expect(res.statusCode).toBe(401);
    expect(calls.some((u) => u.includes("anthropic.com"))).toBe(false);
  });

  it("rejects an over-long transcript with 413 before any fetch", async () => {
    const res = await mod.handler(post({ transcript: "x".repeat(1001), householdId: "h1", secret: "open sesame" }));
    expect(res.statusCode).toBe(413);
    expect(calls).toEqual([]);
  });

  it("does not log the transcript text or householdId", async () => {
    await mod.handler(post({ transcript: "secret shopping list", householdId: "house-xyz", secret: "nope" }));
    const logged = console.log.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("secret shopping list");
    expect(logged).not.toContain("house-xyz");
  });

  it("passphraseMatches is exact and rejects empty stored secrets", () => {
    expect(passphraseMatches("abc", "abc")).toBe(true);
    expect(passphraseMatches("abc", "abd")).toBe(false);
    expect(passphraseMatches("abc", "abcd")).toBe(false);
    expect(passphraseMatches("", "")).toBe(false);
  });
});
