import { describe, it, expect } from "vitest";
import { watchItemToMediaItem } from "../media-watch-adapter.js";
import { createMediaProviderRegistry, PROVIDER_CATALOG } from "../media-provider.js";
import { discoverView } from "../media-search.js";

// The exact data path the Watch⇄Media UI merge uses: a Watch item →
// watchItemToMediaItem → discoverView(registry). Proves a Watch card can render
// the same "Your services / Other services" the Discover cards do.
describe("Watch card renders via the hub Coordinator (UI merge data path)", () => {
  const registry = createMediaProviderRegistry(PROVIDER_CATALOG, { connectedIds: ["netflix"] });
  const watchItem = {
    id: "w1", type: "movie", title: "Dune", tmdbId: 438631,
    streamingProviders: { flatrate: [{ provider_name: "Netflix", provider_id: 8 }, { provider_name: "Max", provider_id: 1899 }], link: "https://justwatch/dune" },
    seasonProgress: {},
  };

  it("splits Your (subscribed) vs Other services and marks targets", () => {
    const item = watchItemToMediaItem(watchItem);
    const view = discoverView(item, registry);
    expect(view.hasTargets).toBe(true);
    expect(view.yours.map((e) => e.providerId)).toContain("netflix");   // connected → Your services
    expect(view.others.map((e) => e.providerId)).toContain("max");      // not connected → Other services
  });

  it("Open buttons carry the provider-aware deep link (Netflix title search), not just JustWatch", () => {
    const item = watchItemToMediaItem(watchItem);
    const view = discoverView(item, registry);
    const netflix = view.yours.find((e) => e.providerId === "netflix");
    expect(netflix.uri).toContain("netflix.com/search?q=Dune");
    expect(netflix.action).toBe("handoff"); // streamer = honest hand-off, not in-app
  });

  it("no availability yet → no hub targets (card keeps its bespoke fallback)", () => {
    const bare = watchItemToMediaItem({ id: "w2", type: "movie", title: "Untracked", tmdbId: 1, streamingProviders: null, seasonProgress: {} });
    expect(discoverView(bare, registry).hasTargets).toBe(false);
  });
});
