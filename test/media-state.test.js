import { describe, it, expect } from "vitest";
import {
  toHistoryEntry, fromHistoryEntry, recordPlayback, historyItems,
  progressRatio, progressLabel, isContinuable, continueList,
  makeSavedItem, isSaved, saveItem, unsaveItem, toggleSaved, savedList, SAVED_LIST,
} from "../media-state.js";
import { makeMediaItem, mediaKey } from "../media-model.js";
import { watchItemToMediaItem } from "../media-watch-adapter.js";

const vid = (id, title, extra = {}) => makeMediaItem({ kind: "video", id, title, providerRefs: [{ providerId: "jellyfin", uri: "u" }], ...extra });

describe("history bridge (canonical ⇄ media-history)", () => {
  it("round-trips a MediaItem through a history entry (kind/id/meta/refs preserved)", () => {
    const item = vid("jf_1", "Dune", { subtitle: "Movie", artworkUrl: "a", meta: { tmdbId: "438631" }, userState: { lastAt: 1000 } });
    const e = toHistoryEntry(item);
    expect(e).toMatchObject({ kind: "video", id: "jf_1", title: "Dune", subtitle: "Movie", at: 1000 });
    const back = fromHistoryEntry(e);
    expect(back.kind).toBe("video");
    expect(back.meta.tmdbId).toBe("438631");
    expect(back.providerRefs[0].providerId).toBe("jellyfin");
  });
  it("recordPlayback prepends + de-dupes by kind:id (reuses media-history)", () => {
    let list = [];
    list = recordPlayback(list, vid("jf_1", "Dune"));
    list = recordPlayback(list, vid("yt_2", "Clip"));
    list = recordPlayback(list, vid("jf_1", "Dune (rewatch)")); // same id → moves to front, no dup
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("jf_1");
  });
  it("historyItems returns canonical items, filterable by kind", () => {
    let list = [];
    list = recordPlayback(list, vid("jf_1", "Dune"));
    list = recordPlayback(list, makeMediaItem({ kind: "music", id: "mus_9", title: "Song" }));
    expect(historyItems(list).map((i) => i.kind)).toEqual(["music", "video"]);
    expect(historyItems(list, { kind: "video" })).toHaveLength(1);
  });
});

describe("progress semantics (per-kind, design §12)", () => {
  it("ratio: position/duration, percent, completed, else 0", () => {
    expect(progressRatio({ kind: "position", position: 30, duration: 120 })).toBe(0.25);
    expect(progressRatio({ kind: "percent", percent: 0.6 })).toBe(0.6);
    expect(progressRatio({ completed: true })).toBe(1);
    expect(progressRatio({ kind: "episodic", season: 3 })).toBe(0);
    expect(progressRatio(null)).toBe(0);
  });
  it("label: podcast/audiobook remaining, episodic S/E, live, completed, percent", () => {
    expect(progressLabel({ kind: "position", position: 60, duration: 60 * 32 })).toBe("31 min left");
    expect(progressLabel({ kind: "position", position: 0, duration: 3600 * 4 + 720 })).toBe("4h 12m left");
    expect(progressLabel({ kind: "episodic", season: 3, episode: 4 })).toBe("S3 E4");
    expect(progressLabel({ kind: "live" })).toBe("Live");
    expect(progressLabel({ completed: true })).toBe("Done");
    expect(progressLabel({ kind: "percent", percent: 0.42 })).toBe("42%");
  });
});

describe("Continue", () => {
  const item = (id, progress, lastAt) => makeMediaItem({ kind: "video", id, title: id, userState: { progress, lastAt } });
  it("keeps started-but-unfinished + in-progress series; drops completed/live/unstarted/near-done", () => {
    expect(isContinuable(item("a", { kind: "position", position: 30, duration: 120 }))).toBe(true);
    expect(isContinuable(item("b", { kind: "episodic", season: 2 }))).toBe(true);
    expect(isContinuable(item("c", { completed: true }))).toBe(false);
    expect(isContinuable(item("d", { kind: "live" }))).toBe(false);
    expect(isContinuable(item("e", { kind: "position", position: 0, duration: 120 }))).toBe(false);
    expect(isContinuable(item("f", { kind: "position", position: 119, duration: 120 }))).toBe(false); // ~done
    expect(isContinuable(makeMediaItem({ kind: "video", id: "g", title: "g" }))).toBe(false); // no progress
  });
  it("lists continuable items newest-activity first, honouring limit", () => {
    const items = [
      item("old", { kind: "position", position: 10, duration: 100 }, 100),
      item("new", { kind: "position", position: 10, duration: 100 }, 300),
      item("done", { completed: true }, 999),
    ];
    expect(continueList(items).map((i) => i.id)).toEqual(["new", "old"]);
    expect(continueList(items, { limit: 1 }).map((i) => i.id)).toEqual(["new"]);
  });
});

describe("Saved store (app-owned, cross-provider)", () => {
  const dune = vid("tmdb_438631", "Dune");
  it("makeSavedItem uses mediaKey as id (unions across devices)", () => {
    const s = makeSavedItem(dune, SAVED_LIST.WATCH_LATER);
    expect(s.id).toBe(mediaKey(dune));
    expect(s).toMatchObject({ key: "video:tmdb_438631", list: "watch-later", kind: "video", title: "Dune" });
  });
  it("save is idempotent; isSaved / unsaveItem / toggle work by key + list", () => {
    let saved = saveItem([], dune);
    saved = saveItem(saved, dune);               // idempotent
    expect(saved).toHaveLength(1);
    expect(isSaved(saved, dune)).toBe(true);
    expect(isSaved(saved, "video:tmdb_438631", SAVED_LIST.WATCH_LATER)).toBe(true);
    saved = toggleSaved(saved, dune);            // → removed
    expect(isSaved(saved, dune)).toBe(false);
  });
  it("the same item can live on two lists; savedList filters by list + kind", () => {
    let saved = saveItem([], dune, SAVED_LIST.WATCH_LATER);
    saved = saveItem(saved, dune, SAVED_LIST.FAVORITES);
    saved = saveItem(saved, makeMediaItem({ kind: "music", id: "mus_1", title: "Song" }), SAVED_LIST.LISTEN_LATER);
    expect(saved).toHaveLength(3);
    expect(savedList(saved, { list: SAVED_LIST.FAVORITES })).toHaveLength(1);
    expect(savedList(saved, { kind: "music" }).map((s) => s.title)).toEqual(["Song"]);
    expect(unsaveItem(saved, dune, SAVED_LIST.WATCH_LATER)).toHaveLength(2); // only that list removed
  });
});

describe("integration: real Watch item → Continue + Saved", () => {
  const bear = { id: "w1", type: "tv", title: "The Bear", tmdbId: 136315, status: "want", seasonProgress: { 1: {}, 2: {} } };
  it("a partially-watched series is continuable (episodic), and a want-item can be saved", () => {
    const item = { ...watchItemToMediaItem(bear), userState: { ...watchItemToMediaItem(bear).userState, lastAt: 500 } };
    expect(continueList([item]).map((i) => i.title)).toEqual(["The Bear"]);
    const saved = saveItem([], item, SAVED_LIST.WATCH_LATER);
    expect(isSaved(saved, item)).toBe(true);
  });
});
