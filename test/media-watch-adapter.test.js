import { describe, it, expect } from "vitest";
import { watchItemToMediaItem, matchProviderId } from "../media-watch-adapter.js";
import { chooseTarget, playAction } from "../playback-coordinator.js";
import { createMediaProviderRegistry } from "../media-provider.js";
import { PLAYBACK_MODE } from "../media-model.js";

const bear = {
  id: "w1", type: "tv", title: "The Bear", tmdbId: 136315, year: "2022", posterPath: "/x.jpg",
  status: "want",
  streamingProviders: { flatrate: [{ provider_name: "Hulu", provider_id: 15 }, { provider_name: "Disney Plus", provider_id: 337 }], link: "https://justwatch.com/bear" },
  seasonProgress: { 1: {}, 2: {} },
};

describe("matchProviderId", () => {
  it("maps display names to catalog ids, slugifies the rest", () => {
    expect(matchProviderId("Netflix")).toBe("netflix");
    expect(matchProviderId("Disney Plus")).toBe("disney");
    expect(matchProviderId("HBO Max")).toBe("max");
    expect(matchProviderId("Paramount+")).toBe("paramount");
    expect(matchProviderId("Amazon Prime Video")).toBe("prime");
    expect(matchProviderId("Some New Service")).toBe("some-new-service");
  });
});

describe("watchItemToMediaItem — wrap, don't migrate", () => {
  const it2 = watchItemToMediaItem(bear);
  it("projects a canonical video item and KEEPS the watchItem on source", () => {
    expect(it2.kind).toBe("video");
    expect(it2.title).toBe("The Bear");
    expect(it2.artworkUrl).toContain("image.tmdb.org");
    expect(it2.source).toBe(bear); // authoritative record preserved — no migration
  });
  it("builds providerRefs from streamingProviders + a TMDB anchor", () => {
    const ids = it2.providerRefs.map((r) => r.providerId);
    expect(ids).toContain("tmdb");
    expect(ids).toContain("disney");
    expect(ids).toContain("hulu");
    const tmdb = it2.providerRefs.find((r) => r.providerId === "tmdb");
    expect(tmdb.externalId).toBe("136315");
  });
  it("maps Watch status/progress into userState (video semantics)", () => {
    expect(it2.userState.saved).toBe(true);              // status "want" = saved
    expect(it2.userState.progress).toMatchObject({ kind: "episodic", season: 2 });
    expect(watchItemToMediaItem({ ...bear, status: "watched" }).userState.progress).toMatchObject({ kind: "completed", completed: true });
  });
});

describe("wrapped Watch item flows through the coordinator", () => {
  it("Disney connected → Play; nothing connected → Open (handoff)", () => {
    const connected = createMediaProviderRegistry(undefined, { connectedIds: ["disney"] });
    // Disney is a commercial streamer → even connected, best is a deep-link handoff.
    expect(playAction(watchItemToMediaItem(bear), connected).kind).toBe("handoff");
    const target = chooseTarget(watchItemToMediaItem(bear), connected);
    expect(target.mode).toBe(PLAYBACK_MODE.DEEPLINK);
  });
});
