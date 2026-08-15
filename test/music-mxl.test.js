import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { isZip, extractMusicXml } from "../music/mxl.js";
import { createMemoryStorage } from "../music/storage.js";
import { importMusicXmlFile, loadWork } from "../music/import.js";

const xml = () => readFileSync(fileURLToPath(new URL("./fixtures/simple-4-4.musicxml", import.meta.url)), "utf8");

// Build a real .mxl: a zip with META-INF/container.xml pointing at the score.
function makeMxl(scorePath = "score.musicxml") {
  return zipSync({
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="${scorePath}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`),
    [scorePath]: strToU8(xml()),
  });
}

describe("mxl — detection & extraction", () => {
  it("detects the zip magic; passes plain XML through untouched", () => {
    const plain = new TextEncoder().encode(xml());
    expect(isZip(plain)).toBe(false);
    expect(extractMusicXml(plain)).toBe(plain);
  });
  it("unwraps an .mxl to the score named by container.xml", () => {
    const mxl = makeMxl("MyScore.musicxml");
    expect(isZip(mxl)).toBe(true);
    const out = new TextDecoder().decode(extractMusicXml(mxl));
    expect(out).toContain("<score-partwise");
  });
  it("falls back to the first .xml when container.xml is absent", () => {
    const mxl = zipSync({ "whatever.xml": strToU8(xml()) });
    expect(new TextDecoder().decode(extractMusicXml(mxl))).toContain("<score-partwise");
  });
  it("throws a clear error when the zip has no MusicXML", () => {
    const mxl = zipSync({ "readme.txt": strToU8("hello") });
    expect(() => extractMusicXml(mxl)).toThrow(/no MusicXML/i);
  });
});

describe("mxl — full import path", () => {
  it("imports a compressed .mxl exactly like a plain file, tagging provenance", async () => {
    const s = createMemoryStorage();
    const res = await importMusicXmlFile({ name: "titanic.mxl", bytes: makeMxl() }, s);
    expect(res.model.measures).toHaveLength(2);
    expect(res.model.measures[0].events.map((e) => e.midis[0])).toEqual([60, 62, 64, 65]);

    const asset = await s.get("blobAssets", res.blobId);
    expect(asset.provenance.originalFormat).toBe("mxl");
    expect(asset.mimeType).toContain("musicxml");

    // Stored bytes are plain XML now (what the renderer will receive).
    const rec = await s.get("bytes", res.blobId);
    expect(new TextDecoder().decode(rec.bytes)).toContain("<score-partwise");

    const reloaded = await loadWork(s, res.work.id);
    expect(reloaded.model.ticksPerQuarter).toBe(1);
  });
});
