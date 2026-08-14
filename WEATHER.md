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
- [ ] Client shared weather service (`getWeatherSnapshot` + cache/dedup/no-loop).
- [ ] Weather route/page + nav entry; current-location flow + search + saved
      locations.
- [ ] Dashboard: current conditions, today summary, next-hours strip, alert
      banner, radar preview.
- [ ] Progressive disclosure: hourly-through-tomorrow, 7-day, detailed grid,
      NWS product text.
- [ ] Leaflet expanded map: base map + one stable radar layer + alert polygons
      + legend/timestamp.
- [ ] Tests (Vitest, pending decision) for conversion, timezone/DST, alert sort,
      cache TTL, in-flight dedup, no-render-loop; production build verification.

## Phase 2 (do not start until Phase 1 is stable)

- [ ] Radar animation + timeline controls; reduced-motion behavior.
- [ ] Overlay registry from live WMS GetCapabilities: temperature, precip
      probability/amount, snowfall, wind/gust, cloud cover (only expose layers
      that resolve).
- [ ] Optional UV/AQI adapters (only with a deliberately configured, trustworthy
      source).
- [ ] Alert-notification worker (scheduled Netlify function) after opt-in +
      delivery are defined; dedup by alert id + sent time; minimal state only.
- [ ] Weather-aware sailing/calendar/insight selectors (separate focused changes)
      — migrate sailing off its direct Open-Meteo calls onto the shared service.
