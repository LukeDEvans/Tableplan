import { describe, it, expect } from "vitest";
import { WATCH_SCOPE_TYPES, WATCH_SCOPE_KEYS, normalizeWatchScope, allowedProviderIds } from "../media-search-scope.js";

// The provider ids the Watch search actually queries (media-provider-*.js .id).
// If a provider id changes or a new video/audio search provider is added, this
// list and the scope mapping must move together — the coverage test below fails
// loudly if the scope types stop covering exactly these ids.
const REAL_SEARCH_PROVIDER_IDS = ["tmdb", "youtube", "jellyfin", "music", "podcastsearch", "radio"];

describe("normalizeWatchScope — persisted preference handling", () => {
  it("missing/null → all types, servicesOnly false (first-run default)", () => {
    expect(normalizeWatchScope(null)).toEqual({ types: WATCH_SCOPE_KEYS, servicesOnly: false });
    expect(normalizeWatchScope(undefined).types).toEqual(WATCH_SCOPE_KEYS);
  });
  it("corrupt/non-array types → defaults to all types (not empty)", () => {
    expect(normalizeWatchScope({ types: "movtv" }).types).toEqual(WATCH_SCOPE_KEYS);
    expect(normalizeWatchScope({ types: 42 }).types).toEqual(WATCH_SCOPE_KEYS);
    expect(normalizeWatchScope({}).types).toEqual(WATCH_SCOPE_KEYS);
  });
  it("an explicit EMPTY array is honored (user unchecked all) — NOT coerced to all", () => {
    // This is the subtle bit: [] must survive so runDiscoverSearch can show the
    // "pick a type" hint instead of silently searching everything.
    expect(normalizeWatchScope({ types: [] }).types).toEqual([]);
  });
  it("unknown type keys are dropped, valid ones kept in order", () => {
    expect(normalizeWatchScope({ types: ["music", "bogus", "radio"] }).types).toEqual(["music", "radio"]);
  });
  it("servicesOnly is coerced to a real boolean", () => {
    expect(normalizeWatchScope({ types: ["music"], servicesOnly: 1 }).servicesOnly).toBe(true);
    expect(normalizeWatchScope({ types: ["music"] }).servicesOnly).toBe(false);
  });
});

describe("allowedProviderIds — type → provider mapping", () => {
  it("single type maps to its providers", () => {
    expect([...allowedProviderIds({ types: ["movtv"] })]).toEqual(["tmdb"]);
    expect([...allowedProviderIds({ types: ["video"] })].sort()).toEqual(["jellyfin", "youtube"]);
  });
  it("multiple types union their providers without duplicates", () => {
    const ids = allowedProviderIds({ types: ["movtv", "video", "music"] });
    expect([...ids].sort()).toEqual(["jellyfin", "music", "tmdb", "youtube"]);
  });
  it("empty / missing types → empty set (search shows the 'pick a type' hint)", () => {
    expect(allowedProviderIds({ types: [] }).size).toBe(0);
    expect(allowedProviderIds({}).size).toBe(0);
    expect(allowedProviderIds(null).size).toBe(0);
  });
});

describe("scope ↔ real providers contract", () => {
  it("every scope type declares at least one provider, and provider lists are unique", () => {
    WATCH_SCOPE_TYPES.forEach((t) => {
      expect(t.providers.length).toBeGreaterThan(0);
      expect(new Set(t.providers).size).toBe(t.providers.length);
    });
  });
  it("selecting ALL types covers EXACTLY the real search-provider ids (no orphaned provider)", () => {
    const covered = allowedProviderIds({ types: WATCH_SCOPE_KEYS });
    expect([...covered].sort()).toEqual([...REAL_SEARCH_PROVIDER_IDS].sort());
  });
  it("scope type keys are unique", () => {
    expect(new Set(WATCH_SCOPE_KEYS).size).toBe(WATCH_SCOPE_KEYS.length);
  });
});
