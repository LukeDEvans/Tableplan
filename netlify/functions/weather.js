// ── Weather proxy (NOAA/NWS authoritative) ───────────────────────────────────
// The NWS API requires an identifying User-Agent that browsers can't reliably
// set, so all NWS traffic is routed through here. This function is the ONLY
// place that speaks raw NOAA: it fetches the point→grid→forecast/observation/
// alert chain, NORMALIZES everything into the app's shared weather model, and
// returns plain JSON. No weather API key is required for NWS.
//
// It holds no secrets and touches no database (weather must never generate DB
// egress), so it does not run the Supabase auth check the data functions use —
// it's origin-restricted and CDN-cacheable instead. Location search is proxied
// too (Open-Meteo geocoding, US-only) so the client has one weather service.
//
// Pure normalization helpers are exported at the bottom for unit tests.

const NWS_BASE = "https://api.weather.gov";
const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";
// A real contact belongs in WEATHER_USER_AGENT (URL or email); this dev
// fallback identifies the project without exposing a personal address.
const USER_AGENT = String(process.env.WEATHER_USER_AGENT || "").trim()
  || "LDE Personal App (https://effervescent-malabi-e0af55.netlify.app)";

const ALLOWED_ORIGINS = new Set([
  "https://effervescent-malabi-e0af55.netlify.app",
  "http://localhost:4174",
  "http://127.0.0.1:4174",
  "http://localhost:5173",
  "http://localhost:5174"
]);

const NWS_PRODUCT_TYPES = ["AFD", "HWO", "LSR", "PNS"];

exports.handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);
  const respond = (statusCode, body, cacheSeconds) =>
    jsonResponse(statusCode, body, { ...headers, ...(cacheSeconds ? { "cache-control": `public, max-age=${cacheSeconds}` } : {}) });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed." });

  const q = event.queryStringParameters || {};
  const action = String(q.action || "snapshot");
  try {
    if (action === "search") {
      const results = await searchLocations(String(q.q || ""));
      return respond(200, { results }, 600); // place names change slowly
    }
    if (action === "product") {
      const product = await getProduct(String(q.office || ""), String(q.type || ""));
      return respond(200, { product }, 600);
    }
    // Default: the full normalized snapshot for a coordinate.
    const lat = Number(q.lat), lon = Number(q.lon);
    if (!isFinite(lat) || !isFinite(lon)) return respond(400, { error: "lat and lon are required." });
    const snapshot = await buildSnapshot(lat, lon, q.label ? String(q.label) : null, q.timezone ? String(q.timezone) : null);
    // Forecasts are good for ~10 min; the client layer also caches + dedups.
    return respond(200, snapshot, 600);
  } catch (err) {
    const status = Number(err?.status) || 502;
    return respond(status, { error: String(err?.message || "Weather request failed."), warnings: [String(err?.message || "upstream error")] });
  }
};

// ── NWS fetch with identification, timeout, and bounded retry ─────────────────
async function nwsFetch(url, { accept = "application/geo+json", timeoutMs = 9000, retries = 2 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        // Transient — retry with bounded exponential backoff.
        lastErr = httpError(res.status, `NWS ${res.status} for ${shortPath(url)}`);
        if (attempt < retries) { await sleep(300 * Math.pow(2, attempt)); attempt++; continue; }
        throw lastErr;
      }
      if (!res.ok) throw httpError(res.status, `NWS ${res.status} for ${shortPath(url)}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (e?.status && e.status !== 429 && e.status < 500) throw e; // non-transient
      lastErr = e;
      if (attempt < retries) { await sleep(300 * Math.pow(2, attempt)); attempt++; continue; }
      throw e;
    }
  }
  throw lastErr || new Error("NWS request failed");
}

// ── Snapshot orchestration ───────────────────────────────────────────────────
async function buildSnapshot(lat, lon, label, timezone) {
  const fetchedAt = new Date().toISOString();
  const warnings = [];
  const round = (n) => Math.round(n * 10000) / 10000;

  // 1. The point resolves grid, office, zones, and forecast/observation links.
  let point;
  try {
    point = await nwsFetch(`${NWS_BASE}/points/${round(lat)},${round(lon)}`);
  } catch (e) {
    // Outside NWS coverage (non-US) 404s here — surface a clear, typed error.
    throw httpError(e.status || 502, e.status === 404 ? "This location is outside NWS coverage (U.S. only)." : e.message);
  }
  const p = point.properties || {};
  const office = p.cwa || p.gridId || "";
  const tz = timezone || p.timeZone || "America/New_York";
  const relCity = p.relativeLocation?.properties;
  const resolvedLabel = label
    || (relCity ? [relCity.city, relCity.state].filter(Boolean).join(", ") : null)
    || `${round(lat)}, ${round(lon)}`;

  const location = {
    id: `${round(lat)},${round(lon)}`,
    label: resolvedLabel,
    latitude: lat,
    longitude: lon,
    timezone: tz
  };

  // 2. Fetch the dependent resources concurrently; one failure must not blank
  //    the whole page, so each is captured independently.
  const [dailyRes, hourlyRes, obsRes, alertsRes] = await Promise.allSettled([
    nwsFetch(p.forecast, { accept: "application/geo+json" }),
    nwsFetch(p.forecastHourly, { accept: "application/geo+json" }),
    fetchLatestObservation(p.observationStations, lat, lon),
    nwsFetch(`${NWS_BASE}/alerts/active?point=${round(lat)},${round(lon)}`, { accept: "application/geo+json" })
  ]);

  let daily = [];
  if (dailyRes.status === "fulfilled") daily = normalizeDaily(dailyRes.value?.properties?.periods || []);
  else warnings.push("7-day forecast unavailable.");

  let hourly = [];
  if (hourlyRes.status === "fulfilled") hourly = normalizeHourly(hourlyRes.value?.properties?.periods || []);
  else warnings.push("Hourly forecast unavailable.");

  let current;
  if (obsRes.status === "fulfilled" && obsRes.value) {
    current = obsRes.value;
  } else {
    // Forecast-derived fallback, transparently labeled (never implied as measured).
    current = currentFromForecast(hourly, daily, fetchedAt);
    warnings.push("No recent station observation — showing forecast data.");
  }
  // Sunrise/sunset computed locally from coordinates (NWS doesn't provide them).
  const sun = sunTimes(lat, lon, new Date());
  current.sunrise = sun.sunrise;
  current.sunset = sun.sunset;

  let alerts = [];
  if (alertsRes.status === "fulfilled") alerts = normalizeAlerts(alertsRes.value?.features || []);
  else warnings.push("Active alerts could not be loaded.");

  // Product availability is advertised in the snapshot; the text is fetched on
  // demand (progressive disclosure) via action=product.
  const products = office ? NWS_PRODUCT_TYPES.map((type) => ({ type, office, name: PRODUCT_NAMES[type] })) : [];

  return {
    location,
    office,
    radarStation: p.radarStation || null,
    grid: p.gridId ? { office: p.gridId, x: p.gridX, y: p.gridY } : null,
    zones: { forecast: zoneId(p.forecastZone), county: zoneId(p.county), fire: zoneId(p.fireWeatherZone) },
    current,
    hourly,
    daily,
    alerts,
    products,
    fetchedAt,
    isStale: false,
    warnings
  };
}

async function fetchLatestObservation(stationsUrl, lat, lon) {
  if (!stationsUrl) return null;
  const stations = await nwsFetch(stationsUrl, { accept: "application/geo+json" });
  const feats = stations?.features || [];
  if (!feats.length) return null;
  // observationStations is returned ordered nearest-first; take the first that
  // has a recent, valid temperature reading.
  for (const st of feats.slice(0, 4)) {
    const sp = st.properties || {};
    const stationId = sp.stationIdentifier;
    if (!stationId) continue;
    let obs;
    try {
      obs = await nwsFetch(`${NWS_BASE}/stations/${stationId}/observations/latest`, { accept: "application/geo+json", retries: 1 });
    } catch { continue; }
    const op = obs?.properties;
    if (!op || op.temperature?.value == null) continue;
    const coords = st.geometry?.coordinates; // [lon, lat]
    const distance = coords ? haversineMiles(lat, lon, coords[1], coords[0]) : null;
    return normalizeCurrent(op, { id: stationId, name: sp.name, distanceMiles: distance });
  }
  return null;
}

async function getProduct(office, type) {
  if (!office || !NWS_PRODUCT_TYPES.includes(type)) throw httpError(400, "Unknown product.");
  const list = await nwsFetch(`${NWS_BASE}/products/types/${type}/locations/${office}`, { accept: "application/ld+json" });
  const first = (list?.["@graph"] || list?.products || [])[0];
  if (!first?.id) return null;
  const full = await nwsFetch(`${NWS_BASE}/products/${first.id}`, { accept: "application/ld+json" });
  return {
    type,
    office,
    name: PRODUCT_NAMES[type] || type,
    issued: full?.issuanceTime || first.issuanceTime || null,
    text: full?.productText || null
  };
}

// ── Location search (Open-Meteo geocoding, U.S. only) ────────────────────────
async function searchLocations(query) {
  const name = String(query || "").trim();
  if (name.length < 3) return [];
  const url = `${GEOCODE_BASE}?name=${encodeURIComponent(name)}&count=10&language=en&format=json&countryCode=US`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let data;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw httpError(res.status, "Location search failed.");
    data = await res.json();
  } finally { clearTimeout(timer); }
  return (data?.results || [])
    .filter((r) => r.country_code === "US" && isFinite(r.latitude) && isFinite(r.longitude))
    .map((r) => ({
      id: String(r.id ?? `${r.latitude},${r.longitude}`),
      label: [r.name, r.admin1, r.country_code === "US" ? "USA" : r.country].filter(Boolean).join(", "),
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone || "America/New_York"
    }));
}

// ── Normalization (pure — exported for tests) ────────────────────────────────
const PRODUCT_NAMES = { AFD: "Area Forecast Discussion", HWO: "Hazardous Weather Outlook", LSR: "Local Storm Report", PNS: "Public Information Statement" };

function zoneId(url) {
  if (!url) return null;
  const m = String(url).match(/\/zones\/[^/]+\/([A-Z0-9]+)$/);
  return m ? m[1] : null;
}

// Convert an NWS measured value {value, unitCode} to the app's U.S. unit.
function conv(measure, kind) {
  if (!measure || measure.value == null) return null;
  const v = measure.value;
  const u = String(measure.unitCode || "");
  switch (kind) {
    case "tempF": return round1(u.includes("degF") ? v : cToF(v));
    case "mph": return round1(u.includes("km_h") ? v * 0.621371 : u.includes("m_s") || u.endsWith("m/s") ? v * 2.236936 : v);
    case "inHg": return round2(u.includes("Pa") ? v * 0.0002953 : v);
    case "miles": return round1(u.includes("m") && !u.includes("mi") ? v / 1609.344 : v);
    case "inches": return round2(u.includes("mm") ? v / 25.4 : v);
    case "percent": return Math.round(v);
    case "degrees": return Math.round(v);
    default: return v;
  }
}

function normalizeCurrent(op, station) {
  const windDir = op.windDirection?.value ?? null;
  return {
    temperatureF: conv(op.temperature, "tempF"),
    apparentTemperatureF: conv(op.heatIndex, "tempF") ?? conv(op.windChill, "tempF") ?? conv(op.temperature, "tempF"),
    description: op.textDescription || null,
    humidityPercent: conv(op.relativeHumidity, "percent"),
    dewPointF: conv(op.dewpoint, "tempF"),
    windDirectionDegrees: windDir == null ? null : Math.round(windDir),
    windDirectionCardinal: windDir == null ? null : cardinal(windDir),
    windMph: conv(op.windSpeed, "mph"),
    windGustMph: conv(op.windGust, "mph"),
    visibilityMiles: conv(op.visibility, "miles"),
    pressureInHg: conv(op.barometricPressure ?? op.seaLevelPressure, "inHg"),
    precipitationInches: conv(op.precipitationLastHour, "inches"),
    snowDepthInches: null,
    uvIndex: null,            // NWS obs don't carry UV — never invented
    airQualityIndex: null,    // requires a separate configured source
    sunrise: null,
    sunset: null,
    provenance: {
      provider: "NWS",
      observedAt: op.timestamp || null,
      fetchedAt: new Date().toISOString(),
      stationId: station.id,
      stationName: station.name || station.id,
      stationDistanceMiles: station.distanceMiles == null ? null : round1(station.distanceMiles),
      isForecastDerived: false
    }
  };
}

// Transparent fallback when no station observation is available.
function currentFromForecast(hourly, daily, fetchedAt) {
  const h = hourly[0] || {};
  return {
    temperatureF: h.temperatureF ?? null,
    apparentTemperatureF: h.temperatureF ?? null,
    description: h.description ?? (daily[0]?.description ?? null),
    humidityPercent: h.humidityPercent ?? null,
    dewPointF: h.dewPointF ?? null,
    windDirectionDegrees: h.windDirectionDegrees ?? null,
    windDirectionCardinal: h.windDirectionCardinal ?? null,
    windMph: h.windMph ?? null,
    windGustMph: null,
    visibilityMiles: null,
    pressureInHg: null,
    precipitationInches: null,
    snowDepthInches: null,
    uvIndex: null,
    airQualityIndex: null,
    sunrise: null,
    sunset: null,
    provenance: { provider: "NWS", fetchedAt: fetchedAt, isForecastDerived: true }
  };
}

function normalizeHourly(periods) {
  return (periods || []).slice(0, 48).map((p) => ({
    startTime: p.startTime,
    isDaytime: !!p.isDaytime,
    temperatureF: p.temperatureUnit === "F" ? p.temperature : (p.temperature ?? null),
    description: p.shortForecast || null,
    precipProbabilityPercent: p.probabilityOfPrecipitation?.value ?? null,
    windMph: parseWindMph(p.windSpeed),
    windDirectionCardinal: p.windDirection || null,
    windDirectionDegrees: cardinalToDegrees(p.windDirection),
    humidityPercent: p.relativeHumidity?.value ?? null,
    dewPointF: p.dewpoint?.value != null ? round1(cToF(p.dewpoint.value)) : null,
    icon: p.icon || null
  }));
}

function normalizeDaily(periods) {
  return (periods || []).map((p) => ({
    name: p.name,
    startTime: p.startTime,
    isDaytime: !!p.isDaytime,
    temperatureF: p.temperature ?? null,
    temperatureTrend: p.temperatureTrend || null,
    description: p.shortForecast || null,
    detailedForecast: p.detailedForecast || null,
    precipProbabilityPercent: p.probabilityOfPrecipitation?.value ?? null,
    windSpeed: p.windSpeed || null,
    windDirection: p.windDirection || null,
    icon: p.icon || null
  }));
}

// Sort by severity → urgency → soonest expiry (never alphabetical).
const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
const URGENCY_RANK = { Immediate: 0, Expected: 1, Future: 2, Past: 3, Unknown: 4 };
function normalizeAlerts(features) {
  return (features || []).map((f) => {
    const a = f.properties || {};
    return {
      id: a.id || f.id,
      event: a.event || "Weather Alert",
      headline: a.headline || a.event || "",
      description: a.description || "",
      instructions: a.instruction || null,
      severity: a.severity || "Unknown",
      urgency: a.urgency || "Unknown",
      certainty: a.certainty || "Unknown",
      onset: a.onset || a.effective || null,
      expires: a.expires || a.ends || null,
      affectedArea: a.areaDesc || null,
      geometry: f.geometry || null
    };
  }).sort((x, y) =>
    (SEVERITY_RANK[x.severity] ?? 4) - (SEVERITY_RANK[y.severity] ?? 4)
    || (URGENCY_RANK[x.urgency] ?? 4) - (URGENCY_RANK[y.urgency] ?? 4)
    || (new Date(x.expires || 0) - new Date(y.expires || 0))
  );
}

// ── Small pure utilities ─────────────────────────────────────────────────────
const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function cardinal(deg) { return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }
function cardinalToDegrees(c) { const i = CARDINALS.indexOf(String(c || "").toUpperCase()); return i < 0 ? null : i * 22.5; }
function parseWindMph(s) { const m = String(s || "").match(/(\d+)/); return m ? Number(m[1]) : null; }
function cToF(c) { return (c * 9) / 5 + 32; }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// NOAA sunrise/sunset (UTC ISO strings) for a date at a coordinate.
function sunTimes(lat, lon, date) {
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.floor((start - Date.UTC(2000, 0, 1)) / dayMs) + 0.0009 - lon / 360;
  const solarNoon = 2451545 + n + 0.0053 * Math.sin(rad * (357.5291 + 0.98560028 * n))
    - 0.0069 * Math.sin(2 * rad * (280.147 + 0.98564736 * n));
  const M = (357.5291 + 0.98560028 * (n)) % 360;
  const C = 1.9148 * Math.sin(rad * M) + 0.02 * Math.sin(2 * rad * M) + 0.0003 * Math.sin(3 * rad * M);
  const L = (M + C + 180 + 102.9372) % 360;
  const decl = Math.asin(Math.sin(rad * L) * Math.sin(rad * 23.44));
  const cosH = (Math.sin(rad * -0.833) - Math.sin(rad * lat) * Math.sin(decl)) / (Math.cos(rad * lat) * Math.cos(decl));
  if (cosH > 1) return { sunrise: null, sunset: null };   // polar night
  if (cosH < -1) return { sunrise: null, sunset: null };  // midnight sun
  const H = Math.acos(cosH) / rad;
  const J = 2451545 + n + 0.0053 * Math.sin(rad * M) - 0.0069 * Math.sin(2 * rad * L);
  const jToIso = (j) => new Date((j - 2440587.5) * dayMs).toISOString();
  return { sunrise: jToIso(J - H / 360), sunset: jToIso(J + H / 360) };
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(String(origin || "")) ? String(origin) : "";
  return {
    ...(allowed ? { "access-control-allow-origin": allowed } : {}),
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    vary: "Origin"
  };
}
function jsonResponse(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body) };
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function shortPath(url) { try { return new URL(url).pathname; } catch { return url; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Exported for unit tests (Vitest or node) — pure, no network.
module.exports = exports;
module.exports._test = { conv, normalizeCurrent, normalizeHourly, normalizeDaily, normalizeAlerts, cardinal, cardinalToDegrees, parseWindMph, cToF, haversineMiles, sunTimes, zoneId };
