import { describe, it, expect } from "vitest";
import { DISCOVER_CATEGORIES, categoriesFor, categoryById, resolveGenreId, textMatches, filterSavedLibrary, filterTracks, entityText, greetingFor } from "../music-discover.js";

describe("music-discover categories", () => {
  it("has unique ids and a query for every category", () => {
    const ids = DISCOVER_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DISCOVER_CATEGORIES) { expect(c.query).toBeTruthy(); expect(typeof c.hue).toBe("number"); }
  });
  it("shows only free-source categories without a full catalog", () => {
    const free = categoriesFor({ fullCatalog: false });
    expect(free.every((c) => c.free)).toBe(true);
    expect(free.some((c) => c.id === "classical")).toBe(true);
    expect(free.some((c) => c.id === "pop")).toBe(false);
    expect(categoriesFor({ fullCatalog: true }).length).toBe(DISCOVER_CATEGORIES.length);
  });
  it("resolves genre ids by name from the provider list, else the fallback id", () => {
    const hip = categoryById("hiphop");
    const genres = [{ id: "34", name: "Music" }, { id: "18", name: "Hip-Hop/Rap" }, { id: "14", name: "Pop" }];
    expect(resolveGenreId(hip, genres)).toBe("18");
    expect(resolveGenreId(categoryById("pop"), [{ id: "999", name: "POP" }])).toBe("999");
    // A list without the genre → no id (don't trust a stale fallback)
    expect(resolveGenreId(categoryById("kpop"), genres)).toBe(null);
    // No list at all → fallback
    expect(resolveGenreId(categoryById("kpop"), null)).toBe("51");
    // Mood categories have no genre
    expect(resolveGenreId(categoryById("chill"), genres)).toBe(null);
  });
});

describe("music-discover local search", () => {
  const lib = {
    favorites: [
      { key: "recording:am:1", type: "recording", entity: { title: "Come Together", performers: [{ name: "The Beatles" }], album: "Abbey Road" } },
      { key: "work:x", type: "work", entity: { title: "Piano Sonata No. 14", composer: "Beethoven", catalog: "Op. 27 No. 2" } },
    ],
    playlists: [
      { id: "p1", name: "Road trip", items: [{ title: "Hey Jude", performers: [{ name: "The Beatles" }] }] },
      { id: "p2", name: "Focus", items: [{ title: "Clair de lune", composer: "Debussy" }] },
    ],
  };
  it("matches every word, order-free, accent-insensitive", () => {
    expect(textMatches("Abbey Road The Beatles", "beatles abbey")).toBe(true);
    expect(textMatches("Beyoncé", "beyonce")).toBe(true);
    expect(textMatches("Abbey Road", "beatles abbey")).toBe(false);
  });
  it("filters saved favourites and playlists (by name or by contents)", () => {
    const r = filterSavedLibrary(lib, "beatles");
    expect(r.active).toBe(true);
    expect(r.favorites.map((f) => f.key)).toEqual(["recording:am:1"]);
    expect(r.playlists.map((p) => p.id)).toEqual(["p1"]);
    expect(filterSavedLibrary(lib, "focus").playlists.map((p) => p.id)).toEqual(["p2"]);
    expect(filterSavedLibrary(lib, "beethoven").favorites.map((f) => f.type)).toEqual(["work"]);
    expect(filterSavedLibrary(lib, "  ").active).toBe(false);
  });
  it("filters track lists and builds entity text from any shape", () => {
    const tracks = [{ title: "A", artist: "X", album: "Y" }, { title: "B", artists: [{ name: "Zed" }] }];
    expect(filterTracks(tracks, "zed").map((t) => t.title)).toEqual(["B"]);
    expect(filterTracks(tracks, "").length).toBe(2);
    expect(entityText({ name: "Miles Davis" })).toContain("Miles");
  });
  it("greets by time of day", () => {
    expect(greetingFor(new Date(2026, 0, 1, 9))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 0, 1, 14))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 0, 1, 20))).toBe("Good evening");
  });
});
