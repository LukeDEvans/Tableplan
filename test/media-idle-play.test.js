import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { recentHistory as recentMediaHistory } from "../media-history.js";

// The permanent mini-player's play button with nothing loaded, and the
// "when the queue ends, play…" pick. Same sandbox approach as
// music-playback-races: the REAL functions are lifted from app.js.
const SRC = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
function extract(name) {
  const m = new RegExp(`\\n((?:async )?function ${name}\\()`).exec(SRC);
  if (!m) throw new Error(`function ${name} not found in app.js`);
  const start = m.index + 1;
  return SRC.slice(start, SRC.indexOf("\n}\n", start) + 2);
}
const FNS = ["idlePlaybackPlan", "shuffledCopy", "playRecordingsShuffled", "favoriteRecordings",
  "recentRadioRefs", "knownRadioStation", "queueFallbackPlan", "queueFallbackOptions"];

function sandbox(env) {
  const body = `
    const { state, getAllListenList, mediaItemPlayable, findPodcastEpisode, resumePositionFor, playRadioStation,
      playAllQueueFrom, openPodcastEpisode, playMusicQueueItem, recentMediaHistory } = env;
    ${FNS.map(extract).join("\n")}
    return { ${FNS.join(", ")} };`;
  return new Function("env", body)(env); // eslint-disable-line no-new-func
}
const station = (id, name) => ({ id, name, streams: [{ url: `https://s/${id}` }], logoUrl: "" });
const rec = (id) => ({ id, title: id });
function env(over = {}) {
  return {
    state: { mediaHistory: [], podcastProgress: {}, mediaProgress: {}, musicLibrary: { favorites: [], playlists: [] }, radioFavorites: [], mediaQueueFallback: "auto", ...(over.state || {}) },
    getAllListenList: () => over.queue || [],
    mediaItemPlayable: () => true,
    findPodcastEpisode: (id) => ({ episode: (over.episodes || []).includes(id) ? { id } : null }),
    resumePositionFor: (m, id) => (m[id]?.position || 0),
    playRadioStation: vi.fn(), playAllQueueFrom: vi.fn(), openPodcastEpisode: vi.fn(), playMusicQueueItem: vi.fn(),
    recentMediaHistory,
  };
}
const hist = (...entries) => entries.map((e, i) => ({ at: 100 - i, subtitle: "", artworkUrl: "", ...e }));

describe("idle play: resume → next in queue → queue-ends pick", () => {
  it("resumes the last radio station", () => {
    const e = env({ state: { mediaHistory: hist({ kind: "radio", id: "mpr", title: "MPR News", ref: station("mpr", "MPR News") }) } });
    const plan = sandbox(e).idlePlaybackPlan();
    expect(plan.title).toBe("MPR News");
    plan.start();
    expect(e.playRadioStation).toHaveBeenCalledWith(expect.objectContaining({ id: "mpr" }));
  });
  it("resumes an unfinished podcast from the queue", () => {
    const e = env({ state: { mediaHistory: hist({ kind: "podcast", id: "ep1", title: "Ep 1" }) }, queue: [{ id: "ep0" }, { id: "ep1" }] });
    sandbox(e).idlePlaybackPlan().start();
    expect(e.playAllQueueFrom).toHaveBeenCalledWith("ep1");
  });
  it("a finished podcast falls through to the next queue item", () => {
    const e = env({ state: { mediaHistory: hist({ kind: "podcast", id: "ep1", title: "Ep 1" }), podcastProgress: { ep1: { played: true } } }, queue: [{ id: "ep2", title: "Ep 2" }] });
    const plan = sandbox(e).idlePlaybackPlan();
    expect(plan.sub).toBe("Up next in your queue");
    plan.start();
    expect(e.playAllQueueFrom).toHaveBeenCalledWith("ep2");
  });
  it("resumes a song only when it has a saved position", () => {
    const last = { kind: "music", id: "t1", title: "Song", ref: { recording: rec("t1") } };
    expect(sandbox(env({ state: { mediaHistory: hist(last) } })).idlePlaybackPlan()).toBeNull();
    const e = env({ state: { mediaHistory: hist(last), mediaProgress: { t1: { position: 90 } } } });
    sandbox(e).idlePlaybackPlan().start();
    expect(e.playMusicQueueItem).toHaveBeenCalledWith({ kind: "recording", recording: rec("t1") }, [], { interactive: true });
  });
  it("finished + empty queue → the queue-ends pick (auto: last radio station)", () => {
    const e = env({ state: { mediaHistory: hist(
      { kind: "podcast", id: "ep1", title: "Ep 1" },
      { kind: "radio", id: "kexp", title: "KEXP", ref: station("kexp", "KEXP") }
    ), podcastProgress: { ep1: { played: true } } } });
    const plan = sandbox(e).idlePlaybackPlan();
    expect(plan.title).toBe("KEXP");
  });
});

describe("queue-ends pick (state.mediaQueueFallback)", () => {
  it("a chosen playlist plays shuffled — every song, once", () => {
    const items = ["a", "b", "c", "d"].map(rec);
    const e = env({ state: { mediaQueueFallback: "playlist:p1", musicLibrary: { favorites: [], playlists: [{ id: "p1", name: "Road", items }] } } });
    sandbox(e).queueFallbackPlan().start();
    const [first, rest] = e.playMusicQueueItem.mock.calls[0];
    const played = [first.recording, ...rest.map((r) => r.recording)].map((r) => r.id).sort();
    expect(played).toEqual(["a", "b", "c", "d"]);
  });
  it("a chosen radio station plays (from favourites)", () => {
    const e = env({ state: { mediaQueueFallback: "radio:wnyc", radioFavorites: [station("wnyc", "WNYC")] } });
    expect(sandbox(e).queueFallbackPlan().title).toBe("WNYC");
  });
  it("auto with no radio history → favourite songs shuffled; nothing at all → null; off → null", () => {
    const favs = { favorites: [{ type: "recording", entity: rec("f1") }, { type: "album", entity: {} }], playlists: [] };
    expect(sandbox(env({ state: { musicLibrary: favs } })).queueFallbackPlan().title).toBe("Favorite songs");
    expect(sandbox(env()).queueFallbackPlan()).toBeNull();
    expect(sandbox(env({ state: { mediaQueueFallback: "off", musicLibrary: favs } })).queueFallbackPlan()).toBeNull();
  });
  it("a pick that's gone falls back to auto, and the settings list flags it", () => {
    const e = env({ state: { mediaQueueFallback: "playlist:deleted", mediaHistory: hist({ kind: "radio", id: "mpr", title: "MPR", ref: station("mpr", "MPR") }) } });
    const sb = sandbox(e);
    expect(sb.queueFallbackPlan().title).toBe("MPR");
    const opts = sb.queueFallbackOptions();
    expect(opts.map((o) => o.value)).toEqual(["auto", "playlist:deleted", "radio:mpr", "off"]);
  });
});
