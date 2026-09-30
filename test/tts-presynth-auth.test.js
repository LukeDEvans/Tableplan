import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import worker from "../netlify/functions/presynth-tts-background.mjs";
import cron from "../netlify/functions/presynth-cron.mjs";
import { presynthKey, presynthKeyValid } from "../netlify/functions/_presynth-key.mjs";

describe("presynth worker shared-key gate (SRV-7 / MED-2)", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-test";
    delete process.env.KOKORO_URL;
    delete process.env.KOKORO_TOKEN;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("403s without the header or with a wrong key", async () => {
    expect((await worker(new Request("http://x/", { method: "POST" }))).status).toBe(403);
    const bad = new Request("http://x/", { method: "POST", headers: { "x-presynth-key": "nope" } });
    expect((await worker(bad)).status).toBe(403);
    expect((await worker(undefined)).status).toBe(403);
  });

  it("accepts the key presynth-cron sends", async () => {
    let sent;
    process.env.URL = "https://site.example";
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { sent = init; return { status: 202 }; }));
    await cron();
    const key = sent.headers["x-presynth-key"];
    expect(key).toBe(presynthKey("sk-test"));
    const res = await worker(new Request("http://x/", { method: "POST", headers: { "x-presynth-key": key } }));
    expect(res.status).not.toBe(403); // passes the gate (then skips: no Kokoro env)
  });

  it("never validates when the service key is missing", () => {
    expect(presynthKey("")).toBe("");
    expect(presynthKeyValid("", "")).toBe(false);
  });
});
