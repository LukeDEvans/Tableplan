// music-applemusic-native.js — the iOS app's native Apple Music (the "AppleMusic"
// Capacitor plugin, ios/App/App/AppleMusicPlugin.swift) dressed up as a MusicKit JS
// instance, so music-provider-applemusic.js runs unchanged on the phone.
//
// Why: inside the app's web view MusicKit JS can't sign in (Apple's popup is
// ignored) and its DRM playback isn't reliable. The native plugin does sign-in,
// the Apple Music API (MusicKit adds the tokens itself) and playback, including
// with the phone locked. This file only translates shapes:
//   isAuthorized / storefrontId / authorize()        ← getStatus / authorize
//   api.music(path, params) → { data }                ← api({ path }) → { body }
//   setQueue({ songs }) / play / pause / seekToTime / skipToNextItem / skipToPreviousItem
//   nowPlayingItem / playbackState / currentPlaybackTime / currentPlaybackDuration
//   addEventListener(playbackStateDidChange | nowPlayingItemDidChange | playbackTimeDidChange)
//                                                     ← the plugin's "change" events
//
// Pure apart from the injected plugin, so it's unit-tested with a fake.

const EVENTS = ["playbackStateDidChange", "nowPlayingItemDidChange", "playbackTimeDidChange"];

// MusicKit JS api.music params → a query string (arrays joined with commas).
export function apiPath(path, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const qs = q.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

export function createNativeMusicKitInstance(plugin) {
  const listeners = new Map(EVENTS.map((e) => [e, new Set()]));
  let snap = { playbackState: 0, time: 0, duration: 0, item: null };

  const fire = (name) => listeners.get(name).forEach((cb) => { try { cb(); } catch { /* isolated */ } });

  function applySnapshot(next) {
    if (!next || typeof next !== "object") return;
    const prev = snap;
    snap = {
      playbackState: Number(next.playbackState) || 0,
      time: Number(next.time) || 0,
      duration: Number(next.duration) || 0,
      item: next.item && typeof next.item === "object" ? next.item : null,
    };
    if ((prev.item && prev.item.id) !== (snap.item && snap.item.id)) fire("nowPlayingItemDidChange");
    if (prev.playbackState !== snap.playbackState) fire("playbackStateDidChange");
    fire("playbackTimeDidChange");
  }

  function applyStatus(s) {
    if (!s) return;
    inst.isAuthorized = !!s.authorized;
    if (s.storefront) inst.storefrontId = String(s.storefront).toLowerCase();
    if (s.nowPlaying) applySnapshot(s.nowPlaying);
  }

  const inst = {
    isAuthorized: false,
    storefrontId: null,
    get playbackState() { return snap.playbackState; },
    get currentPlaybackTime() { return snap.time; },
    get currentPlaybackDuration() { return snap.duration; },
    get nowPlayingItem() {
      const it = snap.item;
      if (!it || !it.id) return null;
      return {
        id: String(it.id),
        title: it.title || "",
        artistName: it.artistName || "",
        albumName: it.albumName || "",
        artwork: it.artworkUrl ? { url: it.artworkUrl } : null,
      };
    },
    addEventListener(name, cb) { if (listeners.has(name) && typeof cb === "function") listeners.get(name).add(cb); },
    removeEventListener(name, cb) { if (listeners.has(name)) listeners.get(name).delete(cb); },

    async authorize() { applyStatus(await plugin.authorize()); },

    api: {
      async music(path, params) {
        const { body } = await plugin.api({ path: apiPath(path, params) });
        return { data: body ? JSON.parse(body) : null };
      },
    },

    async setQueue({ songs } = {}) { await plugin.setQueue({ ids: (songs || []).map(String) }); },
    async play() { await plugin.play(); },
    async pause() { await plugin.pause(); },
    async seekToTime(seconds) { await plugin.seekTo({ seconds: Math.max(0, Number(seconds) || 0) }); },
    async skipToNextItem() { await plugin.skipToNext(); },
    async skipToPreviousItem() { await plugin.skipToPrevious(); },

    // Internal: first status read + the change subscription (see getInstance below).
    _applyStatus: applyStatus,
    _applySnapshot: applySnapshot,
  };
  return inst;
}

// deps.getInstance for createAppleMusicProvider: one instance, set up once.
export function nativeMusicKitLoader(plugin) {
  let loading = null;
  return function getInstance() {
    if (!loading) loading = (async () => {
      const inst = createNativeMusicKitInstance(plugin);
      await plugin.addListener("change", (s) => inst._applySnapshot(s));
      inst._applyStatus(await plugin.getStatus());
      return inst;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  };
}
