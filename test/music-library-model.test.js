import { describe, it, expect } from "vitest";
import {
  emptyLibrary, isFavorite, addFavorite, removeFavorite, toggleFavorite, favoritesOfType,
  createPlaylist, deletePlaylist, renamePlaylist, addToPlaylist, removeFromPlaylist, reorderPlaylist,
} from "../music-library-model.js";

const work = { id: "work_1", entity: "work", composer: "Beethoven", title: "Piano Sonata No. 14", catalogId: "op27no2", providerRefs: [{ provider: "ia", externalId: "x" }] };
const recA = { id: "rec_a", entity: "recording", workId: "work_1", title: "Moonlight — Gould", providerRefs: [{ provider: "musopen", externalId: "m1" }] };
const recB = { id: "rec_b", entity: "recording", title: "Clair de Lune", providerRefs: [{ provider: "ia", externalId: "i1" }] };

describe("favorites reference canonical entities", () => {
  it("favorites a Work and a Recording, is idempotent, and survives provider metadata changes", () => {
    let lib = emptyLibrary();
    lib = addFavorite(lib, "work", work);
    lib = addFavorite(lib, "work", work); // idempotent
    lib = addFavorite(lib, "recording", recA);
    expect(lib.favorites).toHaveLength(2);
    expect(isFavorite(lib, "work", work)).toBe(true);

    // A provider changes its id/title on the referenced work — the favorite (by
    // canonical id) is unaffected.
    const changed = { ...work, providerRefs: [{ provider: "ia", externalId: "NEW" }], title: "renamed by provider" };
    expect(isFavorite(lib, "work", changed)).toBe(true); // still favorited (same canonical id)
  });

  it("removes and toggles favorites", () => {
    let lib = addFavorite(emptyLibrary(), "recording", recA);
    lib = removeFavorite(lib, "recording", recA);
    expect(isFavorite(lib, "recording", recA)).toBe(false);
    lib = toggleFavorite(lib, "work", work);
    expect(isFavorite(lib, "work", work)).toBe(true);
    lib = toggleFavorite(lib, "work", work);
    expect(isFavorite(lib, "work", work)).toBe(false);
    expect(favoritesOfType(lib, "work")).toHaveLength(0);
  });
});

describe("playlists mix providers and are provider-independent", () => {
  it("creates a playlist with recordings from different providers", () => {
    let { library, playlist } = createPlaylist(emptyLibrary(), "Morning Piano");
    library = addToPlaylist(library, playlist.id, recA); // musopen
    library = addToPlaylist(library, playlist.id, recB); // internet archive
    library = addToPlaylist(library, playlist.id, recA); // de-duped
    const p = library.playlists[0];
    expect(p.items).toHaveLength(2);
    expect(p.items.map((r) => r.providerRefs[0].provider)).toEqual(["musopen", "ia"]);
  });

  it("reorders, removes, renames, deletes", () => {
    let { library, playlist } = createPlaylist(emptyLibrary(), "P");
    library = addToPlaylist(library, playlist.id, recA);
    library = addToPlaylist(library, playlist.id, recB);
    library = reorderPlaylist(library, playlist.id, 0, 1);
    expect(library.playlists[0].items.map((r) => r.id)).toEqual(["rec_b", "rec_a"]);
    library = removeFromPlaylist(library, playlist.id, 0);
    expect(library.playlists[0].items.map((r) => r.id)).toEqual(["rec_a"]);
    library = renamePlaylist(library, playlist.id, "Renamed");
    expect(library.playlists[0].name).toBe("Renamed");
    library = deletePlaylist(library, playlist.id);
    expect(library.playlists).toHaveLength(0);
  });
});
