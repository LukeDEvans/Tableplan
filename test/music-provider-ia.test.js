import { describe, it, expect } from "vitest";
import { createInternetArchiveProvider, createMusopenProvider } from "../music-provider-internetarchive.js";

// A canned Internet Archive API over an injectable fetchJson, keyed by URL.
function client(overrides = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("advancedsearch.php")) {
      return overrides.search || { response: { numFound: 1, docs: [
        { identifier: "bach-cello-suites", title: "Bach: Cello Suites", creator: "Yo-Yo Ma", date: "1983", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/", collection: ["musopen"] },
      ] } };
    }
    if (url.includes("/metadata/")) {
      return overrides.meta || {
        metadata: { title: "Bach: Cello Suite No. 1", creator: "Performer A", composer: "J.S. Bach", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" },
        files: [
          { name: "01 Prelude.mp3", format: "VBR MP3", title: "Prélude", track: "1", length: "2:30", artist: "Performer A" },
          { name: "01 Prelude.ogg", format: "Ogg Vorbis", title: "Prélude", track: "1", length: "150.0" }, // dup of track 1, worse format
          { name: "02 Allemande.mp3", format: "VBR MP3", title: "Allemande", track: "2", length: "247.53" },
          { name: "cover.jpg", format: "JPEG" },                 // not audio
          { name: "bundle.zip", format: "ZIP" },                 // not audio
        ],
      };
    }
    throw new Error("unexpected url " + url);
  };
  return { fetchJson, calls };
}

describe("Internet Archive provider — search", () => {
  it("maps advancedsearch docs to normalized albums with refs, artwork and licence", async () => {
    const c = client();
    const p = createInternetArchiveProvider({}, c);
    const items = await p.search("bach cello");
    expect(items).toHaveLength(1);
    const a = items[0];
    expect(a.entity).toBe("album");
    expect(a.title).toBe("Bach: Cello Suites");
    expect(a.artist).toBe("Yo-Yo Ma");
    expect(a.year).toBe(1983);
    expect(a.artworkUrl).toBe("https://archive.org/services/img/bach-cello-suites");
    expect(a.providerRefs[0]).toMatchObject({ provider: "internetarchive", externalId: "bach-cello-suites" });
    expect(a.license.isPublicDomain).toBe(true);
    // request shape: audio filter + query
    const u = c.calls[0];
    expect(u).toContain("mediatype%3A%28audio%29");
    expect(u).toContain("output=json");
  });

  it("scopes the Musopen variant to the musopen collection", async () => {
    const c = client();
    await createMusopenProvider({}, c).search("beethoven");
    expect(c.calls[0]).toContain("collection%3A%28musopen%29");
  });
});

describe("Internet Archive provider — getItem (tracks)", () => {
  it("builds streamable tracks from audio files, de-dups formats, skips non-audio", async () => {
    const p = createInternetArchiveProvider({}, client());
    const { album, tracks } = await p.getItem("bach-cello-suites");
    expect(tracks).toHaveLength(2);                       // ogg dup + jpg + zip excluded
    expect(album.trackCount).toBe(2);

    const [t1, t2] = tracks;
    expect(t1.trackNo).toBe(1);
    expect(t1.title).toBe("Prélude");
    expect(t1.composer).toMatchObject({ name: "J.S. Bach", role: "composer" });
    expect(t1.durationMs).toBe(150000);                  // "2:30" → 150s
    expect(t1.playable.url).toBe("https://archive.org/download/bach-cello-suites/01%20Prelude.mp3");
    expect(t1.playable.container).toBe("mp3");
    expect(t2.trackNo).toBe(2);
    expect(t2.durationMs).toBe(247530);                  // "247.53" seconds
  });

  it("getPlayable returns the resolved source (or throws)", async () => {
    const p = createInternetArchiveProvider({}, client());
    const { tracks } = await p.getItem("bach-cello-suites");
    expect((await p.getPlayable(tracks[0])).url).toContain("/download/");
    await expect(p.getPlayable({})).rejects.toThrow(/playable/);
  });

  it("yields an empty track list (not a throw) for a ZIP-only bundle", async () => {
    const c = client({ meta: { metadata: { title: "Compressed" }, files: [{ name: "all.zip", format: "ZIP" }] } });
    const p = createInternetArchiveProvider({}, c);
    const { tracks } = await p.getItem("musopen-compressed");
    expect(tracks).toEqual([]);
  });
});
