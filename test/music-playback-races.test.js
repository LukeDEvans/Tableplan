import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Behavioral test of the music start/stop/save/open control flow in app.js
// (audit MED-4/5/8/11/12/13). app.js can't be imported (it boots the whole app),
// so we lift the named top-level functions out of its source verbatim and run
// them in a sandbox with stubbed collaborators. This exercises the REAL code.
const SRC = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
function extract(name) {
  const re = new RegExp(`\\n((?:async )?function ${name}\\()`);
  const m = re.exec(SRC);
  if (!m) throw new Error(`function ${name} not found in app.js`);
  const start = m.index + 1;
  const end = SRC.indexOf("\n}\n", start);
  return SRC.slice(start, end + 2);
}
const FNS = [
  "saveMusicPosition", "ownedMusicCall", "teardownOwnedMusic", "playMusicDescriptor",
  "startLibraryTrack", "startOwnedMusicTrack", "startStreamingTrack", "playMusicQueueItem",
  "onMusicEnded", "stopMusicPlayback", "toggleMusicPlayPause", "skipMusic",
  "openMusicItem", "closeMusicItem", "advanceMediaAllQueue",
];

function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeSandbox(env = {}) {
  const body = `
    let musicAudio = null, musicPositionSaveTimer = null, musicLastSavedPos = null, musicStartGen = 0;
    let musicCurTrack = null, musicQueueRest = [], musicCurUrl = null;
    let musicPlaybackProvider = null, musicOwnedUnsub = null, musicOwnedNP = null;
    let musicOpenToken = 0, musicOpenItem = null, musicOpenItemLoading = false;
    let mediaAllQueueId = env.mediaAllQueueId ?? null, mediaAllQueueRest = env.mediaAllQueueRest ?? [];
    const { state, persist, mediaEngine, getMediaEngine, ensureMediaAudioEl, getMusicLib, getMusicProviders,
      musicStreamMod, showVoiceToast, stopPodcastAudio, stopListen, stopRadio, setMiniPlayer, hideMiniPlayer,
      setMusicMediaSession, pushMusicHistory, renderMusicPanel, updateMiniPlayerPlayBtn, updateMiniPlayerProgress,
      setMediaSessionPlaybackState, musicArtUrlFor, nativeAppleMusic, resumePositionFor, setMediaPosition,
      clearMediaPosition, pruneMediaProgress, updateDiscoverResults, playStreamingTrack, musicItemCache,
      getAllListenList, mediaItemPlayable, playMediaAllItem, renderMediaAllList, startRecordingResolved,
      nativeMusicEnabled, startNativeMusicTrack } = env;
    const activeAppArea = "other", activeMediaTab = "other", mediaPlaybackSpeed = 1;
    const window = { clearInterval() {}, setInterval() { return 1; } };
    const URL = { revokeObjectURL: env.revoke || (() => {}) };
    ${FNS.map(extract).join("\n")}
    return {
      ${FNS.join(", ")},
      get: () => ({ musicAudio, musicCurTrack, musicPlaybackProvider, musicQueueRest, musicOpenItem, musicOpenItemLoading, musicStartGen, mediaAllQueueId }),
      set: (o) => { if ("musicAudio" in o) musicAudio = o.musicAudio; if ("musicCurTrack" in o) musicCurTrack = o.musicCurTrack; if ("musicQueueRest" in o) musicQueueRest = o.musicQueueRest; if ("musicPlaybackProvider" in o) musicPlaybackProvider = o.musicPlaybackProvider; if ("musicOwnedNP" in o) musicOwnedNP = o.musicOwnedNP; },
    };`;
  // eslint-disable-next-line no-new-func
  return new Function("env", body)(env);
}

function baseEnv(over = {}) {
  const el = { currentTime: 0, duration: 200, paused: false, play: () => Promise.resolve(), pause() { this.paused = true; } };
  const engine = { load: vi.fn(), stop: vi.fn() };
  const env = {
    state: { mediaProgress: {} },
    persist: vi.fn(),
    mediaEngine: engine, getMediaEngine: () => engine, ensureMediaAudioEl: () => el,
    showVoiceToast: vi.fn(), stopPodcastAudio() {}, stopListen() {}, stopRadio() {},
    setMiniPlayer() {}, hideMiniPlayer() {}, setMusicMediaSession() {}, pushMusicHistory() {},
    renderMusicPanel() {}, updateMiniPlayerPlayBtn() {}, updateMiniPlayerProgress() {}, setMediaSessionPlaybackState() {},
    musicArtUrlFor: () => "", nativeAppleMusic: () => false, resumePositionFor: () => 0,
    setMediaPosition: (m, id, v) => ({ ...m, [id]: v }), clearMediaPosition: (m, id) => { const n = { ...m }; delete n[id]; return n; },
    pruneMediaProgress: (m) => m, updateDiscoverResults() {}, playStreamingTrack() {}, musicItemCache: new Map(),
    musicStreamMod: { isPlaybackOwner: (p) => !!p.owns },
    getAllListenList: () => [], mediaItemPlayable: () => true, playMediaAllItem: vi.fn(), renderMediaAllList() {},
    startRecordingResolved: async () => false,
    nativeMusicEnabled: () => false, startNativeMusicTrack: async () => false,
    ...over,
  };
  env.el = el;
  return env;
}

describe("MED-4 music start race (generation token)", () => {
  it("a slow stream resolve that loses to a newer start does not load, and skips onMusicEnded", async () => {
    const slow = deferred();
    const providers = { get: (id) => (id === "slow" ? { getPlayable: () => slow.promise } : { getPlayable: async () => ({ url: "fast.mp3" }) }) };
    const env = baseEnv({ getMusicProviders: async () => providers });
    const sb = makeSandbox(env);
    const p1 = sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "slow" } }, [{ kind: "stream", track: { id: "Q" } }]);
    const p2 = sb.playMusicQueueItem({ kind: "stream", track: { id: "B", provider: "fast" } }, []);
    await p2;
    slow.resolve({ url: "slow.mp3" });
    await p1;
    expect(env.mediaEngine.load).toHaveBeenCalledTimes(1);
    expect(env.mediaEngine.load.mock.calls[0][0].segments[0].url).toBe("fast.mp3");
    expect(sb.get().musicCurTrack.id).toBe("B");
  });

  it("an owned (Apple) start that resolves after being superseded is paused", async () => {
    const playD = deferred();
    const apple = { id: "apple", owns: true, play: vi.fn(() => playD.promise), pause: vi.fn(() => Promise.reject(new Error("x"))), onChange: () => () => {}, getNowPlaying: () => ({}) };
    const providers = { get: (id) => (id === "apple" ? apple : { getPlayable: async () => ({ url: "ia.mp3" }) }) };
    const env = baseEnv({ getMusicProviders: async () => providers });
    const sb = makeSandbox(env);
    const p1 = sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "apple" } }, []);
    await tick();
    expect(apple.play).toHaveBeenCalled();
    await sb.playMusicQueueItem({ kind: "stream", track: { id: "B", provider: "ia" } }, []);
    const pausesBefore = apple.pause.mock.calls.length;
    playD.resolve();
    await p1;
    expect(apple.pause.mock.calls.length).toBe(pausesBefore + 1); // late start silenced
    expect(sb.get().musicCurTrack.id).toBe("B");
    expect(sb.get().musicPlaybackProvider).toBe(null);
  });

  it("a stop while a start is resolving prevents the start", async () => {
    const slow = deferred();
    const env = baseEnv({ getMusicProviders: async () => ({ get: () => ({ getPlayable: () => slow.promise }) }) });
    const sb = makeSandbox(env);
    const p = sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "x" } }, []);
    sb.stopMusicPlayback();
    slow.resolve({ url: "a.mp3" });
    await p;
    expect(env.mediaEngine.load).not.toHaveBeenCalled();
  });

  it("a current failure still skips to the next queued item", async () => {
    const env = baseEnv({ getMusicProviders: async () => ({ get: (id) => ({ getPlayable: async () => (id === "bad" ? null : { url: "ok.mp3" }) }) }) });
    const sb = makeSandbox(env);
    await sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "bad" } }, [{ kind: "stream", track: { id: "B", provider: "good" } }]);
    await tick(); await tick();
    expect(env.mediaEngine.load).toHaveBeenCalledTimes(1);
    expect(sb.get().musicCurTrack.id).toBe("B");
  });
});

describe("MED-5 saveMusicPosition", () => {
  it("skips while paused and when unchanged; force saves once on pause", () => {
    const env = baseEnv();
    const sb = makeSandbox(env);
    const el = env.el;
    sb.set({ musicAudio: el, musicCurTrack: { id: "T" } });
    el.currentTime = 30; el.paused = false;
    sb.saveMusicPosition();
    expect(env.persist).toHaveBeenCalledTimes(1);
    sb.saveMusicPosition();                      // unchanged → no write
    expect(env.persist).toHaveBeenCalledTimes(1);
    el.currentTime = 42; el.paused = true;
    sb.saveMusicPosition();                      // interval while paused → no write
    expect(env.persist).toHaveBeenCalledTimes(1);
    sb.saveMusicPosition({ force: true });       // the pause handler
    expect(env.persist).toHaveBeenCalledTimes(2);
    expect(env.state.mediaProgress.T.position).toBe(42);
    sb.saveMusicPosition({ force: true });       // still unchanged → no write
    expect(env.persist).toHaveBeenCalledTimes(2);
  });
});

describe("MED-11 onMusicEnded does not re-save the cleared resume point", () => {
  it("queue drained → resume point stays cleared", () => {
    const env = baseEnv();
    env.state.mediaProgress = { T: { position: 100 } };
    const sb = makeSandbox(env);
    env.el.currentTime = 190; env.el.paused = false;
    sb.set({ musicAudio: env.el, musicCurTrack: { id: "T" }, musicQueueRest: [] });
    sb.onMusicEnded();
    expect(env.state.mediaProgress.T).toBeUndefined();
    expect(sb.get().musicCurTrack).toBe(null);
  });
  it("an explicit stop still saves the resume point", () => {
    const env = baseEnv();
    const sb = makeSandbox(env);
    env.el.currentTime = 90; env.el.paused = true;
    sb.set({ musicAudio: env.el, musicCurTrack: { id: "T" } });
    sb.stopMusicPlayback();
    expect(env.state.mediaProgress.T.position).toBe(90);
  });
});

describe("MED-12 owned-provider async transport calls are rejection-safe", () => {
  it("toggle/skip/teardown swallow rejected provider promises and sync throws", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    const prov = {
      pause: () => Promise.reject(new Error("p")), resume: () => Promise.reject(new Error("r")),
      seek: () => { throw new Error("s"); },
    };
    const sb = makeSandbox(baseEnv());
    sb.set({ musicPlaybackProvider: prov, musicOwnedNP: { isPlaying: true, positionMs: 0, durationMs: 1000 } });
    sb.toggleMusicPlayPause();
    sb.set({ musicOwnedNP: { isPlaying: false } });
    sb.toggleMusicPlayPause();
    expect(() => sb.skipMusic(10)).not.toThrow();
    sb.teardownOwnedMusic();
    await tick(); await tick();
    process.off("unhandledRejection", onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
  });
});

describe("MED-8 openMusicItem race", () => {
  it("a slow getItem for album A doesn't overwrite a later open of album B", async () => {
    const dA = deferred();
    const prov = { getItem: (a) => (a.id === "A" ? dA.promise : Promise.resolve({ album: a, tracks: ["b1"] })) };
    const env = baseEnv({ getMusicProviders: async () => ({ get: () => prov }) });
    const sb = makeSandbox(env);
    const pA = sb.openMusicItem({ id: "A", provider: "x" });
    await sb.openMusicItem({ id: "B", provider: "x" });
    dA.resolve({ album: { id: "A" }, tracks: ["a1"] });
    await pA;
    expect(sb.get().musicOpenItem.album.id).toBe("B");
    expect(sb.get().musicOpenItemLoading).toBe(false);
  });
  it("closing while loading keeps it closed", async () => {
    const dA = deferred();
    const env = baseEnv({ getMusicProviders: async () => ({ get: () => ({ getItem: () => dA.promise }) }) });
    const sb = makeSandbox(env);
    const pA = sb.openMusicItem({ id: "A", provider: "x" });
    sb.closeMusicItem();
    dA.resolve({ album: { id: "A" }, tracks: [] });
    await pA;
    expect(sb.get().musicOpenItem).toBe(null);
  });
});

describe("MED-13 advanceMediaAllQueue", () => {
  it("returns false when nothing was started", () => {
    const sb = makeSandbox(baseEnv({ mediaAllQueueId: "x", mediaAllQueueRest: ["gone"] }));
    expect(sb.advanceMediaAllQueue("x")).toBe(false);
    expect(sb.get().mediaAllQueueId).toBe(null);
  });
  it("returns true when it started the next item", () => {
    const env = baseEnv({ mediaAllQueueId: "x", mediaAllQueueRest: ["y"], getAllListenList: () => [{ id: "y" }] });
    const sb = makeSandbox(env);
    expect(sb.advanceMediaAllQueue("x")).toBe(true);
    expect(env.playMediaAllItem).toHaveBeenCalled();
  });
});

describe("iPhone app: songs on the native player", () => {
  const providers = { get: () => ({ getPlayable: async () => ({ url: "song.mp3" }) }) };

  it("plays a stream natively and never loads the web element", async () => {
    const startNativeMusicTrack = vi.fn(async () => true);
    const env = baseEnv({ getMusicProviders: async () => providers, nativeMusicEnabled: () => true, startNativeMusicTrack });
    const sb = makeSandbox(env);
    await sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "ia", title: "A" } }, []);
    expect(startNativeMusicTrack).toHaveBeenCalledTimes(1);
    expect(startNativeMusicTrack.mock.calls[0][1]).toBe("song.mp3");
    expect(env.mediaEngine.load).not.toHaveBeenCalled();
  });

  it("falls back to the web player when the native player can't take the song", async () => {
    const env = baseEnv({ getMusicProviders: async () => providers, nativeMusicEnabled: () => true, startNativeMusicTrack: async () => false });
    const sb = makeSandbox(env);
    await sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "ia", title: "A" } }, []);
    expect(env.mediaEngine.load).toHaveBeenCalledTimes(1);
    expect(sb.get().musicCurTrack.id).toBe("A");
  });

  it("a superseded native start doesn't fall back to the web player", async () => {
    const gate = deferred();
    let sbRef;
    const startNativeMusicTrack = vi.fn(async () => { await gate.promise; return false; });
    const env = baseEnv({ getMusicProviders: async () => providers, nativeMusicEnabled: () => true, startNativeMusicTrack });
    const sb = makeSandbox(env); sbRef = sb;
    const first = sb.playMusicQueueItem({ kind: "stream", track: { id: "A", provider: "ia", title: "A" } }, []);
    await tick();
    sbRef.stopMusicPlayback();           // a stop supersedes the pending start
    gate.resolve();
    await first; await tick();
    expect(env.mediaEngine.load).not.toHaveBeenCalled();
  });
});
