// Listen's Best result and artist pages (LISTEN_SEARCH_DESIGN.md): the pure
// helpers, and the Apple Music provider's topResults + artist paging.
import { describe, it, expect } from "vitest";
import { pickBestMusicResult, mergeArtistSongs, pageParams, namesMatch, songKey } from "../music-search-best.js";
import { createAppleMusicProvider } from "../music-provider-applemusic.js";

const track = (id, title, artist = "A", isrc = null) => ({ entity: "track", id, title, artists: [{ name: artist }], isrc });
const artist = (id, title) => ({ entity: "album", kind: "artist", id, title });
const album = (id, title) => ({ entity: "album", kind: "album", id, title });

describe("pickBestMusicResult", () => {
  it("takes the item the provider marked", () => {
    const items = [track("t1", "drivers license"), album("a1", "SOUR"), { ...artist("r1", "Olivia Rodrigo"), bestMatch: true }];
    expect(pickBestMusicResult("olivia", items).id).toBe("r1");
  });
  it("without a mark, an artist named like the query beats the songs listed first", () => {
    const items = [track("t1", "good 4 u", "Olivia Rodrigo"), track("t2", "vampire", "Olivia Rodrigo"), album("a1", "GUTS"), artist("r1", "Olivia Rodrigo")];
    expect(pickBestMusicResult("Olivia Rodrigo", items).id).toBe("r1");
  });
  it("matches ignoring case, accents, '&' and a leading 'The'", () => {
    expect(namesMatch("Mumford & Sons", "mumford and sons")).toBe(true);
    expect(namesMatch("Beyoncé", "beyonce")).toBe(true);
    expect(namesMatch("The Beatles", "beatles")).toBe(true);
    expect(namesMatch("Olivia", "Olivia Rodrigo")).toBe(false);
  });
  it("then an album with that name, then the first song, else the first item", () => {
    expect(pickBestMusicResult("guts", [track("t1", "x"), album("a1", "GUTS")]).id).toBe("a1");
    expect(pickBestMusicResult("zzz", [album("a1", "Other"), track("t1", "x")]).id).toBe("t1");
    expect(pickBestMusicResult("zzz", [album("a1", "Other")]).id).toBe("a1");
    expect(pickBestMusicResult("zzz", [])).toBe(null);
  });
});

describe("mergeArtistSongs", () => {
  it("adds new songs and skips ones already listed (ISRC, else title + artist)", () => {
    const first = [track("1", "Little Lion Man", "Mumford & Sons", "GBUM70900001"), track("2", "The Cave", "Mumford & Sons")];
    const next = [
      track("9", "Little Lion Man (single)", "Mumford & Sons", "GBUM70900001"), // same recording
      track("10", "the cave", "Mumford & Sons"),                               // same title + artist
      track("11", "I Will Wait", "Mumford & Sons"),
    ];
    const out = mergeArtistSongs(first, next);
    expect(out.map((t) => t.id)).toEqual(["1", "2", "11"]);
    expect(first).toHaveLength(2); // inputs untouched
  });
  it("keys songs", () => {
    expect(songKey(track("1", "A", "B", "X1"))).toBe("isrc:X1");
    expect(songKey(track("1", "Hey There", "B"))).toBe("t:hey there|b");
  });
});

describe("pageParams", () => {
  it("splits a next link into path and params", () => {
    expect(pageParams("/v1/catalog/us/artists/1/albums?offset=10&limit=10")).toEqual({ path: "/v1/catalog/us/artists/1/albums", params: { offset: "10", limit: "10" } });
    expect(pageParams("/v1/catalog/us/artists/1/view/singles")).toEqual({ path: "/v1/catalog/us/artists/1/view/singles", params: {} });
  });
  it("refuses anything that isn't an Apple API path", () => {
    expect(pageParams("https://evil.example/x")).toBe(null);
    expect(pageParams(null)).toBe(null);
  });
});

// A fake MusicKit instance answering by path.
function fakeMusic(routes) {
  const calls = [];
  return {
    calls,
    storefrontId: "us",
    api: {
      music: async (path, params) => {
        calls.push([path, params || {}]);
        const key = Object.keys(routes).find((k) => (k.endsWith("$") ? path === k.slice(0, -1) : path.startsWith(k)));
        if (!key) throw new Error(`404 ${path}`);
        const r = routes[key];
        return typeof r === "function" ? r(path, params || {}) : r;
      },
    },
  };
}
const provider = (music) => createAppleMusicProvider({ storefront: "us" }, { getInstance: async () => music });
const songRes = (id, name, artistName = "Mumford & Sons", extra = {}) => ({ id, type: "songs", attributes: { name, artistName, ...extra } });

describe("Apple Music search: Best result", () => {
  it("asks for topResults and marks Apple's first top hit", async () => {
    const music = fakeMusic({
      "/v1/catalog/us/search": { data: { results: {
        songs: { data: [songRes("s1", "drivers license", "Olivia Rodrigo")] },
        artists: { data: [{ id: "r1", type: "artists", attributes: { name: "Olivia Rodrigo" } }] },
        top: { data: [{ id: "r1", type: "artists", attributes: { name: "Olivia Rodrigo" } }, songRes("s1", "drivers license", "Olivia Rodrigo")] },
      } } },
    });
    const items = await provider(music).search("olivia rodrigo");
    expect(music.calls[0][1].with).toBe("topResults");
    expect(items[0].entity).toBe("track"); // the list stays songs-first
    const best = items.filter((i) => i.bestMatch);
    expect(best.map((i) => i.id)).toEqual(["applemusic:r1"]);
    expect(pickBestMusicResult("olivia rodrigo", items).title).toBe("Olivia Rodrigo");
  });
  it("adds the top hit when it isn't among the typed results", async () => {
    const music = fakeMusic({
      "/v1/catalog/us/search": { data: { results: {
        songs: { data: [songRes("s1", "x")] },
        top: { data: [{ id: "al9", type: "albums", attributes: { name: "Babel", artistName: "Mumford & Sons" } }] },
      } } },
    });
    const items = await provider(music).search("babel");
    expect(items[0]).toMatchObject({ id: "applemusic:al9", bestMatch: true, kind: "album" });
    expect(items).toHaveLength(2);
  });
  it("no top results → nothing marked (the app's fallback picks)", async () => {
    const music = fakeMusic({ "/v1/catalog/us/search": { data: { results: { songs: { data: [songRes("s1", "x")] } } } } });
    const items = await provider(music).search("x");
    expect(items.some((i) => i.bestMatch)).toBe(false);
  });
});

describe("Apple Music artist pages", () => {
  const base = "/v1/catalog/us/artists/42";
  const albumRes = (id, name, releaseDate) => ({ id, type: "albums", attributes: { name, artistName: "Mumford & Sons", releaseDate } });

  it("loads top songs, albums and singles, and starts All songs from the artist's albums", async () => {
    const music = fakeMusic({
      [`${base}$`]: { data: { data: [{ id: "42", type: "artists", attributes: { name: "Mumford & Sons" } }] } },
      [`${base}/view/top-songs`]: { data: { data: [songRes("s1", "I Will Wait")] } },
      [`${base}/view/full-albums`]: { data: { data: [albumRes("a1", "Babel", "2012-09-24")], next: `${base}/view/full-albums?offset=25` } },
      [`${base}/view/singles`]: { data: { data: [albumRes("x1", "Rushmere", "2023-01-20")] } },
    });
    const item = await provider(music).getItem({ entity: "album", kind: "artist", id: "applemusic:42", providerRefs: [{ provider: "applemusic", externalId: "42" }] });
    expect(item.tracks.map((t) => t.title)).toEqual(["I Will Wait"]);
    expect(item.artistPage).toMatchObject({ artistName: "Mumford & Sons", albumsNext: `${base}/view/full-albums?offset=25`, singlesNext: null, songs: [] });
    expect(item.artistPage.albums.map((a) => a.title)).toEqual(["Babel"]);
    expect(item.artistPage.singles.map((a) => a.title)).toEqual(["Rushmere"]);
    expect(item.artistPage.songsNext).toBe(`${base}/albums?limit=10`);
  });

  it("a failed albums view leaves that section empty, not the page", async () => {
    const music = fakeMusic({
      [`${base}$`]: { data: { data: [{ id: "42", type: "artists", attributes: { name: "M" } }] } },
      [`${base}/view/top-songs`]: { data: { data: [songRes("s1", "a")] } },
    });
    const item = await provider(music).getItem({ entity: "album", kind: "artist", id: "applemusic:42", providerRefs: [{ provider: "applemusic", externalId: "42" }] });
    expect(item.tracks).toHaveLength(1);
    expect(item.artistPage.albums).toEqual([]);
    expect(item.artistPage.singles).toEqual([]);
  });

  it("pages albums and singles by the next link", async () => {
    const music = fakeMusic({ [`${base}/view/full-albums`]: { data: { data: [albumRes("a2", "Delta", "2018-11-16")] } } });
    const res = await provider(music).getArtistMore("albums", `${base}/view/full-albums?offset=25&limit=25`);
    expect(music.calls[0]).toEqual([`${base}/view/full-albums`, { offset: "25", limit: "25" }]);
    expect(res).toMatchObject({ next: null });
    expect(res.items.map((a) => a.title)).toEqual(["Delta"]);
  });

  it("All songs: the next albums' tracks, newest album first, the artist's own songs only", async () => {
    const music = fakeMusic({
      [`${base}/albums`]: { data: { data: [{ id: "a1" }, { id: "a2" }], next: `${base}/albums?offset=10&limit=10` } },
      "/v1/catalog/us/albums": (path, params) => {
        expect(params).toEqual({ ids: "a1,a2", include: "tracks" });
        return { data: { data: [
          { ...albumRes("a1", "Sigh No More", "2009-10-02"), relationships: { tracks: { data: [songRes("s1", "Little Lion Man"), songRes("v1", "Video", "Mumford & Sons", {})].map((t, i) => (i === 1 ? { ...t, type: "music-videos" } : t)) } } },
          { ...albumRes("a2", "A Compilation", "2020-01-01"), relationships: { tracks: { data: [songRes("s2", "Guiding Light"), songRes("s3", "Someone Else's Song", "Other Band"), songRes("s4", "Duet", "Mumford & Sons & Baaba Maal")] } } },
        ] } };
      },
    });
    const res = await provider(music).getArtistMore("songs", `${base}/albums?limit=10`, { artistName: "Mumford & Sons" });
    expect(res.next).toBe(`${base}/albums?offset=10&limit=10`);
    expect(res.tracks.map((t) => t.title)).toEqual(["Guiding Light", "Duet", "Little Lion Man"]);
  });

  it("a bad link does no request", async () => {
    const music = fakeMusic({});
    expect(await provider(music).getArtistMore("songs", "https://x/y")).toEqual({ tracks: [], next: null });
    expect(music.calls).toHaveLength(0);
  });
});
