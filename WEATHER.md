# Weather page — implementation notes

U.S.-focused Weather page backed by NOAA/NWS as the authoritative provider,
exposed through one normalized shared service so other modules (sailing,
calendar, briefing, …) reuse the same data without duplicate requests.

## Architecture

- **`netlify/functions/weather.js`** is the *only* code that speaks raw NOAA.
  It sends the required identifying `User-Agent`, fetches the NWS
  point→grid→forecast/observation/alert chain, **normalizes** everything into
  the shared model, and returns plain JSON. It holds no secrets and touches no
  database (weather must never create DB egress), so it is origin-restricted and
  CDN-cacheable instead of running the Supabase auth check the data functions
  use. Location search (Open-Meteo geocoding, U.S.-only) is proxied through the
  same function so the client has a single weather service.
- **Client shared service** (in `app.js`, *increment 2*) — `getWeatherSnapshot()`
  etc. with an in-memory TTL cache, in-flight de-duplication, staleness flags,
  and no-render-loop guarantees. Saved locations live in the existing
  `state` / `STATE_SECTIONS` store — never bulk weather payloads.

Consumers must use the normalized service, never raw NOAA endpoints.

## Environment variable

```
WEATHER_USER_AGENT="LDE Personal App (https://your-contact-url-or-email)"
```

NWS requires an identifying User-Agent with a real contact (URL or email). No
API key is needed. If unset, the function falls back to a project-identifying
string (the Netlify site URL) so development works without exposing a personal
address — set a real contact before relying on it in production.

## Upstream services / endpoints

- NWS points: `GET /points/{lat},{lon}` → forecast, forecastHourly,
  observationStations, office (cwa), grid, forecast/county/fire zones.
- NWS station obs: `/stations/{id}/observations/latest` (nearest valid).
- NWS alerts: `/alerts/active?point={lat},{lon}`.
- NWS products: `/products/types/{AFD|HWO|LSR|PNS}/locations/{office}` (on demand).
- Open-Meteo geocoding: `/v1/search?...&countryCode=US` (U.S.-only search).
- Radar/overlays (Phase 2): NOAA RIDGE2 / IDPGIS OGC + NDFD WMS via GetCapabilities.

## Caching / request safeguards

- Function sets `Cache-Control` so Netlify's CDN + the browser cache repeats
  (forecasts/products ~10 min, search ~10 min). Bounded retry on 429/5xx only
  (≤2, exponential backoff), 9s timeout, typed errors, `Promise.allSettled` so
  one failed subsection never blanks the snapshot.
- Client service (increment 2) adds the TTL query cache, in-flight de-dup,
  cancellation on location change/unmount, 60–120s foreground refresh paused
  when hidden, and a stale indicator when upstream is down. No client-side
  background alert poll.

## Phase 1 checklist

- [x] Server-side NWS client: identification, normalization, caching headers,
      timeout, bounded retry, typed errors (`weather.js`).
- [x] Current station observation with transparent provenance (station id/name/
      distance/age; forecast-derived fallback clearly labeled).
- [x] Normalized model: location, current, hourly (48h), daily (7-day), alerts
      (severity/urgency-sorted), product availability, warnings, provenance.
- [x] Local sunrise/sunset from coordinates (no NWS dependency).
- [x] U.S.-only location search (Open-Meteo) + on-demand NWS products (AFD/HWO/
      LSR/PNS).
- [x] Live-API smoke tests (snapshot / search / product / out-of-coverage).
- [x] Client shared weather service (`getWeatherSnapshot` + selectors, TTL
      cache, in-flight de-dup, stale-on-failure, gen-counter cancellation so no
      runaway loads; 90s foreground refresh paused when hidden/away).
- [x] Weather route/page + nav entry; current-location flow (one-time
      geolocation w/ denied/timeout handling) + U.S. search (debounced) + saved
      locations (add/select/remove, synced in `state.weatherLocations`).
- [x] Dashboard: current conditions w/ provenance, today summary, next-hours
      strip, alert cards (severity-colored + expandable), static radar preview.
- [x] Progressive disclosure: hourly-through-tomorrow, 7-day, detailed grid,
      on-demand NWS product text (AFD/HWO/LSR/PNS).
- [x] Leaflet expanded map (increment 3): theme-aware CARTO base map + one
      stable NOAA base-reflectivity radar layer (discovered via GetCapabilities,
      not hard-coded) + active NWS alert polygons from snapshot geometry +
      reflectivity legend + attribution + radar/alerts toggles + loading and
      radar-offline states. Leaflet is lazy-loaded from CDN on first map open;
      tile/radar hosts are excluded from the service-worker cache (sw.js
      SKIP_HOSTS) so tiles/frames are never stored. Single current frame — no
      time dimension, so no animation yet (Phase 2).
- [x] Tests (**Vitest**) — `npm test` runs 26 tests covering NWS unitCode
      conversion, wind cardinal, zone parsing, station provenance + forecast-
      derived labeling, null measurements, hourly/daily normalization, alert
      sort/geometry/expiration, sun times + timezone/DST formatting, nwsFetch
      retry/timeout/error-typing (mocked), U.S.-only search (mocked), radar
      capability discovery (mocked), and the TTL cache + in-flight de-dup +
      stale-peek behavior. The de-dup/cache logic was extracted to
      `weather-cache.js` so the shipped code is what's tested.
- [x] Production build verified — `npm run build` (vite) passes with the new
      `weather-cache.js` module bundled.

> Note: the repo also has older `test/*.js` files that predate the source being
> ES modules and have no runner; `vitest.config.mjs` scopes `npm test` to
> `test/weather-*.test.js` so this feature's suite stays green. Fixing/removing
> the legacy tests is out of scope for the weather work.

## Phase 2

- [x] **UV + air-quality enrichment adapter** — NWS carries neither, so both come
      from an explicitly-labeled provider (Open-Meteo: free, no key). Fetched in
      parallel inside `buildSnapshot` (failure-isolated → fields stay null, never
      invented), tagged `current.uvAqiProvenance = { provider: "OPEN_METEO" }`,
      and shown with category labels (UV Low/Moderate/…; AQI Good/Moderate/…) plus
      a "via Open-Meteo" note. Unit-tested (mocked) + verified live.
- [ ] Radar animation + timeline controls. **Blocked upstream:** NOAA's current
      IDP radar service exposes only a single live frame (no time dimension /
      `radar_base_reflectivity_time` is gone), so there is no reliable NOAA frame
      source to animate. Revisit if NOAA restores a time-enabled radar WMS, or
      decide to accept a non-NOAA frame provider (e.g. RainViewer).
- [ ] Overlay registry (temperature, precip prob/amount, snowfall, wind/gust,
      cloud cover) from live GetCapabilities. **Thin upstream right now:** the IDP
      `NDFD` folder currently offers essentially only `NDFD_temp` (numbered,
      ambiguous sublayers); precip/wind/gust/sky are not cleanly exposed. Per the
      brief we only expose layers that resolve, so this is deferred until the set
      is worth a discovery-driven registry (temperature + NOHRSC snow are the
      realistic candidates).
- [ ] Alert-notification worker (scheduled Netlify function) after opt-in +
      delivery are defined; dedup by alert id + sent time; minimal state only.
      (App already has VAPID/web-push + a scheduled-function pattern to build on.)
- [ ] Weather-aware sailing/calendar/insight selectors (separate focused changes).
      Note: sailing also needs marine (wave) + cloud-cover %, which the NWS-based
      service doesn't provide — migrating it needs a small design decision (keep
      marine via a separate adapter vs. add those fields), so it's its own change.

## Weather 2.0 — UI redesign (branch `weather-2.0`)

A presentation-layer redesign ("calm card stack") over the SAME `weather.js` +
`getWeatherSnapshot` service — **no backend, model, or provider change to the data
path**. The normalized model was rich enough as-is (the NWS `icon` token + `isDaytime`
+ `shortForecast` drive everything).

**New pure modules (unit-tested):**
- `weather-condition.js` — interprets the already-normalized `icon`/text/day-night into
  one canonical condition set (+ heavy/severe refinement, text-only fallback for
  observations, `weatherEmphasis()` for the reactive hierarchy). NOT a data source.
- `weather-art.js` — the ARTWORK SKIN: `(condition, isDay) -> inline SVG` hero art +
  forecast icons. Deliberately isolated so the "calm" set can later be swapped for an
  atmospheric/animated set without touching callers.

**UI (all in app.js, `renderWeatherPage` + `wx*` components):** atmospheric hero
(condition + time-of-day artwork, mood-tinted sky, dominant temp, provenance, chips),
horizontal hourly rail, 7-day folded from day/night periods into hi/lo rows with
temp-range bars, grouped detail (Wind dial · Comfort · Sun & Sky arc · Air), 12h temp+
precip trend chart, location rail, progressive NWS feed, upgraded alerts. Two-column
desktop / single-column mobile; light + dark; `minmax(0,…)` grids (no blowout).

**Map (`openWeatherRadarMap`):** RADAR | SATELLITE modes.
- Radar = the existing NOAA IDP base-reflectivity WMS (single frame, discovered via
  GetCapabilities). **Satellite = NASA GIBS GOES-East GeoColor**, latest frame via
  `time=default`, `GoogleMapsCompatible_Level7` (maxNativeZoom 7). This is a deliberate
  **non-NOAA provider** choice — GOES-derived, reliably tiled, ~10-min cadence — the only
  reliable tiled satellite source found; documented here per the brief.
- Base map switched CARTO → **Esri gray canvas** (keyless, theme-aware) because CARTO's
  free basemaps now stamp an "API KEY REQUIRED" watermark.
- Warnings (alert polygons) kept. States: radar-offline disables its mode + falls back to
  satellite; satellite tile errors show "temporarily unavailable"; freshness + attribution
  always shown. `sw.js` SKIP_HOSTS excludes gibs + arcgisonline (tiles never cached).

**NOAA limitations reconfirmed live:** no reliable historical radar frames → **no timeline/
animation** (not faked). NDFD overlays still thin. If radar animation is ever wanted, a
non-NOAA frame provider (e.g. RainViewer) is the explicit future decision.

**Verified (browser, live NWS data):** hero/rails/detail/chart/feed at 360/390/desktop ×
light/dark, 0 horizontal overflow, no render errors; map opens, radar + GIBS satellite
tiles load, mode-switch + freshness labels correct. `weather-*` tests: 49 green.
**Not live-verifiable at build time:** severe/alert + night + stale states (no active US
alerts existed during QA; day everywhere) — covered by unit tests + the design mockup.
