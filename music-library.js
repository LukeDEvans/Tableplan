// Listen-page music library — provider-agnostic catalog for playable audio
// tracks. This is the "music" counterpart to the podcast/TTS providers: the
// single `music` media-provider in app.js talks only to a MusicLibrary, and the
// library fans a flat track list out over one or more MusicSources.
//
//   MusicLibrary ── source registry ──┬─ local    (audio blobs in IndexedDB)   ← now
//                                      └─ jellyfin (remote index + stream URL)  ← later
//
// A source is anything that can list tracks and turn a track into a playable
// URL, so a home-server source drops in later behind the same contract with no
// change to the provider, the queue, or the UI. Bytes and metadata are stored
// separately (blobs never sync; small track records can), matching the app's
// existing "sync carries records, never payloads" rule.

// ── ids & helpers ───────────────────────────────────────────────────────────
let _n = 0;
export function uid(prefix = "trk") {
  _n += 1;
  return `${prefix}_${Date.now().toString(36)}${_n.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
const str = (v, d = "") => (v == null ? d : String(v));
const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Best-effort display title from a filename: drop the extension, turn
 *  separators into spaces, strip a leading track number ("01 - Foo"). */
export function titleFromFilename(name) {
  let s = String(name || "").replace(/\.[^.]+$/, "");
  s = s.replace(/^\s*\d{1,3}\s*[-_.]\s*/, ""); // leading "07 - ", "07_", "07."
  s = s.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return s || "Untitled";
}

// ── track model ─────────────────────────────────────────────────────────────
// A normalized, source-tagged track. `locator` is the source-specific handle a
// source uses to resolve bytes/stream — local: {kind:"blob", blobId}; a server
// source would use {kind:"jellyfin", itemId} etc. Callers never read `locator`.
export function makeTrack(p = {}) {
  return {
    entity: "musicTrack",
    id: str(p.id) || uid("trk"),
    sourceId: str(p.sourceId) || "local",
    title: str(p.title) || "Untitled",
    artist: str(p.artist),
    album: str(p.album),
    durationMs: numOrNull(p.durationMs),
    artworkRef: p.artworkRef ?? null,      // {kind, ...} for embedded/remote art (Slice 2)
    locator: p.locator && typeof p.locator === "object" ? p.locator : null,
    addedAt: numOrNull(p.addedAt) ?? Date.now(),
  };
}

/** Library sort: artist, then album, then title (case-insensitive). Untagged
 *  uploads (no artist) sort after named ones. */
export function compareTracks(a, b) {
  const k = (t) => `${(t.artist ? t.artist.toLowerCase() : "~~~")} ${(t.album || "").toLowerCase()} ${(t.title || "").toLowerCase()}`;
  return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
}

// ── in-memory store (tests / fallback) ──────────────────────────────────────
export function createMemoryMusicStore() {
  const db = { audio: new Map(), tracks: new Map() };
  const s = (name) => { if (!db[name]) db[name] = new Map(); return db[name]; };
  return {
    kind: "memory",
    async put(store, key, value) { s(store).set(String(key), value); },
    async get(store, key) { return s(store).get(String(key)); },
    async getAll(store) { return [...s(store).values()]; },
    async has(store, key) { return s(store).has(String(key)); },
    async delete(store, key) { s(store).delete(String(key)); },
  };
}

// ── IndexedDB store (browser) ────────────────────────────────────────────────
// Its own database, independent of the Cadence score store, with two object
// stores: "audio" (blob records) and "tracks" (metadata records).
export function createIdbMusicStore(dbName = "live-music", version = 1) {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  const NAMES = ["audio", "tracks"];
  let dbp = null;
  const open = () => (dbp = dbp || new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => { const idb = req.result; for (const n of NAMES) if (!idb.objectStoreNames.contains(n)) idb.createObjectStore(n); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (name, mode, fn) => {
    const idb = await open();
    return new Promise((resolve, reject) => {
      const t = idb.transaction(name, mode);
      let out; const r = fn(t.objectStore(name));
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    kind: "idb",
    async put(store, key, value) { await tx(store, "readwrite", (os) => os.put(value, String(key))); },
    async get(store, key) { return tx(store, "readonly", (os) => os.get(String(key))); },
    async getAll(store) { return tx(store, "readonly", (os) => os.getAll()); },
    async has(store, key) { const v = await tx(store, "readonly", (os) => os.getKey(String(key))); return v !== undefined; },
    async delete(store, key) { await tx(store, "readwrite", (os) => os.delete(String(key))); },
  };
}

// ── local source: audio blobs on this device ─────────────────────────────────
export function createLocalMusicSource(store) {
  const SOURCE_ID = "local";
  return {
    id: SOURCE_ID,
    label: "On this device",
    async isAvailable() { return true; },
    async listTracks() {
      const rows = await store.getAll("tracks");
      return rows.map(makeTrack).filter((t) => t.sourceId === SOURCE_ID);
    },
    /**
     * Ingest one audio File. Bytes go to the "audio" store keyed by the new
     * track id; a normalized track record goes to "tracks". `probeDurationMs`
     * (optional, injected by the app) turns bytes into a duration without this
     * module needing the DOM.
     */
    async importAudioFile(file, { probeDurationMs } = {}) {
      const id = uid("trk");
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const mimeType = str(file.type) || "audio/mpeg";
      await store.put("audio", id, { bytes, mimeType });
      let durationMs = null;
      if (typeof probeDurationMs === "function") { try { durationMs = await probeDurationMs(bytes, mimeType); } catch { /* leave null */ } }
      const track = makeTrack({ id, sourceId: SOURCE_ID, title: titleFromFilename(file.name), durationMs, locator: { kind: "blob", blobId: id } });
      await store.put("tracks", id, track);
      return track;
    },
    /** Turn a local track into a playable object URL (caller revokes it). */
    async resolvePlayable(track) {
      const blobId = track?.locator?.blobId;
      if (!blobId) throw new Error("track has no local blob");
      const rec = await store.get("audio", blobId);
      if (!rec || !rec.bytes) throw new Error("audio bytes not on this device");
      const blob = new Blob([rec.bytes], { type: rec.mimeType || "audio/mpeg" });
      return URL.createObjectURL(blob);
    },
    async deleteTrack(track) {
      const blobId = track?.locator?.blobId;
      if (blobId) await store.delete("audio", blobId);
      await store.delete("tracks", track.id);
    },
  };
}

// ── library: the source registry the provider talks to ───────────────────────
export function createMusicLibrary({ sources = [] } = {}) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const sourceFor = (track) => byId.get(track?.sourceId) || null;
  return {
    sources,
    sourceIds: [...byId.keys()],
    /** Flat, sorted track list merged across every source (available ones only). */
    async listAllTracks() {
      const lists = await Promise.all(sources.map(async (s) => {
        try { return (await s.isAvailable()) ? await s.listTracks() : []; }
        catch { return []; }
      }));
      return lists.flat().sort(compareTracks);
    },
    async resolvePlayable(track) {
      const s = sourceFor(track);
      if (!s) throw new Error(`no source for track ${track?.id}`);
      return s.resolvePlayable(track);
    },
    /** Imports always land in the local source. */
    async importAudioFile(file, opts) {
      const local = byId.get("local");
      if (!local?.importAudioFile) throw new Error("no local source to import into");
      return local.importAudioFile(file, opts);
    },
    async deleteTrack(track) {
      const s = sourceFor(track);
      if (s?.deleteTrack) await s.deleteTrack(track);
    },
  };
}
