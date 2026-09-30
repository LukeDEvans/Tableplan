// The iOS app's native Apple Music plugin wrapped as a MusicKit JS instance
// (music-applemusic-native.js), driving the real provider end to end.
import { describe, it, expect } from "vitest";
import { apiPath, createNativeMusicKitInstance, nativeMusicKitLoader } from "../music-applemusic-native.js";
import { createAppleMusicProvider } from "../music-provider-applemusic.js";
import { PLAYBACK_STATE } from "../music-streaming.js";

function fakePlugin({ status = { status: "notDetermined", authorized: false }, bodies = {} } = {}) {
  const calls = [];
  let onChange = null;
  return {
    calls,
    emit: (s) => onChange && onChange(s),
    async addListener(name, cb) { calls.push(["addListener", name]); if (name === "change") onChange = cb; return { remove() {} }; },
    async getStatus() { calls.push(["getStatus"]); return status; },
    async authorize() { calls.push(["authorize"]); return { status: "authorized", authorized: true, storefront: "GB" }; },
    async api({ path }) {
      calls.push(["api", path]);
      const key = Object.keys(bodies).find((k) => path.startsWith(k));
      if (!key) throw new Error("Apple Music request failed: 404");
      return { body: JSON.stringify(bodies[key]) };
    },
    async setQueue(o) { calls.push(["setQueue", o]); },
    async play() { calls.push(["play"]); },
    async pause() { calls.push(["pause"]); },
    async seekTo(o) { calls.push(["seekTo", o]); },
    async skipToNext() { calls.push(["skipToNext"]); },
    async skipToPrevious() { calls.push(["skipToPrevious"]); },
  };
}

describe("apiPath", () => {
  it("builds the query MusicKit JS would", () => {
    expect(apiPath("/v1/catalog/us/search", { term: "bach suites", types: "songs,albums", limit: 5, skip: null }))
      .toBe("/v1/catalog/us/search?term=bach+suites&types=songs%2Calbums&limit=5");
    expect(apiPath("/v1/me/storefront")).toBe("/v1/me/storefront");
    expect(apiPath("/v1/x?a=1", { b: ["c", "d"] })).toBe("/v1/x?a=1&b=c%2Cd");
  });
});

describe("native MusicKit instance", () => {
  it("sign-in: status, authorize, storefront", async () => {
    const plugin = fakePlugin();
    const music = await nativeMusicKitLoader(plugin)();
    expect(music.isAuthorized).toBe(false);
    await music.authorize();
    expect(music.isAuthorized).toBe(true);
    expect(music.storefrontId).toBe("gb");
    expect(plugin.calls.filter((c) => c[0] === "addListener")).toEqual([["addListener", "change"]]);
  });

  it("the loader sets up once", async () => {
    const plugin = fakePlugin();
    const get = nativeMusicKitLoader(plugin);
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toBe(b);
    expect(plugin.calls.filter((c) => c[0] === "getStatus")).toHaveLength(1);
  });

  it("change events map to MusicKit JS events and now-playing fields", () => {
    const music = createNativeMusicKitInstance(fakePlugin());
    const seen = [];
    for (const e of ["playbackStateDidChange", "nowPlayingItemDidChange", "playbackTimeDidChange"]) music.addEventListener(e, () => seen.push(e));
    music._applySnapshot({ playbackState: 2, time: 12.5, duration: 200, item: { id: "s1", title: "Song", artistName: "A", albumName: "Al", artworkUrl: "https://img/400x400.jpg" } });
    expect(seen).toEqual(["nowPlayingItemDidChange", "playbackStateDidChange", "playbackTimeDidChange"]);
    expect(music.nowPlayingItem).toEqual({ id: "s1", title: "Song", artistName: "A", albumName: "Al", artwork: { url: "https://img/400x400.jpg" } });
    expect(music.currentPlaybackTime).toBe(12.5);
    seen.length = 0;
    music._applySnapshot({ playbackState: 2, time: 13.5, duration: 200, item: { id: "s1" } });
    expect(seen).toEqual(["playbackTimeDidChange"]); // same song, same state
  });
});

describe("provider on the native instance", () => {
  const song = (id) => ({ id: `applemusic:${id}`, provider: "applemusic", providerRefs: [{ provider: "applemusic", externalId: id }] });

  it("search goes through the plugin's API call and parses the body", async () => {
    const plugin = fakePlugin({ status: { authorized: true, storefront: "us" }, bodies: {
      "/v1/catalog/us/search": { results: { songs: { data: [{ id: "s1", attributes: { name: "Song One", artistName: "Artist" } }] } } },
    } });
    const p = createAppleMusicProvider({}, { getInstance: nativeMusicKitLoader(plugin) });
    const res = await p.search("song one");
    expect(res.map((r) => r.title)).toEqual(["Song One"]);
    expect(plugin.calls.find((c) => c[0] === "api")[1]).toMatch(/^\/v1\/catalog\/us\/search\?term=song\+one&/);
  });

  it("play queues the track plus upcoming Apple songs, then plays; transport maps to the plugin", async () => {
    const plugin = fakePlugin({ status: { authorized: true } });
    const p = createAppleMusicProvider({}, { getInstance: nativeMusicKitLoader(plugin) });
    await p.play(song("s1"), { upcoming: [song("s2"), { id: "x", providerRefs: [] }, song("s3")] });
    expect(plugin.calls.filter((c) => ["setQueue", "play"].includes(c[0]))).toEqual([["setQueue", { ids: ["s1", "s2", "s3"] }], ["play"]]);
    await p.pause(); await p.seek(30500); await p.skipNext(); await p.skipPrevious();
    expect(plugin.calls.slice(-4)).toEqual([["pause"], ["seekTo", { seconds: 30.5 }], ["skipToNext"], ["skipToPrevious"]]);
  });

  it("native 'ended' (queue ran out) reaches onChange as ENDED; a song change shows the new track", async () => {
    const plugin = fakePlugin({ status: { authorized: true } });
    const p = createAppleMusicProvider({}, { getInstance: nativeMusicKitLoader(plugin) });
    const seen = [];
    p.onChange((np) => seen.push(np));
    await p.play(song("s1"));
    plugin.emit({ playbackState: 2, time: 1, duration: 200, item: { id: "s2", title: "Two" } });
    expect(seen.at(-1).track.id).toBe("applemusic:s2");
    plugin.emit({ playbackState: 5, time: 0, duration: 0 });
    expect(seen.at(-1).state).toBe(PLAYBACK_STATE.ENDED);
  });

  it("subscription check uses /v1/me/storefront; a rejected call means no subscription", async () => {
    const ok = createAppleMusicProvider({}, { getInstance: nativeMusicKitLoader(fakePlugin({ status: { authorized: true }, bodies: { "/v1/me/storefront": { data: [] } } })) });
    expect((await ok.getSubscriptionStatus()).active).toBe(true);
    const none = createAppleMusicProvider({}, { getInstance: nativeMusicKitLoader(fakePlugin({ status: { authorized: true } })) });
    expect((await none.getSubscriptionStatus()).active).toBe(false);
  });
});
