import { describe, it, expect } from "vitest";
import { createTmdbProvider } from "../media-provider-tmdb.js";
import { MEDIA_CAP } from "../media-provider.js";

const SEARCH = { results: [
  { id: 438631, type: "movie", title: "Dune", year: "2021", posterPath: "/d.jpg" },
  { id: 136315, type: "tv", title: "The Bear", year: "2022", posterPath: "/b.jpg" },
  { id: null, type: "movie", title: "no id" },
] };
const PROVIDERS = { flatrate: [{ provider_name: "Max", provider_id: 1899 }, { provider_name: "Netflix", provider_id: 8 }], rent: [{ provider_name: "Apple TV", provider_id: 2 }], link: "https://justwatch.com/dune" };

const cfg = {
  searchUrl: (q) => `/api/tmdb-search?q=${encodeURIComponent(q)}`,
  providersUrl: (id, type) => `/api/tmdb-watch-providers?id=${id}&type=${type}`,
};
const fetchJson = async (url) => (url.includes("watch-providers") ? PROVIDERS : SEARCH);

describe("createTmdbProvider — availability aggregator, not a streamer", () => {
  const tmdb = createTmdbProvider(cfg, { fetchJson });

  it("advertises search + availability but NO playback", () => {
    expect(tmdb.capabilities.has(MEDIA_CAP.SEARCH)).toBe(true);
    expect(tmdb.capabilities.has(MEDIA_CAP.AVAILABILITY)).toBe(true);
    expect(tmdb.capabilities.has(MEDIA_CAP.NATIVE_PLAYBACK)).toBe(false);
    expect(tmdb.capabilities.has(MEDIA_CAP.EMBEDDED_PLAYBACK)).toBe(false);
  });
  it("is available only with a search URL builder", async () => {
    expect(await tmdb.isAvailable()).toBe(true);
    expect(await createTmdbProvider({}, { fetchJson }).isAvailable()).toBe(false);
  });

  it("search → canonical video Works with a TMDB anchor + meta.tmdbId", async () => {
    const items = await tmdb.search("dune");
    expect(items).toHaveLength(2); // id-less dropped
    expect(items[0]).toMatchObject({ kind: "video", id: "tmdb_438631", title: "Dune", year: "2021" });
    expect(items[0].meta).toMatchObject({ tmdbId: "438631", tmdbType: "movie" });
    expect(items[0].providerRefs).toEqual([{ providerId: "tmdb", externalId: "438631", uri: null, deepLink: null, available: null }]);
    expect(items[1].subtitle).toBe("TV series");
  });

  it("availability() resolves the actual services (Max/Netflix/Apple TV)", async () => {
    const refs = await tmdb.availability("438631", "movie");
    const ids = refs.map((r) => r.providerId);
    expect(ids).toEqual(["max", "netflix", "appletv"]);
    expect(refs[0].deepLink).toBe("https://justwatch.com/dune");
  });

  it("enrich() folds availability into the item's providerRefs (retains provider identities)", async () => {
    const item = (await tmdb.search("dune"))[0];
    const enriched = await tmdb.enrich(item);
    const ids = enriched.providerRefs.map((r) => r.providerId);
    expect(ids).toContain("tmdb");   // anchor preserved
    expect(ids).toContain("max");
    expect(ids).toContain("netflix");
  });
});
