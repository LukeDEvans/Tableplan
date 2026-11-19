// The Listen bell's playback (media-music-show-ui.js) with a fake native player:
// what it hands the plugin, following along, resume, songs found by search,
// finishing, and giving way to other playback. The window itself is covered by
// scripts/qa-music-shows.mjs in a browser.
import { describe, it, expect, beforeEach } from "vitest";
import { createMusicShowsModule } from "../media-music-show-ui.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}

function fakeTts() {
  const handlers = {};
  const calls = [];
  return {
    calls, handlers,
    emit: (name, e) => (handlers[name] || []).forEach((h) => h(e)),
    addListener: async (name, h) => { (handlers[name] ||= []).push(h); return { remove: () => { handlers[name] = handlers[name].filter((x) => x !== h); } }; },
    play: async (o) => { calls.push(["play", o]); },
    setUpcoming: async (o) => { calls.push(["setUpcoming", o]); },
    next: async () => { calls.push(["next"]); return { advanced: true }; },
    pause: async () => { calls.push(["pause"]); },
    resume: async () => { calls.push(["resume"]); },
    stop: async () => { calls.push(["stop"]); },
  };
}

function fakeAppleMusic({ authorized = true, search = {} } = {}) {
  const calls = [];
  return {
    calls,
    getStatus: async () => ({ authorized, storefront: "us" }),
    authorize: async () => ({ authorized, storefront: "us" }),
    api: async ({ path }) => {
      calls.push(path);
      const term = decodeURIComponent(/term=([^&]+)/.exec(path)[1]);
      const songs = search[term] || [];
      return { body: JSON.stringify({ results: { songs: { data: songs } } }) };
    },
  };
}

const show = (id = "show-1") => ({
  id, title: "The Amplifier: Two cities", author: "The Amplifier · NYT", savedAt: "2026-10-27T19:26:19.000Z",
  musicShow: {
    v: 1, title: "Two Cities", author: "Pat Writer", durationText: "2 songs", image: "",
    intro: "Dear listeners,",
    songs: [
      { n: 1, artist: "The First Band", title: "Opening Song", text: "A song.", appleMusicId: "111" },
      { n: 2, artist: "Second Artist", title: "Closing Song", text: "Another.", appleMusicId: null },
    ],
  },
});

let state, tts, am, toasts, persisted, read, stopped, mini;
function build(opts = {}) {
  state = { savedArticles: [show()], readArticleIds: [] };
  tts = opts.noTts ? null : fakeTts();
  am = opts.am === undefined ? fakeAppleMusic({ search: { "Second Artist Closing Song": [{ id: "222", attributes: { name: "Closing Song", artistName: "Second Artist" } }] } }) : opts.am;
  toasts = []; persisted = 0; read = []; stopped = 0; mini = [];
  const opened = [];
  const mod = createMusicShowsModule({
    getState: () => state,
    persist: () => { persisted++; },
    markArticleRead: (id) => { read.push(id); state.readArticleIds.push(id); state.savedArticles = state.savedArticles.filter((a) => a.id !== id); },
    openArticle: (id) => opened.push(id),
    escapeHtml: (s) => String(s),
    showToast: (t) => toasts.push(t),
    nativeTts: () => tts,
    nativeAppleMusic: () => am,
    nativeVoiceId: () => "voice-1",
    voiceSpeed: () => 1.1,
    playbackRate: () => 1,
    stopOtherPlayback: () => { stopped++; },
    setMiniPlayer: (...a) => mini.push(a),
    onPlaybackChange: () => {},
    setPageNotifCount: () => {},
    showListen: () => {},
    callGmailApi: async () => ({ imported: 0, articles: [] }),
  });
  mod._opened = opened;
  return mod;
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
  globalThis.document = { getElementById: () => null };
});

describe("playing a show on the iPhone", () => {
  it("hands the whole show to the native player: write-ups as speech, songs as Apple Music", async () => {
    const m = build();
    await m.play("show-1");
    const [play, upcoming] = tts.calls;
    expect(stopped).toBe(1);
    expect(play[0]).toBe("play");
    expect(play[1]).toMatchObject({ voiceId: "voice-1", rate: 1, speechSpeed: 1.1, item: { id: "show-1#intro", kind: "speech" } });
    expect(play[1].item.text).toContain("Dear listeners,");
    expect(upcoming[1].items.map((i) => [i.kind, i.id, i.songId || null])).toEqual([
      ["speech", "show-1#1", null], ["appleMusic", "show-1#1:song", "111"],
      ["speech", "show-1#2", null], ["appleMusic", "show-1#2:song", "222"],
    ]);
    // Song 2 had no id: found by search, and saved back for other devices.
    expect(am.calls).toHaveLength(1);
    expect(state.savedArticles[0].musicShow.songs[1].appleMusicId).toBe("222");
    expect(persisted).toBe(1);
    expect(m.active()).toBe(true);
    expect(m.isPlaying()).toBe(true);
    expect(mini.at(-1)).toEqual(["Two Cities", "Two Cities", ""]);
  });

  it("follows the player, remembers where it was, and resumes there", async () => {
    let m = build();
    await m.play("show-1");
    tts.emit("ttsItemStart", { id: "show-1#1:song" });
    expect(m.info()).toMatchObject({ title: "Playing Opening Song · The First Band", date: "3 of 5" });
    tts.emit("ttsState", { playing: false });
    expect(m.isPlaying()).toBe(false);
    m.stop();
    expect(tts.calls.at(-1)).toEqual(["stop"]);
    expect(m.active()).toBe(false);

    // A fresh start (same device): picks up at song 1.
    const storage = globalThis.localStorage;
    m = build();
    globalThis.localStorage = storage;
    await m.play("show-1");
    expect(tts.calls[0][1].item.id).toBe("show-1#1:song");
    expect(tts.calls[1][1].items[0].id).toBe("show-1#2");
  });

  it("finishes: off the bell, marked read, position forgotten", async () => {
    const m = build();
    await m.play("show-1");
    tts.emit("ttsItemStart", { id: "show-1#2:song" });
    tts.emit("ttsFinish", { id: "show-1#2:song", hasNext: false });
    expect(read).toEqual(["show-1"]);
    expect(m.active()).toBe(false);
    expect(m.pendingCount()).toBe(0);
    expect(toasts.at(-1)).toBe("Finished “Two Cities”.");
    expect(JSON.parse(localStorage.getItem("live-music-show-pos-v1") || "{}")).toEqual({});
  });

  it("lets go when something else takes over the player", async () => {
    const m = build();
    await m.play("show-1");
    tts.emit("ttsItemStart", { id: "podcast-episode-9" });
    expect(m.active()).toBe(false);
    expect(read).toEqual([]); // not finished, still on the bell
    expect(tts.calls.filter((c) => c[0] === "stop")).toHaveLength(0); // didn't stop the other thing
  });

  it("skips forward a part, and back a part", async () => {
    const m = build();
    await m.play("show-1");
    tts.emit("ttsItemStart", { id: "show-1#1:song" });
    await m.step(1);
    expect(tts.calls.at(-1)).toEqual(["next"]);
    await m.step(-1);
    const [, back] = tts.calls.at(-2);
    expect(back.item.id).toBe("show-1#1");
    expect(m.info().date).toBe("2 of 5");
  });

  it("tells about a song that won't play, and keeps going", async () => {
    const m = build();
    await m.play("show-1");
    tts.emit("ttsSongFailed", { id: "show-1#1:song" });
    expect(toasts.at(-1)).toBe("Couldn't play “Opening Song” — moving on.");
    expect(m.active()).toBe(true);
  });

  it("without Apple Music, plays the write-ups only", async () => {
    const m = build({ am: fakeAppleMusic({ authorized: false }) });
    await m.play("show-1");
    const kinds = [tts.calls[0][1].item, ...tts.calls[1][1].items].map((i) => i.kind);
    expect(kinds).toEqual(["speech", "speech", "speech"]);
    expect(toasts[0]).toMatch(/Sign in to Apple Music/);
  });

  it("outside the iPhone app, opens the show to read", async () => {
    const m = build({ noTts: true });
    await m.play("show-1");
    expect(m._opened).toEqual(["show-1"]);
    expect(m.active()).toBe(false);
  });

  it("stopping leaves the show on the bell to resume", async () => {
    const m = build();
    await m.play("show-1");
    m.stop();
    expect(m.active()).toBe(false);
    expect(m.pendingCount()).toBe(1);
    expect(read).toEqual([]);
  });
});

describe("the first-run import", () => {
  it("merges returned shows once, skipping ones already here or read", async () => {
    const m = build();
    state.readArticleIds.push("show-old");
    let calls = 0;
    // swap in a gmail stub that returns records
    const m2 = createMusicShowsModule({
      getState: () => state, persist: () => { persisted++; }, markArticleRead: () => {}, openArticle: () => {}, escapeHtml: String,
      showToast: () => {}, nativeTts: () => null, nativeAppleMusic: () => null, nativeVoiceId: () => "", voiceSpeed: () => 1, playbackRate: () => 1,
      stopOtherPlayback: () => {}, setMiniPlayer: () => {}, onPlaybackChange: () => {}, setPageNotifCount: () => {}, showListen: () => {},
      callGmailApi: async () => { calls++; return { imported: 2, articles: [show("show-1"), show("show-new"), show("show-old")] }; },
    });
    await m2.importRecentOnce();
    await m2.importRecentOnce();
    expect(calls).toBe(1);
    expect(state.savedArticles.map((a) => a.id)).toEqual(["show-1", "show-new"]);
    expect(m.pendingCount()).toBe(2);
  });

  it("tries again at the next app start when Gmail isn't reachable", async () => {
    build();
    let calls = 0;
    const m2 = createMusicShowsModule({
      getState: () => state, persist: () => {}, markArticleRead: () => {}, openArticle: () => {}, escapeHtml: String,
      showToast: () => {}, nativeTts: () => null, nativeAppleMusic: () => null, nativeVoiceId: () => "", voiceSpeed: () => 1, playbackRate: () => 1,
      stopOtherPlayback: () => {}, setMiniPlayer: () => {}, onPlaybackChange: () => {}, setPageNotifCount: () => {}, showListen: () => {},
      callGmailApi: async () => { calls++; return { error: "Gmail not connected." }; },
    });
    await m2.importRecentOnce();
    await m2.importRecentOnce(); // same app start: not again
    expect(calls).toBe(1);
    expect(localStorage.getItem("live-music-show-import-v1")).toBeNull(); // next start tries again
  });
});
