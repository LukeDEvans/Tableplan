import { describe, it, expect, beforeEach } from "vitest";
import { syncReceiptShareToken, SHARE_TOKEN_STAMP_KEY, REMINT_MS } from "../receipt-share-token.js";

// The iPhone app keeps the Share Extension's receipt share token in step with
// sign-in: mint on sign-in / app start (re-mint monthly), clear on sign-out.
function fakePlugin(present = false) {
  const calls = [];
  let stored = present ? "old" : null;
  return {
    calls,
    get stored() { return stored; },
    async status() { calls.push("status"); return { present: stored != null }; },
    async set({ token }) { calls.push("set"); stored = token; },
    async clear() { calls.push("clear"); stored = null; }
  };
}
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

let mints;
const mint = async () => { mints += 1; return { token: `tok${mints}` }; };
beforeEach(() => { mints = 0; });

describe("syncReceiptShareToken", () => {
  it("does nothing without the native plugin (web / older app build)", async () => {
    expect(await syncReceiptShareToken({ plugin: null, mint, storage: fakeStorage(), signedIn: true })).toBe("unavailable");
    expect(mints).toBe(0);
  });

  it("mints and stores a token on first sign-in", async () => {
    const plugin = fakePlugin(); const storage = fakeStorage();
    expect(await syncReceiptShareToken({ plugin, mint, storage, signedIn: true, now: 1000 })).toBe("stored");
    expect(plugin.stored).toBe("tok1");
    expect(storage.getItem(SHARE_TOKEN_STAMP_KEY)).toBe("1000");
  });

  it("leaves a fresh token alone, and re-mints after a month", async () => {
    const plugin = fakePlugin(true); const storage = fakeStorage({ [SHARE_TOKEN_STAMP_KEY]: "1000" });
    expect(await syncReceiptShareToken({ plugin, mint, storage, signedIn: true, now: 1000 + REMINT_MS - 1 })).toBe("fresh");
    expect(mints).toBe(0);
    expect(await syncReceiptShareToken({ plugin, mint, storage, signedIn: true, now: 1000 + REMINT_MS })).toBe("stored");
    expect(plugin.stored).toBe("tok1");
  });

  it("re-mints when the keychain lost the token even if the stamp is recent", async () => {
    const plugin = fakePlugin(false); const storage = fakeStorage({ [SHARE_TOKEN_STAMP_KEY]: "1000" });
    expect(await syncReceiptShareToken({ plugin, mint, storage, signedIn: true, now: 2000 })).toBe("stored");
  });

  it("clears the token and stamp on sign-out", async () => {
    const plugin = fakePlugin(true); const storage = fakeStorage({ [SHARE_TOKEN_STAMP_KEY]: "1000" });
    expect(await syncReceiptShareToken({ plugin, mint, storage, signedIn: false })).toBe("cleared");
    expect(plugin.stored).toBe(null);
    expect(storage.getItem(SHARE_TOKEN_STAMP_KEY)).toBe(null);
  });

  it("reports a failed mint without storing anything", async () => {
    const plugin = fakePlugin(); const storage = fakeStorage();
    const bad = async () => ({ error: "Invalid session." });
    expect(await syncReceiptShareToken({ plugin, mint: bad, storage, signedIn: true })).toBe("failed");
    expect(plugin.stored).toBe(null);
    expect(storage.getItem(SHARE_TOKEN_STAMP_KEY)).toBe(null);
  });

  it("shares one run between overlapping calls (no double mint)", async () => {
    const plugin = fakePlugin(); const storage = fakeStorage();
    const [a, b] = await Promise.all([
      syncReceiptShareToken({ plugin, mint, storage, signedIn: true }),
      syncReceiptShareToken({ plugin, mint, storage, signedIn: true })
    ]);
    expect([a, b]).toEqual(["stored", "stored"]);
    expect(mints).toBe(1);
  });
});
