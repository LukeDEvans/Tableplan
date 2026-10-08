// News in the iPhone app: the phone's own newspaper sign-ins are reported to the
// server as a status per paper (news-ui.js verifySignIns + news-device-signin.js),
// and the automatic re-report is bounded.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createNewsModule } from "../news-ui.js";

const NOW = Date.parse("2026-10-08T12:00:00Z");

function setup({ device, state = {}, server } = {}) {
  const calls = [];
  const mod = createNewsModule({
    escapeHtml: (s) => String(s),
    callGmailApi: async (body) => { calls.push(body); return server ? server(body) : { ok: true, signIns: {} }; },
    isSignedIn: () => true,
    getState: () => state,
    getActiveAppArea: () => "mail", // not on News: nothing renders
    getDeviceSignIn: () => device || null
  });
  return { mod, calls };
}

describe("verifySignIns in the iPhone app", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    globalThis.document = { getElementById: () => null, addEventListener: () => {}, hidden: false };
    globalThis.window = { innerWidth: 390 };
  });
  afterEach(() => { vi.useRealTimers(); delete globalThis.document; delete globalThis.window; });

  it("sends the phone's status per paper and no cookie", async () => {
    const device = { check: async () => ({ nyt: "signed-in", startribune: "unverified" }), needsCheck: () => false };
    const { mod, calls } = setup({ device, server: () => ({ ok: true, signIns: { nyt: { status: "signed-in", via: "device" } } }) });
    const out = await mod.verifySignIns();
    expect(calls).toEqual([{
      action: "verifyNewsSignIns",
      cookies: { nytCookie: "", economistCookie: "", stribCookie: "" },
      deviceStatus: { nyt: "signed-in", startribune: "unverified" }
    }]);
    expect(out.nyt.status).toBe("signed-in"); // resolves to the server's answer
    expect(mod.deviceStatus()).toEqual({ nyt: "signed-in", startribune: "unverified" }); // what the phone found
  });

  it("a browser (no phone check) sends exactly what it always did", async () => {
    const { mod, calls } = setup({ state: { articleSync: { nytCookie: "abc" } } });
    await mod.verifySignIns();
    expect(calls).toEqual([{ action: "verifyNewsSignIns", cookies: { nytCookie: "abc", economistCookie: "", stribCookie: "" } }]);
  });

  it("a phone check that fails or learns nothing sends no deviceStatus", async () => {
    const failing = setup({ device: { check: async () => { throw new Error("bridge down"); } } });
    await failing.mod.verifySignIns();
    expect(failing.calls[0].deviceStatus).toBeUndefined();
    const empty = setup({ device: { check: async () => ({}) } });
    await empty.mod.verifySignIns();
    expect(empty.calls[0].deviceStatus).toBeUndefined();
  });

  it("a second request during a check runs once more, and both callers get the final answer", async () => {
    let n = 0;
    const device = { check: async () => ({ nyt: ++n === 1 ? "none" : "signed-in" }) };
    const { mod, calls } = setup({ device, server: (b) => ({ ok: true, signIns: { nyt: { status: b.deviceStatus.nyt } } }) });
    const [a, b] = await Promise.all([mod.verifySignIns(), mod.verifySignIns()]);
    expect(calls.length).toBe(2);
    expect(a.nyt.status).toBe("signed-in");
    expect(b.nyt.status).toBe("signed-in");
  });

  it("opening News re-reports a stale phone status at most once per 6 hours, even if the server never records it", async () => {
    let checks = 0;
    const device = { check: async () => { checks++; return { nyt: "signed-in" }; }, needsCheck: () => true };
    // An older server: ignores deviceStatus, so the status stays stale forever.
    const server = (b) => (b.action === "newsFeed" ? { articles: [], signIns: {} } : { ok: true, signIns: {} });
    const { mod } = setup({ device, server });
    const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    await mod.load(true); await settle();
    expect(checks).toBe(1);
    for (let i = 0; i < 5; i++) { await mod.load(true); await settle(); }
    expect(checks).toBe(1);
    vi.setSystemTime(NOW + 6 * 3_600_000 + 1000);
    await mod.load(true); await settle();
    expect(checks).toBe(2);
  });

  it("opening News does not start a phone check when its last report is fresh", async () => {
    let checks = 0;
    const device = { check: async () => { checks++; return {}; }, needsCheck: () => false };
    const { mod } = setup({ device, server: () => ({ articles: [], signIns: { nyt: { status: "signed-in" } } }) });
    await mod.load(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(checks).toBe(0);
  });
});
