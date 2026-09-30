import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createOAuthState, verifyOAuthState } = require("../netlify/functions/_oauth-state.js");

const KEY = "service-role-key-for-tests";

describe("signed Gmail OAuth state (SRV-1)", () => {
  it("round-trips a valid state", () => {
    const s = createOAuthState("user-123", KEY);
    expect(verifyOAuthState(s, KEY)).toEqual({ userId: "user-123" });
  });

  it("rejects the legacy unsigned base64 JSON form", () => {
    const legacy = Buffer.from(JSON.stringify({ userId: "victim" })).toString("base64url");
    expect(verifyOAuthState(legacy, KEY)).toBeNull();
  });

  it("rejects a tampered payload (swapped userId, original signature)", () => {
    const s = createOAuthState("attacker", KEY);
    const [payload, sig] = s.split(".");
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString());
    obj.userId = "victim";
    const forged = Buffer.from(JSON.stringify(obj)).toString("base64url") + "." + sig;
    expect(verifyOAuthState(forged, KEY)).toBeNull();
  });

  it("rejects a tampered signature and a different key", () => {
    const s = createOAuthState("user-1", KEY);
    const bad = s.slice(0, -2) + (s.endsWith("AA") ? "BB" : "AA");
    expect(verifyOAuthState(bad, KEY)).toBeNull();
    expect(verifyOAuthState(s, "other-key")).toBeNull();
  });

  it("rejects an expired state", () => {
    const now = Date.now();
    const s = createOAuthState("user-1", KEY, { now: now - 16 * 60 * 1000 });
    expect(verifyOAuthState(s, KEY, { now })).toBeNull();
    const fresh = createOAuthState("user-1", KEY, { now: now - 14 * 60 * 1000 });
    expect(verifyOAuthState(fresh, KEY, { now })).toEqual({ userId: "user-1" });
  });

  it("rejects garbage input", () => {
    for (const v of [undefined, null, "", ".", "a.b.c", "x".repeat(5000), 42]) {
      expect(verifyOAuthState(v, KEY)).toBeNull();
    }
  });
});
