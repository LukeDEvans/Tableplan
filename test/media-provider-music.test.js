import { describe, it, expect } from "vitest";
import { createMusicMediaProvider } from "../media-provider-music.js";
import { createMediaProviderRegistry } from "../media-provider.js";
import { chooseTarget, playAction } from "../playback-coordinator.js";
import { PLAYBACK_MODE } from "../media-model.js";

// Mimics createMusicProviderRegistry().search(...).items (CanonicalTrack/Album).
const RESULTS = [
  { entity: "album", id: "ia_dune", title: "Dune (OST)", artist: "Hans Zimmer", artworkUrl: "art", provider: "internetarchive" },
  { entity: "track", id: "t9", title: "Paul's Dream", artists: [{ name: "Hans Zimmer" }], album: "Dune", provider: "jamendo" },
];
const search = async () => RESULTS;

describe("createMusicMediaProvider", () => {
  const music = createMusicMediaProvider({ search });

  it("declares native playback + search; available when a search fn is injected", async () => {
    expect(music.capabilities.has("nativePlayback")).toBe(true);
    expect(music.capabilities.has("search")).toBe(true);
    expect(await music.isAvailable()).toBe(true);
    expect(await createMusicMediaProvider({}).isAvailable()).toBe(false);
  });

  it("maps CanonicalTrack/Album → canonical MUSIC items, keeping the source for the play bridge", async () => {
    const items = await music.search("dune");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "music", id: "mus_ia_dune", title: "Dune (OST)", subtitle: "Hans Zimmer" });
    expect(items[0].meta.musicKind).toBe("album");
    expect(items[0].source).toBe(RESULTS[0]);     // original preserved for openMusicItem()
    expect(items[1].meta.musicKind).toBe("track");
    expect(items[1].subtitle).toBe("Hans Zimmer");
    expect(items[0].providerRefs[0].providerId).toBe("music");
  });

  it("blank query → nothing", async () => {
    expect(await music.search("  ")).toEqual([]);
  });
});

describe("music result → Playback Coordinator", () => {
  it("resolves to NATIVE in-app playback (music is always connected)", async () => {
    const music = createMusicMediaProvider({ search });
    const reg = createMediaProviderRegistry([music], { connectedIds: ["music"] });
    const item = (await music.search("dune"))[0];
    expect(chooseTarget(item, reg).mode).toBe(PLAYBACK_MODE.NATIVE);
    expect(playAction(item, reg).kind).toBe("play");
  });
});
