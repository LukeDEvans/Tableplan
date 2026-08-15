import { describe, it, expect } from "vitest";
import { makeStation, makeRadioStream, pickStream, streamCandidates, createRadioRegistry, RADIO_CAP } from "../radio.js";
import { createMprProvider } from "../radio-provider-mpr.js";
import { createRadioBrowserProvider } from "../radio-provider-radiobrowser.js";

describe("radio domain", () => {
  it("normalizes a station with multiple stream candidates", () => {
    const st = makeStation({ providerId: "mpr", slug: "yc", name: "YourClassical", streams: [{ url: "https://x/y.aac" }, { url: "http://x/y.mp3" }] });
    expect(st.entity).toBe("station");
    expect(st.id).toBe("mpr:yc");
    expect(st.streams).toHaveLength(2);
    expect(st.streams[0].format).toBe("aac");
    expect(st.streams[1].format).toBe("mp3");
    expect(st.streams[0].isHttps).toBe(true);
    expect(st.streams[1].isHttps).toBe(false);
  });

  it("infers format/mime from url and keeps a user-added flag", () => {
    const s = makeRadioStream({ url: "https://h/stream.mp3" });
    expect(s.format).toBe("mp3");
    expect(s.mimeType).toBe("audio/mpeg");
    expect(makeStation({ userAdded: true, name: "Mine", streams: [{ url: "https://h/s.aac" }] }).userAdded).toBe(true);
  });

  it("pickStream/streamCandidates prefers HTTPS then format order (mp3 fallback first)", () => {
    const st = makeStation({ providerId: "p", slug: "s", streams: [
      { url: "http://h/a.aac" },   // http → deprioritized (mixed content)
      { url: "https://h/b.aac" },
      { url: "https://h/c.mp3" },
    ] });
    const ordered = streamCandidates(st);
    expect(ordered[0].url).toBe("https://h/c.mp3"); // https + mp3 preferred
    expect(ordered[ordered.length - 1].isHttps).toBe(false); // http last
    expect(pickStream(st).url).toBe("https://h/c.mp3");
  });
});

describe("MPR provider — curated catalog", () => {
  it("lists major services and YourClassical specialty streams, offline (no fetch)", async () => {
    const p = createMprProvider();
    const stations = await p.listStations();
    const names = stations.map((s) => s.name);
    expect(names).toContain("MPR News");
    expect(names).toContain("The Current");
    expect(names).toContain("YourClassical MPR");
    expect(names).toContain("Radio Heartland");
    expect(names).toContain("YourClassical Peaceful Piano");
    expect(names).toContain("YourClassical Relax");
    // multi-candidate major service; official CDN host
    const news = stations.find((s) => s.name === "MPR News");
    expect(news.streams.length).toBeGreaterThanOrEqual(2);
    expect(news.streams[0].url).toContain("stream.publicradio.org");
    // YourClassical specialty grouped
    expect(stations.filter((s) => s.programGroup === "YourClassical").length).toBeGreaterThanOrEqual(6);
  });

  it("searches the catalog and degrades now-playing/schedule to null (no scraping)", async () => {
    const p = createMprProvider();
    expect((await p.search("classical")).length).toBeGreaterThan(0);
    expect(await p.nowPlaying()).toBeNull();
    expect(await p.schedule()).toEqual([]);
  });
});

describe("Radio Browser provider — mocked", () => {
  const fake = {
    fetchJson: async (url) => {
      if (url.includes("/stations/search")) return [
        { stationuuid: "u1", name: "Test FM", url_resolved: "https://s/stream", codec: "MP3", bitrate: 128, country: "United States", countrycode: "US", tags: "jazz,chill", favicon: "https://s/i.png" },
        { stationuuid: "u2", name: "No Stream", url_resolved: "", codec: "MP3" }, // dropped (no url)
      ];
      if (url.includes("/stations/bytag/")) return [{ stationuuid: "t1", name: "Tagged", url_resolved: "https://s/t", codec: "AAC" }];
      return [];
    },
  };
  it("maps search results to normalized stations and drops streamless ones", async () => {
    const p = createRadioBrowserProvider({}, fake);
    const res = await p.search("jazz");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("radiobrowser:u1");
    expect(res[0].streams[0]).toMatchObject({ url: "https://s/stream", format: "mp3" });
    expect(res[0].tags).toEqual(["jazz", "chill"]);
  });
  it("supports byTag", async () => {
    const p = createRadioBrowserProvider({}, fake);
    expect((await p.byTag("jazz"))[0].streams[0].format).toBe("aac");
  });
});

describe("radio registry — aggregation + isolation", () => {
  it("lists across providers, isolates a failing one, and reports search status", async () => {
    const boom = { id: "boom", capabilities: new Set([RADIO_CAP.LIST, RADIO_CAP.SEARCH]), async listStations() { throw new Error("down"); }, async search() { throw new Error("down"); } };
    const reg = createRadioRegistry([createMprProvider(), boom]);
    const stations = await reg.listStations();
    expect(stations.some((s) => s.name === "The Current")).toBe(true); // MPR survived boom
    const res = await reg.search("classical");
    expect(res.stations.length).toBeGreaterThan(0);
    expect(res.providerStatuses.find((s) => s.provider === "boom").ok).toBe(false);
  });
  it("nowPlaying returns null when no provider supports it", async () => {
    const reg = createRadioRegistry([createMprProvider()]);
    const st = (await reg.listStations())[0];
    expect(await reg.nowPlaying(st)).toBeNull();
  });
});
