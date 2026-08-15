import { describe, it, expect } from "vitest";
import { createJellyfinSource } from "../music-jellyfin.js";

// A canned Jellyfin API over an injectable fetchJson, keyed by URL substring.
function fakeClient() {
  const calls = [];
  const fetchJson = async (u) => {
    calls.push(u);
    if (u.includes("/System/Info/Public")) return { Version: "10.9.0" };
    if (u.includes("/Items")) {
      return { Items: [
        { Id: "a1", Name: "Prelude", Album: "Suite", AlbumArtist: "Bach", Artists: ["Bach"], RunTimeTicks: 1_500_000_000, IndexNumber: 1, ImageTags: { Primary: "tag" } },
        { Id: "b2", Name: "Solo", Artists: ["Two", "People"], RunTimeTicks: 0, ImageTags: {} },
      ] };
    }
    throw new Error("unexpected url " + u);
  };
  return { fetchJson, calls };
}

const CFG = { url: "https://jf.example.com/", apiKey: "SECRET", userId: "u9" };

describe("createJellyfinSource — configuration", () => {
  it("is unavailable and lists nothing when unconfigured", async () => {
    const s = createJellyfinSource({}, { fetchJson: async () => { throw new Error("should not call"); } });
    expect(s.configured).toBe(false);
    expect(await s.isAvailable()).toBe(false);
    expect(await s.listTracks()).toEqual([]);
  });

  it("reports availability from a System/Info ping", async () => {
    const ok = createJellyfinSource(CFG, fakeClient());
    expect(await ok.isAvailable()).toBe(true);
    const down = createJellyfinSource(CFG, { fetchJson: async () => { throw new Error("ECONNREFUSED"); } });
    expect(await down.isAvailable()).toBe(false);
  });
});

describe("createJellyfinSource — track mapping", () => {
  it("maps Items to normalized tracks (artist fallback, ticks→ms, art URL, locator)", async () => {
    const s = createJellyfinSource(CFG, fakeClient());
    const tracks = await s.listTracks();
    expect(tracks).toHaveLength(2);

    const [a, b] = tracks;
    expect(a.id).toBe("jf_a1");
    expect(a.sourceId).toBe("jellyfin");
    expect(a.title).toBe("Prelude");
    expect(a.artist).toBe("Bach");        // AlbumArtist preferred
    expect(a.album).toBe("Suite");
    expect(a.trackNo).toBe(1);
    expect(a.durationMs).toBe(150000);    // 1.5e9 ticks / 1e4
    expect(a.artworkRef).toMatchObject({ kind: "url" });
    expect(a.artworkRef.url).toContain("/Items/a1/Images/Primary");
    expect(a.artworkRef.url).toContain("api_key=SECRET");
    expect(a.locator).toEqual({ kind: "jellyfin", itemId: "a1" });

    expect(b.artist).toBe("Two, People"); // Artists[] joined when no AlbumArtist
    expect(b.durationMs).toBeNull();       // 0 ticks → null
    expect(b.artworkRef).toBeNull();       // no Primary image tag
  });

  it("hits the user-scoped Items endpoint with the audio filter and key", async () => {
    const c = fakeClient();
    await createJellyfinSource(CFG, c).listTracks();
    const itemsCall = c.calls.find((u) => u.includes("/Items"));
    expect(itemsCall).toContain("/Users/u9/Items");
    expect(itemsCall).toContain("IncludeItemTypes=Audio");
    expect(itemsCall).toContain("Recursive=true");
    expect(itemsCall).toContain("api_key=SECRET");
    // base URL trailing slash is normalized away (no // before Users)
    expect(itemsCall.startsWith("https://jf.example.com/Users")).toBe(true);
  });
});

describe("createJellyfinSource — stream URL", () => {
  it("builds a direct universal audio URL with the item id, user, and key", async () => {
    const s = createJellyfinSource(CFG, fakeClient());
    const url = await s.resolvePlayable({ locator: { kind: "jellyfin", itemId: "a1" } });
    expect(url).toContain("https://jf.example.com/Audio/a1/universal");
    expect(url).toContain("UserId=u9");
    expect(url).toContain("api_key=SECRET");
  });
  it("throws when the track carries no itemId", async () => {
    const s = createJellyfinSource(CFG, fakeClient());
    await expect(s.resolvePlayable({ locator: {} })).rejects.toThrow(/itemId/);
  });
});
