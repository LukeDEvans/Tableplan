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

// A fake File whose bytes are a real ID3v2.3 tag (title/artist/album/track + APIC).
function id3File(name, img = new Uint8Array([0xff, 0xd8, 1, 2, 3])) {
  const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  const beU32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const ss = (n) => new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);
  const cat = (...ps) => { const a = ps.map((x) => (x instanceof Uint8Array ? x : new Uint8Array(x))); const o = new Uint8Array(a.reduce((s, p) => s + p.length, 0)); let k = 0; for (const p of a) { o.set(p, k); k += p.length; } return o; };
  const tf = (id, txt) => { const body = cat([3], new TextEncoder().encode(txt)); return cat(ascii(id), beU32(body.length), [0, 0], body); };
  const apic = (() => { const body = cat([0], ascii("image/jpeg"), [0], [3], [0], img); return cat(ascii("APIC"), beU32(body.length), [0, 0], body); })();
  const frames = cat(tf("TIT2", "Real Title"), tf("TPE1", "Real Artist"), tf("TALB", "Real Album"), tf("TRCK", "4"), apic);
  const bytes = cat(ascii("ID3"), [3, 0, 0], ss(frames.length), frames);
  return { name, type: "audio/mpeg", async arrayBuffer() { return bytes.buffer; } };
}

describe("local source — tag & artwork extraction", () => {
  it("reads embedded tags + cover art on import, overriding the filename", async () => {
    const store = createMemoryMusicStore();
    const src = createLocalMusicSource(store);
    const t = await src.importAudioFile(id3File("99 - ignored.mp3"));
    expect(t.title).toBe("Real Title");
    expect(t.artist).toBe("Real Artist");
    expect(t.album).toBe("Real Album");
    expect(t.trackNo).toBe(4);
    expect(t.artworkRef).not.toBeNull();
    const art = await src.getArtworkBytes(t);
    expect(art.mime).toBe("image/jpeg");
    expect([...art.bytes]).toEqual([0xff, 0xd8, 1, 2, 3]);
  });

  it("deleteTrack removes the artwork blob too", async () => {
    const store = createMemoryMusicStore();
    const src = createLocalMusicSource(store);
    const t = await src.importAudioFile(id3File("x.mp3"));
    await src.deleteTrack(t);
    expect(await src.getArtworkBytes(t)).toBeNull();
  });
});

describe("compareTracks — track numbers", () => {
  it("orders by track number within an album (numeric, not lexical)", () => {
    const list = [
      makeTrack({ artist: "A", album: "X", trackNo: 2, title: "b" }),
      makeTrack({ artist: "A", album: "X", trackNo: 10, title: "a" }),
      makeTrack({ artist: "A", album: "X", trackNo: 1, title: "z" }),
    ].sort(compareTracks);
    expect(list.map((t) => t.trackNo)).toEqual([1, 2, 10]);
  });
});
