import { describe, it, expect } from "vitest";
import { geoKey, geoCacheGet, geoCachePut, shouldGeocode, dayColor, boundsOf, resolvePlaces } from "../travel-geo.js";

describe("cache key + get/put", () => {
  it("normalizes keys", () => {
    expect(geoKey("  Hagia   Sophia ")).toBe("hagia sophia");
  });
  it("puts and gets coords without mutating input", () => {
    const c0 = {};
    const c1 = geoCachePut(c0, "Louvre", { lat: 48.86, lng: 2.33 });
    expect(c0).toEqual({});
    expect(geoCacheGet(c1, "louvre")).toMatchObject({ lat: 48.86, lng: 2.33 });
  });
  it("records misses", () => {
    const c = geoCachePut({}, "Nowhere", null);
    expect(geoCacheGet(c, "Nowhere")).toBeNull();
    expect(c[geoKey("Nowhere")].miss).toBe(true);
  });
});

describe("shouldGeocode", () => {
  it("yes when unknown, no when cached, no on recent miss", () => {
    expect(shouldGeocode({}, "A")).toBe(true);
    const hit = geoCachePut({}, "A", { lat: 1, lng: 2 });
    expect(shouldGeocode(hit, "A")).toBe(false);
    const miss = geoCachePut({}, "B", null, { now: 1000 });
    expect(shouldGeocode(miss, "B", { now: 2000 })).toBe(false);
    expect(shouldGeocode(miss, "B", { now: 1000 + 8 * 864e5 })).toBe(true); // miss expired
  });
  it("no for empty address", () => {
    expect(shouldGeocode({}, "")).toBe(false);
  });
});

describe("dayColor + boundsOf", () => {
  it("wraps colors and is deterministic", () => {
    expect(dayColor(0)).toBe(dayColor(8));
    expect(dayColor(-1)).toBe("#888888");
  });
  it("computes bounds and center", () => {
    const b = boundsOf([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }, { lat: null }]);
    expect(b.center).toEqual({ lat: 1, lng: 2 });
    expect(boundsOf([])).toBeNull();
  });
});

describe("resolvePlaces", () => {
  const places = [
    { location: "Louvre", title: "Museum", dayIndex: 0 },
    { location: "Eiffel Tower", title: "Tower", dayIndex: 0 },
    { location: "", title: "No location" },
  ];
  const table = { louvre: { lat: 48.86, lng: 2.33 }, "eiffel tower": { lat: 48.85, lng: 2.29 } };

  it("geocodes gaps via injected provider and returns located places", async () => {
    let calls = 0;
    const geocode = async addr => { calls++; return table[addr.toLowerCase()] || null; };
    const { located, cache, resolvedCount } = await resolvePlaces(places, { geocode });
    expect(resolvedCount).toBe(2);
    expect(calls).toBe(2); // empty location skipped
    expect(located[0]).toMatchObject({ title: "Museum", lat: 48.86 });
    // cache is populated for reuse
    expect(geoCacheGet(cache, "Louvre")).toBeTruthy();
  });

  it("reuses cache and does not re-request", async () => {
    let calls = 0;
    const geocode = async () => { calls++; return { lat: 1, lng: 1 }; };
    const cache = geoCachePut({}, "Louvre", { lat: 48.86, lng: 2.33 });
    await resolvePlaces([places[0]], { geocode, cache });
    expect(calls).toBe(0);
  });

  it("degrades gracefully when the provider throws", async () => {
    const geocode = async () => { throw new Error("rate limited"); };
    const { located, resolvedCount } = await resolvePlaces(places, { geocode });
    expect(resolvedCount).toBe(0);
    expect(located).toEqual([]);
  });

  it("respects maxRequests", async () => {
    let calls = 0;
    const many = Array.from({ length: 30 }, (_, i) => ({ location: "p" + i }));
    const geocode = async () => { calls++; return { lat: 1, lng: 1 }; };
    await resolvePlaces(many, { geocode, maxRequests: 5 });
    expect(calls).toBe(5);
  });
});
