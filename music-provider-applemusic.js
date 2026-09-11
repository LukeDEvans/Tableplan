// Apple Music provider (MusicKit JS) — a PLAYBACK-OWNING MusicProvider.
//
// Unlike the URL providers (Internet Archive, Jamendo) that resolve a track to a
// streamable URL for the shared engine, Apple Music never hands out a raw URL
// (DRM): MusicKit owns its own player. So this adapter advertises
// CAP.OWNS_PLAYBACK + CAP.AUTH and implements the Transport contract documented
// in music-streaming.js, delegating to the MusicKit instance.
//
// EVERYTHING MusicKit-specific lives in this file: the SDK load, MusicKit.configure,
// the /v1/catalog + /v1/me API paths, event names, playbackState integers, error
// shapes. The rest of the app only ever sees CanonicalTrack/Album + the normalized
// NowPlaying/AuthStatus/SubscriptionStatus types. Swapping in Spotify later means a
// sibling file with the same surface — no caller changes.
//
// The MusicKit instance is injected via deps.getInstance() so this module is unit-
// testable against a fake and never touches window/global MusicKit in tests. The
// default loader (used in the browser) fetches a developer token from the Netlify
// apple-music-token function, loads the MusicKit v3 script, and configures it.

import {
  CAP, PLAYBACK_STATE, makeCanonicalTrack, makeCanonicalAlbum,
  makeNowPlaying, makeAuthStatus, makeSubscriptionStatus, makeProviderRef,
} from "./music-streaming.js";

const PROVIDER_ID = "applemusic";
const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const DEFAULT_TOKEN_ENDPOINT = "/.netlify/functions/apple-music-token";

const str = (v, d = "") => (v == null ? d : String(v));

// MusicKit artwork is a template ({w}/{h} placeholders); render a concrete URL.
function appleArtwork(art, size = 300) {
  if (!art || !art.url) return null;
  return str(art.url).replace("{w}", size).replace("{h}", size).replace("{f}", "jpg");
}

function msFromMinutes(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }

// ── Apple catalog schema → canonical (raw Apple shapes never leave this file) ──
function songToTrack(song) {
  const a = song.attributes || {};
  return makeCanonicalTrack({
    id: `${PROVIDER_ID}:${song.id}`,
    title: a.name,
    artists: a.artistName ? [{ name: a.artistName, role: "artist" }] : [],
    album: a.albumName || null,
    trackNo: a.trackNumber || null,
    durationMs: msFromMinutes(a.durationInMillis),
    artworkUrl: appleArtwork(a.artwork),
    provider: PROVIDER_ID,
    providerRefs: [makeProviderRef({ provider: PROVIDER_ID, externalId: song.id, url: a.url })],
    // No `playable`: Apple Music owns playback; the id in providerRefs is what
    // setQueue/play consume.
  });
}

function albumToAlbum(album) {
  const a = album.attributes || {};
  return makeCanonicalAlbum({
    id: `${PROVIDER_ID}:${album.id}`,
    title: a.name,
    artist: a.artistName || null,
    year: a.releaseDate ? Number(String(a.releaseDate).slice(0, 4)) : null,
    artworkUrl: appleArtwork(a.artwork),
    trackCount: a.trackCount || null,
    provider: PROVIDER_ID,
    providerRefs: [makeProviderRef({ provider: PROVIDER_ID, externalId: album.id, url: a.url })],
  });
}

// The Apple catalog id lives in the canonical track's providerRef.
function appleIdOf(track) {
  const ref = (track && track.providerRefs || []).find((r) => r.provider === PROVIDER_ID);
  if (ref && ref.externalId) return ref.externalId;
  // Tolerate a raw canonical id shaped "applemusic:<id>".
  const id = str(track && track.id);
  return id.startsWith(`${PROVIDER_ID}:`) ? id.slice(PROVIDER_ID.length + 1) : null;
}

// MusicKit playbackState integers → normalized PLAYBACK_STATE. (MusicKit.PlaybackStates:
// none 0, loading 1, playing 2, paused 3, stopped 4, ended 5, seeking 6, waiting 8,
// stalled 9, completed 10.)
function mapPlaybackState(n) {
  switch (n) {
    case 2: return PLAYBACK_STATE.PLAYING;
    case 3: return PLAYBACK_STATE.PAUSED;
    case 4: return PLAYBACK_STATE.STOPPED;
    case 5: case 10: return PLAYBACK_STATE.ENDED;
    case 1: case 6: case 8: case 9: return PLAYBACK_STATE.LOADING;
    default: return PLAYBACK_STATE.NONE;
  }
}

// The default browser loader: fetch a developer token, inject the MusicKit v3
// script, configure, and hand back the singleton instance. Isolated so tests
// inject their own getInstance and never load a script.
function makeDefaultLoader(config, deps) {
  const tokenEndpoint = config.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT;
  const fetchJson = deps.fetchJson || (async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) { const e = new Error(`token endpoint ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  });
  let instance = null;
  let loading = null;
  async function fetchToken() {
    const data = await fetchJson(tokenEndpoint);
    if (!data || !data.token) { const e = new Error("Apple Music not configured"); e.code = "not-configured"; throw e; }
    return data.token;
  }
  async function loadScript() {
    if (typeof document === "undefined") throw new Error("MusicKit requires a browser");
    if (globalThis.MusicKit) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = MUSICKIT_SRC; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error("Failed to load MusicKit"));
      document.head.appendChild(s);
    });
    // MusicKit signals readiness via a window event on some versions.
    if (!globalThis.MusicKit) await new Promise((r) => setTimeout(r, 0));
  }
  return async function getInstance() {
    if (instance) return instance;
    if (!loading) loading = (async () => {
      const token = await fetchToken(); // throws {code:"not-configured"} if no key yet
      await loadScript();
      const MK = globalThis.MusicKit;
      if (!MK) throw new Error("MusicKit unavailable");
      await MK.configure({
        developerToken: token,
        app: { name: config.appName || "TablePlan", build: config.appBuild || "1.0.0" },
      });
      instance = MK.getInstance();
      return instance;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  };
}

/**
 * @param config { storefront="us", tokenEndpoint, appName, appBuild }
 * @param deps   { getInstance?, fetchJson? } — inject getInstance() (returns a
 *               configured MusicKit instance) to make this testable; otherwise a
 *               default browser loader is used.
 */
export function createAppleMusicProvider(config = {}, deps = {}) {
  const storefront = config.storefront || "us";
  const getInstance = deps.getInstance || makeDefaultLoader(config, deps);
  const listeners = new Set();

  // Lazily obtain the instance; a "not-configured" error (no developer token yet)
  // is swallowed by isAvailable() and surfaced as a clear message elsewhere.
  async function instanceOrNull() {
    try { return await getInstance(); } catch { return null; }
  }

  // Wire the MusicKit instance's events to our normalized onChange listeners
  // exactly once. All MusicKit event-name knowledge is confined here.
  let wired = false;
  function wireEvents(music) {
    if (wired || !music || typeof music.addEventListener !== "function") return;
    wired = true;
    const fire = () => { const np = readNowPlaying(music); listeners.forEach((cb) => { try { cb(np); } catch { /* isolated */ } }); };
    music.addEventListener("playbackStateDidChange", fire);
    music.addEventListener("nowPlayingItemDidChange", fire);
    music.addEventListener("playbackTimeDidChange", fire);
  }

  function readNowPlaying(music) {
    if (!music) return makeNowPlaying({ state: PLAYBACK_STATE.NONE });
    const item = music.nowPlayingItem;
    const track = item ? songToTrack({ id: item.id, attributes: {
      name: item.title, artistName: item.artistName, albumName: item.albumName,
      durationInMillis: (music.currentPlaybackDuration || 0) * 1000, artwork: item.artwork,
    } }) : null;
    return makeNowPlaying({
      track,
      state: mapPlaybackState(music.playbackState),
      positionMs: Math.round((music.currentPlaybackTime || 0) * 1000),
      durationMs: Math.round((music.currentPlaybackDuration || 0) * 1000) || null,
    });
  }

  async function ensureQueueAndPlay(track) {
    const music = await getInstance(); // throws if not configured — caller handles
    wireEvents(music);
    const id = appleIdOf(track);
    if (!id) throw new Error("Track has no Apple Music id");
    await music.setQueue({ songs: [id] });
    await music.play();
  }

  return {
    id: PROVIDER_ID,
    label: config.label || "Apple Music",
    capabilities: new Set([CAP.SEARCH, CAP.GET_ITEM, CAP.ARTWORK, CAP.OWNS_PLAYBACK, CAP.AUTH]),

    // Cheap gate: available only once a developer token is configured (the key
    // has been added to the Netlify function's env). Inert otherwise — the
    // architecture never depends on it, exactly like Jamendo without a client id.
    async isAvailable() { return !!(await instanceOrNull()); },

    // ── Catalog ────────────────────────────────────────────────────────────
    async search(query, o = {}) {
      const music = await getInstance();
      const limit = o.limit || 25;
      const res = await music.api.music(`/v1/catalog/${storefront}/search`, { term: query, types: "songs,albums", limit });
      const results = (res && res.data && res.data.results) || {};
      const songs = ((results.songs && results.songs.data) || []).map(songToTrack);
      const albums = ((results.albums && results.albums.data) || []).map(albumToAlbum);
      return [...albums, ...songs];
    },

    async getItem(albumOrRef, o = {}) {
      const music = await getInstance();
      const id = appleIdOf(albumOrRef) || str(albumOrRef && albumOrRef.externalId) || str(albumOrRef);
      const res = await music.api.music(`/v1/catalog/${storefront}/albums/${id}`, { include: "tracks" });
      const album = (res && res.data && res.data.data && res.data.data[0]) || null;
      const tracks = ((album && album.relationships && album.relationships.tracks && album.relationships.tracks.data) || []).map(songToTrack);
      return { album: album ? albumToAlbum(album) : null, tracks };
    },

    // ── Transport (CAP.OWNS_PLAYBACK) ────────────────────────────────────────
    async play(track) { await ensureQueueAndPlay(track); },
    async pause() { const m = await instanceOrNull(); if (m) await m.pause(); },
    async resume() { const m = await instanceOrNull(); if (m) await m.play(); },
    async seek(positionMs) { const m = await instanceOrNull(); if (m) await m.seekToTime(Math.max(0, positionMs) / 1000); },
    async skipNext() { const m = await instanceOrNull(); if (m) await m.skipToNextItem(); },
    async skipPrevious() { const m = await instanceOrNull(); if (m) await m.skipToPreviousItem(); },
    getQueue() { return this._queueCache || []; },
    async setQueue(tracks) {
      const music = await getInstance();
      wireEvents(music);
      const ids = (tracks || []).map(appleIdOf).filter(Boolean);
      await music.setQueue({ songs: ids });
      this._queueCache = (tracks || []).map((t) => makeCanonicalTrack(t));
    },
    getNowPlaying() {
      // Sync read: return the last known instance's now-playing, else empty.
      const m = this._instance;
      return readNowPlaying(m);
    },
    onChange(cb) {
      if (typeof cb !== "function") return () => {};
      listeners.add(cb);
      // Ensure events are wired as soon as an instance exists.
      instanceOrNull().then((m) => { if (m) { this._instance = m; wireEvents(m); } });
      return () => listeners.delete(cb);
    },

    // ── Auth / subscription (CAP.AUTH) ───────────────────────────────────────
    async getAuthStatus() {
      const m = await instanceOrNull();
      if (!m) return makeAuthStatus({ authorized: false, state: "not-configured", reason: "Apple Music isn't configured yet." });
      return makeAuthStatus({ authorized: !!m.isAuthorized, state: m.isAuthorized ? "authorized" : "unauthorized" });
    },
    async authorize() {
      const music = await getInstance(); // throws "not-configured" if no token
      wireEvents(music);
      this._instance = music;
      await music.authorize(); // opens Apple's auth flow, returns a music-user-token
      return makeAuthStatus({ authorized: !!music.isAuthorized, state: music.isAuthorized ? "authorized" : "unauthorized" });
    },
    async getSubscriptionStatus() {
      const m = await instanceOrNull();
      if (!m) return makeSubscriptionStatus({ active: false, canPlay: false, state: "not-configured" });
      if (!m.isAuthorized) return makeSubscriptionStatus({ active: false, canPlay: false, state: "unknown", reason: "Not signed in to Apple Music." });
      // An authorized user with an active subscription can read their own
      // storefront; a non-subscriber's music-user-token is rejected there. (Verify
      // against MusicKit at integration time — the honest, low-assumption probe.)
      try {
        await m.api.music("/v1/me/storefront");
        return makeSubscriptionStatus({ active: true, canPlay: true, state: "active" });
      } catch (e) {
        return makeSubscriptionStatus({ active: false, canPlay: false, state: "none", reason: "No active Apple Music subscription." });
      }
    },
  };
}
