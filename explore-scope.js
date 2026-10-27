// Explore sections (Luke, 2026-10-17; renamed 2026-10-22): the Explore page groups
// trips into Local, Regional, National and Global by how far the destination is
// from home. The keys stay local / state / country / world, so trips the user
// already moved (`trip.scope`) keep their row. The app sorts
// each trip itself — comparing the destination's place to home's — and a trip the
// user moves (or adds from a section's "+") keeps that choice in `trip.scope`.
//
// Pure: places come in already looked up ({ lat, lng, country, state }); the
// lookup and its device cache live in app.js. Nothing here touches the network.

import { recipePhotoPublicUrl } from "./recipe-photos.js";

export const EXPLORE_SCOPES = [
  { key: "local",   label: "Local",    icon: "./explore-local.png" },
  { key: "state",   label: "Regional", icon: "./explore-regional.png" },
  { key: "country", label: "National", icon: "./explore-national.png" },
  { key: "world",   label: "Global",   icon: "./explore-global.png" },
];
const SCOPE_KEYS = new Set(EXPLORE_SCOPES.map((s) => s.key));
export const isExploreScope = (key) => SCOPE_KEYS.has(key);

// Within this distance of home a trip is Local, whatever state line it crosses
// (a day trip from Minneapolis into Wisconsin is still local).
export const LOCAL_KM = 100;

export function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const same = (x, y) => !!x && !!y && String(x).trim().toLowerCase() === String(y).trim().toLowerCase();

// Which section a place belongs in relative to home, or null when it can't tell
// (no home, or the place wasn't found). Country codes compare case-insensitively.
export function classifyPlace(home, place, { localKm = LOCAL_KM } = {}) {
  if (!home || !place) return null;
  const km = distanceKm(home, place);
  if (km != null && km <= localKm) return "local";
  if (!home.country || !place.country) return null;
  if (!same(home.country, place.country)) return "world";
  if (home.state && place.state && same(home.state, place.state)) return "state";
  return "country";
}

// A trip's section: the user's own choice wins; then the sorted place; else null
// ("Not sorted yet" — no destination, no home, or the lookup found nothing).
export function tripScope(trip, { home, placeOf } = {}) {
  if (isExploreScope(trip?.scope)) return trip.scope;
  const dest = String(trip?.destination || "").trim();
  if (!dest) return null;
  return classifyPlace(home, placeOf?.(dest) || null);
}

// Trips by section, plus `unsorted`. Order within a section is the caller's
// (pass trips already sorted).
export function groupTrips(trips, opts = {}) {
  const out = { local: [], state: [], country: [], world: [], unsorted: [] };
  for (const t of trips || []) {
    const key = tripScope(t, opts);
    (key ? out[key] : out.unsorted).push(t);
  }
  return out;
}

// A Nominatim search/reverse hit (with addressdetails=1) → our place shape.
export function placeFromNominatim(hit) {
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const a = hit.address || {};
  return {
    lat, lng,
    country: String(a.country_code || "").toLowerCase(),
    state: a.state || a.province || a.region || a["ISO3166-2-lvl4"] || "",
  };
}

// Trip pictures (Luke, 2026-10-27): a trip may carry its own picture in
// `trip.image` — a storage path in the public recipe-photos bucket
// ("<user>/trips/<trip>/trip-<ts>.png"), never image bytes. The path changes on
// every upload, so the service worker can cache it forever. A trip without one
// shows its row's default picture (as does each row's "New trip" card).
export function scopeIconUrl(scopeKey) {
  return EXPLORE_SCOPES.find((s) => s.key === scopeKey)?.icon || "";
}

export function tripImagePath(trip) {
  const v = String(trip?.image || "").trim().replace(/^\/+/, "");
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.includes("..")) return "";
  return v;
}

// What a trip card's <img> loads: the trip's own picture, else its row's default,
// else "" (a trip not sorted yet keeps the plain travel icon).
export function tripCardImageUrl(trip, scopeKey, supabaseUrl) {
  const path = tripImagePath(trip);
  if (path && supabaseUrl) return recipePhotoPublicUrl(path, supabaseUrl);
  return scopeIconUrl(scopeKey);
}

export function tripImageStoragePath(userId, tripId, now = Date.now()) {
  const safe = (x) => String(x || "").replace(/[^a-z0-9-]/gi, "-") || "x";
  return `${safe(userId)}/trips/${safe(tripId)}/trip-${now}.png`;
}
