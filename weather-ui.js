// weather-ui.js — the Weather domain, extracted from app.js as a PURE STRUCTURAL
// MOVE (no behavior change). The normalized weather service (fetch + cache +
// selectors), the page rendering/handlers, and the lazy Leaflet radar map live
// here; app.js keeps only the thin nav entry `showWeatherApp` and calls into this
// module. The pure tested logic modules (weather-cache/condition/art) are imported
// directly and used unchanged — see WEATHER.md.
//
// Other modules must consume getWeatherSnapshot()/its selectors, never raw NOAA.
//
// Dependencies from the app shell are INJECTED via createWeatherModule(deps):
//   state              shared app-state object (state.weatherLocations, state.weatherActiveLocationId)
//   elements           shared DOM-refs object (elements.weatherPageInner, …)
//   persist            save the state
//   escapeHtml         HTML-escape helper
//   canUseLocalBackend true on localhost dev → hit /api/* instead of /.netlify/functions/*
//   getActiveAppArea   () => activeAppArea — lets loads/refresh bail when the user
//                      has left the Weather page, without importing the nav global
//   ensureLeaflet      SHARED Leaflet CDN loader — kept in app.js because Travel Mode's
//                      map (renderTravelMap) uses it too; injected here, not duplicated
//
// CROSS-DOMAIN: getCurrentConditions() is consumed by Travel Mode
// (travelModeWeather in app.js) to show a trip's current temperature; it is part of
// this module's returned interface for that reason. ensureLeaflet is shared with
// Travel Mode's map (see above).

import { createWeatherCache } from './weather-cache.js';
import { conditionFor, conditionLabel, weatherEmphasis } from './weather-condition.js';
import { heroArtSvg, iconSvg } from './weather-art.js';

export function createWeatherModule(deps) {
  const { state, elements, persist, escapeHtml, canUseLocalBackend, getActiveAppArea, ensureLeaflet } = deps;

function weatherApiUrl(params) {
  const qs = new URLSearchParams(params).toString();
  if (canUseLocalBackend()) return `/api/weather?${qs}`;
  if (window.location.protocol.startsWith("http")) return `/.netlify/functions/weather?${qs}`;
  return "";
}
const WEATHER_TTL = { snapshot: 12 * 60 * 1000, search: 10 * 60 * 1000, product: 12 * 60 * 1000 };
const weatherCache = createWeatherCache(); // TTL cache + in-flight de-dup (tested in weather-cache.test.js)
async function weatherRequest(params, ttl) {
  return weatherCache.request(JSON.stringify(params), ttl, async () => {
    const res = await fetch(weatherApiUrl(params));
    if (!res.ok) { const e = new Error(`weather ${res.status}`); e.status = res.status; try { e.body = await res.json(); } catch {} throw e; }
    return res.json();
  });
}
// Shared service (consumed by the page now; sailing/calendar/briefing later).
async function getWeatherSnapshot(location, opts = {}) {
  const params = { action: "snapshot", lat: location.latitude, lon: location.longitude };
  if (location.label) params.label = location.label;
  if (location.timezone) params.timezone = location.timezone;
  try { return await weatherRequest(params, opts.maxAgeMs ?? WEATHER_TTL.snapshot); }
  catch (err) {
    const cached = weatherCache.peek(JSON.stringify(params)); // serve stale on upstream failure
    if (cached) return { ...cached, isStale: true, warnings: [...(cached.warnings || []), "Showing recently cached data."] };
    throw err;
  }
}
async function getCurrentConditions(location) { return (await getWeatherSnapshot(location)).current; }
async function getHourlyForecast(location) { return (await getWeatherSnapshot(location)).hourly; }
async function getDailyForecast(location) { return (await getWeatherSnapshot(location)).daily; }
async function getActiveAlerts(location) { return (await getWeatherSnapshot(location)).alerts; }
async function getWeatherProducts(location) { return (await getWeatherSnapshot(location)).products; }
async function getWeatherProductText(office, type) { return (await weatherRequest({ action: "product", office, type }, WEATHER_TTL.product)).product; }
async function searchWeatherLocations(query) { const q = String(query || "").trim(); if (q.length < 3) return []; return (await weatherRequest({ action: "search", q }, WEATHER_TTL.search)).results || []; }
function getMapLayerCatalog() { return []; } // Phase 2 (WMS GetCapabilities)

// ── Weather page state ────────────────────────────────────────────────────────
let weatherActiveLocation = null;   // WeatherLocation currently displayed
let weatherCurrentGeoLoc = null;    // session-only geolocation result (id "current")
let weatherSnapshot = null;
let weatherStatus = "idle";         // idle | loading | geolocating | ready | error
let weatherErrorMsg = "";
let weatherGenId = 0;               // cancels stale loads on location change / leave
let weatherRefreshTimer = null;
let weatherPickerOpen = false;
let weatherSearchResults = [];
let weatherSearchTimer = null;
let weatherSearchBusy = false;
let weatherSearchGen = 0;           // separate from weatherGenId so a search never cancels a snapshot load
const weatherExpanded = new Set();  // expanded disclosure section ids
const weatherProductText = new Map(); // `${office}:${type}` -> product | "loading" | "none"
let weatherWired = false;

function initWeatherPage() {
  const saved = state.weatherLocations || [];
  const activeId = state.weatherActiveLocationId;
  let loc = saved.find((l) => l.id === activeId) || null;
  if (!loc && activeId === "current" && weatherCurrentGeoLoc) loc = weatherCurrentGeoLoc;
  if (loc) setWeatherLocation(loc, { persistChoice: false });
  else if (weatherActiveLocation) loadWeatherSnapshot();
  else if (saved.length) setWeatherLocation(saved[0], { persistChoice: false });
  else { weatherStatus = "idle"; renderWeatherPage(); useCurrentWeatherLocation(); }
  startWeatherRefreshLoop();
}

function setWeatherLocation(loc, { persistChoice = true } = {}) {
  weatherActiveLocation = loc;
  if (persistChoice) { state.weatherActiveLocationId = loc.id; persist(); }
  weatherSnapshot = null;
  weatherPickerOpen = false;
  loadWeatherSnapshot();
}

async function loadWeatherSnapshot() {
  if (!weatherActiveLocation) { renderWeatherPage(); return; }
  const gen = ++weatherGenId;
  weatherStatus = weatherSnapshot ? "ready" : "loading"; // keep old data visible while refreshing
  weatherErrorMsg = "";
  renderWeatherPage();
  try {
    const snap = await getWeatherSnapshot(weatherActiveLocation);
    if (gen !== weatherGenId || getActiveAppArea() !== "weather") return; // superseded / left page
    weatherSnapshot = snap;
    weatherStatus = "ready";
  } catch (err) {
    if (gen !== weatherGenId || getActiveAppArea() !== "weather") return;
    weatherErrorMsg = err?.body?.error || (err?.status === 404 ? "This location is outside NWS coverage (U.S. only)." : "Weather is unavailable right now.");
    weatherStatus = weatherSnapshot ? "ready" : "error";
  }
  renderWeatherPage();
}

function useCurrentWeatherLocation() {
  if (!navigator.geolocation) { weatherStatus = "error"; weatherErrorMsg = "Location isn't available on this device — search for a place instead."; renderWeatherPage(); return; }
  weatherStatus = "geolocating"; weatherErrorMsg = ""; renderWeatherPage();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      weatherCurrentGeoLoc = { id: "current", label: "Current location", latitude: pos.coords.latitude, longitude: pos.coords.longitude, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, isCurrentLocation: true };
      state.weatherActiveLocationId = "current"; persist();
      setWeatherLocation(weatherCurrentGeoLoc, { persistChoice: false });
    },
    (err) => {
      weatherStatus = weatherSnapshot ? "ready" : "idle";
      weatherErrorMsg = err.code === err.PERMISSION_DENIED ? "Location permission denied — search for a place or pick a saved one." : "Couldn't get your location — search instead.";
      weatherPickerOpen = !weatherSnapshot; // open the picker so they can act
      renderWeatherPage();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
  );
}

function startWeatherRefreshLoop() {
  stopWeatherRefreshLoop();
  // Foreground-only refresh; paused when the tab is hidden or the user leaves.
  weatherRefreshTimer = setInterval(() => {
    if (getActiveAppArea() !== "weather" || document.hidden || !weatherActiveLocation) return;
    loadWeatherSnapshot();
  }, 90 * 1000);
}
function stopWeatherRefreshLoop() { if (weatherRefreshTimer) { clearInterval(weatherRefreshTimer); weatherRefreshTimer = null; } }

// ── Formatting helpers ──────────────────────────────────────────────────────
function wxFmt(iso, tz, opts) { try { return new Date(iso).toLocaleString("en-US", { timeZone: tz, ...opts }); } catch { return ""; } }
function wxHourLabel(iso, tz) { return wxFmt(iso, tz, { hour: "numeric" }); }
function wxWeekday(iso, tz) { return wxFmt(iso, tz, { weekday: "short" }); }
function wxClock(iso, tz) { return wxFmt(iso, tz, { hour: "numeric", minute: "2-digit" }); }
function wxTempStr(n) { return n == null ? "—" : `${Math.round(n)}°`; }
function wxNum(n, suffix = "") { return n == null ? "—" : `${n}${suffix}`; }
function wxAgo(iso) { const m = Math.round((Date.now() - new Date(iso)) / 60000); if (!isFinite(m)) return ""; if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); return `${h} hr ago`; }
function wxUvLabel(uv) { if (uv == null) return "—"; const c = uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very high" : "Extreme"; return `${uv} · ${c}`; }
function wxAqiLabel(aqi) { if (aqi == null) return "—"; const c = aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy (sensitive)" : aqi <= 200 ? "Unhealthy" : aqi <= 300 ? "Very unhealthy" : "Hazardous"; return `${aqi} · ${c}`; }
const WX_SEVERITY_CLASS = { Extreme: "wx-sev-extreme", Severe: "wx-sev-severe", Moderate: "wx-sev-moderate", Minor: "wx-sev-minor" };

// ── Render ──────────────────────────────────────────────────────────────────
function renderWeatherPage() {
  const el = elements.weatherPageInner;
  if (!el) return;
  wireWeatherPage();
  const loc = weatherActiveLocation;
  const s = weatherSnapshot;
  const tz = s?.location?.timezone || loc?.timezone || "America/New_York";
  const label = s?.location?.label || loc?.label || "Weather";
  const updated = s ? `Updated ${wxAgo(s.fetchedAt)}` : "";
  // The "+" next to the city adds the shown place to the saved list. Hidden once
  // it's saved (or for the live "current" location, which isn't a saved place).
  const savedLocs = state.weatherLocations || [];
  const canSaveActive = !!(loc && loc.id !== "current" && !savedLocs.some((l) => l.id === loc.id));
  const header = `
    <div class="wx-header">
      <div class="wx-header-loc">
        <button class="wx-location-btn" type="button" data-wx-action="toggle-picker" aria-expanded="${weatherPickerOpen}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
          <span class="wx-location-name">${escapeHtml(label)}</span>
          <span class="wx-caret">▾</span>
        </button>
        ${canSaveActive ? `<button class="wx-add-btn" type="button" data-wx-action="save-current" title="Add ${escapeHtml(wxShortLoc(label))} to your weather page" aria-label="Add ${escapeHtml(wxShortLoc(label))} to your weather page">+</button>` : ""}
      </div>
      <div class="wx-updated">${s?.isStale ? `<span class="wx-stale">Stale</span> ` : ""}${escapeHtml(updated)}</div>
    </div>`;

  let body;
  if (weatherStatus === "geolocating") body = `<div class="wx-skeleton">Finding your location…</div>`;
  else if (!loc) body = wxEmptyState();
  else if (weatherStatus === "error" && !s) body = `<div class="wx-error">${escapeHtml(weatherErrorMsg || "Weather unavailable.")}</div>`;
  else if (!s) body = `<div class="wx-skeleton">Loading weather…</div>`;
  else body = wxDashboard(s, tz);

  el.innerHTML = header
    + (loc ? wxLocationRail() : "")
    + (weatherPickerOpen ? wxPicker() : "")
    + (weatherErrorMsg && s ? `<div class="wx-inline-warn">${escapeHtml(weatherErrorMsg)}</div>` : "")
    + body;
}

function wxShortLoc(label) { return String(label || "").split(",")[0].trim() || "Location"; }

function wxLocationRail() {
  // Just the saved cities (quick-switch). "Current" moved to the search picker
  // ("Use my location"); adding a place is the "+" beside the city name.
  const saved = state.weatherLocations || [];
  if (!saved.length) return "";
  const active = weatherActiveLocation;
  const chips = saved.map((l) => `<button class="wx-loc" type="button" data-wx-action="select-saved" data-id="${escapeHtml(l.id)}" aria-current="${active && active.id === l.id ? "true" : "false"}">${escapeHtml(wxShortLoc(l.label))}</button>`);
  return `<div class="wx-locrail" role="group" aria-label="Saved locations">${chips.join("")}</div>`;
}

function wxEmptyState() {
  return `
    <div class="wx-empty">
      <p>See current conditions, forecasts, and alerts for any U.S. location.</p>
      <button class="primary-btn" type="button" data-wx-action="use-current">Use my location</button>
      <button class="secondary-btn" type="button" data-wx-action="toggle-picker">Search a place</button>
    </div>`;
}

function wxPicker() {
  const saved = state.weatherLocations || [];
  const savedHtml = saved.length ? saved.map((l) => `
    <div class="wx-saved-row">
      <button class="wx-saved-pick" type="button" data-wx-action="select-saved" data-id="${escapeHtml(l.id)}">${escapeHtml(l.label)}</button>
      <button class="icon-btn wx-saved-remove" type="button" data-wx-action="remove-saved" data-id="${escapeHtml(l.id)}" aria-label="Remove ${escapeHtml(l.label)}">&times;</button>
    </div>`).join("") : `<div class="wx-picker-empty">No saved locations yet.</div>`;
  const results = weatherSearchResults.map((r) => `
    <button class="wx-search-result" type="button" data-wx-action="select-result" data-id="${escapeHtml(r.id)}">${escapeHtml(r.label)}</button>`).join("");
  const canSave = weatherActiveLocation && weatherActiveLocation.id !== "current" && !saved.some((l) => l.id === weatherActiveLocation.id);
  return `
    <div class="wx-picker">
      <button class="wx-picker-current" type="button" data-wx-action="use-current">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg> Use my location
      </button>
      <div class="wx-search-wrap">
        <input type="search" class="wx-search-input" id="wxSearchInput" placeholder="Search a U.S. city…" autocomplete="off" value="" />
        ${weatherSearchBusy ? `<span class="wx-search-busy">…</span>` : ""}
      </div>
      ${results ? `<div class="wx-search-results">${results}</div>` : ""}
      <div class="wx-picker-label">Saved</div>
      ${savedHtml}
      ${canSave ? `<button class="secondary-btn wx-save-current" type="button" data-wx-action="save-current">+ Save “${escapeHtml(weatherActiveLocation.label)}”</button>` : ""}
      <div class="wx-attribution">Search by Open-Meteo / GeoNames · Weather by NWS/NOAA</div>
    </div>`;
}

function wxAlertCard(a) {
  const cls = WX_SEVERITY_CLASS[a.severity] || "wx-sev-minor";
  const open = weatherExpanded.has(`alert:${a.id}`);
  const tz = weatherActiveLocation?.timezone || "America/New_York";
  const until = a.expires ? `until ${wxClock(a.expires, tz)}` : "";
  const meta = [a.affectedArea, a.urgency, a.certainty].filter((x) => x && x !== "Unknown").join(" · ");
  return `
    <div class="wx-alert ${cls}">
      <button class="wx-alert-head" type="button" data-wx-action="toggle" data-id="alert:${escapeHtml(a.id)}" aria-expanded="${open}">
        <span class="wx-alert-sev">${escapeHtml(a.severity === "Unknown" ? "Advisory" : a.severity)}</span>
        <span class="wx-alert-event">${escapeHtml(a.event)}</span>
        ${until ? `<span class="wx-alert-meta">${escapeHtml(until)}</span>` : ""}
        <span class="wx-caret" aria-hidden="true">${open ? "▴" : "▾"}</span>
      </button>
      ${open ? `<div class="wx-alert-body">
        ${meta ? `<div class="wx-alert-area">${escapeHtml(meta)}</div>` : ""}
        ${a.headline ? `<div class="wx-alert-headline">${escapeHtml(a.headline)}</div>` : ""}
        <div class="wx-alert-desc">${escapeHtml(a.description || "")}</div>
        ${a.instructions ? `<div class="wx-alert-instr"><b>What to do:</b> ${escapeHtml(a.instructions)}</div>` : ""}
      </div>` : ""}
    </div>`;
}

function wxDashboard(s, tz) {
  const c = s.current || {};
  const nowHour = (s.hourly || [])[0] || {};
  // Prefer the real station observation for the hero condition (so the artwork
  // matches the shown label); fall back to the current forecast hour's icon.
  const hasObs = !!c.description && !c.provenance?.isForecastDerived;
  const cond = conditionFor(hasObs
    ? { description: c.description, sunrise: c.sunrise, sunset: c.sunset, at: c.provenance?.observedAt || s.fetchedAt }
    : { icon: nowHour.icon, shortForecast: nowHour.description, isDaytime: nowHour.isDaytime, sunrise: c.sunrise, sunset: c.sunset, at: s.fetchedAt });
  const emphasis = weatherEmphasis({ conditionKey: cond.key, alerts: s.alerts || [] });
  const alertsHtml = (s.alerts || []).length ? `<div class="wx-alerts">${s.alerts.map(wxAlertCard).join("")}</div>` : "";
  return `
    ${alertsHtml}
    <div class="wx-grid" data-emphasis="${emphasis}">
      ${wxHero(s, c, cond)}
      ${wxHourlyCard(s, tz)}
      <div class="wx-col">
        ${wxDailyCard(s, tz)}
        ${wxRadarCard(s)}
      </div>
      <div class="wx-col">
        ${wxDetailGroups(s, c, tz)}
        ${wxTrendCard(s, tz)}
        ${wxFeedCard(s)}
      </div>
    </div>`;
}

// clear/partly day = open sky (default); cloud/precip day = muted; night/severe = dark.
function wxHeroMood(cond) {
  if (!cond.isDay) return "mood-night";
  if (["thunderstorm", "heavy-rain", "heavy-snow"].includes(cond.key)) return "mood-storm";
  if (["cloudy", "overcast", "rain", "snow", "sleet", "fog", "haze", "wind"].includes(cond.key)) return "mood-cloud";
  return "";
}

function wxHero(s, c, cond) {
  const prov = c.provenance || {};
  const obs = prov.isForecastDerived
    ? "Forecast data — no recent station observation"
    : `${escapeHtml(prov.stationName || prov.stationId || "Nearby station")}${prov.stationDistanceMiles != null ? ` · ${prov.stationDistanceMiles} mi` : ""}${prov.observedAt ? ` · ${escapeHtml(wxAgo(prov.observedAt))}` : ""}`;
  const today = s.daily?.[0];
  const condLabel = c.description || today?.description || conditionLabel(cond.key, cond.isDay);
  const hi = s.daily?.find((d) => d.isDaytime)?.temperatureF;
  const lo = s.daily?.find((d) => !d.isDaytime)?.temperatureF;
  const hilo = [hi != null ? `↑ ${Math.round(hi)}°` : "", lo != null ? `↓ ${Math.round(lo)}°` : ""].filter(Boolean).join("  ");
  const summary = today?.detailedForecast || today?.description || "";
  const chips = [
    c.windMph != null ? `🍃 ${c.windMph} mph ${c.windDirectionCardinal || ""}`.trim() : "",
    c.humidityPercent != null ? `💧 ${c.humidityPercent}%` : "",
    c.uvIndex != null ? `☀︎ UV ${wxUvLabel(c.uvIndex)}` : "",
    c.visibilityMiles != null ? `🌫 ${c.visibilityMiles} mi` : "",
  ].filter(Boolean).map((t) => `<span class="wx-chip">${escapeHtml(t)}</span>`).join("");
  return `
    <section class="wx-card wx-hero wx-span ${wxHeroMood(cond)}">
      ${heroArtSvg(cond.key, cond.isDay)}
      <div class="wx-hero-inner">
        <div class="wx-hero-obs">${obs}</div>
        <div class="wx-temp">${c.temperatureF != null ? Math.round(c.temperatureF) : "—"}<sup>°F</sup></div>
        <div class="wx-hero-cond">${escapeHtml(condLabel)}</div>
        <div class="wx-hero-feels">Feels like ${wxTempStr(c.apparentTemperatureF)}</div>
        ${hilo || summary ? `<div class="wx-hero-hilo">${escapeHtml(hilo)}${hilo && summary ? "  ·  " : ""}${escapeHtml(summary)}</div>` : ""}
        ${chips ? `<div class="wx-hero-chips">${chips}</div>` : ""}
      </div>
    </section>`;
}

function wxHourlyCard(s, tz) {
  const hours = (s.hourly || []).slice(0, 24);
  if (!hours.length) return "";
  const cells = hours.map((h, i) => {
    const cond = conditionFor({ icon: h.icon, shortForecast: h.description, isDaytime: h.isDaytime });
    const pop = h.precipProbabilityPercent;
    const wind = [h.windDirectionCardinal, h.windMph].filter((v) => v != null && v !== "").join(" ");
    return `
      <div class="wx-hour${i === 0 ? " is-now" : ""}" role="listitem">
        <div class="wx-hour-hh">${i === 0 ? "Now" : escapeHtml(wxHourLabel(h.startTime, tz))}</div>
        ${iconSvg(cond.key, cond.isDay)}
        <div class="wx-hour-temp">${wxTempStr(h.temperatureF)}</div>
        <div class="wx-hour-pop${pop ? "" : " is-zero"}">💧${pop || 0}%</div>
        <div class="wx-hour-wd">${escapeHtml(wind)}</div>
      </div>`;
  }).join("");
  return `
    <section class="wx-card wx-span">
      <div class="wx-card-hd"><h3>Hourly</h3><span class="wx-sub">Next 24 hours · scroll →</span></div>
      <div class="wx-rail" role="list" aria-label="Hourly forecast">${cells}</div>
    </section>`;
}

// Fold NWS day/night periods into calendar days with a high, low, pop, and condition.
function wxFoldDaily(periods, tz) {
  const keyOf = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); } catch { return String(iso).slice(0, 10); } };
  const order = [];
  const byKey = new Map();
  for (const p of periods || []) {
    if (!p?.startTime) continue;
    const k = keyOf(p.startTime);
    if (!byKey.has(k)) { byKey.set(k, { key: k, periods: [] }); order.push(k); }
    byKey.get(k).periods.push(p);
  }
  const todayKey = keyOf(new Date().toISOString());
  return order.map((k) => {
    const g = byKey.get(k);
    const day = g.periods.find((p) => p.isDaytime);
    const night = g.periods.find((p) => !p.isDaytime);
    const temps = g.periods.map((p) => p.temperatureF).filter((v) => v != null);
    const hi = day ? day.temperatureF : (temps.length ? Math.max(...temps) : null);
    const lo = night ? night.temperatureF : (temps.length ? Math.min(...temps) : null);
    const pop = Math.max(0, ...g.periods.map((p) => p.precipProbabilityPercent || 0));
    const src = day || night || g.periods[0];
    const cond = conditionFor({ icon: src.icon, shortForecast: src.description, isDaytime: true });
    const name = k === todayKey ? "Today" : (() => { try { return new Date(g.periods[0].startTime).toLocaleDateString("en-US", { timeZone: tz, weekday: "short" }); } catch { return g.periods[0].name; } })();
    return { name, hi, lo, pop, cond };
  });
}

function wxDailyCard(s, tz) {
  const days = wxFoldDaily(s.daily || [], tz).slice(0, 7);
  if (!days.length) return "";
  const los = days.map((d) => d.lo).filter((v) => v != null);
  const his = days.map((d) => d.hi).filter((v) => v != null);
  const min = los.length ? Math.min(...los) : 0;
  const max = his.length ? Math.max(...his) : 1;
  const span = Math.max(1, max - min);
  const rows = days.map((d) => {
    const L = d.lo != null ? ((d.lo - min) / span) * 100 : 0;
    const W = (d.lo != null && d.hi != null) ? ((d.hi - d.lo) / span) * 100 : 100;
    return `
      <div class="wx-day">
        <span class="wx-day-name">${escapeHtml(d.name)}</span>
        ${iconSvg(d.cond.key, d.cond.isDay)}
        <span class="wx-day-pop${d.pop ? "" : " is-zero"}">💧${d.pop}%</span>
        <div class="wx-rangewrap">
          <span class="wx-day-lo">${d.lo != null ? Math.round(d.lo) + "°" : "—"}</span>
          <div class="wx-range"><div class="wx-range-seg" style="left:${L.toFixed(1)}%;width:${Math.max(W, 6).toFixed(1)}%"></div></div>
          <span class="wx-day-hi">${d.hi != null ? Math.round(d.hi) + "°" : "—"}</span>
        </div>
      </div>`;
  }).join("");
  return `
    <section class="wx-card">
      <div class="wx-card-hd"><h3>7-Day Forecast</h3></div>
      <div class="wx-daily">${rows}</div>
    </section>`;
}

// Sun position along a dawn→dusk arc (dot only; decorative).
function wxSunArc(c) {
  if (!c.sunrise || !c.sunset) return "";
  const rise = +new Date(c.sunrise), set = +new Date(c.sunset), now = Date.now();
  const frac = Math.max(0, Math.min(1, (now - rise) / Math.max(1, set - rise)));
  const x = 60 - 52 * Math.cos(frac * Math.PI);
  const y = 52 - 40 * Math.sin(frac * Math.PI);
  const up = now >= rise && now <= set;
  return `<svg class="wx-arc" viewBox="0 0 120 56" role="img" aria-hidden="true">
    <path d="M8 52 A52 40 0 0 1 112 52" fill="none" stroke="var(--line)" stroke-width="2.5" stroke-dasharray="3 5"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${up ? "var(--sun,#f1b24e)" : "var(--muted)"}"/></svg>`;
}

function wxDetailGroups(s, c, tz) {
  const deg = c.windDirectionDegrees;
  const dial = `<svg class="wx-dial" viewBox="0 0 100 100" role="img" aria-hidden="true">
    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" stroke-width="2"/>
    <g fill="var(--muted)" font-size="9" font-weight="700"><text x="50" y="14" text-anchor="middle">N</text><text x="88" y="53" text-anchor="middle">E</text><text x="50" y="94" text-anchor="middle">S</text><text x="12" y="53" text-anchor="middle">W</text></g>
    ${deg != null ? `<g transform="rotate(${Math.round(deg)} 50 50)"><path d="M50 20 L44 54 L50 48 L56 54 Z" fill="var(--accent)"/></g>` : ""}
    <circle cx="50" cy="50" r="4" fill="var(--accent-dark)"/></svg>`;
  const g = (title, inner) => `<div class="wx-g"><h4>${title}</h4>${inner}</div>`;
  const kv = (k, v) => `<div class="wx-kv"><span class="wx-k">${escapeHtml(k)}</span><span class="wx-v">${escapeHtml(String(v))}</span></div>`;
  return `
    <div class="wx-groups">
      ${g("🍃 Wind", dial
        + kv("Wind", c.windMph != null ? `${c.windMph} mph ${c.windDirectionCardinal || ""}`.trim() : "—")
        + kv("Gusts", c.windGustMph != null ? `${c.windGustMph} mph` : "—"))}
      ${g("💧 Comfort", kv("Feels like", wxTempStr(c.apparentTemperatureF))
        + kv("Humidity", wxNum(c.humidityPercent, "%"))
        + kv("Dew point", wxTempStr(c.dewPointF))
        + kv("Pressure", c.pressureInHg != null ? `${c.pressureInHg}"` : "—"))}
      ${g("☀︎ Sun & Sky", wxSunArc(c)
        + kv("Sunrise", c.sunrise ? wxClock(c.sunrise, tz) : "—")
        + kv("Sunset", c.sunset ? wxClock(c.sunset, tz) : "—")
        + kv("Visibility", c.visibilityMiles != null ? `${c.visibilityMiles} mi` : "—"))}
      ${g("🌫 Air", kv("UV index", wxUvLabel(c.uvIndex))
        + kv("Air quality", wxAqiLabel(c.airQualityIndex))
        + kv("Precip (1h)", c.precipitationInches != null ? `${c.precipitationInches}"` : "—")
        + (c.uvAqiProvenance ? `<div class="wx-g-note">UV &amp; air quality via Open-Meteo</div>` : ""))}
    </div>`;
}

function wxTrendCard(s, tz) {
  const hrs = (s.hourly || []).slice(0, 12);
  const temps = hrs.map((h) => h.temperatureF);
  if (temps.filter((v) => v != null).length < 3) return "";
  const P = hrs.map((h) => h.precipProbabilityPercent || 0);
  const W = 320, H = 130, pad = 16, n = hrs.length;
  const xs = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const valid = temps.filter((v) => v != null);
  const tmin = Math.min(...valid) - 3, tmax = Math.max(...valid) + 3;
  const ys = (v) => H - 24 - ((v - tmin) / Math.max(1, tmax - tmin)) * (H - 44);
  const bars = P.map((p, i) => { if (!p) return ""; const bh = (p / 100) * (H - 44); return `<rect x="${(xs(i) - 6).toFixed(1)}" y="${(H - 24 - bh).toFixed(1)}" width="12" height="${bh.toFixed(1)}" rx="2" fill="var(--window-border)" opacity="0.2"/>`; }).join("");
  const pts = temps.map((v, i) => (v == null ? null : `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const area = `M${xs(0).toFixed(1)},${H - 24} ` + temps.map((v, i) => (v == null ? "" : `L${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)).join(" ") + ` L${xs(n - 1).toFixed(1)},${H - 24} Z`;
  const dots = temps.map((v, i) => (v == null ? "" : `<circle cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="2.4" fill="var(--tomato)"/>`)).join("");
  const labels = temps.map((v, i) => { if (v == null || i % 2) return ""; const hh = i === 0 ? "Now" : escapeHtml(wxHourLabel(hrs[i].startTime, tz).replace(/\s*(AM|PM)/i, "")); return `<text x="${xs(i).toFixed(1)}" y="${(ys(v) - 6).toFixed(1)}" text-anchor="middle">${Math.round(v)}°</text><text x="${xs(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${hh}</text>`; }).join("");
  const svg = `<svg class="wx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperature and precipitation probability for the next 12 hours">
    <defs><linearGradient id="wxTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--tomato)" stop-opacity="0.26"/><stop offset="1" stop-color="var(--tomato)" stop-opacity="0"/></linearGradient></defs>
    ${bars}<path d="${area}" fill="url(#wxTrendFill)"/><polyline points="${pts}" fill="none" stroke="var(--tomato)" stroke-width="2.5" stroke-linejoin="round"/>${dots}${labels}</svg>`;
  return `
    <section class="wx-card">
      <div class="wx-card-hd"><h3>Temperature &amp; Precip · 12h</h3></div>
      <div class="wx-chart-legend"><span class="wx-k"><span class="wx-sw" style="background:var(--tomato)"></span>Temp</span><span class="wx-k"><span class="wx-sw" style="background:var(--window-border)"></span>Precip %</span></div>
      <div class="wx-chart-wrap">${svg}</div>
    </section>`;
}

function wxRadarCard(s) {
  const site = s.radarStation;
  const stamp = `Radar · ${escapeHtml(wxAgo(s.fetchedAt))}`;
  const inner = site
    ? `<img src="https://radar.weather.gov/ridge/standard/${escapeHtml(site)}_loop.gif" alt="Radar loop for ${escapeHtml(site)}" loading="lazy" onerror="this.closest('.wx-radar-preview').classList.add('is-broken')">
       <span class="wx-radar-fallback">Open radar map</span>
       <span class="wx-radar-open" aria-hidden="true">⤢ Open full map</span>
       <span class="wx-radar-stamp"><span class="wx-live-dot"></span> ${stamp}</span>`
    : `<span class="wx-radar-fallback">Open radar map</span>`;
  return `
    <section class="wx-card wx-radarcard">
      <div class="wx-card-hd"><h3>Radar</h3><span class="wx-sub">tap to open map</span></div>
      <button class="wx-radar-preview" type="button" data-wx-action="open-map" aria-label="Open interactive radar map">${inner}</button>
      <div class="wx-radar-legend"><span>Light</span><span class="wx-radar-scale" aria-hidden="true"></span><span>Heavy</span></div>
    </section>`;
}

function wxFeedCard(s) {
  const products = s.products || [];
  const warnings = (s.warnings || []).length ? `<div class="wx-warnings">${s.warnings.map((w) => `• ${escapeHtml(w)}`).join("<br>")}</div>` : "";
  if (!products.length && !warnings) return "";
  const rows = products.map((p) => {
    const id = `prod:${p.office}:${p.type}`;
    const open = weatherExpanded.has(id);
    let inner = "";
    if (open) {
      const cached = weatherProductText.get(`${p.office}:${p.type}`);
      if (cached === "loading" || cached === undefined) inner = `<div class="wx-note">Loading…</div>`;
      else if (cached === "none" || !cached?.text) inner = `<div class="wx-note">Not currently issued for ${escapeHtml(p.office)}.</div>`;
      else inner = `<div class="wx-product-meta">Issued ${escapeHtml(wxClock(cached.issued, s.location.timezone))}</div><div class="wx-product-text">${escapeHtml(cached.text)}</div>`;
    }
    return `
      <div class="wx-frow">
        <button class="wx-disclosure-head" type="button" data-wx-action="product" data-office="${escapeHtml(p.office)}" data-type="${escapeHtml(p.type)}" aria-expanded="${open}">
          <span class="wx-fname">${escapeHtml(p.name)}</span><span class="wx-rm">${open ? "Read less ▴" : "Read more →"}</span>
        </button>
        ${open ? inner : ""}
      </div>`;
  }).join("");
  return `
    <section class="wx-card wx-feed">
      <div class="wx-card-hd"><h3>NWS Forecast Feed</h3><span class="wx-sub">tap to expand</span></div>
      ${rows}${warnings}
    </section>`;
}

// ── Wiring (delegated, bound once) ──────────────────────────────────────────
function wireWeatherPage() {
  if (weatherWired) return;
  weatherWired = true;
  const root = elements.weatherPageInner;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wx-action]");
    if (!btn) return;
    const action = btn.dataset.wxAction;
    if (action === "toggle-picker") { weatherPickerOpen = !weatherPickerOpen; renderWeatherPage(); }
    else if (action === "use-current") { weatherPickerOpen = false; useCurrentWeatherLocation(); }
    else if (action === "select-saved") { const l = (state.weatherLocations || []).find((x) => x.id === btn.dataset.id); if (l) setWeatherLocation(l); }
    else if (action === "select-result") { const r = weatherSearchResults.find((x) => x.id === btn.dataset.id); if (r) { weatherSearchResults = []; setWeatherLocation(r); } }
    else if (action === "remove-saved") { state.weatherLocations = (state.weatherLocations || []).filter((x) => x.id !== btn.dataset.id); persist(); renderWeatherPage(); }
    else if (action === "save-current") { const l = weatherActiveLocation; if (l) { state.weatherLocations = [...(state.weatherLocations || []), { id: l.id, label: l.label, latitude: l.latitude, longitude: l.longitude, timezone: l.timezone }]; state.weatherActiveLocationId = l.id; persist(); renderWeatherPage(); } }
    else if (action === "toggle") { const id = btn.dataset.id; weatherExpanded.has(id) ? weatherExpanded.delete(id) : weatherExpanded.add(id); renderWeatherPage(); }
    else if (action === "product") { toggleWeatherProduct(btn.dataset.office, btn.dataset.type); }
    else if (action === "open-map") { openWeatherRadarMap(); }
  });
  root.addEventListener("input", (e) => {
    if (!e.target.closest("#wxSearchInput")) return;
    const q = e.target.value;
    clearTimeout(weatherSearchTimer);
    if (q.trim().length < 3) { weatherSearchResults = []; weatherSearchBusy = false; return; }
    weatherSearchTimer = setTimeout(() => runWeatherSearch(q), 350);
  });
}

async function runWeatherSearch(q) {
  const mine = ++weatherSearchGen; // abort superseded searches without touching snapshot loads
  weatherSearchBusy = true;
  try {
    const results = await searchWeatherLocations(q);
    if (mine !== weatherSearchGen || getActiveAppArea() !== "weather") return;
    weatherSearchResults = results;
  } catch { weatherSearchResults = []; }
  weatherSearchBusy = false;
  // Re-render but keep focus/value in the search box.
  const val = document.getElementById("wxSearchInput")?.value || "";
  renderWeatherPage();
  const input = document.getElementById("wxSearchInput");
  if (input) { input.value = val; input.focus(); }
}

async function toggleWeatherProduct(office, type) {
  const id = `prod:${office}:${type}`;
  if (weatherExpanded.has(id)) { weatherExpanded.delete(id); renderWeatherPage(); return; }
  weatherExpanded.add(id);
  const key = `${office}:${type}`;
  if (!weatherProductText.has(key)) {
    weatherProductText.set(key, "loading");
    renderWeatherPage();
    try { const prod = await getWeatherProductText(office, type); weatherProductText.set(key, prod || "none"); }
    catch { weatherProductText.set(key, "none"); }
  }
  if (getActiveAppArea() === "weather") renderWeatherPage();
}

// ── Interactive radar map (Leaflet, lazy-loaded from CDN on first open) ───────
const WX_ALERT_STROKE = { Extreme: "#7b1113", Severe: "#c0392b", Moderate: "#d68910", Minor: "#2e86c1" };
let weatherMapInstance = null;
async function openWeatherRadarMap() {
  const loc = weatherActiveLocation;
  const s = weatherSnapshot;
  if (!loc) return;
  document.getElementById("wxMapOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "wxMapOverlay";
  overlay.className = "wx-map-overlay";
  overlay.innerHTML = `
    <div class="wx-map-modal" role="dialog" aria-modal="true" aria-label="Weather map">
      <div class="wx-map-bar">
        <span class="wx-map-title">${escapeHtml(s?.location?.label || loc.label)}</span>
        <div class="wx-map-modes" role="group" aria-label="Map layer">
          <button type="button" data-wx-map-mode="radar" aria-pressed="true">Radar</button>
          <button type="button" data-wx-map-mode="satellite" aria-pressed="false">Satellite</button>
        </div>
        <label class="wx-map-toggle" id="wxMapAlertsWrap"><input type="checkbox" id="wxMapAlerts" checked> Warnings</label>
        <button class="wx-map-close" type="button" aria-label="Close weather map"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="wx-map-canvas" id="wxMapCanvas"><div class="wx-map-msg">Loading map…</div></div>
      <div class="wx-map-foot">
        <img class="wx-map-legend" id="wxMapLegend" alt="Radar reflectivity scale" hidden>
        <span class="wx-map-valid" id="wxMapValid"></span>
        <span class="wx-map-attr" id="wxMapAttr"></span>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { try { weatherMapInstance?.remove(); } catch {} weatherMapInstance = null; overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.querySelector(".wx-map-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  let L;
  try { L = await ensureLeaflet(); }
  catch { const cv = document.getElementById("wxMapCanvas"); if (cv) cv.innerHTML = `<div class="wx-map-msg">Map couldn't load — check your connection.</div>`; return; }
  if (!document.getElementById("wxMapOverlay")) return; // closed while loading

  const canvas = document.getElementById("wxMapCanvas");
  canvas.innerHTML = "";
  const dark = document.documentElement.dataset.theme === "dark"
    || (!document.documentElement.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const map = L.map(canvas, { zoomControl: true, attributionControl: true }).setView([loc.latitude, loc.longitude], 7);
  weatherMapInstance = map;
  // Keyless, theme-aware Esri gray canvas (CARTO's free basemaps now stamp an
  // "API KEY REQUIRED" watermark). Grayscale reads cleanly under radar/satellite.
  L.tileLayer(
    dark ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
         : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { attribution: "© Esri", maxZoom: 16 }
  ).addTo(map);
  L.marker([loc.latitude, loc.longitude]).addTo(map);

  const legendEl = document.getElementById("wxMapLegend");
  const validEl = document.getElementById("wxMapValid");
  const attrEl = document.getElementById("wxMapAttr");

  // SATELLITE: NASA GIBS GOES-East GeoColor, latest frame (time="default"). A
  // different provider than NOAA radar — documented in WEATHER.md — chosen because
  // it is authoritative (GOES-derived), reliably tiled, and ~10-min fresh. Not
  // animated: NOAA exposes no reliable historical frames, so no fake timeline.
  const satLayer = L.tileLayer(
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
    { maxZoom: 18, maxNativeZoom: 7, opacity: 0.85, attribution: "Imagery: NASA GIBS · NOAA GOES-East", bounds: [[-85, -180], [85, 180]] }
  );
  let satErrored = false;
  satLayer.on("tileerror", () => { if (!satErrored) { satErrored = true; if (currentMode === "satellite" && validEl) validEl.textContent = "Satellite temporarily unavailable"; } });

  // RADAR: NOAA IDP base reflectivity WMS, discovered via GetCapabilities (single
  // current frame). Never leaves a broken toggle — offline disables the mode.
  let radarLayer = null, radarLegendUrl = null, radarOffline = false;
  try {
    const cap = await weatherRequest({ action: "capabilities" }, 3 * 60 * 60 * 1000);
    if (weatherMapInstance !== map) return; // closed/reopened
    if (cap?.available) {
      radarLayer = L.tileLayer.wms(cap.wmsUrl, { layers: cap.layer, format: cap.format, version: cap.version, transparent: true, opacity: 0.75, attribution: cap.attribution });
      radarLegendUrl = cap.legendUrl || null;
    } else radarOffline = true;
  } catch { radarOffline = true; }

  // Active-warning polygons from the snapshot geometry (already normalized).
  const feats = (s?.alerts || []).filter((a) => a.geometry).map((a) => ({ type: "Feature", geometry: a.geometry, properties: { event: a.event, severity: a.severity } }));
  let alertLayer = null;
  if (feats.length) {
    alertLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
      style: (f) => ({ color: WX_ALERT_STROKE[f.properties.severity] || "#c0392b", weight: 2, fillOpacity: 0.15 }),
      onEachFeature: (f, lyr) => lyr.bindPopup(`<b>${escapeHtml(f.properties.event)}</b><br>${escapeHtml(f.properties.severity)}`)
    }).addTo(map);
  } else {
    document.getElementById("wxMapAlertsWrap")?.classList.add("is-disabled");
    const ac = document.getElementById("wxMapAlerts"); if (ac) ac.disabled = true;
  }

  let currentMode = "radar";
  const setMode = (mode) => {
    if (mode === "radar" && radarOffline) mode = "satellite";
    currentMode = mode;
    overlay.querySelectorAll("[data-wx-map-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.wxMapMode === mode)));
    if (mode === "radar") {
      map.removeLayer(satLayer);
      if (radarLayer && !map.hasLayer(radarLayer)) radarLayer.addTo(map);
      if (legendEl && radarLegendUrl) { legendEl.src = radarLegendUrl; legendEl.hidden = false; }
      if (validEl) validEl.textContent = "Base reflectivity · latest frame";
      if (attrEl) attrEl.textContent = "Radar © NOAA/NWS";
    } else {
      if (radarLayer) map.removeLayer(radarLayer);
      if (!map.hasLayer(satLayer)) satLayer.addTo(map);
      if (legendEl) legendEl.hidden = true;
      if (validEl) validEl.textContent = satErrored ? "Satellite temporarily unavailable" : "GOES-East GeoColor · ~10-min imagery";
      if (attrEl) attrEl.textContent = "Imagery: NASA GIBS · NOAA GOES-East";
    }
    // keep warning polygons on top of whichever layer is active
    if (alertLayer && map.hasLayer(alertLayer)) alertLayer.bringToFront();
  };

  if (radarOffline) {
    const rb = overlay.querySelector('[data-wx-map-mode="radar"]');
    if (rb) { rb.disabled = true; rb.title = "Radar temporarily offline"; }
    setMode("satellite");
  } else {
    setMode("radar");
  }

  overlay.querySelectorAll("[data-wx-map-mode]").forEach((b) => b.addEventListener("click", () => { if (!b.disabled) setMode(b.dataset.wxMapMode); }));
  document.getElementById("wxMapAlerts")?.addEventListener("change", (e) => { if (!alertLayer) return; e.target.checked ? alertLayer.addTo(map) : map.removeLayer(alertLayer); });
  setTimeout(() => { try { map.invalidateSize(); } catch {} }, 60); // correct sizing after the overlay lays out
}

  return { initWeatherPage, stopWeatherRefreshLoop, getCurrentConditions };
}

