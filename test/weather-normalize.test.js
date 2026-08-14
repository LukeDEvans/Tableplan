import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
// weather.js is a CommonJS Netlify function — load it via require so its
// module.exports._test surface is reliable regardless of ESM interop.
const require = createRequire(import.meta.url);
const T = require("../netlify/functions/weather.js")._test;

afterEach(() => { vi.restoreAllMocks(); });

describe("unit conversion from NWS unitCodes", () => {
  it("converts temperature, wind, pressure, visibility, precip", () => {
    expect(T.cToF(0)).toBe(32);
    expect(T.cToF(100)).toBe(212);
    expect(T.conv({ value: 20, unitCode: "wmoUnit:degC" }, "tempF")).toBe(68);
    expect(T.conv({ value: 68, unitCode: "wmoUnit:degF" }, "tempF")).toBe(68); // already F, passthrough
    expect(T.conv({ value: 100, unitCode: "wmoUnit:km_h-1" }, "mph")).toBe(62.1);
    expect(T.conv({ value: 10, unitCode: "wmoUnit:m_s-1" }, "mph")).toBe(22.4);
    expect(T.conv({ value: 101325, unitCode: "wmoUnit:Pa" }, "inHg")).toBe(29.92);
    expect(T.conv({ value: 16093.44, unitCode: "wmoUnit:m" }, "miles")).toBe(10);
    expect(T.conv({ value: 25.4, unitCode: "wmoUnit:mm" }, "inches")).toBe(1);
    expect(T.conv({ value: 55, unitCode: "wmoUnit:percent" }, "percent")).toBe(55);
  });

  it("returns null for missing measurements (never invents a value)", () => {
    expect(T.conv(null, "tempF")).toBeNull();
    expect(T.conv({ value: null, unitCode: "wmoUnit:degC" }, "tempF")).toBeNull();
    expect(T.conv(undefined, "mph")).toBeNull();
  });

  it("maps wind direction to/from cardinal", () => {
    expect(T.cardinal(0)).toBe("N");
    expect(T.cardinal(90)).toBe("E");
    expect(T.cardinal(180)).toBe("S");
    expect(T.cardinal(200)).toBe("SSW");
    expect(T.cardinal(360)).toBe("N");
    expect(T.cardinalToDegrees("NE")).toBe(45);
    expect(T.cardinalToDegrees("bogus")).toBeNull();
    expect(T.parseWindMph("10 to 15 mph")).toBe(10);
    expect(T.parseWindMph("calm")).toBeNull();
  });

  it("parses zone ids and computes distance", () => {
    expect(T.zoneId("https://api.weather.gov/zones/forecast/COZ033")).toBe("COZ033");
    expect(T.zoneId(null)).toBeNull();
    expect(Math.round(T.haversineMiles(40, -105, 40, -105))).toBe(0);
    expect(T.haversineMiles(40.0, -105.0, 40.0, -105.5)).toBeCloseTo(26.5, 0); // 0.5° lon at 40°N

  });
});

describe("current conditions normalization + provenance", () => {
  const obs = {
    timestamp: "2026-08-14T02:55:00+00:00",
    textDescription: "Mostly Cloudy",
    temperature: { value: 21, unitCode: "wmoUnit:degC" },
    dewpoint: { value: 15, unitCode: "wmoUnit:degC" },
    relativeHumidity: { value: 73, unitCode: "wmoUnit:percent" },
    windDirection: { value: 320, unitCode: "wmoUnit:degree_(angle)" },
    windSpeed: { value: 10, unitCode: "wmoUnit:km_h-1" },
    windGust: { value: null },
    barometricPressure: { value: 101710, unitCode: "wmoUnit:Pa" },
    visibility: { value: 16093, unitCode: "wmoUnit:m" },
    heatIndex: { value: null },
    windChill: { value: null }
  };

  it("normalizes measured values and records station provenance", () => {
    const c = T.normalizeCurrent(obs, { id: "KBDU", name: "Boulder Muni", distanceMiles: 2.94 });
    expect(c.temperatureF).toBe(69.8);
    expect(c.description).toBe("Mostly Cloudy");
    expect(c.windDirectionCardinal).toBe("NW");
    expect(c.humidityPercent).toBe(73);
    expect(c.provenance.provider).toBe("NWS");
    expect(c.provenance.stationId).toBe("KBDU");
    expect(c.provenance.stationDistanceMiles).toBe(2.9);
    expect(c.provenance.isForecastDerived).toBe(false);
    expect(c.uvIndex).toBeNull();      // never invented
    expect(c.airQualityIndex).toBeNull();
  });

  it("apparent temp falls back heatIndex -> windChill -> temperature", () => {
    const withHeat = T.normalizeCurrent({ ...obs, heatIndex: { value: 30, unitCode: "wmoUnit:degC" } }, { id: "X" });
    expect(withHeat.apparentTemperatureF).toBe(86);
    const withChill = T.normalizeCurrent({ ...obs, windChill: { value: -5, unitCode: "wmoUnit:degC" } }, { id: "X" });
    expect(withChill.apparentTemperatureF).toBe(23);
    const plain = T.normalizeCurrent(obs, { id: "X" });
    expect(plain.apparentTemperatureF).toBe(plain.temperatureF); // falls back to temp
  });

  it("labels the forecast-derived fallback transparently", () => {
    const c = T.currentFromForecast([{ temperatureF: 70, description: "Sunny", windMph: 5 }], [], "2026-08-14T03:00:00Z");
    expect(c.temperatureF).toBe(70);
    expect(c.provenance.isForecastDerived).toBe(true);
    expect(c.provenance.stationId).toBeUndefined();
  });
});

describe("hourly / daily normalization handles nulls", () => {
  it("keeps null measurements as null and slices hourly", () => {
    const hourly = T.normalizeHourly([
      { startTime: "2026-08-14T15:00:00-06:00", temperature: 78, temperatureUnit: "F", isDaytime: true, probabilityOfPrecipitation: { value: 30 }, windSpeed: "10 mph", windDirection: "NW", shortForecast: "Sunny" },
      { startTime: "2026-08-14T16:00:00-06:00", temperature: 80, temperatureUnit: "F", probabilityOfPrecipitation: { value: null }, windSpeed: null, shortForecast: "Clear" }
    ]);
    expect(hourly).toHaveLength(2);
    expect(hourly[0].temperatureF).toBe(78);
    expect(hourly[0].precipProbabilityPercent).toBe(30);
    expect(hourly[0].windMph).toBe(10);
    expect(hourly[1].precipProbabilityPercent).toBeNull();
    expect(hourly[1].windMph).toBeNull();
  });

  it("normalizes daily periods", () => {
    const daily = T.normalizeDaily([
      { name: "Tonight", temperature: 58, isDaytime: false, shortForecast: "Chance Showers", detailedForecast: "A chance...", probabilityOfPrecipitation: { value: 40 }, windSpeed: "5 mph", windDirection: "S" }
    ]);
    expect(daily[0].name).toBe("Tonight");
    expect(daily[0].temperatureF).toBe(58);
    expect(daily[0].precipProbabilityPercent).toBe(40);
  });
});

describe("alerts: sorting, geometry, expiration", () => {
  it("sorts by severity then urgency then soonest expiry, and preserves geometry", () => {
    const feats = [
      { properties: { id: "a", event: "Flood Watch", severity: "Minor", urgency: "Future", expires: "2026-08-15T00:00:00Z" }, geometry: { type: "Polygon", coordinates: [[[0, 0]]] } },
      { properties: { id: "b", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", expires: "2026-08-14T05:00:00Z" }, geometry: null },
      { properties: { id: "c", event: "Severe Tstorm", severity: "Severe", urgency: "Expected", expires: "2026-08-14T04:00:00Z" }, geometry: { type: "Polygon", coordinates: [] } }
    ];
    const out = T.normalizeAlerts(feats);
    expect(out.map((a) => a.event)).toEqual(["Tornado Warning", "Severe Tstorm", "Flood Watch"]);
    expect(out[0].geometry).toBeNull();
    expect(out[1].geometry.type).toBe("Polygon");
    expect(out[0].expires).toBe("2026-08-14T05:00:00Z");
  });

  it("ties on severity/urgency break by earliest expiry", () => {
    const out = T.normalizeAlerts([
      { properties: { id: "late", event: "B", severity: "Severe", urgency: "Expected", expires: "2026-08-14T09:00:00Z" } },
      { properties: { id: "soon", event: "A", severity: "Severe", urgency: "Expected", expires: "2026-08-14T06:00:00Z" } }
    ]);
    expect(out.map((a) => a.event)).toEqual(["A", "B"]);
  });
});

describe("sun times + timezone/DST handling", () => {
  it("computes sunrise before sunset for a mid-latitude summer day", () => {
    const s = T.sunTimes(40.0, -105.27, new Date("2026-06-21T12:00:00Z"));
    expect(new Date(s.sunrise) < new Date(s.sunset)).toBe(true);
    // Boulder solstice sunrise ~11:33Z, sunset next-day ~02:34Z (~15h day)
    const dayHrs = (new Date(s.sunset) - new Date(s.sunrise)) / 3.6e6;
    expect(dayHrs).toBeGreaterThan(14);
    expect(dayHrs).toBeLessThan(16);
  });

  it("winter day is shorter than summer day", () => {
    const summer = T.sunTimes(40, -105.27, new Date("2026-06-21T12:00:00Z"));
    const winter = T.sunTimes(40, -105.27, new Date("2026-12-21T12:00:00Z"));
    const len = (s) => (new Date(s.sunset) - new Date(s.sunrise)) / 3.6e6;
    expect(len(winter)).toBeLessThan(len(summer));
  });

  it("formats a UTC instant in the location timezone across the US spring-forward boundary", () => {
    const tz = "America/New_York";
    const fmt = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    // 2026-03-08: clocks jump 2:00 -> 3:00 local. The 2 AM hour does not exist.
    expect(fmt("2026-03-08T06:00:00Z")).toBe("1:00 AM"); // EST, UTC-5
    expect(fmt("2026-03-08T07:00:00Z")).toBe("3:00 AM"); // EDT, UTC-4 (spring-forward)
  });
});

describe("nwsFetch: retry + timeout + error typing (mocked fetch)", () => {
  it("returns parsed JSON on 200 with a single call", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hi: 1 }) }));
    const data = await T.nwsFetch("https://api.weather.gov/x");
    expect(data).toEqual({ hi: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-transient 404 and throws a typed error", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(T.nwsFetch("https://api.weather.gov/x", { retries: 2 })).rejects.toMatchObject({ status: 404 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 500 then succeeds (bounded)", async () => {
    let n = 0;
    global.fetch = vi.fn(async () => (++n === 1 ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ ok: true }) }));
    const data = await T.nwsFetch("https://api.weather.gov/x", { retries: 2 });
    expect(data).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("location search is restricted to U.S. results (mocked fetch)", () => {
  it("filters out non-US and requires >=3 chars", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [
        { id: 1, name: "Boulder", admin1: "Colorado", country_code: "US", latitude: 40, longitude: -105, timezone: "America/Denver" },
        { id: 2, name: "Boulder", admin1: "X", country_code: "CA", latitude: 50, longitude: -114, timezone: "America/Edmonton" }
      ] })
    }));
    const out = await T.searchLocations("Boulder");
    expect(out).toHaveLength(1);
    expect(out[0].label).toContain("USA");
    expect(await T.searchLocations("ab")).toEqual([]); // too short, no fetch
  });
});

describe("UV/AQI enrichment adapter (mocked fetch)", () => {
  it("returns rounded UV + US AQI tagged with the provider", async () => {
    global.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes("air-quality") ? { current: { us_aqi: 61 } } : { current: { uv_index: 5.37 } })
    }));
    const e = await T.enrichUvAqi(40, -105);
    expect(e.uvIndex).toBe(5.4);
    expect(e.airQualityIndex).toBe(61);
    expect(e.provider).toBe("OPEN_METEO");
  });

  it("returns null when neither value is available (never invents)", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await T.enrichUvAqi(40, -105)).toBeNull();
  });

  it("keeps one value when only the other provider fails", async () => {
    global.fetch = vi.fn(async (url) => String(url).includes("air-quality")
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => ({ current: { uv_index: 3 } }) });
    const e = await T.enrichUvAqi(40, -105);
    expect(e.uvIndex).toBe(3);
    expect(e.airQualityIndex).toBeNull();
  });
});

describe("radar capabilities discovery (mocked fetch)", () => {
  it("reads the drawable layer id from the LegendURL, not a hard-coded guess", async () => {
    const xml = `<WMS_Capabilities><Capability><Request><GetMap/></Request></Capability>
      <Layer><LegendURL><OnlineResource xlink:href="https://x/WMSServer?request=GetLegendGraphic%26layer=7"/></LegendURL></Layer></WMS_Capabilities>`;
    global.fetch = vi.fn(async () => ({ ok: true, text: async () => xml }));
    const cap = await T.getRadarCapabilities();
    expect(cap.available).toBe(true);
    expect(cap.layer).toBe("7");
    expect(cap.legendUrl).toContain("layer=7");
  });

  it("reports unavailable when the service is down", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, text: async () => "" }));
    expect((await T.getRadarCapabilities()).available).toBe(false);
  });
});
