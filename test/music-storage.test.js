import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMemoryStorage, hasLocalBytes } from "../music/storage.js";
import { importMusicXmlFile, loadWork, listWorks } from "../music/import.js";
import { blobAvailability } from "../music/blob.js";

const fixtureBytes = () => new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/simple-4-4.musicxml", import.meta.url))));

describe("StoragePort — in-memory fake", () => {
  it("round-trips records and bytes across named stores", async () => {
    const s = createMemoryStorage();
    await s.put("works", "w1", { id: "w1", title: "Test" });
    await s.put("bytes", "blob_1", { bytes: new Uint8Array([1, 2, 3]), mimeType: "x" });
    expect(await s.get("works", "w1")).toEqual({ id: "w1", title: "Test" });
    expect((await s.get("bytes", "blob_1")).bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.has("bytes", "blob_1")).toBe(true);
    expect(await s.getAll("works")).toHaveLength(1);
    await s.delete("works", "w1");
    expect(await s.has("works", "w1")).toBe(false);
  });
});

describe("import pipeline → offline reload", () => {
  it("imports a MusicXML file into the canonical spine and stores it owned+local", async () => {
    const s = createMemoryStorage();
    const res = await importMusicXmlFile({ name: "Clair de lune.musicxml", bytes: fixtureBytes() }, s, { composer: "Debussy" });

    expect(res.work.title).toBe("Clair de lune");
    expect(res.work.composer).toBe("Debussy");
    expect(res.work.editions[0].representations[0].blobId).toBe(res.blobId);
    expect(res.representation.measureIdentity.ids).toHaveLength(2); // one id per measure
    expect(res.model.measures).toHaveLength(2);

    const asset = await s.get("blobAssets", res.blobId);
    expect(asset.ownership).toBe("owned");
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(blobAvailability(asset, (key) => key === res.blobId)).toBe("local");
  });

  it("reloads the whole work from storage with no re-parse and no network", async () => {
    const s = createMemoryStorage();
    const { work } = await importMusicXmlFile({ name: "piece.musicxml", bytes: fixtureBytes() }, s);

    // Simulate an offline reload: brand-new references, same StoragePort only.
    const reloaded = await loadWork(s, work.id);
    expect(reloaded.work.id).toBe(work.id);
    expect(reloaded.model.measures[0].events.map((e) => e.midis[0])).toEqual([60, 62, 64, 65]);
    expect(reloaded.model.ticksPerQuarter).toBe(1);
    expect(await hasLocalBytes(s, reloaded.representation.blobId)).toBe(true);

    const picker = await listWorks(s);
    expect(picker).toEqual([{ id: work.id, title: "piece", composer: "" }]);
  });

  it("derives 'missing' availability once the bytes are evicted (records survive)", async () => {
    const s = createMemoryStorage();
    const { work, blobId } = await importMusicXmlFile({ name: "p.musicxml", bytes: fixtureBytes() }, s);
    await s.delete("bytes", blobId); // simulate IndexedDB eviction of the blob

    const asset = await s.get("blobAssets", blobId);
    const available = blobAvailability(asset, (key) => false); // checker reports no local bytes
    expect(available).toBe("missing");
    // The domain records still load — the work isn't lost, just its bytes need refetching.
    const reloaded = await loadWork(s, work.id);
    expect(reloaded.work.id).toBe(work.id);
  });
});
