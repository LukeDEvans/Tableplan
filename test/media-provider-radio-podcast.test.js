import { describe, it, expect } from "vitest";
import { createRadioMediaProvider } from "../media-provider-radio.js";
import { createPodcastMediaProvider } from "../media-provider-podcast.js";
import { createMediaProviderRegistry, MEDIA_CAP } from "../media-provider.js";
import { chooseTarget, playAction } from "../playback-coordinator.js";
import { PLAYBACK_MODE } from "../media-model.js";

describe("radio media provider", () => {
  const stations = [
    { id: "kexp", name: "KEXP", logoUrl: "logo", genre: "Alternative", country: "US", streams: [{ url: "http://s" }] },
    { id: "nybad" }, // no name → still maps with a fallback title
  ];
  const radio = createRadioMediaProvider({ search: async () => stations });

  it("declares native + live + search; available only with an injected search", async () => {
    expect(radio.capabilities.has(MEDIA_CAP.NATIVE_PLAYBACK)).toBe(true);
    expect(radio.capabilities.has(MEDIA_CAP.LIVE)).toBe(true);
    expect(await radio.isAvailable()).toBe(true);
    expect(await createRadioMediaProvider({}).isAvailable()).toBe(false);
  });

  it("maps stations → canonical RADIO items (live progress, station kept on source)", async () => {
    const items = await radio.search("k");
    expect(items[0]).toMatchObject({ kind: "radio", id: "rad_kexp", title: "KEXP", subtitle: "Alternative · US" });
    expect(items[0].artworkUrl).toBe("logo");
    expect(items[0].source.streams[0].url).toBe("http://s"); // for playRadioStation
    expect(items[0].userState.progress.kind).toBe("live");
    expect(items[1].title).toBe("Station");
  });

  it("resolves to NATIVE in-app playback when radio is connected", async () => {
    const reg = createMediaProviderRegistry([radio], { connectedIds: ["radio"] });
    const item = (await radio.search("k"))[0];
    expect(chooseTarget(item, reg).mode).toBe(PLAYBACK_MODE.NATIVE);
    expect(playAction(item, reg).kind).toBe("play");
  });
});

describe("podcast media provider (iTunes episodes)", () => {
  const RAW = {
    results: [
      { trackId: 1, trackName: "The Case", collectionName: "Reply All", collectionId: 9, episodeUrl: "http://a.mp3", trackTimeMillis: 3600000, artworkUrl600: "art", releaseDate: "2026-01-01" },
      { trackId: 2, trackName: "No Audio", collectionName: "Nope" }, // no audio url → dropped
    ],
  };
  const fetchJson = async (url) => { expect(url).toContain("entity=podcastEpisode"); return RAW; };
  const pod = createPodcastMediaProvider({ fetchJson });

  it("maps episodes → canonical podcast items with a ready-to-play source.episode", async () => {
    const items = await pod.search("reply all");
    expect(items).toHaveLength(1);                 // the audio-less result is dropped
    expect(items[0]).toMatchObject({ kind: "podcast", id: "pod_itunes-ep-1", title: "The Case", subtitle: "Reply All" });
    expect(items[0].meta.episodeId).toBe("itunes-ep-1");
    expect(items[0].source.episode.audioUrl).toBe("http://a.mp3");
    expect(items[0].source.episode.duration).toBe(3600);
    expect(items[0].providerRefs[0].providerId).toBe("podcast"); // plays via the native podcast provider
  });

  it("blank query / no fetch → nothing", async () => {
    expect(await pod.search("  ")).toEqual([]);
    expect(await createPodcastMediaProvider({}).search("x")).toEqual([]);
  });

  it("a podcast search item plays natively when the podcast provider is connected", async () => {
    const podcastNative = { id: "podcast", label: "Podcasts", kind: "podcast", capabilities: new Set([MEDIA_CAP.NATIVE_PLAYBACK]) };
    const reg = createMediaProviderRegistry([podcastNative], { connectedIds: ["podcast"] });
    const item = (await pod.search("x"))[0];
    expect(playAction(item, reg).kind).toBe("play");
  });
});
