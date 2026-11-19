import { describe, it, expect } from "vitest";
import { watchPlace, watchNextFrom, watchOpenSeason, watchStartSeason, watchSeasonPct, watchesFromNow } from "../watch-place.js";

const eps = (n) => Array.from({ length: n }, (_, i) => ({ episodeNumber: i + 1, name: `E${i + 1}` }));
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const tv = (over = {}) => ({ id: "t", type: "tv", seasonProgress: {}, ...over });

describe("watch-place: your place is the last episode you crossed off", () => {
  it("SNL: tick an episode of season 51 → it opens there, next is the one after, nothing before counts", () => {
    const snl = tv({ totalSeasons: 51, seasonProgress: { 51: { episodes: { 3: true } } }, tickAt: { "51:3": "2026-11-01T10:00:00Z" } });
    const ctx = { seasons: range(51), episodesFor: (s) => (s === 51 ? eps(10) : []) };
    expect(watchPlace(snl)).toEqual({ season: 51, episode: 3 });
    expect(watchNextFrom(snl, ctx)).toMatchObject({ season: 51, episode: 4 });
    expect(watchOpenSeason(snl, ctx)).toBe(51);
    expect(watchSeasonPct(snl, ctx)).toBe(10);
  });

  it("the most recent tick wins, even in an earlier season (a rewatch)", () => {
    const show = tv({ totalSeasons: 3, seasonProgress: { 3: { episodes: { 5: true } }, 1: { episodes: { 2: true } } },
      tickAt: { "3:5": "2026-10-01T00:00:00Z", "1:2": "2026-11-01T00:00:00Z" } });
    expect(watchPlace(show)).toEqual({ season: 1, episode: 2 });
    expect(watchNextFrom(show, { seasons: [1, 2, 3], episodesFor: () => eps(8) })).toMatchObject({ season: 1, episode: 3 });
  });

  it("an episode unticked since doesn't count as your place", () => {
    const show = tv({ seasonProgress: { 2: { episodes: { 4: false, 3: true } } }, tickAt: { "2:4": "2026-11-02T00:00:00Z", "2:3": "2026-11-01T00:00:00Z" } });
    expect(watchPlace(show)).toEqual({ season: 2, episode: 3 });
  });

  it("skips episodes already ticked after your place; rolls into the next season at the end", () => {
    const show = tv({ totalSeasons: 2, seasonProgress: { 1: { episodes: { 7: true, 8: true } } }, tickAt: { "1:7": "2026-11-01T00:00:00Z" } });
    expect(watchNextFrom(show, { seasons: [1, 2], episodesFor: () => eps(8) })).toMatchObject({ season: 2, episode: 1 });
  });

  it("caught up: no next, and it opens on your place's season", () => {
    const show = tv({ totalSeasons: 2, seasonProgress: { 2: { episodes: { 8: true } } }, tickAt: { "2:8": "2026-11-01T00:00:00Z" } });
    const ctx = { seasons: [1, 2], episodesFor: () => eps(8) };
    expect(watchNextFrom(show, ctx)).toBeNull();
    expect(watchOpenSeason(show, ctx)).toBe(2);
  });

  it("ticks saved before tick times: the furthest-along tick, and a whole season ticked counts as its end", () => {
    const show = tv({ totalSeasons: 3, seasonProgress: { 1: { watched: true }, 2: { watched: true }, 3: { episodes: { 1: true, 2: true, 3: true, 4: true, 5: true } } } });
    expect(watchPlace(show)).toEqual({ season: 3, episode: 5 });
    expect(watchNextFrom(show, { seasons: [1, 2, 3], episodesFor: (s) => (s === 3 ? eps(8) : []) })).toMatchObject({ season: 3, episode: 6 });
    const wholeSeason = tv({ totalSeasons: 3, seasonProgress: { 2: { watched: true } } });
    expect(watchPlace(wholeSeason)).toEqual({ season: 2, episode: Infinity });
    expect(watchNextFrom(wholeSeason, { seasons: [1, 2, 3] })).toMatchObject({ season: 3, episode: 1, unsure: true });
  });
});

describe("watch-place: a show with nothing crossed off", () => {
  it("story shows open on Season 1", () => {
    const drama = tv({ totalSeasons: 5, showType: "Scripted", lastAiredSeason: 5 });
    expect(watchStartSeason(drama, range(5))).toBe(1);
    expect(watchOpenSeason(drama, { seasons: range(5) })).toBe(1);
    expect(watchSeasonPct(drama, { seasons: range(5) })).toBeNull();
  });

  it("talk / reality / news open on the latest season that's aired (type or genre)", () => {
    const bake = tv({ totalSeasons: 13, showType: "Reality", lastAiredSeason: 12 });
    expect(watchesFromNow(bake)).toBe(true);
    expect(watchOpenSeason(bake, { seasons: range(13) })).toBe(12);
    const snl = tv({ totalSeasons: 51, showType: "Scripted", genreIds: [35, 10767] }); // Talk genre
    expect(watchStartSeason(snl, range(51))).toBe(51);
    expect(watchNextFrom(snl, { seasons: range(51), episodesFor: (s) => (s === 51 ? eps(4) : []) })).toMatchObject({ season: 51, episode: 1 });
  });

  it("without TMDB's type yet it stays on Season 1", () => {
    expect(watchStartSeason(tv({ totalSeasons: 10 }), range(10))).toBe(1);
  });
});
