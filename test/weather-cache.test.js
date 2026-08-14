import { describe, it, expect, vi } from "vitest";
import { createWeatherCache } from "../weather-cache.js";

describe("weather cache — TTL + de-dup", () => {
  it("serves cached data within TTL and fetches only once", async () => {
    let clock = 1000;
    const cache = createWeatherCache({ now: () => clock });
    const fetcher = vi.fn(async () => ({ v: 1 }));
    expect(await cache.request("k", 5000, fetcher)).toEqual({ v: 1 });
    clock = 3000; // still within TTL
    expect(await cache.request("k", 5000, fetcher)).toEqual({ v: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has expired", async () => {
    let clock = 0;
    const cache = createWeatherCache({ now: () => clock });
    const fetcher = vi.fn(async () => ({ t: clock }));
    await cache.request("k", 1000, fetcher);
    clock = 1500; // past TTL
    await cache.request("k", 1000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent identical requests into one in-flight call", async () => {
    const cache = createWeatherCache();
    let resolve;
    const gate = new Promise((r) => { resolve = r; }); // created now so resolve is set before fetcher runs
    const fetcher = vi.fn(() => gate);
    const p1 = cache.request("k", 5000, fetcher);
    const p2 = cache.request("k", 5000, fetcher);
    expect(cache.sizes().inflight).toBe(1);
    resolve({ v: 7 });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.sizes().inflight).toBe(0);
  });

  it("does not cache a rejected fetch and clears the in-flight entry", async () => {
    const cache = createWeatherCache();
    await expect(cache.request("k", 5000, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(cache.has("k")).toBe(false);
    expect(cache.sizes().inflight).toBe(0);
  });

  it("peek returns the last cached value (for stale fallback) or undefined", async () => {
    const cache = createWeatherCache();
    await cache.request("k", 5000, async () => ({ temp: 70 }));
    expect(cache.peek("k")).toEqual({ temp: 70 });
    expect(cache.peek("missing")).toBeUndefined();
  });

  it("keeps separate keys independent (distinct cache entries)", async () => {
    const cache = createWeatherCache();
    const f = vi.fn(async (x) => ({ x }));
    await cache.request("a", 5000, () => f("a"));
    await cache.request("b", 5000, () => f("b"));
    expect(cache.sizes().cache).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
