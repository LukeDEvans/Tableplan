import { describe, it, expect } from "vitest";
import { emptyLibrary, createPlaylist, deletePlaylist, addToPlaylist, renamePlaylist, addFavorite, removeFavorite, mergeLibraries, normalizeLibrary } from "../music-library-model.js";

const rec = (ext, id = `rec_${ext}_${Math.random()}`) => ({ id, entity: "recording", title: ext, providerRefs: [{ provider: "applemusic", externalId: ext }] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const wait = () => new Promise((r) => setTimeout(r, 5));

describe("mergeLibraries", () => {
  it("an older empty copy can't erase a new playlist (the 2026-11-16 'Bike' loss)", () => {
    let { library: phone, playlist } = createPlaylist(emptyLibrary(), "Bike");
    phone = addToPlaylist(phone, playlist.id, rec("726390516"));
    const laptop = emptyLibrary();
    // either side as "newer"
    expect(mergeLibraries(laptop, phone).playlists.map((p) => p.name)).toEqual(["Bike"]);
    expect(mergeLibraries(phone, laptop).playlists.map((p) => p.name)).toEqual(["Bike"]);
  });

  it("a legacy library without `removed` still merges", () => {
    const legacy = { favorites: [], playlists: [{ id: "pl_1", name: "Old", items: [], updatedAt: "2026-01-01" }] };
    expect(mergeLibraries({ favorites: [], playlists: [] }, legacy).playlists).toHaveLength(1);
  });

  it("a deleted playlist stays deleted when the other copy still has it", async () => {
    const { library: a, playlist } = createPlaylist(emptyLibrary(), "Gone");
    const b = clone(a);
    await wait();
    const deleted = deletePlaylist(a, playlist.id);
    expect(mergeLibraries(b, deleted).playlists).toEqual([]);
    expect(mergeLibraries(deleted, b).playlists).toEqual([]);
  });

  it("a playlist on both sides comes whole from the side that changed it last", async () => {
    const { library: a, playlist } = createPlaylist(emptyLibrary(), "Run");
    const b = clone(a);
    await wait();
    renamePlaylist(b, playlist.id, "Run fast");
    addToPlaylist(b, playlist.id, rec("1"));
    for (const m of [mergeLibraries(a, b), mergeLibraries(b, a)]) {
      expect(m.playlists[0].name).toBe("Run fast");
      expect(m.playlists[0].items).toHaveLength(1);
    }
  });

  it("favourites union; an un-favourite sticks; a later re-favourite wins", async () => {
    const a = addFavorite(emptyLibrary(), "recording", rec("1", "x"));
    const b = addFavorite(clone(a), "recording", rec("2", "y"));
    expect(mergeLibraries(a, b).favorites).toHaveLength(2);
    await wait();
    const un = removeFavorite(clone(b), "recording", rec("1", "x"));
    expect(mergeLibraries(b, un).favorites.map((f) => f.entity.title)).toEqual(["2"]);
    await wait();
    const re = addFavorite(clone(un), "recording", rec("1", "x"));
    expect(mergeLibraries(un, re).favorites).toHaveLength(2);
  });

  it("the same song twice is caught even with different canonical ids", () => {
    let { library, playlist } = createPlaylist(emptyLibrary(), "P");
    library = addToPlaylist(library, playlist.id, rec("726390516", "rec_a"));
    library = addToPlaylist(library, playlist.id, rec("726390516", "rec_b"));
    expect(library.playlists[0].items).toHaveLength(1);
  });

  it("normalizeLibrary keeps `removed`", () => {
    expect(normalizeLibrary({ favorites: [], playlists: [], removed: { "pl:x": "t" } }).removed).toEqual({ "pl:x": "t" });
  });
});
