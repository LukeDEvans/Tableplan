// v36: caching narrowed to same-origin static files (+ versioned CDN libs);
// navigations keyed to "/" only when ok. Bumping the name also drops every
// hashed /assets/ file the old worker accumulated across deploys.
const CACHE = "live-v53";

// Recipe photos (RECIPE_PHOTOS_DESIGN.md §4.3): own photos live in the PUBLIC
// recipe-photos bucket at URLs that never change (every upload gets a new name),
// so they're served cache-first from their own cache. It's kept apart from CACHE
// so an app-version bump doesn't make every device re-download every photo, and
// it's capped (oldest out first). Website photos are NOT cached here: they're
// opaque cross-origin responses, which browsers charge several MB of quota each.
const PHOTO_CACHE = "live-recipe-photos-v1";
const PHOTO_CACHE_MAX = 400;
const PHOTO_PATH = "/storage/v1/object/public/recipe-photos/";

function isRecipePhotoRequest(url) {
  return /\.supabase\.co$/i.test(url.hostname) && url.pathname.startsWith(PHOTO_PATH);
}
const PRECACHE = ["/", "/favicon.svg"];

// Cross-origin hosts whose GET responses may be cached. Only versioned,
// immutable library URLs (the pinned supabase-js SDK — needed for an offline
// boot — and Leaflet) are served from here. Every OTHER cross-origin request
// (Supabase, weather/open-meteo, map tiles, radar, audio streams, Apple Music,
// fonts, …) passes straight through to the network untouched.
const CACHEABLE_CROSS_ORIGIN_HOSTS = ["cdn.jsdelivr.net"];

// Same-origin files worth caching: Vite's hashed bundle under /assets/, plus the
// root-level static files copied into dist (icons, logos, manifest).
const ROOT_STATIC_FILE = /^\/[^/]+\.(?:png|svg|ico|webp|jpe?g|gif|json|webmanifest|woff2?)$/i;

function isCacheableRequest(url) {
  if (url.origin === self.location.origin) {
    if (url.pathname === "/version.json") return false; // the build stamp must be live
    return url.pathname.startsWith("/assets/") || ROOT_STATIC_FILE.test(url.pathname);
  }
  return CACHEABLE_CROSS_ORIGIN_HOSTS.includes(url.hostname);
}

function isCacheableResponse(res) {
  if (!res || !res.ok || res.status !== 200) return false; // no partial (206) / error bodies
  // Never cache audio streams (live radio, media) — they're large, often
  // range/chunked, and would buffer indefinitely.
  const ct = res.headers.get("content-type") || "";
  return !/^audio\//i.test(ct) && !/(mpegurl|octet-stream)/i.test(ct);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigation: network-first, fall back to the cached shell. The app is a
  // single page, so the shell is always stored under "/" — never under the
  // request URL, which can carry one-time tokens (?invite=…) — and only from a
  // good, same-origin, non-redirected response (never a 404/500 page).
  if (request.mode === "navigate") {
    const network = fetch(request);
    event.waitUntil(
      network
        .then((res) => {
          if (res.ok && !res.redirected && res.type === "basic" && url.origin === self.location.origin) {
            const copy = res.clone();
            return caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return undefined;
        })
        .catch(() => {})
    );
    event.respondWith(network.catch(() => caches.match("/")));
    return;
  }

  if (isRecipePhotoRequest(url) && !request.headers.has("range")) {
    event.respondWith(recipePhotoResponse(request, event));
    return;
  }

  // Everything else that isn't an allowed static file goes straight to the
  // network (APIs, functions, cross-origin data, range requests).
  if (!isCacheableRequest(url) || request.headers.has("range")) return;

  // Static files: stale-while-revalidate. The response copy is taken
  // synchronously when the network response arrives (before the page can read
  // the body), and the cache write is tied to event.waitUntil so the worker
  // isn't killed mid-update.
  const network = fetch(request).then((res) => ({ res, copy: isCacheableResponse(res) ? res.clone() : null }));
  network.catch(() => {}); // a failed background refresh is not an error
  event.waitUntil(
    network
      .then(({ copy }) => (copy ? caches.open(CACHE).then((c) => c.put(request, copy)) : undefined))
      .catch(() => {})
  );
  event.respondWith(
    caches.match(request, { cacheName: CACHE })
      .then((cached) => cached || network.then(({ res }) => res))
  );
});

// Cache-first for recipe photos, keyed by URL alone. An <img> asks in no-cors
// mode (an opaque, unreadable response), so the worker re-asks in CORS mode to get
// a real response it can check and store; if that fails it falls back to the
// page's own request, uncached.
async function recipePhotoResponse(request, event) {
  const key = request.url;
  try {
    const cache = await caches.open(PHOTO_CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = await fetch(key, { mode: "cors", credentials: "omit" });
    if (res.ok && res.status === 200 && /^image\//i.test(res.headers.get("content-type") || "")) {
      const copy = res.clone();
      event.waitUntil(cache.put(key, copy).then(() => trimPhotoCache(cache)).catch(() => {}));
    }
    return res;
  } catch {
    return fetch(request);
  }
}

async function trimPhotoCache(cache) {
  const keys = await cache.keys(); // insertion order: oldest first
  const extra = keys.length - PHOTO_CACHE_MAX;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { title: "Live", body: event.data?.text() ?? "" }; }

  const title = data.title || "Live";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || "live-notification",
    data: { url: data.url || "/" },
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
