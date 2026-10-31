import { describe, it, expect } from "vitest";
import { createEpisodeStore } from "../watch-episodes.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
const eps = (n) => Array.from({ length: n }, (_, i) => ({ episodeNumber: i + 1, name: `E${i + 1}` }));

describe("watch-episodes: device store for episode lists", () => {
  it("stores and reads a season, and survives a reload from storage", () => {
    const storage = memStorage();
    const a = createEpisodeStore({ storage });
    expect(a.get(94997, 3)).toEqual([]);
    expect(a.set(94997, 3, eps(8))).toBe(true);
    expect(a.set(94997, 3, eps(8))).toBe(false); // unchanged
    const b = createEpisodeStore({ storage });
    expect(b.get("94997", 3)).toHaveLength(8);
    expect(Object.keys(b.seasons(94997))).toEqual(["3"]);
  });

  it("adopts lists an older client saved on the show, without overwriting newer ones", () => {
    const s = createEpisodeStore({ storage: memStorage() });
    s.set(1, 1, eps(3));
    expect(s.adopt(1, { 1: eps(9), 2: eps(4), 3: [] })).toBe(true);
    expect(s.get(1, 1)).toHaveLength(3);
    expect(s.get(1, 2)).toHaveLength(4);
    expect(s.adopt(1, { 2: eps(4) })).toBe(false);
  });

  it("keeps at most maxShows, dropping the least recently used", () => {
    let t = 0;
    const s = createEpisodeStore({ storage: memStorage(), maxShows: 2, now: () => ++t });
    s.set(1, 1, eps(1)); s.set(2, 1, eps(1)); s.set(1, 2, eps(1)); s.set(3, 1, eps(1));
    expect(s.get(2, 1)).toEqual([]);
    expect(s.get(1, 1)).toHaveLength(1);
    expect(s.get(3, 1)).toHaveLength(1);
  });

  it("works without storage (memory only) and ignores shows without a TMDB id", () => {
    const s = createEpisodeStore({ storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } });
    expect(s.set(5, 1, eps(2))).toBe(true);
    expect(s.get(5, 1)).toHaveLength(2);
    expect(s.set(null, 1, eps(2))).toBe(false);
    expect(s.seasons(undefined)).toEqual({});
  });
});
