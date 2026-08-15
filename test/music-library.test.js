import { describe, it, expect } from "vitest";
import {
  titleFromFilename, makeTrack, compareTracks,
  createMemoryMusicStore, createLocalMusicSource, createMusicLibrary,
} from "../music-library.js";

// A minimal File stand-in (Node has no File): just needs name/type/arrayBuffer.
function fakeFile(name, bytes = [1, 2, 3], type = "audio/mpeg") {
  return { name, type, async arrayBuffer() { return new Uint8Array(bytes).buffer; } };
}

describe("titleFromFilename", () => {
  it("drops extension, separators, and a leading track number", () => {
    expect(titleFromFilename("07 - Clair_de_lune.mp3")).toBe("Clair de lune");
    expect(titleFromFilename("My Song.m4a")).toBe("My Song");
    expect(titleFromFilename("03.Intro.flac")).toBe("Intro");
    expect(titleFromFilename("")).toBe("Untitled");
  });
});

describe("makeTrack normalization", () => {
  it("defaults source to local, coerces duration, keeps locator opaque", () => {
    const t = makeTrack({ title: "X", durationMs: "1500", locator: { kind: "blob", blobId: "b1" } });
    expect(t.entity).toBe("musicTrack");
    expect(t.id).toMatch(/^trk_/);
    expect(t.sourceId).toBe("local");
    expect(t.durationMs).toBe(1500);
    expect(t.locator).toEqual({ kind: "blob", blobId: "b1" });
  });
  it("nulls a non-numeric duration and a bad locator", () => {
    const t = makeTrack({ durationMs: "nope", locator: "oops" });
    expect(t.durationMs).toBeNull();
    expect(t.locator).toBeNull();
  });
});

describe("compareTracks", () => {
  it("orders by artist, then album, then title", () => {
    const list = [
      makeTrack({ artist: "B", title: "z" }),
      makeTrack({ artist: "A", album: "2", title: "a" }),
      makeTrack({ artist: "A", album: "1", title: "b" }),
    ].sort(compareTracks);
    expect(list.map((t) => `${t.artist}${t.album}${t.title}`)).toEqual(["A1b", "A2a", "Bz"]);
  });
});

describe("local source — import & round-trip", () => {
  it("stores bytes + a track record and lists it back", async () => {
    const store = createMemoryMusicStore();
    const src = createLocalMusicSource(store);
    const track = await src.importAudioFile(fakeFile("01 - Song.mp3", [9, 9, 9]));
    expect(track.sourceId).toBe("local");
    expect(track.title).toBe("Song");
    expect(track.locator.blobId).toBe(track.id);
    const audio = await store.get("audio", track.id);
    expect(audio.bytes).toEqual(new Uint8Array([9, 9, 9]));
    const listed = await src.listTracks();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(track.id);
  });

  it("runs the injected duration probe when given one", async () => {
    const store = createMemoryMusicStore();
    const src = createLocalMusicSource(store);
    const track = await src.importAudioFile(fakeFile("t.mp3"), { probeDurationMs: async () => 42000 });
    expect(track.durationMs).toBe(42000);
  });

  it("delete removes both the bytes and the record", async () => {
    const store = createMemoryMusicStore();
    const src = createLocalMusicSource(store);
    const track = await src.importAudioFile(fakeFile("t.mp3"));
    await src.deleteTrack(track);
    expect(await store.get("audio", track.id)).toBeUndefined();
    expect(await src.listTracks()).toHaveLength(0);
  });
});

describe("library — source registry", () => {
  it("merges tracks across sources and routes resolve by sourceId", async () => {
    const store = createMemoryMusicStore();
    const local = createLocalMusicSource(store);
    await local.importAudioFile(fakeFile("Local Tune.mp3"));

    // A stub remote source proves the same-contract extension point works.
    const remoteTrack = makeTrack({ id: "r1", sourceId: "remote", title: "Remote Tune", locator: { kind: "url", url: "http://x/y" } });
    let resolvedFrom = null;
    const remote = {
      id: "remote", label: "Server",
      async isAvailable() { return true; },
      async listTracks() { return [remoteTrack]; },
      async resolvePlayable(t) { resolvedFrom = "remote"; return remoteTrack.locator.url; },
    };

    const lib = createMusicLibrary({ sources: [local, remote] });
    const all = await lib.listAllTracks();
    expect(all.map((t) => t.title).sort()).toEqual(["Local Tune", "Remote Tune"]);

    const url = await lib.resolvePlayable(remoteTrack);
    expect(url).toBe("http://x/y");
    expect(resolvedFrom).toBe("remote");
  });

  it("an unavailable source contributes nothing but doesn't break the list", async () => {
    const store = createMemoryMusicStore();
    const local = createLocalMusicSource(store);
    await local.importAudioFile(fakeFile("Only Local.mp3"));
    const down = { id: "down", async isAvailable() { return false; }, async listTracks() { throw new Error("unreachable"); }, async resolvePlayable() {} };
    const lib = createMusicLibrary({ sources: [local, down] });
    const all = await lib.listAllTracks();
    expect(all.map((t) => t.title)).toEqual(["Only Local"]);
  });

  it("imports always land in the local source", async () => {
    const store = createMemoryMusicStore();
    const lib = createMusicLibrary({ sources: [createLocalMusicSource(store)] });
    const t = await lib.importAudioFile(fakeFile("Added.mp3"));
    expect(t.sourceId).toBe("local");
    expect((await lib.listAllTracks()).map((x) => x.title)).toEqual(["Added"]);
  });
});
