import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { splitPlaceQuery } = require("../netlify/functions/weather.js")._test;

// Open-Meteo geocoding matches the place name only, so "City, ST" returned
// nothing — the server splits the state off and filters by it instead.
describe("weather search query splitting", () => {
  it("passes a bare city through", () => {
    expect(splitPlaceQuery("Minneapolis")).toEqual({ name: "Minneapolis", state: null });
    expect(splitPlaceQuery("New York")).toEqual({ name: "New York", state: null });
    expect(splitPlaceQuery("Kansas City")).toEqual({ name: "Kansas City", state: null });
  });
  it("splits a comma-separated state code or name", () => {
    expect(splitPlaceQuery("Portland, OR")).toEqual({ name: "Portland", state: "Oregon" });
    expect(splitPlaceQuery("Kansas City, Mo.")).toEqual({ name: "Kansas City", state: "Missouri" });
    expect(splitPlaceQuery("Duluth, minnesota")).toEqual({ name: "Duluth", state: "Minnesota" });
  });
  it("splits a trailing state without a comma", () => {
    expect(splitPlaceQuery("Austin TX")).toEqual({ name: "Austin", state: "Texas" });
    expect(splitPlaceQuery("Saint Paul Minnesota")).toEqual({ name: "Saint Paul", state: "Minnesota" });
  });
  it("drops a trailing country", () => {
    expect(splitPlaceQuery("Boise, USA")).toEqual({ name: "Boise", state: null });
  });
});

describe("searchLocations with a state hint (mocked fetch)", () => {
  const T = require("../netlify/functions/weather.js")._test;
  const results = [
    { id: 1, name: "Portland", admin1: "Oregon", country_code: "US", latitude: 45.5, longitude: -122.7, timezone: "America/Los_Angeles" },
    { id: 2, name: "Portland", admin1: "Maine", country_code: "US", latitude: 43.7, longitude: -70.3, timezone: "America/New_York" },
  ];
  it("queries the bare name and keeps only the matching state", async () => {
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ results }) }; };
    const out = await T.searchLocations("Portland, ME");
    expect(urls[0]).toContain("name=Portland&");
    expect(out.map((r) => r.label)).toEqual(["Portland, Maine, USA"]);
  });
  it("falls back to every U.S. match when the state matches none", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results }) });
    expect(await T.searchLocations("Portland, TX")).toHaveLength(2);
  });
});
