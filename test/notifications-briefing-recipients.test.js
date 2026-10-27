// The daily briefing push reaches only its owner's devices (ISSUES.md P1, 2026-10-13).
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadSubscriptions } from "../netlify/functions/daily-briefing.js";

afterEach(() => vi.unstubAllGlobals());

describe("daily briefing recipients", () => {
  it("asks only for the owner's subscriptions", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => [{ subscription: { endpoint: "e1" } }, { subscription: null }] }));
    vi.stubGlobal("fetch", fetch);
    const subs = await loadSubscriptions("key", "user-1");
    expect(subs).toEqual([{ endpoint: "e1" }]);
    expect(fetch.mock.calls[0][0]).toContain("live_push_subscriptions?user_id=eq.user-1&");
  });

  it("sends to nobody when the owner is unknown", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await loadSubscriptions("key", null)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
