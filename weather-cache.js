// Small TTL cache + in-flight de-duplication for the weather service. Kept as
// its own module so the caching/dedup behavior is unit-testable (see
// test/weather-cache.test.js) without booting the whole app. The clock is
// injectable so TTL expiry can be tested deterministically.
export function createWeatherCache({ now = () => Date.now() } = {}) {
  const cache = new Map();    // key -> { at, data }
  const inflight = new Map(); // key -> Promise

  return {
    // Return cached data while it's younger than ttlMs; otherwise call
    // fetcher() exactly once even if several identical requests race — they all
    // share the single in-flight promise (de-dup). A rejected fetch is never
    // cached, and the in-flight entry is always cleared.
    async request(key, ttlMs, fetcher) {
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.data;
      if (inflight.has(key)) return inflight.get(key);
      const p = Promise.resolve()
        .then(fetcher)
        .then((data) => { cache.set(key, { at: now(), data }); return data; })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    // Last cached value for a key (used to serve stale data on upstream failure).
    peek(key) { return cache.get(key)?.data; },
    has(key) { return cache.has(key); },
    sizes() { return { cache: cache.size, inflight: inflight.size }; }
  };
}
