// tmdb-season passes each episode's length through (Luke, 2026-10-29: the Watch
// panel shows it when TMDB has it).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/tmdb-season.js");

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("tmdb-season", () => {
  it("returns runtime in minutes, or null when TMDB has none", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc");
    vi.stubEnv("TMDB_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/auth/v1/user")) return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({ episodes: [
        { episode_number: 1, name: "Pilot", air_date: "2008-01-20", runtime: 58 },
        { episode_number: 2, name: "", runtime: null },
        { episode_number: 3, name: "Odd", runtime: 0 },
      ] }) };
    }));
    const res = await handler({ httpMethod: "GET", headers: { authorization: "Bearer t" }, queryStringParameters: { id: "1396", season: "1" } });
    expect(res.statusCode).toBe(200);
    const { episodes } = JSON.parse(res.body);
    expect(episodes.map((e) => e.runtime)).toEqual([58, null, null]);
    expect(episodes[1].name).toBe("Episode 2");
  });
});
