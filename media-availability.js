// Shared availability mapping — the ONE place that turns TMDB "watch/providers"
// data (JustWatch-sourced) into canonical providerRefs. Reused by the Watch
// adapter (media-watch-adapter.js) and the TMDB availability provider
// (media-provider-tmdb.js), so there is a single availability mechanism, not two
// (design §3/§19 of the plan). Pure, DOM-free.

// Display-name → catalog provider id. Everything else slugifies gracefully, so an
// unknown streamer still yields a ref (the coordinator falls back to a hand-off).
const NAME_TO_ID = [
  [/netflix/i, "netflix"], [/disney/i, "disney"], [/\bmax\b|hbo/i, "max"],
  [/paramount/i, "paramount"], [/espn/i, "espn"], [/xfinity/i, "xfinity"],
  [/prime video|amazon/i, "prime"], [/\bhulu\b/i, "hulu"], [/apple ?tv/i, "appletv"],
  [/youtube/i, "youtube"], [/peacock/i, "peacock"], [/\bpbs\b/i, "pbs"],
];

export function matchProviderId(name) {
  const s = String(name || "");
  for (const [re, id] of NAME_TO_ID) if (re.test(s)) return id;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

/**
 * TMDB watch/providers groups → providerRefs. flatrate/free/ads are subscription/
 * free streaming (the "your services" candidates); rent/buy are also reachable.
 * The JustWatch `link` becomes the deep link for each ref. De-duped by provider.
 */
export function tmdbWatchProvidersToRefs(sp) {
  if (!sp || typeof sp !== "object") return [];
  const link = sp.link || null;
  const groups = [...(sp.flatrate || []), ...(sp.free || []), ...(sp.ads || []), ...(sp.rent || []), ...(sp.buy || [])];
  const seen = new Set();
  const refs = [];
  for (const p of groups) {
    const id = matchProviderId(p && p.provider_name);
    if (seen.has(id)) continue;
    seen.add(id);
    refs.push({ providerId: id, externalId: (p && p.provider_id != null) ? String(p.provider_id) : "", deepLink: link });
  }
  return refs;
}
