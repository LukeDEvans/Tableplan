import { describe, it, expect } from "vitest";
import {
  podcastEpisodeToItem, podcastsToContinueItems, podcastSavedToItems,
  musicFavoriteToItem, musicFavoritesToItems,
} from "../media-sources.js";
import { continueList, isContinuable, savedList, saveItem } from "../media-state.js";

const shows = [
  { id: "s1", title: "Reply All", art: "showart", episodes: [
    { id: "e1", title: "The Case", art: "epart1", duration: 3600 },
    { id: "e2", title: "Long Distance", duration: 2400 },
  ] },
  { id: "s2", title: "99% Invisible", art: "s2art", episodes: [
    { id: "e3", title: "The Weather", duration: 1800 },
  ] },
];

describe("podcast source adapter", () => {
  it("maps an episode+progress → canonical podcast item with position progress", () => {
    const item = podcastEpisodeToItem(shows[0].episodes[0], shows[0], { position: 900, duration: 3600, lastPlayedAt: "2026-08-19T00:00:00Z" });
    expect(item).toMatchObject({ kind: "podcast", id: "pod_e1", title: "The Case", subtitle: "Reply All" });
    expect(item.artworkUrl).toBe("epart1");
    expect(item.userState.progress).toMatchObject({ kind: "position", position: 900, duration: 3600 });
    expect(item.source.episode.id).toBe("e1");   // kept for the play bridge
    expect(item.providerRefs[0].providerId).toBe("podcast");
  });

  it("falls back to show art + episode duration when the episode lacks them", () => {
    const item = podcastEpisodeToItem(shows[0].episodes[1], shows[0], null);
    expect(item.artworkUrl).toBe("showart");
    expect(item.userState.progress == null).toBe(true);  // no progress → nothing to resume
    expect(isContinuable(item)).toBe(false);
  });

  it("podcastsToContinueItems returns only in-progress (not played) episodes, and they are continuable", () => {
    const progress = {
      e1: { position: 900, duration: 3600, lastPlayedAt: "2026-08-19T10:00:00Z" }, // 25% → continue
      e2: { position: 2400, duration: 2400, played: true },                        // finished → drop
      e3: { position: 100, duration: 1800, lastPlayedAt: "2026-08-19T12:00:00Z" }, // started → continue
      ghost: { position: 5, duration: 100 },                                       // no such episode → drop
    };
    const items = podcastsToContinueItems(shows, progress);
    expect(items.map((i) => i.id).sort()).toEqual(["pod_e1", "pod_e3"]);
    expect(items.every(isContinuable)).toBe(true);
    // Continue orders newest-activity first (e3 played later than e1)
    expect(continueList(items).map((i) => i.id)).toEqual(["pod_e3", "pod_e1"]);
  });

  it("podcastSavedToItems resolves saved ids → items (carrying progress if any)", () => {
    const items = podcastSavedToItems(shows, ["e3", "e1", "nope"], { e1: { position: 10, duration: 3600 } });
    expect(items.map((i) => i.id)).toEqual(["pod_e3", "pod_e1"]);
    expect(items[1].userState.progress.position).toBe(10);
  });
});

describe("music favourite source adapter", () => {
  it("maps a favourite → canonical music item, keeping the entity for the play bridge", () => {
    const fav = { key: "album:hz-dune", type: "album", entity: { id: "hz-dune", title: "Dune (OST)", artist: "Hans Zimmer", artworkUrl: "art" }, at: "2026-08-01T00:00:00Z" };
    const item = musicFavoriteToItem(fav);
    expect(item).toMatchObject({ kind: "music", id: "mus_fav_album:hz-dune", title: "Dune (OST)", subtitle: "Hans Zimmer" });
    expect(item.meta.favorite).toBe(true);
    expect(item.source.id).toBe("hz-dune"); // entity handed straight to openMusicItem
  });

  it("derives a subtitle from artists[]/performers[] when there is no plain artist", () => {
    const item = musicFavoriteToItem({ key: "t1", type: "recording", entity: { id: "t1", title: "Paul's Dream", artists: [{ name: "Hans Zimmer" }] } });
    expect(item.subtitle).toBe("Hans Zimmer");
  });

  it("musicFavoritesToItems maps the whole library; the items are savable", () => {
    const lib = { favorites: [
      { key: "a", type: "album", entity: { id: "a", title: "A" }, at: "2026-08-02T00:00:00Z" },
      { key: "b", type: "recording", entity: { id: "b", title: "B" }, at: "2026-08-03T00:00:00Z" },
    ] };
    const items = musicFavoritesToItems(lib);
    expect(items.map((i) => i.title)).toEqual(["A", "B"]);
    const saved = saveItem([], items[0], "favorites");
    expect(savedList(saved, { kind: "music" })).toHaveLength(1);
  });
});
