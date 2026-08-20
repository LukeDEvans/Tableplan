import { describe, it, expect } from "vitest";
import { createYouTubeProvider } from "../media-provider-youtube.js";
import { createMediaProviderRegistry } from "../media-provider.js";
import { chooseTarget, playAction } from "../playback-coordinator.js";
import { PLAYBACK_MODE } from "../media-model.js";

const SAMPLE = {
  items: [
    { id: { videoId: "abc123" }, snippet: { title: "Dune Trailer", channelTitle: "Warner Bros.", publishedAt: "2021-07-22T00:00:00Z", thumbnails: { medium: { url: "https://i.ytimg.com/abc.jpg" } } } },
    { id: { kind: "youtube#channel" }, snippet: { title: "not a video" } }, // no videoId → dropped
  ],
};
const fetchJson = async () => SAMPLE;

describe("createYouTubeProvider", () => {
  const yt = createYouTubeProvider({ apiKey: "k" }, { fetchJson });

  it("advertises search + embedded playback, and is available with a key", async () => {
    expect(yt.capabilities.has("search")).toBe(true);
    expect(yt.capabilities.has("embeddedPlayback")).toBe(true);
    expect(await yt.isAvailable()).toBe(true);
    expect(await createYouTubeProvider({}, { fetchJson }).isAvailable()).toBe(false); // no key/proxy
  });

  it("maps search hits to canonical MediaItems (embed uri + watch deep link)", async () => {
    const items = await yt.search("dune");
    expect(items).toHaveLength(1); // the channel result is dropped
    expect(items[0]).toMatchObject({ kind: "video", id: "yt_abc123", title: "Dune Trailer", subtitle: "Warner Bros.", year: "2021" });
    const ref = items[0].providerRefs[0];
    expect(ref).toMatchObject({ providerId: "youtube", externalId: "abc123", uri: "https://www.youtube.com/embed/abc123", deepLink: "https://www.youtube.com/watch?v=abc123" });
  });

  it("empty/blank query short-circuits without fetching", async () => {
    let called = false;
    const y = createYouTubeProvider({ apiKey: "k" }, { fetchJson: async () => { called = true; return SAMPLE; } });
    expect(await y.search("   ")).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("YouTube result → Playback Coordinator", () => {
  it("resolves to EMBEDDED in-app playback (no account needed)", async () => {
    const yt = createYouTubeProvider({ apiKey: "k" }, { fetchJson });
    const reg = createMediaProviderRegistry([yt]);       // adapter registered as a provider
    const item = (await yt.search("dune"))[0];
    expect(chooseTarget(item, reg).mode).toBe(PLAYBACK_MODE.EMBEDDED);
    expect(playAction(item, reg).kind).toBe("play");     // in-app
  });
});
