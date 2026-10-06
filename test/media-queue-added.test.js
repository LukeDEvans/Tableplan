import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeQueueAdded, queueAddedFindRef, withQueueEntry, withoutQueueEntries,
  episodeRef, articleRef, libraryAlbumRef, slimCatalogItem, libraryAlbumTracks,
} from "../media-queue-added.js";

// Manual "Add to queue" entries: the pure list helpers, then the REAL app.js
// functions that place them in the queue and hand playback back after an album
// (lifted from the source, same sandbox approach as media-idle-play).

describe("queue-added list helpers", () => {
  it("adds once per ref, with a fresh id each time", () => {
    let n = 0;
    const makeId = () => `id${++n}`;
    const a = withQueueEntry([], { kind: "episode", ref: episodeRef("e1"), itemId: "e1" }, { now: 5, makeId });
    expect(a.added).toBe(true);
    expect(a.list).toEqual([{ kind: "episode", ref: "episode:e1", itemId: "e1", id: "id1", addedAt: 5 }]);
    const b = withQueueEntry(a.list, { kind: "episode", ref: episodeRef("e1"), itemId: "e1" }, { makeId });
    expect(b.added).toBe(false);
    expect(b.list).toHaveLength(1);
    const c = withQueueEntry(b.list, { kind: "article", ref: articleRef("a1"), itemId: "a1" }, { makeId });
    expect(c.list.map((e) => e.id)).toEqual(["id1", "id2"]); // appended → queue order is add order
  });

  it("rejects malformed drafts and stored junk", () => {
    expect(withQueueEntry([], { kind: "radio", ref: "x" }).added).toBe(false);
    expect(withQueueEntry([], null).added).toBe(false);
    expect(normalizeQueueAdded([null, {}, { id: "1", ref: "r", kind: "nope" }, { id: "2", ref: "r", kind: "track" }, { id: "3", ref: "r", kind: "track" }]))
      .toEqual([{ id: "2", ref: "r", kind: "track" }]); // also collapses a duplicate ref from two devices
    expect(normalizeQueueAdded("nope")).toEqual([]);
  });

  it("removes by predicate and reports what went (for tombstones)", () => {
    const list = [{ id: "1", ref: "a", kind: "track" }, { id: "2", ref: "b", kind: "album" }];
    const r = withoutQueueEntries(list, (e) => e.id === "2");
    expect(r.removed.map((e) => e.id)).toEqual(["2"]);
    expect(r.list.map((e) => e.id)).toEqual(["1"]);
    expect(withoutQueueEntries(list, () => false).removed).toEqual([]);
    expect(queueAddedFindRef(list, "a").id).toBe("1");
    expect(queueAddedFindRef(list, "zz")).toBe(null);
  });

  it("library albums match on artist + album; catalog items drop their track list", () => {
    const tracks = [{ id: 1, album: "Blue", artist: "Joni" }, { id: 2, album: "Blue", artist: "Other" }, { id: 3, artist: "Joni" }];
    expect(libraryAlbumTracks(tracks, { artist: "Joni", album: "Blue" }).map((t) => t.id)).toEqual([1]);
    expect(libraryAlbumTracks(tracks, { artist: "Joni", album: "" }).map((t) => t.id)).toEqual([3]); // untagged singles
    expect(libraryAlbumRef("Joni", "Blue")).not.toBe(libraryAlbumRef("Other", "Blue"));
    expect(slimCatalogItem({ id: "x", provider: "p", tracks: [1, 2] })).toEqual({ id: "x", provider: "p" });
  });
});

const SRC = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
function extract(name) {
  const m = new RegExp(`\\n((?:async )?function ${name}\\()`).exec(SRC);
  if (!m) throw new Error(`function ${name} not found in app.js`);
  const start = m.index + 1;
  return SRC.slice(start, SRC.indexOf("\n}\n", start) + 2);
}

describe("queue-added items in the Media queue (real app.js functions)", () => {
  const FNS = ["articleHasListenableBody", "articleQueueItem", "queueAddedItems", "queuedMusicRow", "getAutoPlaylist", "getAllListenList"];
  function build(state) {
    const env = {
      state, normalizeQueueAdded, libraryAlbumTracks,
      RECENT_WINDOW_OPTIONS: [{ value: "month", ms: 30 * 864e5 }, 0, 0, 0, { value: "month", ms: 30 * 864e5 }],
      getBundleHeldEpisodeIds: () => new Set(),
      getReadPublications: () => [], articleArtUrl: () => "", getArticleSortDate: (a) => a.savedAt,
      publicationTierFor: () => undefined, hoistResumeEpisode: (l) => l, musicArtUrlFor: () => "", musicLibrary: [],
      playlistItemForEpisodeId: (id) => {
        for (const p of state.podcasts) { const e = p.episodes.find((x) => x.id === id); if (e) return { ...e, type: "podcast", showId: p.id, showTitle: p.title, showArt: "" }; }
        return null;
      },
    };
    const body = `const { ${Object.keys(env).join(", ")} } = env;\n${FNS.map(extract).join("\n")}\nreturn { ${FNS.join(", ")} };`;
    return new Function("env", body)(env); // eslint-disable-line no-new-func
  }
  const recent = new Date(Date.now() - 864e5).toISOString();
  const old = new Date(Date.now() - 400 * 864e5).toISOString();
  const base = () => ({
    podcasts: [{ id: "s", title: "Show", episodes: [{ id: "new", title: "New", pubDate: recent }, { id: "old", title: "Old", pubDate: old }, { id: "new2", title: "New 2", pubDate: recent }] }],
    podcastProgress: {}, podcastAutoSkipped: [], readArticleIds: [], savedArticles: [], readingItems: [], mediaAllPinnedOrder: [], mediaQueueAdded: [],
  });

  it("an emailed newsletter whose body moved to the content store still queues", () => {
    const state = base();
    state.savedArticles = [
      { id: "inline", title: "Inline", text: "<p>x</p>", url: null, savedAt: recent, publication: "email" },
      { id: "stored", title: "Stored", text: null, url: null, bodyRef: { cloud: "k" }, savedAt: recent, publication: "email" },
      { id: "empty", title: "Empty", text: null, url: null, savedAt: recent, publication: "email" },
    ];
    const ids = build(state).getAllListenList().map((i) => i.id);
    expect(ids).toContain("inline");
    expect(ids).toContain("stored"); // the regression: dropped once text was stripped from the synced row
    expect(ids).not.toContain("empty");
  });

  it("manual adds go last, in add order, including items the rules leave out", () => {
    const state = base();
    state.savedArticles = [{ id: "art", title: "Art", url: "https://x", savedAt: recent, publication: "nyt" }];
    state.mediaQueueAdded = [
      { id: "q1", ref: "album:lib:Joni|Blue", kind: "album", source: "library", title: "Blue", artist: "Joni", album: "Blue" },
      { id: "q2", ref: "episode:old", kind: "episode", itemId: "old" },   // outside the time window
      { id: "q3", ref: "episode:new", kind: "episode", itemId: "new" },   // also auto-included → moves to the end
    ];
    const list = build(state).getAllListenList();
    expect(list.map((i) => i.id)).toEqual(["new2", "art", "q1", "old", "new"]);
    const album = list.find((i) => i.id === "q1");
    expect(album).toMatchObject({ type: "music", providerId: "queue-music", title: "Blue", showTitle: "Joni · Album" });
    // The podcasts-only playlist shows the added episodes too (not the album).
    expect(build(state).getAutoPlaylist().map((i) => i.id)).toEqual(["new2", "old", "new"]);
  });

  it("a played episode or a read / deleted article drops out even with an entry", () => {
    const state = base();
    state.podcastProgress = { old: { played: true } };
    state.readArticleIds = ["gone"];
    state.mediaQueueAdded = [
      { id: "q1", ref: "episode:old", kind: "episode", itemId: "old" },
      { id: "q2", ref: "article:gone", kind: "article", itemId: "gone" },
      { id: "q3", ref: "episode:missing", kind: "episode", itemId: "missing" },
    ];
    expect(build(state).queueAddedItems()).toEqual([]);
  });

  it("an episode removed from the queue stays out until it is added again", () => {
    const state = base();
    state.mediaQueueRemoved = ["new"];
    expect(build(state).getAllListenList().map((i) => i.id)).toEqual(["new2"]);
    state.mediaQueueAdded = [{ id: "q1", ref: "episode:new", kind: "episode", itemId: "new" }]; // a stale "removed" from another device can't hide a fresh add
    expect(build(state).getAllListenList().map((i) => i.id)).toEqual(["new2", "new"]);
  });

  it("a drag order still wins over the add-to-end placement", () => {
    const state = base();
    state.mediaQueueAdded = [{ id: "q1", ref: "track:lib:9", kind: "track", source: "library", title: "Song", mq: { kind: "library", id: 9 } }];
    state.mediaAllPinnedOrder = ["q1", "new"];
    expect(build(state).getAllListenList().map((i) => i.id)).toEqual(["q1", "new", "new2"]);
  });
});

describe("an added album hands the queue on when its last track ends", () => {
  function build(over = {}) {
    const env = {
      state: { mediaProgress: {} }, musicCurTrack: { id: "t9" }, musicPositionSaveTimer: 0,
      window: { clearInterval: () => {} }, clearMediaPosition: (m) => m, persist: vi.fn(), updateMiniPlayerPlayBtn: () => {},
      playMusicQueueItem: vi.fn(), stopMusicPlayback: vi.fn(), removeQueueAddedEntries: vi.fn(() => true),
      advanceMediaAllQueue: vi.fn(() => true), ...over,
    };
    const body = `let { ${Object.keys(env).join(", ")} } = env;
      let musicQueueRest = env.rest || []; let musicQueueOwnerId = env.owner || null;
      ${extract("onMusicEnded")}
      return { onMusicEnded, owner: () => musicQueueOwnerId };`;
    return { env, api: new Function("env", body)(env) }; // eslint-disable-line no-new-func
  }

  it("mid-album: the next track plays and keeps the queue entry as owner", () => {
    const { env, api } = build({ rest: [{ kind: "library", id: 2 }], owner: "q1" });
    api.onMusicEnded();
    expect(env.playMusicQueueItem).toHaveBeenCalledWith({ kind: "library", id: 2 }, [], { queueOwner: "q1" });
    expect(env.advanceMediaAllQueue).not.toHaveBeenCalled();
  });

  it("last track: the entry leaves the queue and the next queue item takes over", () => {
    const { env, api } = build({ owner: "q1" });
    api.onMusicEnded();
    const match = env.removeQueueAddedEntries.mock.calls[0][0];
    expect(match({ id: "q1" })).toBe(true);
    expect(match({ id: "q2" })).toBe(false);
    expect(env.advanceMediaAllQueue).toHaveBeenCalledWith("q1");
    expect(env.stopMusicPlayback).not.toHaveBeenCalled(); // no pause between items
    expect(api.owner()).toBe(null);
  });

  it("last track with nothing after it: music stops", () => {
    const { env, api } = build({ owner: "q1", advanceMediaAllQueue: vi.fn(() => false) });
    api.onMusicEnded();
    expect(env.stopMusicPlayback).toHaveBeenCalledWith({ save: false });
  });

  it("music the listener started themselves never touches the queue", () => {
    const { env, api } = build({});
    api.onMusicEnded();
    expect(env.advanceMediaAllQueue).not.toHaveBeenCalled();
    expect(env.stopMusicPlayback).toHaveBeenCalled();
  });
});
