import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../content-store/storage.js";
import { createScanImages } from "../scan-content.js";

const bytes = (s) => new TextEncoder().encode(s);
const str = (u8) => new TextDecoder().decode(u8);
const store = () => createScanImages({ storage: createMemoryStorage(["bytes", "blobAssets"]), cloudClient: null });

describe("createScanImages — source-image content store (local-only)", () => {
  it("round-trips an image and returns a ref with no cloud location", async () => {
    const sc = store();
    const ref = await sc.saveImage("r1", 0, bytes("JPEGDATA"), "image/jpeg");
    expect(ref).toMatchObject({ index: 0, mimeType: "image/jpeg", cloud: null });
    expect(ref.hash).toBeTruthy();
    expect(await sc.hasImage("r1", 0)).toBe(true);
    expect(str(await sc.loadImage("r1", 0))).toBe("JPEGDATA");
  });

  it("namespaces by record id + index (no collisions with articles or each other)", async () => {
    const sc = store();
    await sc.saveImage("r1", 0, bytes("A"));
    await sc.saveImage("r1", 1, bytes("B"));
    await sc.saveImage("r2", 0, bytes("C"));
    expect(str(await sc.loadImage("r1", 1))).toBe("B");
    expect(str(await sc.loadImage("r2", 0))).toBe("C");
    expect(await sc.loadImage("r1", 2)).toBeNull(); // absent
  });

  it("removeImages drops a record's local copies (retention: until receipt deleted)", async () => {
    const sc = store();
    await sc.saveImage("r1", 0, bytes("A"));
    await sc.saveImage("r1", 1, bytes("B"));
    await sc.removeImages("r1", 2);
    expect(await sc.hasImage("r1", 0)).toBe(false);
    expect(await sc.hasImage("r1", 1)).toBe(false);
  });

  it("empty bytes or missing id → null ref (never throws for the caller)", async () => {
    const sc = store();
    expect(await sc.saveImage("r1", 0, new Uint8Array())).toBeNull();
    expect(await sc.saveImage("", 0, bytes("A"))).toBeNull();
    expect(await sc.loadImage("missing", 0)).toBeNull();
  });
});
