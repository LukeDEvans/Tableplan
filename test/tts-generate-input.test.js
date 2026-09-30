import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mod = require("../netlify/functions/generate-tts.js");

function post(body) {
  return { httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify(body) };
}

describe("generate-tts input validation (SRV-5 / MED-10)", () => {
  let urls;
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "gk";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk";
    urls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      urls.push(String(url));
      if (String(url).includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: "u1" }) };
      // cache hit so the handler returns without calling TTS
      return { ok: true, json: async () => ({ count: 1, version: 2, timings: null }) };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("400s on non-string or oversized text", async () => {
    expect((await mod.handler(post({ articleId: "a1", text: { x: 1 } }))).statusCode).toBe(400);
    expect((await mod.handler(post({ articleId: "a1", text: "w ".repeat(30001) }))).statusCode).toBe(400);
  });

  it("400s when articleId sanitizes to empty (and no cacheKey)", async () => {
    const res = await mod.handler(post({ articleId: "../..", text: "hello" }));
    expect(res.statusCode).toBe(400);
  });

  it("never puts a traversal articleId into the storage path", async () => {
    const res = await mod.handler(post({ articleId: "../other/x", text: "hello" }));
    expect(res.statusCode).toBe(200);
    const storage = urls.filter((u) => u.includes("/storage/"));
    expect(storage.length).toBeGreaterThan(0);
    for (const u of storage) expect(u).not.toContain("..");
    expect(JSON.parse(res.body).urls[0]).toContain("/article-audio/otherx/0.mp3");
  });
});
