// Provider-aware deep links (design §9 — "provider-aware deep links … native-app
// handoff … browser fallback"). Given a known streamer and a title, build the URL
// that lands the user INSIDE that service (its own search/browse), rather than an
// aggregator page. This is a legitimate hand-off only: it never bypasses DRM,
// auth, or anti-embedding — it opens the provider's normal surface so the user
// signs in and plays there. TMDB tells us WHICH services carry a title, not the
// title's per-provider id, so a title search is the honest, precise target. Pure.

const enc = (s) => encodeURIComponent(String(s || "").trim());

// providerId → (encodedTitle) => url. Only the services we actually model.
const TEMPLATES = {
  netflix:   (q) => `https://www.netflix.com/search?q=${q}`,
  disney:    (q) => `https://www.disneyplus.com/search?q=${q}`,
  max:       (q) => `https://play.max.com/search?q=${q}`,
  hulu:      (q) => `https://www.hulu.com/search?q=${q}`,
  prime:     (q) => `https://www.amazon.com/s?k=${q}&i=instant-video`,
  paramount: (q) => `https://www.paramountplus.com/search/?query=${q}`,
  appletv:   (q) => `https://tv.apple.com/search?term=${q}`,
  peacock:   (q) => `https://www.peacocktv.com/search?q=${q}`,
  espn:      (q) => `https://www.espn.com/search/_/q/${q}`,
  xfinity:   (q) => `https://www.xfinity.com/stream/search/${q}`,
  youtube:   (q) => `https://www.youtube.com/results?search_query=${q}`,
  pbs:       (q) => `https://www.pbs.org/search/?q=${q}`,
};

/** A provider-specific deep link for a title, or null if we don't model it. */
export function buildStreamerDeepLink(providerId, title) {
  const t = enc(title);
  if (!t) return null;
  const f = TEMPLATES[providerId];
  return f ? f(t) : null;
}

/** True if we can build a deep link for this provider. */
export function hasDeepLink(providerId) {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, providerId);
}
