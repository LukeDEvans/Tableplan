// Explore's Local / State / Country / World rows (explore-scope.js).
import { describe, it, expect } from "vitest";
import {
  EXPLORE_SCOPES, LOCAL_KM, distanceKm, classifyPlace, tripScope, groupTrips, placeFromNominatim, isExploreScope,
} from "../explore-scope.js";

const home = { lat: 44.9778, lng: -93.265, country: "us", state: "Minnesota" }; // Minneapolis
const places = {
  "stillwater, mn": { lat: 45.0564, lng: -92.8085, country: "us", state: "Minnesota" },   // ~37 km
  "hudson, wi": { lat: 44.9747, lng: -92.7568, country: "us", state: "Wisconsin" },       // ~40 km, other state
  "duluth": { lat: 46.7867, lng: -92.1005, country: "us", state: "Minnesota" },           // ~220 km
  "chicago": { lat: 41.8781, lng: -87.6298, country: "us", state: "Illinois" },
  "amsterdam": { lat: 52.3676, lng: 4.9041, country: "nl", state: "North Holland" },
};
const placeOf = (q) => places[String(q).trim().toLowerCase()] || null;

describe("explore scopes", () => {
  it("lists the four rows in order", () => {
    expect(EXPLORE_SCOPES.map((s) => s.label)).toEqual(["Local", "State", "Country", "World"]);
    expect(isExploreScope("world")).toBe(true);
    expect(isExploreScope("unsorted")).toBe(false);
  });

  it("measures great-circle distance", () => {
    expect(Math.round(distanceKm(home, places.duluth))).toBeGreaterThan(200);
    expect(Math.round(distanceKm(home, places.duluth))).toBeLessThan(240);
    expect(distanceKm(home, { lat: NaN, lng: 1 })).toBeNull();
  });

  it("sorts a place by distance, state and country", () => {
    expect(classifyPlace(home, places["stillwater, mn"])).toBe("local");
    expect(classifyPlace(home, places["hudson, wi"])).toBe("local"); // close, even across a state line
    expect(classifyPlace(home, places.duluth)).toBe("state");
    expect(classifyPlace(home, places.chicago)).toBe("country");
    expect(classifyPlace(home, places.amsterdam)).toBe("world");
    expect(LOCAL_KM).toBe(100);
  });

  it("compares country and state case-insensitively", () => {
    expect(classifyPlace({ ...home, country: "US", state: "minnesota" }, places.duluth)).toBe("state");
  });

  it("can't sort without home, a place, or country information", () => {
    expect(classifyPlace(null, places.chicago)).toBeNull();
    expect(classifyPlace(home, null)).toBeNull();
    expect(classifyPlace({ lat: home.lat, lng: home.lng, country: "", state: "" }, places.chicago)).toBeNull();
    // ...but a nearby place is Local even before home's country is known.
    expect(classifyPlace({ lat: home.lat, lng: home.lng, country: "", state: "" }, places["stillwater, mn"])).toBe("local");
  });

  it("lets the user's choice win over the sorting", () => {
    expect(tripScope({ destination: "Amsterdam", scope: "local" }, { home, placeOf })).toBe("local");
    expect(tripScope({ destination: "Amsterdam", scope: "nonsense" }, { home, placeOf })).toBe("world");
    expect(tripScope({ destination: "", scope: "state" }, { home, placeOf })).toBe("state");
    expect(tripScope({ destination: "" }, { home, placeOf })).toBeNull();
    expect(tripScope({ destination: "Atlantis" }, { home, placeOf })).toBeNull();
  });

  it("groups trips, keeping the given order and collecting the unsorted", () => {
    const trips = [
      { id: "a", destination: "Chicago" },
      { id: "b", destination: "Amsterdam" },
      { id: "c", destination: "Stillwater, MN" },
      { id: "d", destination: "Atlantis" },
      { id: "e", destination: "Chicago", scope: "world" },
      { id: "f", destination: "Duluth" },
    ];
    const g = groupTrips(trips, { home, placeOf });
    expect(g.local.map((t) => t.id)).toEqual(["c"]);
    expect(g.state.map((t) => t.id)).toEqual(["f"]);
    expect(g.country.map((t) => t.id)).toEqual(["a"]);
    expect(g.world.map((t) => t.id)).toEqual(["b", "e"]);
    expect(g.unsorted.map((t) => t.id)).toEqual(["d"]);
  });

  it("reads Nominatim search and reverse results", () => {
    expect(placeFromNominatim({ lat: "41.87", lon: "-87.62", address: { country_code: "US", state: "Illinois" } }))
      .toEqual({ lat: 41.87, lng: -87.62, country: "us", state: "Illinois" });
    expect(placeFromNominatim({ lat: "52.1", lon: "5.1", address: { country_code: "nl", province: "Utrecht" } }).state).toBe("Utrecht");
    expect(placeFromNominatim({ lat: "x", lon: "1" })).toBeNull();
    expect(placeFromNominatim(null)).toBeNull();
    expect(placeFromNominatim({ error: "Unable to geocode" })).toBeNull();
  });
});
