// Personal music library + playlists — provider-independent, local-first.
//
// Favorites reference CANONICAL entities (Work / Recording / Album / Artist /
// Composer from music-canonical.js), never provider-specific records, so the
// library survives a provider disappearing or changing its ids. Playlists hold
// canonical Recordings (each carrying providerRefs), so one playlist can mix
// sources. These are pure functions over a plain `library` object:
//
//   library = { favorites: Favorite[], playlists: Playlist[] }
//   Favorite = { key, type, entity, at }
//   Playlist = { id, name, items: Recording[], createdAt, updatedAt }
//
// They mutate-and-return the object (the app stores it at state.musicLibrary and
// calls persist()); nothing here touches the DOM or storage, so it's all tested.

let _n = 0;
const uid = (p) => { _n += 1; return `${p}_${Date.now().toString(36)}${_n.toString(36)}${Math.random().toString(36).slice(2, 6)}`; };
const nowIso = () => new Date().toISOString();

export function emptyLibrary() { return { favorites: [], playlists: [] }; }
export function normalizeLibrary(lib) {
  const l = lib && typeof lib === "object" ? lib : {};
  return { favorites: Array.isArray(l.favorites) ? l.favorites : [], playlists: Array.isArray(l.playlists) ? l.playlists : [] };
}

// Stable, content-derived identity for a favorited entity (NOT the random
// canonical id, which changes each derivation). Works key on composer + catalog
// (provider-independent, canonical); recordings/albums key on their stable
// provider reference (the identity of that specific found performance/release);
// people key on name. So isFavorite matches across re-renders and provider
// metadata changes.
const low = (s) => String(s || "").toLowerCase().trim();
export function favoriteKey(type, entity) {
  if (!entity) return `${type}:?`;
  if (type === "work") return `work:${low(entity.composer)}|${entity.catalogId || low(entity.title) || entity.id || "?"}`;
  if (type === "composer" || type === "artist") return `${type}:${low(entity.name || entity)}`;
  const r = entity.providerRefs && entity.providerRefs[0];
  if (type === "recording" || type === "album") return r ? `${type}:${r.provider}:${r.externalId}` : `${type}:${entity.id || low(entity.title)}`;
  return `${type}:${entity.id || low(entity.title || entity.name)}`;
}

// ── favorites ─────────────────────────────────────────────────────────────────
export function isFavorite(lib, type, entity) {
  const key = favoriteKey(type, entity);
  return normalizeLibrary(lib).favorites.some((f) => f.key === key);
}
export function addFavorite(lib, type, entity) {
  const l = normalizeLibrary(lib);
  const key = favoriteKey(type, entity);
  if (!l.favorites.some((f) => f.key === key)) l.favorites.unshift({ key, type, entity, at: nowIso() });
  return l;
}
export function removeFavorite(lib, type, entity) {
  const l = normalizeLibrary(lib);
  const key = favoriteKey(type, entity);
  l.favorites = l.favorites.filter((f) => f.key !== key);
  return l;
}
export function toggleFavorite(lib, type, entity) {
  return isFavorite(lib, type, entity) ? removeFavorite(lib, type, entity) : addFavorite(lib, type, entity);
}
export function favoritesOfType(lib, type) { return normalizeLibrary(lib).favorites.filter((f) => f.type === type); }

// ── playlists ─────────────────────────────────────────────────────────────────
export function createPlaylist(lib, name) {
  const l = normalizeLibrary(lib);
  const pl = { id: uid("pl"), name: String(name || "New playlist").trim() || "New playlist", items: [], createdAt: nowIso(), updatedAt: nowIso() };
  l.playlists.unshift(pl);
  return { library: l, playlist: pl };
}
export function deletePlaylist(lib, id) {
  const l = normalizeLibrary(lib);
  l.playlists = l.playlists.filter((p) => p.id !== id);
  return l;
}
export function renamePlaylist(lib, id, name) {
  const l = normalizeLibrary(lib);
  const p = l.playlists.find((x) => x.id === id);
  if (p) { p.name = String(name || p.name).trim() || p.name; p.updatedAt = nowIso(); }
  return l;
}
export function getPlaylist(lib, id) { return normalizeLibrary(lib).playlists.find((p) => p.id === id) || null; }

// Items are canonical Recordings. De-duped within a playlist by recording id
// (or a provider-ref key when a recording has no canonical id yet).
const recKey = (r) => r && (r.id || (r.providerRefs && r.providerRefs[0] && `${r.providerRefs[0].provider}:${r.providerRefs[0].externalId}`)) || "";
export function addToPlaylist(lib, id, recording) {
  const l = normalizeLibrary(lib);
  const p = l.playlists.find((x) => x.id === id);
  if (p && recording) {
    const k = recKey(recording);
    if (!p.items.some((it) => recKey(it) === k)) { p.items.push(recording); p.updatedAt = nowIso(); }
  }
  return l;
}
export function removeFromPlaylist(lib, id, index) {
  const l = normalizeLibrary(lib);
  const p = l.playlists.find((x) => x.id === id);
  if (p && index >= 0 && index < p.items.length) { p.items.splice(index, 1); p.updatedAt = nowIso(); }
  return l;
}
export function reorderPlaylist(lib, id, from, to) {
  const l = normalizeLibrary(lib);
  const p = l.playlists.find((x) => x.id === id);
  if (p && from >= 0 && from < p.items.length && to >= 0 && to < p.items.length && from !== to) {
    const [moved] = p.items.splice(from, 1);
    p.items.splice(to, 0, moved);
    p.updatedAt = nowIso();
  }
  return l;
}
