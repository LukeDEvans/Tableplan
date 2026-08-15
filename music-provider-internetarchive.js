// Internet Archive music provider (also backs "Musopen", scoped to that
// collection). The Archive exposes an auth-free, CORS-enabled JSON API and
// streams individual audio files directly, so this adapter talks to it from the
// client with an injectable fetch (a Netlify proxy can slot in later for rate
// limits/caching without touching callers).
//
//   search:   https://archive.org/advancedsearch.php?q=…&output=json   → items
//   getItem:  https://archive.org/metadata/{identifier}                → tracks
//   stream:   https://archive.org/download/{identifier}/{file}         (direct)
//   artwork:  https://archive.org/services/img/{identifier}
//
// An item (advancedsearch doc) is an album/work; its audio files are the tracks
// (classical movements). Some uploads are ZIP-only bundles with no individual
// audio files — those yield an empty track list and are surfaced gracefully.

import { CAP, makeCanonicalAlbum, makeCanonicalTrack, makeProviderRef, makeLicense } from "./music-streaming.js";

const IA = "https://archive.org";
const SEARCH_URL = `${IA}/advancedsearch.php`;
const encPath = (name) => String(name).split("/").map(encodeURIComponent).join("/");
const streamUrl = (id, name) => `${IA}/download/${encodeURIComponent(id)}/${encPath(name)}`;
const artUrl = (id) => `${IA}/services/img/${encodeURIComponent(id)}`;

// IA audio file formats we can stream in a browser, best first.
const AUDIO_FORMATS = ["VBR MP3", "128Kbps MP3", "256Kbps MP3", "64Kbps MP3", "MP3", "Ogg Vorbis", "Opus", "AAC"];
const isPreferred = (fmt) => AUDIO_FORMATS.includes(String(fmt || ""));
const containerOf = (fmt) => (/mp3/i.test(fmt) ? "mp3" : /ogg|vorbis/i.test(fmt) ? "ogg" : /opus/i.test(fmt) ? "opus" : /aac/i.test(fmt) ? "aac" : null);

// IA `length` is either seconds ("247.53") or "M:SS" / "H:MM:SS".
function lengthToMs(v) {
  if (v == null) return null;
  const s = String(v);
  if (s.includes(":")) {
    const parts = s.split(":").map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return null;
    const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
    return Math.round(secs * 1000);
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

async function defaultFetchJson(url, { signal } = {}) {
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`internet archive HTTP ${r.status}`);
  return r.json();
}

/**
 * @param opts.collection  restrict to an IA collection (e.g. "musopen")
 * @param opts.id/label    provider identity (defaults to internet-archive)
 * @param deps.fetchJson   injectable HTTP client (tests)
 */
export function createInternetArchiveProvider(opts = {}, deps = {}) {
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const collection = opts.collection ? String(opts.collection) : null;
  const id = opts.id || (collection ? `ia-${collection}` : "internetarchive");
  const label = opts.label || (collection ? "Internet Archive" : "Internet Archive");

  function buildSearchUrl(q, { limit = 25, page = 1 } = {}) {
    const scoped = collection ? `(${q}) AND collection:(${collection})` : q;
    const query = `(${scoped}) AND mediatype:(audio)`;
    const fields = ["identifier", "title", "creator", "date", "licenseurl", "downloads", "collection"];
    const params = new URLSearchParams();
    params.set("q", query);
    fields.forEach((f) => params.append("fl[]", f));
    params.set("rows", String(Math.max(1, Math.min(100, limit))));
    params.set("page", String(Math.max(1, page)));
    params.set("output", "json");
    params.set("sort[]", "downloads desc");
    return `${SEARCH_URL}?${params.toString()}`;
  }

  function docToAlbum(doc) {
    const licenseurl = Array.isArray(doc.licenseurl) ? doc.licenseurl[0] : doc.licenseurl;
    return makeCanonicalAlbum({
      id: `${id}:${doc.identifier}`,
      title: firstStr(doc.title) || doc.identifier,
      artist: firstStr(doc.creator) || null,
      year: yearOf(doc.date),
      artworkUrl: artUrl(doc.identifier),
      kind: "collection",
      provider: id,
      providerRefs: [makeProviderRef({ provider: id, externalId: doc.identifier, url: `${IA}/details/${doc.identifier}`, collection: firstStr(doc.collection) })],
      license: makeLicense({ url: licenseurl || null }),
    });
  }

  return {
    id,
    label,
    collection,
    capabilities: new Set([CAP.SEARCH, CAP.GET_ITEM, CAP.PLAYABLE, CAP.ARTWORK, CAP.LICENSE, CAP.PAGINATION]),

    async isAvailable() { return true; }, // failures surface per-request via search()/getItem()

    async search(query, o = {}) {
      const data = await fetchJson(buildSearchUrl(String(query), o), { signal: o.signal });
      const docs = (data && data.response && data.response.docs) || [];
      return docs.map(docToAlbum);
    },

    /** Expand an album/item into its streamable tracks (classical movements). */
    async getItem(albumOrRef, o = {}) {
      const identifier = identifierOf(albumOrRef, id);
      if (!identifier) throw new Error("no internet archive identifier");
      const meta = await fetchJson(`${IA}/metadata/${encodeURIComponent(identifier)}`, { signal: o.signal });
      const m = (meta && meta.metadata) || {};
      const licenseurl = firstStr(m.licenseurl);
      const albumTitle = firstStr(m.title) || identifier;
      const composer = firstStr(m.composer) || null;
      const creator = firstStr(m.creator) || null;

      // Keep one streamable file per logical track (prefer MP3), de-duped by base name.
      const files = ((meta && meta.files) || []).filter((f) => isPreferred(f.format));
      const byBase = new Map();
      for (const f of files) {
        const base = String(f.name || "").replace(/\.[^.]+$/, "");
        const prev = byBase.get(base);
        if (!prev || rank(f.format) < rank(prev.format)) byBase.set(base, f);
      }
      const tracks = [...byBase.values()]
        .map((f) => fileToTrack(f, { identifier, albumTitle, licenseurl, composer, creator }))
        .sort((a, b) => (a.trackNo ?? 1e9) - (b.trackNo ?? 1e9) || a.title.localeCompare(b.title));

      const album = albumOrRef && albumOrRef.entity === "album" ? albumOrRef : docToAlbumFromMeta(identifier, m);
      return { album: { ...album, trackCount: tracks.length }, tracks };
    },

    async getPlayable(track) {
      if (track && track.playable && track.playable.url) return track.playable;
      throw new Error("track has no playable source");
    },
  };

  function fileToTrack(f, ctx) {
    const artistName = firstStr(f.artist) || ctx.creator || null;
    return makeCanonicalTrack({
      id: `${id}:${ctx.identifier}:${f.name}`,
      title: firstStr(f.title) || prettifyName(f.name),
      artists: artistName ? [{ name: artistName, role: "performer" }] : [],
      composer: ctx.composer || null,
      album: firstStr(f.album) || ctx.albumTitle,
      trackNo: intOrNull(f.track),
      durationMs: lengthToMs(f.length),
      artworkUrl: artUrl(ctx.identifier),
      provider: id,
      providerRefs: [makeProviderRef({ provider: id, externalId: `${ctx.identifier}/${f.name}`, url: `${IA}/details/${ctx.identifier}` })],
      license: makeLicense({ url: ctx.licenseurl || null }),
      playable: { provider: id, url: streamUrl(ctx.identifier, f.name), container: containerOf(f.format), mimeType: mimeOf(f.format), streamable: true },
    });
  }

  function docToAlbumFromMeta(identifier, m) {
    return makeCanonicalAlbum({
      id: `${id}:${identifier}`,
      title: firstStr(m.title) || identifier,
      artist: firstStr(m.creator) || null,
      composer: firstStr(m.composer) || null,
      artworkUrl: artUrl(identifier),
      kind: "collection",
      provider: id,
      providerRefs: [makeProviderRef({ provider: id, externalId: identifier, url: `${IA}/details/${identifier}` })],
      license: makeLicense({ url: firstStr(m.licenseurl) || null }),
      description: firstStr(m.description) || null,
    });
  }
}

/** Musopen = the Internet Archive provider scoped to the musopen collection. */
export function createMusopenProvider(opts = {}, deps = {}) {
  return createInternetArchiveProvider({ ...opts, id: "musopen", label: "Musopen", collection: "musopen" }, deps);
}

// ── helpers ───────────────────────────────────────────────────────────────────
const firstStr = (v) => (Array.isArray(v) ? (v.length ? String(v[0]) : null) : v == null ? null : String(v));
const intOrNull = (v) => { const n = parseInt(firstStr(v), 10); return Number.isFinite(n) ? n : null; };
const yearOf = (d) => { const m = firstStr(d) && firstStr(d).match(/\d{4}/); return m ? Number(m[0]) : null; };
const rank = (fmt) => { const i = AUDIO_FORMATS.indexOf(String(fmt)); return i < 0 ? 999 : i; };
const mimeOf = (fmt) => (/mp3/i.test(fmt) ? "audio/mpeg" : /ogg|vorbis/i.test(fmt) ? "audio/ogg" : /opus/i.test(fmt) ? "audio/opus" : /aac/i.test(fmt) ? "audio/aac" : null);
function prettifyName(name) {
  return String(name || "").replace(/\.[^.]+$/, "").replace(/^\d+\s*[-_.]\s*/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}
function identifierOf(albumOrRef, providerId) {
  if (!albumOrRef) return null;
  if (typeof albumOrRef === "string") return albumOrRef.includes(":") ? albumOrRef.split(":").slice(1).join(":") : albumOrRef;
  const ref = (albumOrRef.providerRefs || []).find((r) => r.provider === providerId) || (albumOrRef.providerRefs || [])[0];
  if (ref && ref.externalId) return ref.externalId;
  if (albumOrRef.id && albumOrRef.id.includes(":")) return albumOrRef.id.split(":").slice(1).join(":");
  return null;
}
