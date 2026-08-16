// Travel geo — the spatial layer's pure core. Itinerary items store locations as
// human text ("Hagia Sophia, Istanbul"), not coordinates. This module manages a
// per-trip geocode CACHE (so each place is resolved at most once), ranks places
// onto the map, and does the small geometry (bounds, day colors) the Leaflet
// renderer needs. The actual geocoding request is INJECTED — a provider function
// (address) → Promise<{lat,lng}|null>. app.js wires a real provider; tests inject
// a stub; offline injects one that resolves null. Nothing here touches the
// network or the DOM, and the renderer degrades to map deep-links when a place
// can't be resolved, so the feature never hard-depends on any one geocoder.

// A stable cache key for an address (case/space-insensitive).
export function geoKey(address) {
  return String(address || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function geoCacheGet(cache, address) {
  const k = geoKey(address);
  const v = cache && cache[k];
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? v : null;
}

// Returns a NEW cache object with the coords recorded (never mutates the input).
// A null/failed result is remembered as a miss so we don't hammer the provider,
// but misses expire (ttl) so a place can resolve later once data improves.
export function geoCachePut(cache, address, coords, { now = Date.now() } = {}) {
  const k = geoKey(address);
  const next = { ...(cache || {}) };
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    next[k] = { lat: coords.lat, lng: coords.lng, at: now };
  } else {
    next[k] = { miss: true, at: now };
  }
  return next;
}

// Should we attempt to geocode this address now? No if we already have coords;
// no if we recorded a recent miss (within ttl); yes otherwise.
export function shouldGeocode(cache, address, { now = Date.now(), missTtlMs = 7 * 864e5 } = {}) {
  const k = geoKey(address);
  if (!k) return false;
  const v = cache && cache[k];
  if (!v) return true;
  if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) return false;
  if (v.miss && now - (v.at || 0) < missTtlMs) return false;
  return true;
}

// A calm, distinguishable palette for per-day markers/paths. Wraps for long trips.
const DAY_COLORS = ["#32b496", "#4285f4", "#e2725b", "#9b59b6", "#e0a500", "#2c8c99", "#c0587e", "#5a8f3d"];
export function dayColor(dayIndex) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0) return "#888888";
  return DAY_COLORS[dayIndex % DAY_COLORS.length];
}

// Bounding box of located points, or null. Used for Leaflet fitBounds.
export function boundsOf(points) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  pts.forEach(p => {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  });
  return { minLat, maxLat, minLng, maxLng, center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 } };
}

// Resolve coordinates for a list of places against the cache, geocoding the
// gaps politely (sequential, so we respect provider rate limits) via the
// injected provider. Returns { located, cache, resolvedCount } — `located` carries
// each input place plus lat/lng when known (unresolved places are dropped from
// `located` but never lost from the trip). Pure aside from the injected calls;
// never throws (a provider error is treated as a miss).
export async function resolvePlaces(places, { geocode, cache = {}, now = Date.now, maxRequests = 20 } = {}) {
  let workingCache = { ...(cache || {}) };
  let requests = 0;
  for (const place of (places || [])) {
    const addr = place && place.location;
    if (!addr) continue;
    if (typeof geocode === "function" && requests < maxRequests && shouldGeocode(workingCache, addr, { now: now() })) {
      let coords = null;
      try { coords = await geocode(addr); } catch { coords = null; }
      workingCache = geoCachePut(workingCache, addr, coords, { now: now() });
      requests += 1;
    }
  }
  const located = (places || [])
    .map(p => { const c = geoCacheGet(workingCache, p && p.location); return c ? { ...p, lat: c.lat, lng: c.lng } : null; })
    .filter(Boolean);
  return { located, cache: workingCache, resolvedCount: located.length };
}
