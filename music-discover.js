// Music → Discover: the provider-neutral pieces of the Discover tab (browse
// categories, genre resolution) plus the local-search filters that let the one
// music search bar work on every sub-tab (Discover searches the catalog; Saved,
// Library and playlists filter what the user already has).
//
// Pure: no DOM, no storage, no network. app.js renders; providers fetch
// (music-streaming.js "Browse contract"). A category never names a provider —
// it carries a label, a search query and genre-name hints; a provider that
// supports genres resolves the hint to its own genre id at browse time.

const clean = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9&\s]/g, " ").replace(/\s+/g, " ").trim();

// hue = tile colour (HSL hue, rendered as a gradient). genre = catalog genre
// names to match (first match wins); fallbackGenreId = Apple's long-stable
// iTunes genre id, used only when the genre list itself can't be fetched.
// free = also meaningful on the free/open sources (Internet Archive, Musopen),
// so it's shown when no subscription catalog is connected.
export const DISCOVER_CATEGORIES = Object.freeze([
  { id: "pop", label: "Pop", query: "pop hits", genre: ["pop"], fallbackGenreId: "14", hue: 330 },
  { id: "hiphop", label: "Hip-Hop", query: "hip-hop", genre: ["hip-hop/rap", "hip hop/rap", "hip-hop", "rap"], fallbackGenreId: "18", hue: 20 },
  { id: "rock", label: "Rock", query: "rock", genre: ["rock"], fallbackGenreId: "21", hue: 0 },
  { id: "rnb", label: "R&B", query: "r&b", genre: ["r&b/soul", "r&b", "soul"], fallbackGenreId: "15", hue: 280 },
  { id: "alternative", label: "Alternative", query: "alternative", genre: ["alternative"], fallbackGenreId: "20", hue: 200 },
  { id: "country", label: "Country", query: "country", genre: ["country"], fallbackGenreId: "6", hue: 35 },
  { id: "electronic", label: "Electronic", query: "electronic", genre: ["electronic", "dance"], fallbackGenreId: "7", hue: 190 },
  { id: "dance", label: "Dance", query: "dance", genre: ["dance"], fallbackGenreId: "17", hue: 300 },
  { id: "latin", label: "Latin", query: "latin", genre: ["latin", "música latina", "musica latina"], fallbackGenreId: "12", hue: 10 },
  { id: "kpop", label: "K-Pop", query: "k-pop", genre: ["k-pop", "kpop"], fallbackGenreId: "51", hue: 315 },
  { id: "jazz", label: "Jazz", query: "jazz", genre: ["jazz"], fallbackGenreId: "11", hue: 215, free: true },
  { id: "classical", label: "Classical", query: "classical", genre: ["classical"], fallbackGenreId: "5", hue: 45, free: true },
  { id: "indie", label: "Indie", query: "indie", genre: ["indie pop", "indie rock", "indie"], hue: 160 },
  { id: "singer", label: "Songwriters", query: "singer songwriter", genre: ["singer/songwriter"], fallbackGenreId: "10", hue: 25 },
  { id: "metal", label: "Metal", query: "metal", genre: ["metal", "heavy metal", "hard rock"], fallbackGenreId: "1153", hue: 240 },
  { id: "soundtrack", label: "Soundtracks", query: "soundtrack", genre: ["soundtrack"], fallbackGenreId: "16", hue: 260 },
  { id: "chill", label: "Chill", query: "chill", hue: 175 },
  { id: "focus", label: "Focus", query: "focus", hue: 145, free: true },
  { id: "workout", label: "Workout", query: "workout", hue: 5 },
  { id: "party", label: "Party", query: "party", hue: 290 },
  { id: "feelgood", label: "Feel Good", query: "feel good", hue: 50 },
  { id: "sleep", label: "Sleep", query: "sleep", hue: 230, free: true },
  { id: "piano", label: "Piano", query: "piano", hue: 210, free: true },
  { id: "ambient", label: "Ambient", query: "ambient", hue: 185, free: true },
  { id: "meditation", label: "Meditation", query: "meditation", hue: 265, free: true },
  { id: "instrumental", label: "Instrumental", query: "instrumental", hue: 125, free: true },
  { id: "nature", label: "Nature", query: "nature soundscape", hue: 110, free: true },
]);

/** The categories to show: all of them with a full catalog, else the free ones. */
export function categoriesFor({ fullCatalog = false } = {}) {
  return DISCOVER_CATEGORIES.filter((c) => fullCatalog || c.free);
}
export function categoryById(id) { return DISCOVER_CATEGORIES.find((c) => c.id === id) || null; }

/**
 * Resolve a category to the provider's genre id. `genres` is the provider's
 * list ([{id,name}]) or null when it couldn't be fetched. With a list, only a
 * name match counts (a stale fallback id could point at the wrong genre in a
 * different storefront); without one, fall back to the stable id.
 */
export function resolveGenreId(category, genres) {
  if (!category || !Array.isArray(category.genre) || !category.genre.length) return null;
  if (Array.isArray(genres) && genres.length) {
    const byName = new Map(genres.map((g) => [clean(g.name), String(g.id)]));
    for (const name of category.genre) { const id = byName.get(clean(name)); if (id) return id; }
    return null;
  }
  return category.fallbackGenreId || null;
}

// ── local search (Saved / Library / playlist tabs) ────────────────────────────
// Every query word must appear somewhere in the item's text (AND of words,
// order-free), so "beatles abbey" finds Abbey Road by the Beatles.
export function queryTokens(q) { return clean(q).split(" ").filter(Boolean); }
export function textMatches(text, q) {
  const toks = Array.isArray(q) ? q : queryTokens(q);
  if (!toks.length) return true;
  const hay = clean(text);
  return toks.every((t) => hay.includes(t));
}

const names = (list) => (Array.isArray(list) ? list : []).map((p) => (p && typeof p === "object" ? p.name : p)).filter(Boolean).join(" ");
/** Searchable text for any saved entity (recording / album / work / person / track). */
export function entityText(e) {
  if (!e || typeof e !== "object") return String(e || "");
  const composer = e.composer && typeof e.composer === "object" ? e.composer.name : e.composer;
  return [e.title, e.name, e.workTitle, composer, e.artist, names(e.performers), names(e.artists), e.album, e.catalog].filter(Boolean).join(" ");
}

/** Filter the personal library ({favorites, playlists}) to a query. A playlist
 *  matches on its name OR any of its items (then only matching items show). */
export function filterSavedLibrary(lib, q) {
  const toks = queryTokens(q);
  const favorites = (lib && Array.isArray(lib.favorites) ? lib.favorites : []);
  const playlists = (lib && Array.isArray(lib.playlists) ? lib.playlists : []);
  if (!toks.length) return { favorites, playlists, active: false };
  return {
    active: true,
    favorites: favorites.filter((f) => textMatches(entityText(f.entity), toks)),
    playlists: playlists.filter((p) => textMatches(p.name, toks) || (p.items || []).some((it) => textMatches(entityText(it), toks))),
  };
}

/** Filter a flat track list (local Library, a playlist's items). */
export function filterTracks(tracks, q) {
  const toks = queryTokens(q);
  const list = Array.isArray(tracks) ? tracks : [];
  return toks.length ? list.filter((t) => textMatches(entityText(t), toks)) : list;
}

/** Time-of-day greeting for the Discover header. */
export function greetingFor(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
