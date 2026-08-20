import { describe, it, expect } from "vitest";
import { makeProvider, hasCapability, createMediaProviderRegistry, PROVIDER_CATALOG, MEDIA_CAP } from "../media-provider.js";

describe("makeProvider", () => {
  it("validates capabilities into a Set, dropping unknown ones", () => {
    const p = makeProvider({ id: "x", capabilities: [MEDIA_CAP.SEARCH, "bogus", MEDIA_CAP.NATIVE_PLAYBACK] });
    expect(hasCapability(p, MEDIA_CAP.SEARCH)).toBe(true);
    expect(hasCapability(p, MEDIA_CAP.NATIVE_PLAYBACK)).toBe(true);
    expect(hasCapability(p, "bogus")).toBe(false);
  });
});

describe("PROVIDER_CATALOG — honest capabilities", () => {
  const reg = createMediaProviderRegistry();
  it("Jellyfin is a full in-app provider", () => {
    const j = reg.get("jellyfin");
    expect(hasCapability(j, MEDIA_CAP.NATIVE_PLAYBACK)).toBe(true);
    expect(hasCapability(j, MEDIA_CAP.PROGRESS)).toBe(true);
    expect(hasCapability(j, MEDIA_CAP.LIBRARY)).toBe(true);
  });
  it("YouTube has embedded playback + search", () => {
    const y = reg.get("youtube");
    expect(hasCapability(y, MEDIA_CAP.EMBEDDED_PLAYBACK)).toBe(true);
    expect(hasCapability(y, MEDIA_CAP.SEARCH)).toBe(true);
  });
  it("commercial streamers have NO search and NO in-app playback — only availability + handoff", () => {
    for (const id of ["netflix", "disney", "max", "paramount", "espn", "xfinity"]) {
      const p = reg.get(id);
      expect(hasCapability(p, MEDIA_CAP.SEARCH)).toBe(false);
      expect(hasCapability(p, MEDIA_CAP.NATIVE_PLAYBACK)).toBe(false);
      expect(hasCapability(p, MEDIA_CAP.EMBEDDED_PLAYBACK)).toBe(false);
      expect(hasCapability(p, MEDIA_CAP.DEEP_LINK)).toBe(true);
      expect(hasCapability(p, MEDIA_CAP.AVAILABILITY)).toBe(true);
    }
  });
  it("TMDB is the availability aggregator that powers video search (not a streamer API)", () => {
    const t = reg.get("tmdb");
    expect(hasCapability(t, MEDIA_CAP.SEARCH)).toBe(true);
    expect(hasCapability(t, MEDIA_CAP.AVAILABILITY)).toBe(true);
    expect(hasCapability(t, MEDIA_CAP.NATIVE_PLAYBACK)).toBe(false);
  });
});

describe("known vs connected", () => {
  it("tracks the user's connected set separately from the known catalog", () => {
    const reg = createMediaProviderRegistry(PROVIDER_CATALOG, { connectedIds: ["jellyfin", "max"] });
    expect(reg.isConnected("jellyfin")).toBe(true);
    expect(reg.isConnected("netflix")).toBe(false);
    expect(reg.connectedProviders().map((p) => p.id).sort()).toEqual(["jellyfin", "max"]);
    reg.setConnected(["youtube"]);
    expect(reg.isConnected("jellyfin")).toBe(false);
    expect(reg.isConnected("youtube")).toBe(true);
  });
  it("searchable() = providers that can query their own catalog", () => {
    const ids = createMediaProviderRegistry().searchable().map((p) => p.id);
    expect(ids).toContain("jellyfin");
    expect(ids).toContain("youtube");
    expect(ids).toContain("tmdb");
    expect(ids).not.toContain("netflix");
  });
});
