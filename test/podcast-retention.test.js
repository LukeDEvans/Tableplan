import { describe, it, expect } from "vitest";
import { keptEpisodeIds, pruneOldEpisodes, mergeFetchedEpisodes, episodeIsRetained, EPISODE_MAX_AGE_MS } from "../podcast-retention.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-06T12:00:00Z");
const ago = (days) => new Date(NOW - days * DAY).toUTCString(); // RFC-822, like a feed's pubDate
const ep = (id, days) => ({ id, title: id, pubDate: ago(days), audioUrl: `https://a/${id}.mp3` });
const show = (...episodes) => ({ id: "s1", title: "Show", episodes });

describe("subscription episodes older than 30 days are not stored", () => {
  it("keeps recent episodes and drops old ones", () => {
    const [out] = pruneOldEpisodes([show(ep("new", 2), ep("edge", 29), ep("old", 31), ep("ancient", 400))], { now: NOW });
    expect(out.episodes.map((e) => e.id)).toEqual(["new", "edge"]);
  });
  it("keeps an old episode the user saved", () => {
    const keepIds = keptEpisodeIds({ podcastSaved: ["old"] }, NOW);
    const [out] = pruneOldEpisodes([show(ep("new", 2), ep("old", 90), ep("other", 90))], { now: NOW, keepIds });
    expect(out.episodes.map((e) => e.id)).toEqual(["new", "old"]);
  });
  it("keeps an old episode added to the queue, or in a playlist", () => {
    const keepIds = keptEpisodeIds({
      mediaQueueAdded: [{ id: "qa_1", ref: "episode:q", kind: "episode", itemId: "q" }, { id: "qa_2", ref: "album:x", kind: "album" }],
      podcastPlaylistItems: { p1: ["pl"] },
      mediaSaved: [{ id: "podcast:later" }, { id: "tmdb:55" }],
    }, NOW);
    expect([...keepIds].sort()).toEqual(["later", "pl", "q"]);
  });
  it("keeps one that was started recently and not finished; not one abandoned long ago or already played", () => {
    const keepIds = keptEpisodeIds({ podcastProgress: {
      inHand: { position: 600, lastPlayedAt: new Date(NOW - 3 * DAY).toISOString() },
      abandoned: { position: 600, lastPlayedAt: new Date(NOW - 45 * DAY).toISOString() },
      played: { position: 600, played: true, lastPlayedAt: new Date(NOW - 1 * DAY).toISOString() },
      untouched: { position: 0 },
    } }, NOW);
    expect([...keepIds]).toEqual(["inHand"]);
  });
  it("an episode with no readable date is kept (its age can't be judged)", () => {
    expect(episodeIsRetained({ id: "x", pubDate: "" }, { now: NOW })).toBe(true);
    expect(episodeIsRetained({ id: "x", pubDate: "not a date" }, { now: NOW })).toBe(true);
  });
  it("returns the same show object when nothing is dropped, and never mutates", () => {
    const s = show(ep("a", 1), ep("b", 60));
    const fresh = show(ep("a", 1));
    expect(pruneOldEpisodes([fresh], { now: NOW })[0]).toBe(fresh);
    pruneOldEpisodes([s], { now: NOW });
    expect(s.episodes).toHaveLength(2);
  });
  it("the cut-off is 30 days", () => { expect(EPISODE_MAX_AGE_MS).toBe(30 * DAY); });
});

describe("a fresh feed replaces the list but never loses a kept episode", () => {
  it("carries over a kept episode the feed no longer lists", () => {
    const merged = mergeFetchedEpisodes([ep("n1", 1), ep("n2", 2)], [ep("n2", 2), ep("savedOld", 300), ep("plainOld", 300)], new Set(["savedOld"]));
    expect(merged.map((e) => e.id)).toEqual(["n1", "n2", "savedOld"]);
  });
  it("does not duplicate a kept episode the feed still lists", () => {
    const merged = mergeFetchedEpisodes([ep("a", 1), ep("k", 40)], [ep("k", 40)], new Set(["k"]));
    expect(merged.map((e) => e.id)).toEqual(["a", "k"]);
  });
});
