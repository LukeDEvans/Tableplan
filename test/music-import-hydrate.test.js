import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { createMemoryStorage } from "../music/storage.js";
import { importMusicXmlFile, loadWork, readRepresentationXml, hydrateWorkLocally } from "../music/import.js";

// music/blob.js hashes bytes via WebCrypto; expose it as a global in Node.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// A minimal but real MusicXML score (one 4/4 measure, four quarter notes).
const XML = `<?xml version="1.0"?><score-partwise version="3.1">` +
  `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` +
  `<part id="P1"><measure number="1">` +
  `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
  `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>` +
  `<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>` +
  `<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>` +
  `<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>` +
  `</measure></part></score-partwise>`;

const bytesOf = (s) => new TextEncoder().encode(s);

// Simulate the cross-device path: import on "device A", then reconstruct the
// local cache on a FRESH "device B" from the canonical Work + BlobAsset + bytes
// (exactly what sync carries), and prove the render path works there.
async function importedOnDeviceA() {
  const A = createMemoryStorage();
  const res = await importMusicXmlFile({ name: "etude.musicxml", bytes: bytesOf(XML) }, A, { composer: "Test" });
  const blobAsset = await A.get("blobAssets", res.blobId);
  const bytesRec = await A.get("bytes", res.blobId);
  return { work: res.work, blobAsset, bytes: bytesRec.bytes };
}

describe("hydrateWorkLocally — rebuild a synced Work's local cache", () => {
  it("with bytes: loadWork returns a renderable model and the XML round-trips", async () => {
    const { work, blobAsset, bytes } = await importedOnDeviceA();
    const B = createMemoryStorage(); // fresh device, empty cache

    await hydrateWorkLocally(B, { work, blobAsset, bytes });

    const loaded = await loadWork(B, work.id);
    expect(loaded).toBeTruthy();
    expect(loaded.work.id).toBe(work.id);
    expect(loaded.work.composer).toBe("Test");
    expect(loaded.representation).toBeTruthy();
    expect(loaded.model).toBeTruthy();
    expect(loaded.model.measures).toHaveLength(1);
    expect(loaded.model.measures[0].events.map((e) => e.midis[0])).toEqual([60, 62, 64, 65]);

    const xml = await readRepresentationXml(B, loaded.representation);
    expect(xml).toContain("<score-partwise");
    // preserves the canonical ids (cache-fill, not a new import)
    expect(loaded.representation.id).toBe(work.editions[0].representations[0].id);
    expect(loaded.model.representationId).toBe(loaded.representation.id);
  });

  it("without bytes (metadata-only): the Work record lands but no model yet", async () => {
    const { work, blobAsset } = await importedOnDeviceA();
    const B = createMemoryStorage();

    await hydrateWorkLocally(B, { work, blobAsset, bytes: null });

    const loaded = await loadWork(B, work.id);
    expect(loaded.work.id).toBe(work.id);      // library can show it…
    expect(loaded.model).toBeFalsy();          // …but it needs a download to render
    expect(await B.has("bytes", blobAsset.blobId)).toBe(false);
  });

  it("is idempotent and preserves the blob catalog entry", async () => {
    const { work, blobAsset, bytes } = await importedOnDeviceA();
    const B = createMemoryStorage();
    await hydrateWorkLocally(B, { work, blobAsset, bytes });
    await hydrateWorkLocally(B, { work, blobAsset, bytes }); // twice → same result
    const storedAsset = await B.get("blobAssets", blobAsset.blobId);
    expect(storedAsset.hash).toBe(blobAsset.hash);
    const works = await B.getAll("works");
    expect(works).toHaveLength(1);
  });
});
