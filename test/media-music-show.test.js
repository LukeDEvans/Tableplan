// Music shows (AMPLIFIER_DESIGN.md): parsing a playlist newsletter on the
// server, resolving its Apple Music links, the saved record, the sweep's
// choice of path, and the app's pure helpers (bell list, segments, matching).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createRequire } from "module";
import {
  isMusicShow, pendingMusicShows, buildShowSegments, songSpokenIntro, showSubtitle,
  songsMissingIds, pickCatalogSong, normalizeForMatch, catalogSearchPath, segmentIndex,
} from "../media-music-show.js";

const require = createRequire(import.meta.url);
const M = require("../netlify/functions/_music-show.js");
const HTML = readFileSync(new URL("./fixtures/amplifier-newsletter.html", import.meta.url), "utf8");

describe("music show source", () => {
  it("matches The Amplifier from nytimes.com, unless switched off", () => {
    const from = "The New York Times <nytdirect@nytimes.com>";
    expect(M.musicShowSourceFor(from, "The Amplifier: Two cities", {})?.key).toBe("amplifierToListen");
    expect(M.musicShowSourceFor(from, "The Amplifier: Two cities", { amplifierToListen: true })).toBeTruthy();
    expect(M.musicShowSourceFor(from, "The Amplifier: Two cities", { amplifierToListen: false })).toBeNull();
    expect(M.musicShowSourceFor(from, "The Morning: news", {})).toBeNull();
    expect(M.musicShowSourceFor("someone@example.com", "The Amplifier: x", {})).toBeNull();
  });
});

describe("parseMusicShow", () => {
  const show = M.parseMusicShow(HTML);

  it("finds the title, author, length and photo", () => {
    expect(show.title).toBe("Two Cities: a Ballpark Playlist");
    expect(show.author).toBe("Pat Writer");
    expect(show.durationText).toBe("3 songs · 11 min 2 sec");
    expect(show.image).toBe("https://static01.nyt.com/images/2026/10/27/arts/27amp-two-cities/27amp-two-cities-jumbo.jpg");
  });

  it("keeps the intro, from the greeting to the sign-off, with entities decoded", () => {
    expect(show.intro[0]).toBe("Dear listeners,");
    expect(show.intro).toContain("But which city has the edge musically? Today’s playlist will help decide.");
    expect(show.intro).toContain("Older playlists are here & there.");
    expect(show.intro.slice(-2)).toEqual(["Play ball,", "Pat"]);
    expect(show.intro.join(" ")).not.toMatch(/Listen along/);
  });

  it("splits the songs with their write-ups and links", () => {
    expect(show.songs.map((s) => [s.n, s.artist, s.title])).toEqual([
      [1, "The First Band", "Opening Song"],
      [2, "Second Artist", "Rock’n Song"],
      [3, "The Quintet", "Mercy, Mercy (Live)"],
    ]);
    expect(show.songs[0].writeup).toEqual(["A song from the first city, played at the ballpark before Game 1."]);
    expect(show.songs[1].writeup).toHaveLength(2);
    expect(show.songs[0].appleUrl).toBe("https://nl.nytimes.com/f/a/am1~~/AAAA~/a1");
    expect(show.songs[0].spotifyUrl).toContain("sp1");
    expect(show.songs[0].youtubeUrl).toContain("yt1");
    // The track list and footer after "The Amplifier Playlist" aren't write-ups.
    expect(show.songs[2].writeup).toEqual(["A live crossover hit."]);
  });

  it("returns null for a newsletter that isn't a playlist", () => {
    expect(M.parseMusicShow("<h1>Hello</h1><p>Just some news.</p><h3>1. Not a song</h3>")).toBeNull();
    expect(M.parseMusicShow("")).toBeNull();
  });

  it("reads song headings", () => {
    expect(M.parseSongHeading("8. Cannonball Adderley Quintet: “Mercy, Mercy, Mercy (Live)”")).toEqual({ n: 8, artist: "Cannonball Adderley Quintet", title: "Mercy, Mercy, Mercy (Live)" });
    expect(M.parseSongHeading('3. Steve Miller Band: "Rock’n Me"')).toEqual({ n: 3, artist: "Steve Miller Band", title: "Rock’n Me" });
    expect(M.parseSongHeading("Listen along while you read.")).toBeNull();
  });
});

describe("Apple Music links", () => {
  it("reads a song id from Apple Music URLs", () => {
    expect(M.appleSongIdFromUrl("https://music.apple.com/us/album/blister-in-the-sun/1440829406?i=1440829659")).toBe("1440829659");
    expect(M.appleSongIdFromUrl("https://music.apple.com/us/song/blister-in-the-sun/1440829659")).toBe("1440829659");
    expect(M.appleSongIdFromUrl("https://geo.music.apple.com/us/song/1440829659")).toBe("1440829659");
    expect(M.appleSongIdFromUrl("https://music.apple.com/us/album/violent-femmes/1440829406")).toBeNull();
    expect(M.appleSongIdFromUrl("https://evil.example.com/?i=1440829659")).toBeNull();
    expect(M.appleSongIdFromUrl("not a url")).toBeNull();
  });

  const res = (status, { location, body } = {}) => ({
    status,
    headers: { get: (h) => (h.toLowerCase() === "location" ? location || null : null) },
    text: async () => body || "",
  });

  it("follows tracking redirects to the song page", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push([url, opts.redirect]);
      if (url.startsWith("https://nl.nytimes.com/")) return res(302, { location: "https://music.apple.com/us/album/x/123456?i=7654321&at=1" });
      throw new Error("unexpected " + url);
    };
    const r = await M.resolveAppleMusicLink("https://nl.nytimes.com/f/a/am1~~/AAAA~/a1", { fetchImpl });
    expect(r.id).toBe("7654321");
    expect(calls).toEqual([["https://nl.nytimes.com/f/a/am1~~/AAAA~/a1", "manual"]]);
  });

  it("follows a page that points onward (meta refresh)", async () => {
    const fetchImpl = async () => res(200, { body: '<meta http-equiv="refresh" content="0;url=https://music.apple.com/us/song/opening-song/99887766">' });
    const r = await M.resolveAppleMusicLink("https://nl.nytimes.com/f/a/x", { fetchImpl });
    expect(r.id).toBe("99887766");
  });

  it("never fetches hosts off the allowlist, and gives up after a few hops", async () => {
    let n = 0;
    const offList = async () => { n++; return res(302, { location: "https://tracker.example.com/next" }); };
    expect((await M.resolveAppleMusicLink("https://nl.nytimes.com/f/a/x", { fetchImpl: offList })).id).toBeNull();
    expect(n).toBe(1);
    let loops = 0;
    const loop = async () => { loops++; return res(302, { location: "https://nl.nytimes.com/f/a/again" }); };
    expect((await M.resolveAppleMusicLink("https://nl.nytimes.com/f/a/x", { fetchImpl: loop, maxHops: 3 })).id).toBeNull();
    expect(loops).toBe(4);
  });

  it("treats network errors as unresolved, not as failures", async () => {
    const boom = async () => { throw new Error("offline"); };
    expect(await M.resolveAppleMusicLink("https://nl.nytimes.com/f/a/x", { fetchImpl: boom })).toEqual({ id: null, url: "https://nl.nytimes.com/f/a/x" });
  });

  it("resolves every song of a show", async () => {
    const show = M.parseMusicShow(HTML);
    const fetchImpl = async (url) => {
      const m = /am(\d)/.exec(url);
      if (m && m[1] !== "2") return res(301, { location: `https://music.apple.com/us/album/a/1?i=100${m[1]}000` });
      return res(404);
    };
    await M.resolveShowSongs(show, { fetchImpl });
    expect(show.songs.map((s) => s.appleMusicId)).toEqual(["1001000", null, "1003000"]);
    expect(show.songs[0].appleMusicUrl).toContain("music.apple.com");
    expect(show.songs[1].appleMusicUrl).toBe("");
  });
});

describe("the saved article", () => {
  const show = M.parseMusicShow(HTML);
  show.songs.forEach((s, i) => { s.appleMusicId = i === 1 ? null : `id${s.n}`; s.appleMusicUrl = i === 1 ? "" : `https://music.apple.com/us/song/x/${s.n}`; });
  const source = M.MUSIC_SHOW_SOURCES[0];
  const article = M.musicShowArticle(show, source, { messageId: "abc123", subject: "The Amplifier: Two cities", date: "Tue, 27 Oct 2026 19:26:19 +0000" });

  it("is a separate item from the plain article conversion", () => {
    expect(article.id).toBe("show-abc123");
    expect(article.savedAt).toBe("2026-10-27T19:26:19.000Z");
    expect(article.author).toBe("The Amplifier · NYT");
  });

  it("reads as an ordinary article too, with HTML escaped", () => {
    expect(article.text).toContain("<h2>1. The First Band: “Opening Song”</h2>");
    expect(article.text).toContain("<p>Older playlists are here &amp; there.</p>");
    expect(article.text).toContain('href="https://music.apple.com/us/song/x/1"');
    expect(article.text).not.toContain("nl.nytimes.com");
  });

  it("carries the show for the Listen bell", () => {
    const s = article.musicShow;
    expect(s.v).toBe(1);
    expect(s.source).toBe("amplifierToListen");
    expect(s.songs).toHaveLength(3);
    expect(s.songs[1]).toEqual({ n: 2, artist: "Second Artist", title: "Rock’n Song", text: "A classic from the second city.\n\nIt also inspired a famous joke.", appleMusicId: null, appleMusicUrl: "" });
    expect(s.intro.split("\n\n")[0]).toBe("Dear listeners,");
    expect(isMusicShow(article)).toBe(true);
  });

  it("plays in order: intro, then each write-up and its song", () => {
    const segs = buildShowSegments(article, { ids: { 2: "found2" } });
    expect(segs.map((s) => [s.kind, s.id])).toEqual([
      ["speech", "show-abc123#intro"],
      ["speech", "show-abc123#1"], ["appleMusic", "show-abc123#1:song"],
      ["speech", "show-abc123#2"], ["appleMusic", "show-abc123#2:song"],
      ["speech", "show-abc123#3"], ["appleMusic", "show-abc123#3:song"],
    ]);
    expect(segs[0].text.startsWith("Two Cities: a Ballpark Playlist.\n\nBy Pat Writer.\n\nDear listeners,")).toBe(true);
    expect(segs[1].text.startsWith("Number 1: Opening Song, by The First Band.\n\nA song from")).toBe(true);
    expect(segs[2]).toMatchObject({ songId: "id1", title: "Opening Song", subtitle: "The First Band", n: 1 });
    expect(segs[4].songId).toBe("found2");
    expect(segmentIndex(segs, "show-abc123#3")).toBe(5);
  });

  it("still reads a song's write-up when the song can't be found", () => {
    const segs = buildShowSegments(article);
    expect(segs.filter((s) => s.n === 2).map((s) => s.kind)).toEqual(["speech"]);
    expect(songsMissingIds(article).map((s) => s.n)).toEqual([2]);
  });
});

describe("the Listen bell", () => {
  const a = (id, savedAt, show = true) => ({ id, savedAt, ...(show ? { musicShow: { songs: [{ n: 1, title: "x", artist: "y" }] } } : {}) });
  it("lists unfinished shows, newest first, and nothing else", () => {
    const list = [a("show-1", "2026-10-20T00:00:00Z"), a("news-9", "2026-10-28T00:00:00Z", false), a("show-2", "2026-10-27T00:00:00Z"), a("show-3", "2026-10-26T00:00:00Z")];
    expect(pendingMusicShows(list, ["show-3"]).map((x) => x.id)).toEqual(["show-2", "show-1"]);
    expect(pendingMusicShows(null, null)).toEqual([]);
    expect(isMusicShow({ musicShow: { songs: [] } })).toBe(false);
  });

  it("describes a show", () => {
    expect(showSubtitle({ author: "Pat Writer", durationText: "3 songs · 11 min 2 sec", songs: [1, 2, 3] })).toBe("Pat Writer · 3 songs · 11 min 2 sec");
    expect(showSubtitle({ songs: [1] })).toBe("1 song");
    expect(songSpokenIntro({ n: 4, title: "Green and Lucky Blues", artist: "Tampa Red" })).toBe("Number 4: Green and Lucky Blues, by Tampa Red.");
  });
});

describe("matching a song in Apple Music", () => {
  const r = (id, name, artistName) => ({ id, attributes: { name, artistName } });
  it("needs the title and prefers the artist", () => {
    const results = [
      r("1", "Blister in the Sun (Cover)", "Some Cover Band"),
      r("2", "Blister in the Sun", "Violent Femmes"),
      r("3", "Kiss Off", "Violent Femmes"),
    ];
    expect(pickCatalogSong(results, { title: "Blister in the Sun", artist: "Violent Femmes" })).toBe("2");
  });

  it("refuses a title-only match (likely a cover)", () => {
    expect(pickCatalogSong([r("1", "Milwaukee", "Somebody Else")], { title: "Milwaukee", artist: "Al Jarreau" })).toBeNull();
    expect(pickCatalogSong([], { title: "x", artist: "y" })).toBeNull();
  });

  it("copes with live versions, curly quotes and 'the'", () => {
    const results = [
      r("a", "Mercy, Mercy, Mercy", "Cannonball Adderley"),
      r("b", "Mercy, Mercy, Mercy (Live)", "Cannonball Adderley Quintet"),
    ];
    expect(pickCatalogSong(results, { title: "Mercy, Mercy, Mercy (Live)", artist: "Cannonball Adderley Quintet" })).toBe("b");
    expect(pickCatalogSong([r("c", "Rock'n Me", "Steve Miller Band")], { title: "Rock’n Me", artist: "Steve Miller Band" })).toBe("c");
    expect(pickCatalogSong([r("d", "Why Did We Ever Meet", "Promise Ring")], { title: "Why Did We Ever Meet", artist: "The Promise Ring" })).toBe("d");
    expect(normalizeForMatch("Hammer Smashed Face - 2002 Remaster")).toBe("hammer smashed face");
  });

  it("builds the search request", () => {
    expect(catalogSearchPath("US", { artist: "Tampa Red", title: "Green and Lucky Blues" })).toBe("/v1/catalog/us/search?term=Tampa%20Red%20Green%20and%20Lucky%20Blues&types=songs&limit=8");
    expect(catalogSearchPath("bad!", { artist: "a", title: "b" })).toMatch(/^\/v1\/catalog\/us\//);
  });
});
