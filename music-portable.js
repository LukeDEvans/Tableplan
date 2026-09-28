// Portable music library — CSV export / import of favourites + playlists.
//
// WHERE THE DATA LIVES (and why CSV is not the store): the library's source of
// truth stays state.musicLibrary (synced JSONB), whose entries are already
// provider-independent canonical entities (music-library-model.js) carrying
// every provider reference they were found under, plus an ISRC when the
// provider supplies one. That is what survives switching players: a saved song
// keeps its Apple Music ref AND its ISRC/artist/title, and the resolver
// (music-source-resolver.js) re-finds it on any other provider at play time.
//
// CSV is the PORTABILITY layer on top of that: a flat, human-readable file you
// can keep as a backup, open in a spreadsheet, hand to a migration tool
// (TuneMyMusic / Soundiiz read title/artist/album/ISRC columns), or import back
// — here or into a future provider. One file holds everything: one row per
// favourite and per playlist entry.
//
// Import also accepts foreign playlist CSVs (e.g. Exportify's Spotify export:
// "Track Name", "Artist Name(s)", "Album Name", "ISRC", "Duration (ms)",
// "Track URI"), turning each file into a playlist named after the file.
//
// Pure: no DOM/storage. The app reads/writes the file and persists the result.

import { favoriteKey, normalizeLibrary } from "./music-library-model.js";
import { normalizeIsrc } from "./music-streaming.js";

export const CSV_COLUMNS = Object.freeze([
  "type", "list", "list_id", "position", "item_type", "title", "artist", "album",
  "composer", "work", "catalog", "catalog_id", "isrc", "duration_ms",
  "provider_refs", "artwork_url", "kind", "added_at",
]);

// ── CSV primitives (RFC 4180: quotes, embedded commas/quotes/newlines) ────────
export function csvEscape(v) {
  const s = v == null ? "" : String(v);
  // Guard against spreadsheet formula injection from provider metadata.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Undo csvEscape's formula guard on the way back in.
const unguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = []; let row = []; let field = ""; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

// Provider refs round-trip as "provider:externalId" joined by " | ". The id
// may itself contain ":" (e.g. "spotify:track:…" URIs), so split on the first.
const encodeRefs = (refs) => (refs || []).filter((r) => r && r.provider && r.externalId).map((r) => `${r.provider}:${r.externalId}`).join(" | ");
export function decodeRefs(s) {
  return String(s || "").split("|").map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf(":");
    return i > 0 ? { provider: x.slice(0, i), externalId: x.slice(i + 1), url: null, collection: null } : null;
  }).filter((r) => r && r.externalId);
}

// ── export ────────────────────────────────────────────────────────────────────
const nameOf = (c) => (c == null ? "" : typeof c === "string" ? c : c.name || "");
function entityRow(e, itemType) {
  e = e || {};
  const artist = itemType === "recording" ? nameOf((e.performers || [])[0]) : itemType === "album" ? e.artist : "";
  return {
    item_type: itemType,
    title: itemType === "artist" || itemType === "composer" ? nameOf(e.name != null ? e.name : e) : e.title || "",
    artist: artist || "",
    album: itemType === "recording" ? e.album || "" : "",
    composer: nameOf(e.composer),
    work: itemType === "recording" && e.workTitle && e.workTitle !== e.title && e.workTitle !== e.album ? e.workTitle : "",
    catalog: e.catalog || "",
    catalog_id: e.catalogId || "",
    isrc: e.isrc || "",
    duration_ms: e.durationMs != null ? e.durationMs : "",
    provider_refs: encodeRefs(e.providerRefs),
    artwork_url: e.artworkUrl || "",
    kind: e.kind || "",
  };
}

/** Library → CSV text (header + one row per favourite and playlist entry). */
export function libraryToCsv(lib) {
  const l = normalizeLibrary(lib);
  const rows = [];
  for (const f of l.favorites) rows.push({ type: "favorite", list: "", list_id: "", position: "", ...entityRow(f.entity, f.type), added_at: f.at || "" });
  for (const p of l.playlists) {
    if (!p.items.length) rows.push({ type: "playlist", list: p.name, list_id: p.id, position: "", item_type: "", added_at: p.createdAt || "" });
    p.items.forEach((it, i) => rows.push({ type: "playlist", list: p.name, list_id: p.id, position: i + 1, ...entityRow(it, "recording"), added_at: p.updatedAt || "" }));
  }
  const lines = [CSV_COLUMNS.join(",")].concat(rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c])).join(",")));
  return lines.join("\r\n") + "\r\n";
}

// ── import ────────────────────────────────────────────────────────────────────
// Header aliases so foreign CSVs (Exportify, TuneMyMusic, hand-made) map in.
const ALIASES = {
  title: ["title", "track name", "track", "song", "song name", "name"],
  artist: ["artist", "artist name(s)", "artist name", "artists", "performer"],
  album: ["album", "album name"],
  isrc: ["isrc"],
  duration_ms: ["duration_ms", "duration (ms)", "duration"],
  list: ["list", "playlist", "playlist name"],
  uri: ["track uri", "spotify uri", "uri"],
};
const low = (s) => String(s || "").trim().toLowerCase();
function headerIndex(header) {
  const h = header.map(low);
  const idx = {};
  for (const c of CSV_COLUMNS) { const i = h.indexOf(c); if (i >= 0) idx[c] = i; }
  for (const [k, names] of Object.entries(ALIASES)) {
    if (idx[k] != null) continue;
    const i = h.findIndex((x) => names.includes(x));
    if (i >= 0) idx[k] = i;
  }
  return idx;
}

const num = (v) => { const n = Number(String(v || "").trim()); return v !== "" && v != null && Number.isFinite(n) ? n : null; };
function refsFromRow(get) {
  const refs = decodeRefs(get("provider_refs"));
  const uri = get("uri");
  const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri) || /open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(uri);
  if (m && !refs.some((r) => r.provider === "spotify")) refs.push({ provider: "spotify", externalId: m[1], url: null, collection: null });
  return refs;
}

function recordingFromRow(get, provenanceSource, splitArtists = false) {
  const refs = refsFromRow(get);
  // Foreign files list several artists in one cell ("A, B"); our own export
  // writes exactly one name, which may itself contain a comma — keep it whole.
  const raw = String(get("artist") || "");
  const artists = (splitArtists ? raw.split(/\s*[;,]\s*/) : [raw.trim()]).filter(Boolean);
  return {
    entity: "recording",
    id: `rec_imp_${hashKey([get("isrc"), get("title"), get("artist"), refs[0] && refs[0].externalId].join("|"))}`,
    workId: null,
    workTitle: get("work") || get("album") || get("title") || "",
    composer: get("composer") || "",
    title: get("title") || get("work") || "Recording",
    performers: artists.map((name) => ({ name, role: "artist", id: null })),
    ensemble: null, conductor: null,
    album: get("album") || null,
    releaseDate: null,
    durationMs: num(get("duration_ms")),
    isrc: normalizeIsrc(get("isrc")),
    artworkUrl: get("artwork_url") || null,
    originProvider: refs[0] ? refs[0].provider : null,
    providerRefs: refs,
    canonicalFields: {},
    provenance: [{ provider: provenanceSource, providerId: "", matchType: "manual", confidence: null, matchedOn: ["csv-import"], metadata: null, at: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
  };
}

function entityFromRow(type, get) {
  if (type === "recording") return recordingFromRow(get, "csv");
  const refs = refsFromRow(get);
  if (type === "album") return { entity: "album", id: refs[0] ? `${refs[0].provider}:${refs[0].externalId}` : `alb_imp_${hashKey(get("title") + "|" + get("artist"))}`, title: get("title") || "Untitled", artist: get("artist") || null, composer: get("composer") || null, artworkUrl: get("artwork_url") || null, kind: get("kind") || "album", provider: refs[0] ? refs[0].provider : "", providerRefs: refs };
  if (type === "work") return { entity: "work", id: `work_imp_${hashKey(get("composer") + "|" + (get("catalog_id") || get("title")))}`, title: get("title") || "Untitled work", composer: get("composer") || "", catalog: get("catalog") || null, catalogId: get("catalog_id") || null, providerRefs: refs };
  if (type === "artist" || type === "composer") return { name: get("title") || get("artist") || "" };
  return null;
}

// Small stable hash → deterministic ids, so re-importing the same file de-dupes.
function hashKey(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// Same-song key for de-duping inside a playlist across imports: ISRC, else the
// first provider ref, else title+artist.
const itemKey = (r) => (r.isrc ? `isrc:${r.isrc}` : r.providerRefs && r.providerRefs[0] ? `${r.providerRefs[0].provider}:${r.providerRefs[0].externalId}` : `t:${low(r.title)}|${low(nameOf((r.performers || [])[0]))}`);

/**
 * Merge a CSV into the library (never deletes; de-dupes). Playlists match an
 * existing one by list_id, then by name; unknown ones are created.
 * @param opts { fileName? } — names the playlist for a foreign single-playlist CSV.
 * @returns { library, stats: { favorites, playlists, items, skipped } }
 */
export function importCsvIntoLibrary(lib, csvText, opts = {}) {
  const l = normalizeLibrary(lib);
  const stats = { favorites: 0, playlists: 0, items: 0, skipped: 0 };
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { library: l, stats };
  const idx = headerIndex(rows[0]);
  const native = idx.type != null;
  if (idx.title == null && idx.isrc == null && idx.list == null) { stats.skipped = rows.length - 1; return { library: l, stats }; }
  const fallbackList = String(opts.fileName || "Imported playlist").replace(/\.csv$/i, "").trim() || "Imported playlist";
  const now = new Date().toISOString();

  const findPlaylist = (id, name) => l.playlists.find((p) => id && p.id === id) || l.playlists.find((p) => low(p.name) === low(name));
  const ensurePlaylist = (id, name) => {
    let p = findPlaylist(id, name);
    if (!p) {
      p = { id: id || `pl_imp_${hashKey(name + now)}`, name, items: [], createdAt: now, updatedAt: now };
      l.playlists.push(p);
      stats.playlists += 1;
    }
    return p;
  };

  const ordered = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (k) => (idx[k] != null && cells[idx[k]] != null ? unguard(String(cells[idx[k]]).trim()) : "");
    const type = native ? low(get("type")) : "playlist";
    if (type === "favorite") {
      const itemType = low(get("item_type")) || "recording";
      const entity = entityFromRow(itemType, get);
      if (!entity || !(entity.title || entity.name)) { stats.skipped += 1; continue; }
      const key = favoriteKey(itemType, entity);
      if (!l.favorites.some((f) => f.key === key)) { l.favorites.push({ key, type: itemType, entity, at: get("added_at") || now }); stats.favorites += 1; }
      continue;
    }
    if (type !== "playlist") { stats.skipped += 1; continue; }
    const name = get("list") || fallbackList;
    const p = ensurePlaylist(get("list_id") || null, name);
    if (!get("title") && !get("isrc") && !get("provider_refs") && !get("uri")) continue; // an empty-playlist marker row
    ordered.push({ p, pos: num(get("position")), rec: recordingFromRow(get, "csv", !native) });
  }
  // Keep file order within each playlist (position when given; stable sort).
  const byList = new Map();
  for (const o of ordered) { if (!byList.has(o.p)) byList.set(o.p, []); byList.get(o.p).push(o); }
  const sequenced = [...byList.values()].flatMap((list) => list.slice().sort((a, b) => (a.pos != null && b.pos != null ? a.pos - b.pos : 0)));
  for (const { p, rec } of sequenced) {
    const k = itemKey(rec);
    if (p.items.some((it) => itemKey(it) === k)) continue;
    p.items.push(rec); p.updatedAt = now; stats.items += 1;
  }
  return { library: l, stats };
}
