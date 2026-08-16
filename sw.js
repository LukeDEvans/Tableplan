const CACHE = "live-v20";
const PRECACHE = ["/", "/favicon.svg"];
// Weather map tiles / radar frames must never be cached here (they'd bloat the
// cache and serve stale radar) — pass them straight through to the network.
const SKIP_HOSTS = ["supabase.co", "googleapis.com", "gstatic.com", "cartocdn.com", "mapservices.weather.noaa.gov", "radar.weather.gov", "openstreetmap.org",
  // On-demand Music streams from these directly; never let the SW cache audio
  // (large, range-based, and licence-restricted) or their search/art responses.
  "archive.org", "api.jamendo.com", "jamendo.com",
  // Radio: MPR/APMG stream CDN + Radio Browser directory/streams.
  "publicradio.org", "api.radio-browser.info"];

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (SKIP_HOSTS.some((h) => url.hostname.includes(h))) return;

  // API calls must always hit the network — caching them serves stale
  // responses (e.g. expired OAuth URLs) and masks server errors
  if (url.pathname.startsWith("/.netlify/functions/") || url.pathname.startsWith("/api/")) return;

  // Navigation: network-first, fall back to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Static assets: serve cached immediately, update cache in background
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchAndCache = fetch(request).then((res) => {
        // Never cache audio streams (live radio, media) — they're large, often
        // range/chunked, and would buffer indefinitely.
        const ct = res.headers.get("content-type") || "";
        if (res.ok && !/^audio\//i.test(ct) && !/(mpegurl|octet-stream)/i.test(ct)) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      if (cached) {
        fetchAndCache; // background update, not awaited
        return cached;
      }
      return fetchAndCache;
    })
  );
});

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
