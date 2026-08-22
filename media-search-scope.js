// Watch search scope — pure logic behind the Watch header filter. Maps the
// user-facing media types to the underlying search-provider ids, and normalizes
// the persisted scope preference. Deliberately free of DOM and storage so it is
// unit-testable; app.js owns the localStorage read/write and the popover DOM.
//
// The `providers` ids here MUST match the `.id` of the providers app.js puts in
// hub.searchProviders (media-provider-*.js): tmdb, youtube, jellyfin, music,
// podcastsearch, radio. media-search-scope.test.js locks that contract.
export const WATCH_SCOPE_TYPES = [
  { key: "movtv",   label: "Movies & TV", providers: ["tmdb"] },
  { key: "video",   label: "Videos",      providers: ["youtube", "jellyfin"] },
  { key: "music",   label: "Music",       providers: ["music"] },
  { key: "podcast", label: "Podcasts",    providers: ["podcastsearch"] },
  { key: "radio",   label: "Radio",       providers: ["radio"] },
];

export const WATCH_SCOPE_KEYS = WATCH_SCOPE_TYPES.map((t) => t.key);

// Given a parsed saved value (or null/garbage), produce a normalized scope.
// A valid array of types is honored even when EMPTY (the user unchecked all —
// runDiscoverSearch then shows a "pick a type" hint); only a missing or
// non-array `types` defaults to all types. servicesOnly is coerced to boolean.
export function normalizeWatchScope(saved) {
  const types = Array.isArray(saved?.types)
    ? saved.types.filter((k) => WATCH_SCOPE_KEYS.includes(k))
    : WATCH_SCOPE_KEYS.slice();
  return { types, servicesOnly: !!saved?.servicesOnly };
}

// The set of provider ids a scope's selected types resolve to.
export function allowedProviderIds(scope) {
  const set = new Set();
  const types = scope && Array.isArray(scope.types) ? scope.types : [];
  WATCH_SCOPE_TYPES.forEach((t) => {
    if (types.includes(t.key)) t.providers.forEach((p) => set.add(p));
  });
  return set;
}
