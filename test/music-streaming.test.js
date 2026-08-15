import { describe, it, expect } from "vitest";
import {
  CAP, makeCanonicalTrack, makeCanonicalAlbum, makeLicense, makeProviderRef,
  createMusicProviderRegistry,
} from "../music-streaming.js";

describe("normalized domain", () => {
  it("derives public-domain licence from a CC0/publicdomain url", () => {
    expect(makeLicense({ url: "https://creativecommons.org/publicdomain/zero/1.0/" }).isPublicDomain).toBe(true);
    expect(makeLicense({ url: "https://creativecommons.org/licenses/by/4.0/" }).isPublicDomain).toBe(false);
    expect(makeLicense({}).type).toBe("unknown");
  });

  it("keeps the classical work/composer/movement distinct from the recording", () => {
    const t = makeCanonicalTrack({
      title: "Prélude", composer: "J.S. Bach", movement: "I. Prélude", movementNo: 1,
      work: { title: "Cello Suite No. 1", catalog: "BWV 1007" },
      artists: [{ name: "Performer A", role: "performer" }], provider: "musopen",
    });
    expect(t.composer).toMatchObject({ name: "J.S. Bach", role: "composer" });
    expect(t.work).toEqual({ title: "Cello Suite No. 1", catalog: "BWV 1007" });
    expect(t.artists[0]).toMatchObject({ name: "Performer A", role: "performer" });
    expect(t.license.type).toBe("unknown"); // absent, not assumed
  });

  it("normalizes provider refs and defaults", () => {
    const a = makeCanonicalAlbum({ title: "X", provider: "internetarchive", providerRefs: [{ provider: "internetarchive", externalId: "abc" }] });
    expect(a.entity).toBe("album");
    expect(a.providerRefs[0]).toEqual(makeProviderRef({ provider: "internetarchive", externalId: "abc" }));
  });
});

describe("provider registry — aggregated search isolation", () => {
  const okProvider = (id, items) => ({
    id, capabilities: new Set([CAP.SEARCH]),
    async isAvailable() { return true; },
    async search() { return items; },
  });

  it("merges results across providers and reports per-provider status", async () => {
    const reg = createMusicProviderRegistry([
      okProvider("a", [makeCanonicalAlbum({ title: "A1", provider: "a" })]),
      okProvider("b", [makeCanonicalAlbum({ title: "B1", provider: "b" }), makeCanonicalAlbum({ title: "B2", provider: "b" })]),
    ]);
    const res = await reg.search("bach");
    expect(res.items.map((i) => i.title).sort()).toEqual(["A1", "B1", "B2"]);
    expect(res.providerStatuses).toEqual([
      { provider: "a", ok: true, count: 1 },
      { provider: "b", ok: true, count: 2 },
    ]);
  });

  it("isolates a throwing provider — others still return, failure is reported", async () => {
    const boom = { id: "boom", capabilities: new Set([CAP.SEARCH]), async isAvailable() { return true; }, async search() { throw new Error("rate limited"); } };
    const reg = createMusicProviderRegistry([boom, okProvider("good", [makeCanonicalAlbum({ title: "G", provider: "good" })])]);
    const res = await reg.search("x");
    expect(res.items.map((i) => i.title)).toEqual(["G"]);
    const boomStatus = res.providerStatuses.find((s) => s.provider === "boom");
    expect(boomStatus.ok).toBe(false);
    expect(boomStatus.error).toMatch(/rate limited/);
  });

  it("skips unavailable providers gracefully", async () => {
    const down = { id: "down", capabilities: new Set([CAP.SEARCH]), async isAvailable() { return false; }, async search() { throw new Error("should not be called"); } };
    const reg = createMusicProviderRegistry([down]);
    const res = await reg.search("x");
    expect(res.items).toEqual([]);
    expect(res.providerStatuses[0].ok).toBe(false);
  });

  it("returns empty (not an error) for a blank query", async () => {
    const reg = createMusicProviderRegistry([okProvider("a", [])]);
    const res = await reg.search("   ");
    expect(res.items).toEqual([]);
  });

  it("withCapability filters by advertised capability", () => {
    const reg = createMusicProviderRegistry([
      { id: "s", capabilities: new Set([CAP.SEARCH]) },
      { id: "b", capabilities: new Set([CAP.BROWSE]) },
    ]);
    expect(reg.withCapability(CAP.SEARCH).map((p) => p.id)).toEqual(["s"]);
    expect(reg.withCapability(CAP.BROWSE).map((p) => p.id)).toEqual(["b"]);
  });
});
