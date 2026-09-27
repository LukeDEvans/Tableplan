import { describe, it, expect } from "vitest";
import { libraryToCsv, importCsvIntoLibrary, parseCsv, csvEscape, decodeRefs, CSV_COLUMNS } from "../music-portable.js";
import { addFavorite, createPlaylist, addToPlaylist, emptyLibrary, favoriteKey } from "../music-library-model.js";
import { deriveRecordingFromRecord } from "../music-canonical.js";
import { makeCanonicalTrack } from "../music-streaming.js";

const appleTrack = (id, title, artist, extra = {}) => makeCanonicalTrack({ id: `applemusic:${id}`, title, artists: [{ name: artist }], album: "Alb", durationMs: 200000, isrc: "USUM71703861", provider: "applemusic", providerRefs: [{ provider: "applemusic", externalId: id }], ...extra });

function sampleLibrary() {
  let lib = emptyLibrary();
  const r1 = deriveRecordingFromRecord(appleTrack("111", "Come Together", "Earth, Wind & Fire"));
  const r2 = deriveRecordingFromRecord(appleTrack("222", 'Say "Hi", ok', "Artist", { isrc: null }));
  lib = addFavorite(lib, "recording", r1);
  lib = addFavorite(lib, "work", { entity: "work", title: "Piano Sonata No. 14", composer: "Beethoven", catalog: "Op. 27 No. 2", catalogId: "op27no2" });
  lib = addFavorite(lib, "album", { entity: "album", title: "Abbey Road", artist: "The Beatles", kind: "album", providerRefs: [{ provider: "applemusic", externalId: "al9" }] });
  lib = addFavorite(lib, "artist", { name: "Miles Davis" });
  const made = createPlaylist(lib, "Road, trip"); lib = made.library;
  lib = addToPlaylist(lib, made.playlist.id, r1);
  lib = addToPlaylist(lib, made.playlist.id, r2);
  lib = createPlaylist(lib, "Empty one").library;
  return lib;
}

describe("CSV primitives", () => {
  it("escapes and parses quotes, commas, newlines, BOM", () => {
    const line = ["a,b", 'say "x"', "multi\nline", "plain"].map(csvEscape).join(",");
    expect(parseCsv("﻿h1,h2,h3,h4\r\n" + line + "\r\n")).toEqual([["h1", "h2", "h3", "h4"], ["a,b", 'say "x"', "multi\nline", "plain"]]);
  });
  it("guards spreadsheet formulas but not negative numbers", () => {
    expect(csvEscape("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvEscape("-5")).toBe("-5");
  });
  it("decodes provider refs whose ids contain colons", () => {
    expect(decodeRefs("applemusic:1 | spotify:spotify:track:abc")).toEqual([
      { provider: "applemusic", externalId: "1", url: null, collection: null },
      { provider: "spotify", externalId: "spotify:track:abc", url: null, collection: null },
    ]);
  });
});

describe("library ⇄ CSV round trip", () => {
  it("exports a header and one row per favourite / playlist entry", () => {
    const csv = libraryToCsv(sampleLibrary());
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.length).toBe(1 + 4 + 2 + 1); // 4 favourites, 2 items, 1 empty-playlist marker
  });

  it("re-imports into an empty library preserving favourite keys, playlists, order, ISRC and refs", () => {
    const src = sampleLibrary();
    const { library, stats } = importCsvIntoLibrary(emptyLibrary(), libraryToCsv(src));
    expect(stats).toMatchObject({ favorites: 4, playlists: 2, items: 2 });
    expect(library.favorites.map((f) => f.key).sort()).toEqual(src.favorites.map((f) => f.key).sort());
    const pl = library.playlists.find((p) => p.name === "Road, trip");
    expect(pl.items.map((i) => i.title)).toEqual(["Come Together", 'Say "Hi", ok']);
    expect(pl.items[0].isrc).toBe("USUM71703861");
    expect(pl.items[0].performers[0].name).toBe("Earth, Wind & Fire"); // our own format: artist kept whole
    expect(pl.items[0].providerRefs[0]).toMatchObject({ provider: "applemusic", externalId: "111" });
    expect(library.playlists.some((p) => p.name === "Empty one")).toBe(true);
    const work = library.favorites.find((f) => f.type === "work");
    expect(work.key).toBe(favoriteKey("work", { composer: "Beethoven", catalogId: "op27no2" }));
  });

  it("merging the same file twice adds nothing", () => {
    const csv = libraryToCsv(sampleLibrary());
    const once = importCsvIntoLibrary(emptyLibrary(), csv).library;
    const twice = importCsvIntoLibrary(once, csv);
    expect(twice.stats).toMatchObject({ favorites: 0, playlists: 0, items: 0 });
  });

  it("importing into the ORIGINAL library matches playlists by id and de-dupes", () => {
    const src = sampleLibrary();
    const r = importCsvIntoLibrary(src, libraryToCsv(src));
    expect(r.stats).toMatchObject({ favorites: 0, playlists: 0, items: 0 });
  });
});

describe("foreign CSV import (Exportify-style)", () => {
  const exportify = [
    '"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)","ISRC"',
    '"spotify:track:4uLU6hMCjMI75M1A2tKUQC","Never Gonna Give You Up","Rick Astley","Whenever You Need Somebody","213573","GBARL9300135"',
    '"spotify:track:7ouMYWpwJ422jRcDASZB7P","Knights of Cydonia","Muse, Someone Else","Black Holes","366213","GBAHT0600263"',
  ].join("\n");
  it("becomes a playlist named after the file, with Spotify refs + ISRC", () => {
    const { library, stats } = importCsvIntoLibrary(emptyLibrary(), exportify, { fileName: "Gym Mix.csv" });
    expect(stats).toMatchObject({ playlists: 1, items: 2 });
    const pl = library.playlists[0];
    expect(pl.name).toBe("Gym Mix");
    expect(pl.items[0]).toMatchObject({ title: "Never Gonna Give You Up", isrc: "GBARL9300135", durationMs: 213573 });
    expect(pl.items[0].providerRefs[0]).toMatchObject({ provider: "spotify", externalId: "4uLU6hMCjMI75M1A2tKUQC" });
    expect(pl.items[1].performers.map((p) => p.name)).toEqual(["Muse", "Someone Else"]);
  });
  it("skips files with no usable columns", () => {
    const r = importCsvIntoLibrary(emptyLibrary(), "foo,bar\n1,2\n");
    expect(r.stats.skipped).toBe(1);
    expect(r.library.playlists.length).toBe(0);
  });
});
