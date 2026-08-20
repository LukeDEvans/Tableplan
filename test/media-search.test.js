import { describe, it, expect } from "vitest";
import { universalSearch, dedupeItems, eligibleProviders, describeAvailability, enrichWithAvailability } from "../media-search.js";
import { makeMediaItem, PLAYBACK_MODE } from "../media-model.js";
import { createMediaProviderRegistry, MEDIA_CAP } from "../media-provider.js";
import { createYouTubeProvider } from "../media-provider-youtube.js";
import { createJellyfinMediaProvider } from "../media-provider-jellyfin.js";
import { createTmdbProvider } from "../media-provider-tmdb.js";

// A generic fake provider — proves the aggregator is agnostic to implementation.
const fakeProvider = (id, items, { fail = false, search = true, available = true } = {}) => ({
  id, label: id, kind: "video",
  capabilities: new Set(search ? [MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA] : [MEDIA_CAP.METADATA]),
  async isAvailable() { return available; },
  search: search ? (async () => { if (fail) throw new Error(`${id} boom`); return items; }) : undefined,
});
const vid = (id, title, extra = {}) => makeMediaItem({ kind: "video", id, title, providerRefs: [{ providerId: id.split("_")[0], externalId: id }], ...extra });

describe("universalSearch — aggregation & isolation", () => {
  it("no providers → empty result", async () => {
    expect(await universalSearch("dune", { providers: [] })).toMatchObject({ items: [], providerStatuses: [] });
  });
  it("blank query → empty (no provider calls)", async () => {
    let called = false;
    await universalSearch("  ", { providers: [fakeProvider("a", [vid("a_1", "X")])] });
    expect(called).toBe(false); // never awaited a search
  });
  it("one provider → its items", async () => {
    const r = await universalSearch("dune", { providers: [fakeProvider("a", [vid("a_1", "Dune")])] });
    expect(r.items).toHaveLength(1);
    expect(r.providerStatuses).toEqual([{ provider: "a", ok: true, count: 1 }]);
  });
  it("multiple providers → merged, each status reported", async () => {
    const r = await universalSearch("dune", { providers: [
      fakeProvider("a", [vid("a_1", "Dune")]),
      fakeProvider("b", [vid("b_1", "Dune 2"), vid("b_2", "Arrakis")]),
    ] });
    expect(r.items).toHaveLength(3);
    expect(r.providerStatuses.map((s) => s.count)).toEqual([1, 2]);
  });
  it("ONE provider failing does not fail the search (isolation)", async () => {
    const r = await universalSearch("dune", { providers: [
      fakeProvider("ok", [vid("ok_1", "Dune")]),
      fakeProvider("bad", [], { fail: true }),
    ] });
    expect(r.items).toHaveLength(1); // ok survived
    const bad = r.providerStatuses.find((s) => s.provider === "bad");
    expect(bad).toMatchObject({ ok: false, count: 0 });
    expect(bad.error).toMatch(/boom/);
  });
  it("an unavailable provider is skipped with an error status (timeout/unreachable)", async () => {
    const r = await universalSearch("dune", { providers: [fakeProvider("down", [vid("down_1", "X")], { available: false })] });
    expect(r.items).toHaveLength(0);
    expect(r.providerStatuses[0]).toMatchObject({ provider: "down", ok: false });
  });
  it("providers WITHOUT search capability are never queried", async () => {
    const noSearch = fakeProvider("meta", [vid("meta_1", "X")], { search: false });
    expect(eligibleProviders([noSearch])).toEqual([]);
    const r = await universalSearch("dune", { providers: [noSearch] });
    expect(r.providerStatuses).toEqual([]); // not a target
  });
});

describe("dedupe — one content, many provider targets (§9)", () => {
  it("merges the same TMDB id from two providers, unioning providerRefs", () => {
    const fromTmdb = makeMediaItem({ kind: "video", id: "tmdb_438631", title: "Dune", artworkUrl: "art", meta: { tmdbId: "438631" }, providerRefs: [{ providerId: "tmdb", externalId: "438631" }] });
    const fromJelly = makeMediaItem({ kind: "video", id: "jf_9", title: "Dune", meta: { tmdbId: "438631" }, providerRefs: [{ providerId: "jellyfin", externalId: "9", uri: "http://jelly/9" }] });
    const merged = dedupeItems([fromTmdb, fromJelly]);
    expect(merged).toHaveLength(1);
    expect(merged[0].providerRefs.map((r) => r.providerId).sort()).toEqual(["jellyfin", "tmdb"]);
    expect(merged[0].artworkUrl).toBe("art"); // kept the richer metadata
  });
  it("keeps items with different identities separate (no over-merging)", () => {
    expect(dedupeItems([vid("yt_1", "Dune clip"), vid("yt_2", "Other")])).toHaveLength(2);
  });
});

describe("describeAvailability — Your vs Other services, Play vs Open (via coordinator)", () => {
  const reg = createMediaProviderRegistry(undefined, { connectedIds: ["jellyfin"] });
  const item = makeMediaItem({ kind: "video", id: "tmdb_1", title: "Dune", providerRefs: [
    { providerId: "tmdb", externalId: "1" },                              // anchor — excluded
    { providerId: "jellyfin", uri: "http://jelly/1" },                    // connected → yours, play
    { providerId: "netflix", deepLink: "https://netflix.com/1" },         // known, not connected → others, open
    { providerId: "max", deepLink: "https://play.max.com/1" },
  ] });
  const d = describeAvailability(item, reg);

  it("splits connected (yours) from known-but-not (others), excluding the tmdb anchor", () => {
    expect(d.yours.map((e) => e.providerId)).toEqual(["jellyfin"]);
    expect(d.others.map((e) => e.providerId).sort()).toEqual(["max", "netflix"]);
  });
  it("derives Play/Open from the Playback Coordinator (not re-implemented)", () => {
    expect(d.yours[0]).toMatchObject({ action: "play", mode: PLAYBACK_MODE.NATIVE });
    expect(d.others.find((e) => e.providerId === "netflix")).toMatchObject({ action: "handoff", mode: PLAYBACK_MODE.DEEPLINK });
  });
});

describe("real adapters flow through the SAME architecture (§7 — not special-cased)", () => {
  const youtube = createYouTubeProvider({ apiKey: "k" }, { fetchJson: async () => ({ items: [{ id: { videoId: "v1" }, snippet: { title: "Dune featurette", channelTitle: "WB" } }] }) });
  const jellyfin = createJellyfinMediaProvider({ url: "http://jf", apiKey: "K", userId: "u" },
    { fetchJson: async () => ({ Items: [{ Id: "j1", Name: "Dune", Type: "Movie", ProviderIds: { Tmdb: "438631" } }] }) });
  const tmdb = createTmdbProvider({ searchUrl: (q) => `/s?${q}` }, { fetchJson: async () => ({ results: [{ id: 438631, type: "movie", title: "Dune", year: "2021" }] }) });

  it("YouTube + Jellyfin + TMDB aggregate; Jellyfin & TMDB merge on shared tmdbId", async () => {
    const r = await universalSearch("dune", { providers: [youtube, jellyfin, tmdb] });
    expect(r.providerStatuses.map((s) => s.provider).sort()).toEqual(["jellyfin", "tmdb", "youtube"]);
    // youtube (own id) stays separate; jellyfin + tmdb share tmdbId 438631 → 1 merged
    const dune = r.items.find((i) => i.title === "Dune");
    expect(dune.providerRefs.map((x) => x.providerId).sort()).toEqual(["jellyfin", "tmdb"]);
    expect(r.items.some((i) => i.id === "yt_v1")).toBe(true); // youtube separate
  });

  it("enrichWithAvailability folds streamers into the merged TMDB title", async () => {
    const tmdb2 = createTmdbProvider(
      { searchUrl: (q) => `/s?${q}`, providersUrl: () => "/wp" },
      { fetchJson: async (u) => (u === "/wp" ? { flatrate: [{ provider_name: "Max", provider_id: 1 }] } : { results: [{ id: 438631, type: "movie", title: "Dune" }] }) });
    const { items } = await universalSearch("dune", { providers: [tmdb2] });
    const enriched = await enrichWithAvailability(items, tmdb2);
    expect(enriched[0].providerRefs.map((r) => r.providerId)).toContain("max");
  });
});
