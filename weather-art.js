// weather-art.js — the ARTWORK SKIN for the Weather page.
//
// Pure: (conditionKey, isDay) -> an inline SVG string. Intentionally separate from
// weather-condition.js (which decides WHICH condition) so this visual vocabulary can
// be swapped wholesale later — e.g. the current "calm" set → an atmospheric/animated
// set (design direction 1) — without changing a single caller. No emoji; colours are
// chosen to read on both the light-sky and dark-night hero grounds and on cards.

const C = {
  sun: "#f4b64e", moon: "#e2eaf6", ray: "#f4b64e",
  cloud: "#eef2f6", cloudMid: "#cdd6df", cloudLo: "#aab4bf",
  rain: "#5aa9d6", bolt: "#f4b64e", snow: "#f2f7fc", fog: "#b6c0cb",
};

// ── hero primitives (120×120 canvas) ─────────────────────────────────────────
const SUN = `<circle cx="58" cy="50" r="19" fill="${C.sun}"/><g stroke="${C.ray}" stroke-width="3.4" stroke-linecap="round">
  <line x1="58" y1="18" x2="58" y2="9"/><line x1="58" y1="91" x2="58" y2="82"/><line x1="26" y1="50" x2="17" y2="50"/><line x1="99" y1="50" x2="90" y2="50"/>
  <line x1="35" y1="27" x2="29" y2="21"/><line x1="81" y1="27" x2="87" y2="21"/><line x1="35" y1="73" x2="29" y2="79"/><line x1="81" y1="73" x2="87" y2="79"/></g>`;
const MOON = `<path d="M78 30 a26 26 0 1 0 16 44 a22 22 0 0 1 -16 -44z" fill="${C.moon}"/>
  <circle cx="40" cy="30" r="1.7" fill="${C.moon}"/><circle cx="28" cy="46" r="1.3" fill="${C.moon}"/><circle cx="50" cy="20" r="1.2" fill="${C.moon}"/>`;
// a soft cloud centred lower-right; `f` = fill
const cloud = (f, dx = 0, dy = 0) => `<path transform="translate(${dx} ${dy})" d="M44 78 q-18 0 -18 -15 q0 -15 17 -14 q4 -15 22 -11 q15 -7 23 8 q14 -1 13 15 q0 17 -18 17 z" fill="${f}"/>`;
const RAYS_BEHIND_CLOUD = (isDay) => isDay
  ? `<circle cx="42" cy="40" r="15" fill="${C.sun}"/>`
  : `<path d="M56 26 a17 17 0 1 0 11 29 a14 14 0 0 1 -11 -29z" fill="${C.moon}"/>`;
const drops = (n) => `<g stroke="${C.rain}" stroke-width="3.2" stroke-linecap="round">` +
  [[42, 86], [56, 86], [70, 86], [49, 94], [63, 94]].slice(0, n).map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 9}"/>`).join("") + `</g>`;
const flakes = (n) => `<g fill="${C.rain}">` + [[42, 90], [56, 92], [70, 90], [49, 100], [63, 100]].slice(0, n).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4"/>`).join("") + `</g>`;
const BOLT = `<path d="M62 74 l-11 20 h8 l-6 16 19 -24 h-8 l7 -12z" fill="${C.bolt}"/>`;
const FOGLINES = `<g stroke="${C.fog}" stroke-width="3.4" stroke-linecap="round"><line x1="30" y1="84" x2="86" y2="84"/><line x1="36" y1="94" x2="80" y2="94"/><line x1="30" y1="104" x2="72" y2="104"/></g>`;
const WINDLINES = `<g stroke="${C.cloudLo}" stroke-width="3.6" stroke-linecap="round" fill="none">
  <path d="M22 52 h44 a7 7 0 1 0 -7 -7"/><path d="M22 68 h56 a7 7 0 1 1 -7 7"/><path d="M22 84 h34 a6 6 0 1 0 -6 -6"/></g>`;

// ── public: hero art ─────────────────────────────────────────────────────────
export function heroArtSvg(key, isDay = true) {
  const open = `<svg class="wx-art" viewBox="0 0 120 120" role="img" aria-hidden="true">`;
  let g;
  switch (key) {
    case "clear": g = isDay ? SUN : MOON; break;
    case "partly-cloudy": g = RAYS_BEHIND_CLOUD(isDay) + cloud(C.cloud, 6, 4); break;
    case "cloudy": g = cloud(C.cloudMid, -6, -6) + cloud(C.cloud, 8, 6); break;
    case "overcast": g = cloud(C.cloudLo, -8, -4) + cloud(C.cloudMid, 6, 2); break;
    case "rain": g = cloud(C.cloudMid) + drops(3); break;
    case "heavy-rain": g = cloud(C.cloudLo) + drops(5); break;
    case "thunderstorm": g = cloud(C.cloudLo) + BOLT; break;
    case "snow": g = cloud(C.cloudMid) + flakes(3); break;
    case "heavy-snow": g = cloud(C.cloudLo) + flakes(5); break;
    case "sleet": g = cloud(C.cloudMid) + drops(2) + flakes(2); break;
    case "fog": g = cloud(C.cloud, 0, -12) + FOGLINES; break;
    case "haze": g = `<circle cx="58" cy="50" r="17" fill="${C.sun}" opacity=".7"/>` + FOGLINES; break;
    case "wind": g = WINDLINES; break;
    default: g = isDay ? SUN : MOON;
  }
  return `${open}${g}</svg>`;
}

// ── public: small forecast icon (28×28, for hourly/daily) ────────────────────
const iCloud = (f) => `<path d="M9 22 q-6 0 -6 -6 q0 -6 6 -5 q2 -7 9 -5 q7 -1 7 6 q0 6 -7 6z" fill="${f}"/>`;
export function iconSvg(key, isDay = true) {
  const open = `<svg class="wx-ic" viewBox="0 0 28 28" role="img" aria-hidden="true">`;
  const sunI = `<circle cx="14" cy="13" r="7" fill="${C.sun}"/>`;
  const moonI = `<path d="M18 6 a8 8 0 1 0 5 12 a6.5 6.5 0 0 1 -5 -12z" fill="${C.moon}"/>`;
  let g;
  switch (key) {
    case "clear": g = isDay ? sunI : moonI; break;
    case "partly-cloudy": g = (isDay ? `<circle cx="11" cy="11" r="6" fill="${C.sun}"/>` : `<path d="M15 5 a6 6 0 1 0 4 9 a5 5 0 0 1 -4 -9z" fill="${C.moon}"/>`) + iCloud(C.cloudMid); break;
    case "cloudy": g = iCloud(C.cloudMid); break;
    case "overcast": g = iCloud(C.cloudLo); break;
    case "rain": case "heavy-rain": g = iCloud(C.cloudLo) + `<g stroke="${C.rain}" stroke-width="2" stroke-linecap="round"><line x1="10" y1="22" x2="8" y2="26"/><line x1="16" y1="22" x2="14" y2="26"/><line x1="22" y1="22" x2="20" y2="26"/></g>`; break;
    case "thunderstorm": g = iCloud(C.cloudLo) + `<path d="M15 18 l-4 6 h3 l-2 5 6 -8 h-3 l2 -3z" fill="${C.bolt}"/>`; break;
    case "snow": case "heavy-snow": g = iCloud(C.cloudLo) + `<g fill="${C.rain}"><circle cx="10" cy="24" r="1.6"/><circle cx="16" cy="25" r="1.6"/><circle cx="22" cy="24" r="1.6"/></g>`; break;
    case "sleet": g = iCloud(C.cloudLo) + `<g stroke="${C.rain}" stroke-width="2" stroke-linecap="round"><line x1="11" y1="22" x2="9" y2="26"/></g><circle cx="18" cy="24" r="1.6" fill="${C.rain}"/>`; break;
    case "fog": g = iCloud(C.cloudMid) + `<g stroke="${C.fog}" stroke-width="2" stroke-linecap="round"><line x1="7" y1="24" x2="21" y2="24"/><line x1="9" y1="27" x2="19" y2="27"/></g>`; break;
    case "haze": g = `<circle cx="14" cy="12" r="6" fill="${C.sun}" opacity=".7"/><g stroke="${C.fog}" stroke-width="2" stroke-linecap="round"><line x1="7" y1="22" x2="21" y2="22"/><line x1="9" y1="25" x2="19" y2="25"/></g>`; break;
    case "wind": g = `<g stroke="${C.cloudLo}" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M5 11 h11 a3 3 0 1 0 -3 -3"/><path d="M5 17 h14 a3 3 0 1 1 -3 3"/></g>`; break;
    default: g = isDay ? sunI : moonI;
  }
  return `${open}${g}</svg>`;
}
