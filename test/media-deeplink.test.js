import { describe, it, expect } from "vitest";
import { buildStreamerDeepLink, hasDeepLink } from "../media-deeplink.js";
import { tmdbWatchProvidersToRefs } from "../media-availability.js";

describe("streamer deep links", () => {
  it("builds a provider-specific title search for modelled services", () => {
    expect(buildStreamerDeepLink("netflix", "Dune: Part Two")).toBe("https://www.netflix.com/search?q=Dune%3A%20Part%20Two");
    expect(buildStreamerDeepLink("prime", "Dune")).toBe("https://www.amazon.com/s?k=Dune&i=instant-video");
    expect(hasDeepLink("disney")).toBe(true);
  });
  it("returns null for unmodelled providers or blank titles (caller falls back)", () => {
    expect(buildStreamerDeepLink("someindiestreamer", "Dune")).toBe(null);
    expect(buildStreamerDeepLink("netflix", "  ")).toBe(null);
    expect(hasDeepLink("someindiestreamer")).toBe(false);
  });
});

describe("availability refs prefer the provider deep link, keep JustWatch as fallback", () => {
  const sp = {
    link: "https://www.themoviedb.org/movie/438631/watch",
    flatrate: [{ provider_name: "Netflix", provider_id: 8 }, { provider_name: "Obscure TV", provider_id: 999 }],
  };
  it("known provider → its own deep link; unknown → the JustWatch link; both keep `link`", () => {
    const refs = tmdbWatchProvidersToRefs(sp, { title: "Dune" });
    const netflix = refs.find((r) => r.providerId === "netflix");
    const obscure = refs.find((r) => r.providerId === "obscure-tv");
    expect(netflix.deepLink).toBe("https://www.netflix.com/search?q=Dune");
    expect(obscure.deepLink).toBe(sp.link);       // no template → JustWatch fallback
    expect(netflix.link).toBe(sp.link);            // reference link retained
  });
  it("no title → JustWatch link (unchanged behaviour)", () => {
    const refs = tmdbWatchProvidersToRefs(sp);
    expect(refs.find((r) => r.providerId === "netflix").deepLink).toBe(sp.link);
  });
});
