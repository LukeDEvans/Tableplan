// Canonical DISPLAY conditions for the Weather UI.
//
// This interprets fields that weather.js ALREADY normalized (the NWS `icon` URL,
// `shortForecast`/description text, and day/night) into one small canonical set the
// hero artwork, hourly/daily icons, and the weather-reactive hierarchy all key off.
// It is pure, DOM-free, and adds NO new data source — the NOAA→function boundary is
// unchanged; this is presentation logic, unit-tested in test/weather-condition.test.js.

export const CONDITIONS = Object.freeze([
  "clear", "partly-cloudy", "cloudy", "overcast",
  "rain", "heavy-rain", "thunderstorm",
  "snow", "heavy-snow", "sleet",
  "fog", "haze", "wind",
]);

// NWS icon condition tokens → our canonical key. (See api.weather.gov/icons.)
const ICON_MAP = {
  skc: "clear", few: "clear", sct: "partly-cloudy", bkn: "cloudy", ovc: "overcast",
  wind: "wind",
  rain: "rain", rain_showers: "rain", rain_showers_hi: "rain",
  tsra: "thunderstorm", tsra_sct: "thunderstorm", tsra_hi: "thunderstorm",
  snow: "snow", blizzard: "heavy-snow",
  rain_snow: "sleet", rain_sleet: "sleet", snow_sleet: "sleet", sleet: "sleet",
  fzra: "sleet", rain_fzra: "sleet", snow_fzra: "sleet",
  fog: "fog", haze: "haze", smoke: "haze", dust: "haze",
  hot: "clear", cold: "clear",
  tornado: "thunderstorm", hurricane: "thunderstorm", tropical_storm: "thunderstorm",
};

// Rough "attention" ordering — when an icon carries two conditions (e.g. rain then
// tsra) we surface the more significant one; also used by the reactive hierarchy.
const ATTENTION = [
  "clear", "partly-cloudy", "cloudy", "overcast", "haze", "fog", "wind",
  "rain", "sleet", "snow", "heavy-rain", "heavy-snow", "thunderstorm",
];
export function conditionAttention(key) { const i = ATTENTION.indexOf(key); return i < 0 ? 0 : i; }
function worse(a, b) { return conditionAttention(a) >= conditionAttention(b) ? a : b; }

// Parse an NWS icon URL: .../icons/land/{day|night}/{cond}[,{pop}][/{cond2}[,{pop}]]
export function parseNwsIcon(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/icons\/land\/(day|night)\/([^/?]+)(?:\/([^/?]+))?/i);
  if (!m) return null;
  const tokens = [m[2], m[3]].filter(Boolean).map((s) => decodeURIComponent(s).split(",")[0].toLowerCase());
  return { isDay: m[1].toLowerCase() === "day", tokens };
}

function tokenToKey(tok) {
  if (ICON_MAP[tok]) return ICON_MAP[tok];
  if (tok.startsWith("wind_")) return ICON_MAP[tok.slice(5)] || "wind";
  return null;
}

// Refine heavy/severe variants and resolve text-only cases (current obs carry no icon).
function refineFromText(key, text) {
  const t = String(text || "").toLowerCase();
  if (/thunder|t-?storm|tstm/.test(t)) return "thunderstorm";
  if (/heavy snow|blizzard/.test(t)) return "heavy-snow";
  if (/heavy rain|downpour|torrential/.test(t)) return "heavy-rain";
  if (key) return key;
  if (/sleet|freezing|wintry mix|ice pellet/.test(t)) return "sleet";
  if (/snow|flurr/.test(t)) return "snow";
  if (/rain|shower|drizzle/.test(t)) return "rain";
  if (/fog|mist/.test(t)) return "fog";
  if (/haze|smoke|dust/.test(t)) return "haze";
  if (/wind|breez|blustery/.test(t)) return "wind";
  if (/overcast/.test(t)) return "overcast";
  if (/mostly cloudy|considerable cloud|broken cloud/.test(t)) return "cloudy";
  if (/partly|scattered cloud|few cloud/.test(t)) return "partly-cloudy";
  if (/cloud/.test(t)) return "cloudy";
  if (/sunny|clear|fair/.test(t)) return "clear";
  return "clear";
}

// Derive { key, isDay } from a normalized entry. Prefer the NWS icon token; fall back
// to the forecast phrase; resolve day/night from the icon, an explicit flag, or the
// observation time relative to local sunrise/sunset.
export function conditionFor({ icon = null, shortForecast = "", description = "", isDaytime = null, sunrise = null, sunset = null, at = null } = {}) {
  const parsed = parseNwsIcon(icon);
  let key = null;
  let isDay = null;
  if (parsed) {
    isDay = parsed.isDay;
    key = parsed.tokens.map(tokenToKey).filter(Boolean).reduce((a, b) => (a ? worse(a, b) : b), null);
  }
  key = refineFromText(key, shortForecast || description);

  if (typeof isDay !== "boolean") {
    if (typeof isDaytime === "boolean") isDay = isDaytime;
    else if (sunrise && sunset && at) {
      const t = +new Date(at);
      isDay = Number.isFinite(t) && t >= +new Date(sunrise) && t < +new Date(sunset);
    } else isDay = true;
  }
  return { key, isDay };
}

// Human label for a condition (fallback when no forecast phrase is available).
const LABELS = {
  clear: "Clear", "partly-cloudy": "Partly Cloudy", cloudy: "Mostly Cloudy", overcast: "Overcast",
  rain: "Rain", "heavy-rain": "Heavy Rain", thunderstorm: "Thunderstorm",
  snow: "Snow", "heavy-snow": "Heavy Snow", sleet: "Wintry Mix",
  fog: "Fog", haze: "Haze", wind: "Windy",
};
export function conditionLabel(key, isDay = true) {
  if (key === "clear") return isDay ? "Clear" : "Clear";
  return LABELS[key] || "—";
}

// Reactive-hierarchy weight from the current condition + active alerts. Drives how
// much the page restructures (calm → elevated → high). Alerts dominate; a stormy sky
// nudges it up on its own. Pure so it is testable and reused by the renderer.
export function weatherEmphasis({ conditionKey = "clear", alerts = [] } = {}) {
  const sev = (alerts || []).map((a) => String(a.severity || "")).filter(Boolean);
  if (sev.includes("Extreme")) return "extreme";
  if (sev.includes("Severe")) return "severe";
  if (sev.includes("Moderate") || conditionKey === "thunderstorm" || conditionKey === "heavy-snow") return "elevated";
  if (alerts && alerts.length) return "elevated";
  if (conditionKey === "heavy-rain") return "elevated";
  return "calm";
}
