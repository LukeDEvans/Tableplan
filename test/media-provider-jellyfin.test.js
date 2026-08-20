import { describe, it, expect } from "vitest";
import { createJellyfinMediaProvider } from "../media-provider-jellyfin.js";
import { createMediaProviderRegistry } from "../media-provider.js";
import { chooseTarget, playAction, resolvePlaybackTargets } from "../playback-coordinator.js";
import { PLAYBACK_MODE } from "../media-model.js";

const ITEMS = {
  Items: [
    { Id: "m1", Name: "Dune", Type: "Movie", ProductionYear: 2021, ImageTags: { Primary: "t" }, RunTimeTicks: 1552000000000,
      UserData: { IsFavorite: true, PlaybackPositionTicks: 6000000000 } }, // 600s in
    { Id: "s1", Name: "The Bear", Type: "Series", ProductionYear: 2022 },
    { Name: "no id — dropped" },
  ],
};
const cfg = { url: "https://jelly.example.com/", apiKey: "K", userId: "u1" };

describe("createJellyfinMediaProvider", () => {
  const jf = createJellyfinMediaProvider(cfg, { fetchJson: async () => ITEMS });

  it("declares the full in-app contract; unconfigured → unavailable", async () => {
    expect(jf.capabilities.has("nativePlayback")).toBe(true);
    expect(jf.capabilities.has("progress")).toBe(true);
    expect(jf.capabilities.has("library")).toBe(true);
    expect(await createJellyfinMediaProvider({}, {}).isAvailable()).toBe(false);
  });

  it("isAvailable() pings /System/Info/Public", async () => {
    let hit = "";
    const jf2 = createJellyfinMediaProvider(cfg, { fetchJson: async (u) => { hit = u; return {}; } });
    expect(await jf2.isAvailable()).toBe(true);
    expect(hit).toContain("/System/Info/Public");
  });

  it("maps items to canonical video with a direct stream uri + resume progress", async () => {
    const items = await jf.search("dune");
    expect(items).toHaveLength(2); // the id-less item is dropped
    const dune = items[0];
    expect(dune).toMatchObject({ kind: "video", id: "jf_m1", title: "Dune", year: "2021" });
    const ref = dune.providerRefs[0];
    expect(ref.providerId).toBe("jellyfin");
    expect(ref.uri).toContain("/Videos/m1/stream");
    expect(ref.uri).toContain("api_key=K");
    expect(dune.artworkUrl).toContain("/Items/m1/Images/Primary");
    expect(dune.userState.favorite).toBe(true);
    expect(dune.userState.progress).toMatchObject({ kind: "position", position: 600 });
  });
});

describe("Jellyfin result → Playback Coordinator", () => {
  const jf = createJellyfinMediaProvider(cfg, { fetchJson: async () => ITEMS });

  it("CONNECTED → NATIVE in-app playback on the stream uri", async () => {
    const reg = createMediaProviderRegistry([jf], { connectedIds: ["jellyfin"] });
    const item = (await jf.search("dune"))[0];
    const t = chooseTarget(item, reg);
    expect(t.mode).toBe(PLAYBACK_MODE.NATIVE);
    expect(t.uri).toContain("/Videos/m1/stream");
    expect(playAction(item, reg).kind).toBe("play");
  });

  it("NOT connected → no native; falls back to the Jellyfin web deep link", async () => {
    const reg = createMediaProviderRegistry([jf], { connectedIds: [] });
    const t = chooseTarget((await jf.search("dune"))[0], reg);
    expect(t.mode).toBe(PLAYBACK_MODE.DEEPLINK);
    expect(t.uri).toContain("/web/index.html#!/details?id=m1");
  });

  it("Jellyfin native beats a co-located streamer deep link", async () => {
    const reg = createMediaProviderRegistry([jf], { connectedIds: ["jellyfin"] });
    const item = (await jf.search("dune"))[0];
    // add a Netflix ref to the same item → coordinator must still prefer native.
    item.providerRefs.push({ providerId: "netflix", deepLink: "https://netflix.com/1" });
    // netflix isn't in this registry (only jf) → contributes a browser handoff; native still wins.
    expect(resolvePlaybackTargets(item, reg)[0].mode).toBe(PLAYBACK_MODE.NATIVE);
  });
});
