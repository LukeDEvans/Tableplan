import { describe, it, expect } from "vitest";
import {
  CONDITIONS, parseNwsIcon, conditionFor, conditionLabel, conditionAttention, weatherEmphasis,
} from "../weather-condition.js";

const icon = (path) => `https://api.weather.gov/icons/land/${path}?size=medium`;

describe("parseNwsIcon", () => {
  it("reads day/night + condition token(s)", () => {
    expect(parseNwsIcon(icon("day/few"))).toEqual({ isDay: true, tokens: ["few"] });
    expect(parseNwsIcon(icon("night/rain,40"))).toEqual({ isDay: false, tokens: ["rain"] });
  });
  it("keeps both split conditions (rain then thunderstorm)", () => {
    expect(parseNwsIcon(icon("day/rain,30/tsra,60"))).toEqual({ isDay: true, tokens: ["rain", "tsra"] });
  });
  it("null on junk / missing", () => {
    expect(parseNwsIcon(null)).toBe(null);
    expect(parseNwsIcon("https://example.com/x.png")).toBe(null);
  });
});

describe("conditionFor — icon-driven", () => {
  it("maps the core sky tokens", () => {
    expect(conditionFor({ icon: icon("day/skc") }).key).toBe("clear");
    expect(conditionFor({ icon: icon("day/sct") }).key).toBe("partly-cloudy");
    expect(conditionFor({ icon: icon("day/bkn") }).key).toBe("cloudy");
    expect(conditionFor({ icon: icon("day/ovc") }).key).toBe("overcast");
  });
  it("carries day/night from the icon", () => {
    expect(conditionFor({ icon: icon("night/few") }).isDay).toBe(false);
    expect(conditionFor({ icon: icon("day/few") }).isDay).toBe(true);
  });
  it("surfaces the more significant of two icon conditions", () => {
    expect(conditionFor({ icon: icon("day/rain,30/tsra,60") }).key).toBe("thunderstorm");
  });
  it("wind_* resolves to the base sky, not lost", () => {
    expect(conditionFor({ icon: icon("day/wind_bkn") }).key).toBe("cloudy");
    expect(conditionFor({ icon: icon("day/wind") }).key).toBe("wind");
  });
  it("freezing / mixed precip → sleet", () => {
    expect(conditionFor({ icon: icon("night/snow_fzra") }).key).toBe("sleet");
    expect(conditionFor({ icon: icon("day/rain_snow") }).key).toBe("sleet");
  });
  it("every mapped key is in the canonical set", () => {
    for (const p of ["day/skc", "day/sct", "day/bkn", "day/ovc", "day/rain", "day/tsra", "night/snow", "day/blizzard", "day/fog", "day/haze", "day/wind"]) {
      expect(CONDITIONS).toContain(conditionFor({ icon: icon(p) }).key);
    }
  });
});

describe("conditionFor — text refinement + text-only (observations have no icon)", () => {
  it("promotes heavy variants from the phrase even over a plain icon", () => {
    expect(conditionFor({ icon: icon("day/rain"), shortForecast: "Heavy Rain" }).key).toBe("heavy-rain");
    expect(conditionFor({ icon: icon("day/snow"), shortForecast: "Heavy snow likely" }).key).toBe("heavy-snow");
    expect(conditionFor({ icon: icon("day/rain"), shortForecast: "Thunderstorms" }).key).toBe("thunderstorm");
  });
  it("resolves current-obs text with no icon", () => {
    expect(conditionFor({ description: "Partly Cloudy", isDaytime: true }).key).toBe("partly-cloudy");
    expect(conditionFor({ description: "Mostly Cloudy" }).key).toBe("cloudy");
    expect(conditionFor({ description: "Light Rain" }).key).toBe("rain");
    expect(conditionFor({ description: "Fair" }).key).toBe("clear");
    expect(conditionFor({ description: "Fog/Mist" }).key).toBe("fog");
  });
  it("derives day/night from sunrise/sunset when no icon/flag", () => {
    const sunrise = "2026-06-01T10:00:00Z", sunset = "2026-06-02T00:00:00Z";
    expect(conditionFor({ description: "Clear", sunrise, sunset, at: "2026-06-01T18:00:00Z" }).isDay).toBe(true);
    expect(conditionFor({ description: "Clear", sunrise, sunset, at: "2026-06-02T04:00:00Z" }).isDay).toBe(false);
  });
  it("defaults to clear/day on empty input rather than throwing", () => {
    expect(conditionFor({})).toEqual({ key: "clear", isDay: true });
  });
});

describe("conditionAttention + weatherEmphasis", () => {
  it("orders benign below hazardous", () => {
    expect(conditionAttention("clear")).toBeLessThan(conditionAttention("rain"));
    expect(conditionAttention("rain")).toBeLessThan(conditionAttention("thunderstorm"));
  });
  it("alerts dominate the emphasis", () => {
    expect(weatherEmphasis({ conditionKey: "clear", alerts: [{ severity: "Extreme" }] })).toBe("extreme");
    expect(weatherEmphasis({ conditionKey: "clear", alerts: [{ severity: "Severe" }] })).toBe("severe");
    expect(weatherEmphasis({ conditionKey: "clear", alerts: [{ severity: "Minor" }] })).toBe("elevated");
  });
  it("stormy sky elevates on its own; calm otherwise", () => {
    expect(weatherEmphasis({ conditionKey: "thunderstorm", alerts: [] })).toBe("elevated");
    expect(weatherEmphasis({ conditionKey: "partly-cloudy", alerts: [] })).toBe("calm");
  });
  it("labels are human", () => {
    expect(conditionLabel("partly-cloudy")).toBe("Partly Cloudy");
    expect(conditionLabel("heavy-snow")).toBe("Heavy Snow");
  });
});
