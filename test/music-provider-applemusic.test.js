import { describe, it, expect } from "vitest";
import { createAppleMusicProvider } from "../music-provider-applemusic.js";
import {
  CAP, PLAYBACK_STATE, isPlaybackOwner, createMusicProviderRegistry,
  makeNowPlaying, makeAuthStatus, makeSubscriptionStatus,
} from "../music-streaming.js";

// A fake MusicKit instance — same surface the real SDK exposes, no browser/global.
function fakeMusic(overrides = {}) {
  const handlers = {};
  const m = {
    isAuthorized: false,
    playbackState: 0,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 0,
    nowPlayingItem: null,
    _queue: null, _skippedNext: false, _skippedPrev: false,
    api: {
      music: async (path) => {
        if (path.includes("/search")) return { data: { results: {
          songs: { data: [{ id: "s1", attributes: { name: "Song One", artistName: "Artist", albumName: "Alb", durationInMillis: 200000, artwork: { url: "https://img/{w}x{h}.jpg" } } }] },
          albums: { data: [{ id: "al1", attributes: { name: "Album One", artistName: "Artist", releaseDate: "2020-05-01", trackCount: 9, artwork: { url: "https://img/{w}x{h}.jpg" } } }] },
        } } };
        if (path.includes("/albums/")) return { data: { data: [{ id: "al1", attributes: { name: "Album One", artistName: "Artist" }, relationships: { tracks: { data: [{ id: "s1", attributes: { name: "Song One", artistName: "Artist" } }] } } } ] } };
        if (path.includes("/me/storefront")) { if (overrides.subError) { throw new Error("403 no subscription"); } return { data: {} }; }
        return { data: {} };
      },
    },
    async setQueue(q) { this._queue = q; },
    async play() { this.playbackState = 2; this._emit("playbackStateDidChange"); },
    async pause() { this.playbackState = 3; this._emit("playbackStateDidChange"); },
    async seekToTime(s) { this.currentPlaybackTime = s; },
    async skipToNextItem() { this._skippedNext = true; },
    async skipToPreviousItem() { this._skippedPrev = true; },
    async authorize() { this.isAuthorized = true; return "user-token"; },
    addEventListener(name, cb) { (handlers[name] = handlers[name] || []).push(cb); },
    _emit(name) { (handlers[name] || []).forEach((cb) => cb()); },
  };
  return Object.assign(m, overrides);
}

const withInstance = (music, config = {}) => createAppleMusicProvider(config, { getInstance: async () => music });

describe("music-streaming seam: playback-owning types", () => {
  it("normalizes now-playing / auth / subscription", () => {
    const np = makeNowPlaying({ state: PLAYBACK_STATE.PLAYING, positionMs: 1500.7, durationMs: 200000 });
    expect(np.isPlaying).toBe(true);
    expect(np.positionMs).toBe(1501);
    expect(makeAuthStatus({ authorized: true }).state).toBe("authorized");
    expect(makeSubscriptionStatus({ active: true }).canPlay).toBe(true);
    expect(makeSubscriptionStatus({ active: false }).canPlay).toBe(false);
  });

  it("registry selects the active playback owner by config, else the sole owner", () => {
    const apple = withInstance(fakeMusic());
    const ia = { id: "internetarchive", capabilities: new Set([CAP.SEARCH, CAP.PLAYABLE]) };
    const reg = createMusicProviderRegistry([ia, apple]);
    expect(reg.playbackOwners().map((p) => p.id)).toEqual(["applemusic"]);
    expect(reg.activePlaybackProvider().id).toBe("applemusic");        // sole owner
    expect(reg.activePlaybackProvider("applemusic").id).toBe("applemusic");
    expect(reg.activePlaybackProvider("nope").id).toBe("applemusic");  // stale → sole owner
    expect(isPlaybackOwner(apple)).toBe(true);
    expect(isPlaybackOwner(ia)).toBe(false);
  });
});

describe("AppleMusicProvider", () => {
  it("advertises owns-playback + auth, not URL playable", () => {
    const p = withInstance(fakeMusic());
    expect(p.id).toBe("applemusic");
    expect(p.capabilities.has(CAP.OWNS_PLAYBACK)).toBe(true);
    expect(p.capabilities.has(CAP.AUTH)).toBe(true);
    expect(p.capabilities.has(CAP.PLAYABLE)).toBe(false);
  });

  it("search maps Apple songs + albums to canonical items", async () => {
    const p = withInstance(fakeMusic());
    const items = await p.search("bach");
    const album = items.find((i) => i.entity === "album");
    const track = items.find((i) => i.entity === "track");
    expect(album.title).toBe("Album One");
    expect(album.year).toBe(2020);
    expect(track.title).toBe("Song One");
    expect(track.provider).toBe("applemusic");
    expect(track.providerRefs[0].externalId).toBe("s1");
    expect(track.artworkUrl).toBe("https://img/300x300.jpg"); // template rendered
    expect(track.playable).toBe(null); // no URL — Apple owns playback
  });

  it("getItem expands an album into tracks", async () => {
    const p = withInstance(fakeMusic());
    const { album, tracks } = await p.getItem({ id: "applemusic:al1" });
    expect(album.title).toBe("Album One");
    expect(tracks[0].title).toBe("Song One");
  });

  it("play() sets the MusicKit queue by catalog id then plays", async () => {
    const music = fakeMusic();
    const p = withInstance(music);
    await p.play({ id: "applemusic:s1", providerRefs: [{ provider: "applemusic", externalId: "s1" }] });
    expect(music._queue).toEqual({ songs: ["s1"] });
    expect(music.playbackState).toBe(2);
  });

  it("transport methods delegate to the instance", async () => {
    const music = fakeMusic();
    const p = withInstance(music);
    await p.pause(); expect(music.playbackState).toBe(3);
    await p.resume(); expect(music.playbackState).toBe(2);
    await p.seek(45000); expect(music.currentPlaybackTime).toBe(45);
    await p.skipNext(); expect(music._skippedNext).toBe(true);
    await p.skipPrevious(); expect(music._skippedPrev).toBe(true);
  });

  it("setQueue maps ids and getQueue returns the cached canonical tracks", async () => {
    const music = fakeMusic();
    const p = withInstance(music);
    await p.setQueue([{ id: "applemusic:s1", providerRefs: [{ provider: "applemusic", externalId: "s1" }] }]);
    expect(music._queue).toEqual({ songs: ["s1"] });
    expect(p.getQueue()).toHaveLength(1);
  });

  it("getNowPlaying reflects the instance state (normalized)", async () => {
    const music = fakeMusic({ playbackState: 2, currentPlaybackTime: 12, currentPlaybackDuration: 200, nowPlayingItem: { id: "s1", title: "Song One", artistName: "Artist" } });
    const p = withInstance(music);
    let np = null;
    const off = p.onChange((x) => { np = x; });
    await new Promise((r) => setTimeout(r, 0)); // let onChange resolve the instance
    music._emit("playbackTimeDidChange");
    expect(np.state).toBe(PLAYBACK_STATE.PLAYING);
    expect(np.positionMs).toBe(12000);
    expect(np.track.title).toBe("Song One");
    off();
  });

  it("authorize() runs the flow and reports authorized", async () => {
    const music = fakeMusic();
    const p = withInstance(music);
    expect((await p.getAuthStatus()).authorized).toBe(false);
    const status = await p.authorize();
    expect(status.authorized).toBe(true);
    expect((await p.getAuthStatus()).authorized).toBe(true);
  });

  it("subscription: authorized + storefront ok → canPlay; storefront error → cannot", async () => {
    const okMusic = fakeMusic({ isAuthorized: true });
    expect((await withInstance(okMusic).getSubscriptionStatus())).toMatchObject({ active: true, canPlay: true });
    const noSub = fakeMusic({ isAuthorized: true, subError: true });
    expect((await withInstance(noSub).getSubscriptionStatus())).toMatchObject({ active: false, canPlay: false });
    const notSignedIn = fakeMusic({ isAuthorized: false });
    expect((await withInstance(notSignedIn).getSubscriptionStatus()).canPlay).toBe(false);
  });

  it("is inert (not available, not-configured) when no developer token exists", async () => {
    const p = createAppleMusicProvider({}, { getInstance: async () => { const e = new Error("Apple Music not configured"); e.code = "not-configured"; throw e; } });
    expect(await p.isAvailable()).toBe(false);
    const auth = await p.getAuthStatus();
    expect(auth.authorized).toBe(false);
    expect(auth.state).toBe("not-configured");
    expect((await p.getSubscriptionStatus()).state).toBe("not-configured");
  });
});
