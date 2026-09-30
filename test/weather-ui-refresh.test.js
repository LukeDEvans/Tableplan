// weather-ui.js page behavior with a stubbed DOM: refresh-tick guards (WX-2),
// client fetch timeout (WX-3), and the hero high after dark (WX-4).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWeatherModule } from "../weather-ui.js";

const NOW = new Date("2026-09-30T02:00:00Z"); // 10pm in New York

function snapshot(daily) {
  return {
    location: { label: "Town, ST", timezone: "America/New_York" },
    current: { temperatureF: 55, description: "Clear", provenance: {} },
    hourly: [], alerts: [], products: [],
    daily,
    fetchedAt: NOW.toISOString(),
  };
}
const TONIGHT_FIRST = [
  { name: "Tonight", isDaytime: false, temperatureF: 41, startTime: "2026-09-29T22:00:00-04:00", description: "Clear" },
  { name: "Tuesday", isDaytime: true, temperatureF: 72, startTime: "2026-09-30T06:00:00-04:00", description: "Sunny" },
];
const DAY_FIRST = [
  { name: "Today", isDaytime: true, temperatureF: 68, startTime: "2026-09-29T06:00:00-04:00", description: "Sunny" },
  { name: "Tonight", isDaytime: false, temperatureF: 45, startTime: "2026-09-29T18:00:00-04:00", description: "Clear" },
];

let root, renders, listeners, fetchMock, mod;

function setup(daily) {
  renders = 0;
  listeners = {};
  let html = "";
  const inside = { id: "wxSearchInput" };
  root = {
    get innerHTML() { return html; },
    set innerHTML(v) { renders++; html = v; },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    contains: (el) => el === inside,
    inside,
  };
  vi.stubGlobal("document", { hidden: false, activeElement: null, body: {}, getElementById: () => null });
  vi.stubGlobal("window", { location: { protocol: "http:" } });
  vi.stubGlobal("navigator", {});
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => snapshot(daily) }));
  vi.stubGlobal("fetch", fetchMock);
  const state = { weatherLocations: [{ id: "a", label: "Town, ST", latitude: 1, longitude: 2, timezone: "America/New_York" }], weatherActiveLocationId: "a" };
  mod = createWeatherModule({
    state, elements: { weatherPageInner: root }, persist: () => {}, escapeHtml: (s) => String(s),
    canUseLocalBackend: () => true, getActiveAppArea: () => "weather", ensureLeaflet: async () => {},
  });
}
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { mod?.stopWeatherRefreshLoop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("weather page refresh (WX-2)", () => {
  it("a background refresh of an existing snapshot renders once, not twice", async () => {
    setup(DAY_FIRST);
    mod.initWeatherPage();
    await flush();
    const before = renders;
    await vi.advanceTimersByTimeAsync(90 * 1000);
    await flush();
    expect(renders - before).toBe(1);
  });
  it("skips the refresh tick while the location picker is open", async () => {
    setup(DAY_FIRST);
    mod.initWeatherPage();
    await flush();
    listeners.click({ target: { closest: () => ({ dataset: { wxAction: "toggle-picker" } }) } });
    const before = renders;
    await vi.advanceTimersByTimeAsync(90 * 1000);
    await flush();
    expect(renders).toBe(before);
  });
  it("skips the refresh tick while focus is inside the weather page", async () => {
    setup(DAY_FIRST);
    mod.initWeatherPage();
    await flush();
    document.activeElement = root.inside;
    const before = renders;
    await vi.advanceTimersByTimeAsync(90 * 1000);
    await flush();
    expect(renders).toBe(before);
  });
});

describe("weather client fetch (WX-3)", () => {
  it("passes an abort signal so a hung request times out", async () => {
    setup(DAY_FIRST);
    mod.initWeatherPage();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("weather hero high/low (WX-4)", () => {
  it("omits the high at night instead of showing tomorrow's", async () => {
    setup(TONIGHT_FIRST);
    mod.initWeatherPage();
    await flush();
    expect(root.innerHTML).toContain("↓ 41°");
    expect(root.innerHTML).not.toContain("↑ 72°");
  });
  it("shows today's high and tonight's low during the day", async () => {
    setup(DAY_FIRST);
    mod.initWeatherPage();
    await flush();
    expect(root.innerHTML).toContain("↑ 68°");
    expect(root.innerHTML).toContain("↓ 45°");
  });
});
