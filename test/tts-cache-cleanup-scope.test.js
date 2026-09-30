import { describe, it, expect, vi, afterEach } from "vitest";
import cleanup from "../netlify/functions/tts-cache-cleanup.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.TTS_CLEANUP_DELETE; });

describe("tts-cache-cleanup never lists or deletes reading-content (SRV-11)", () => {
  it("only touches the article-audio bucket, even in DELETE mode", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk";
    process.env.TTS_CLEANUP_DELETE = "1";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const u = String(url);
      calls.push({ u, method: init.method || "GET" });
      const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes("select=id,updated_at")) return ok([{ id: "g1:media" }]);
      if (u.includes("live_group_members")) return ok([]);
      if (u.includes("select=id,state")) return ok([{ id: "g1:media", state: { savedArticles: [{ id: "a1", title: "T", text: "hello world" }] } }]);
      if (u.includes("/object/list/")) return ok([{ name: "orphan-folder" }]);
      return ok([]);
    }));
    const res = await cleanup();
    expect(res.status).toBe(200);
    const storageCalls = calls.filter((c) => c.u.includes("/storage/v1/object"));
    expect(storageCalls.length).toBeGreaterThan(0);
    for (const c of storageCalls) expect(c.u).not.toContain("reading-content");
  });
});
