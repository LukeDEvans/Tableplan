import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { newBlobId, makeBlobAsset, blobAvailability, addLocation, hashBytes } from "../content-store/blob.js";

describe("BlobAsset identity + catalog", () => {
  it("makeBlobAsset normalizes fields and defaults ownership to owned", () => {
    const a = makeBlobAsset({ blobId: "b1", hash: "a".repeat(64), size: 12, mimeType: "text/html" });
    expect(a).toMatchObject({ entity: "blobAsset", blobId: "b1", hash: "a".repeat(64), size: 12, mimeType: "text/html", ownership: "owned" });
    expect(a.locations).toEqual([]);
    expect(typeof a.createdAt).toBe("string");
  });
  it("honors cache ownership and normalizes locations", () => {
    const a = makeBlobAsset({ ownership: "cache", locations: [{ kind: "idb", key: "b1" }, { kind: "cloud", bucket: "x", path: "p" }, { bad: true }] });
    expect(a.ownership).toBe("cache");
    expect(a.locations).toEqual([{ kind: "idb", key: "b1" }, { kind: "cloud", bucket: "x", path: "p" }]);
  });
  it("newBlobId is unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newBlobId()));
    expect(ids.size).toBe(200);
  });
  it("hashBytes is a stable sha-256 hex (content identity)", async () => {
    const h1 = await hashBytes(new Uint8Array([1, 2, 3]));
    const h2 = await hashBytes(new Uint8Array([1, 2, 3]));
    const h3 = await hashBytes(new Uint8Array([1, 2, 4]));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe("addLocation", () => {
  it("appends and dedupes locations", () => {
    let a = makeBlobAsset({ blobId: "b" });
    a = addLocation(a, { kind: "idb", key: "b" });
    a = addLocation(a, { kind: "idb", key: "b" }); // dupe
    a = addLocation(a, { kind: "cloud", bucket: "x", path: "p" });
    expect(a.locations).toEqual([{ kind: "idb", key: "b" }, { kind: "cloud", bucket: "x", path: "p" }]);
  });
});

describe("blobAvailability (derived, never stored)", () => {
  it("local when an idb location exists (catalog-trusted without a checker)", () => {
    expect(blobAvailability(makeBlobAsset({ locations: [{ kind: "idb", key: "b" }] }))).toBe("local");
  });
  it("with a checker: local only if bytes are actually present, else remote/missing", () => {
    const asset = makeBlobAsset({ locations: [{ kind: "idb", key: "b" }, { kind: "cloud", bucket: "x", path: "p" }] });
    expect(blobAvailability(asset, (k) => k === "b")).toBe("local");
    expect(blobAvailability(asset, () => false)).toBe("remote"); // no local bytes but a cloud location
    const localOnly = makeBlobAsset({ locations: [{ kind: "idb", key: "b" }] });
    expect(blobAvailability(localOnly, () => false)).toBe("missing"); // no local bytes, no remote
  });
  it("remote when only a fetchable location exists; missing when none", () => {
    expect(blobAvailability(makeBlobAsset({ locations: [{ kind: "cloud", bucket: "x", path: "p" }] }))).toBe("remote");
    expect(blobAvailability(makeBlobAsset({ locations: [{ kind: "url", url: "http://x" }] }))).toBe("remote");
    expect(blobAvailability(makeBlobAsset({ locations: [] }))).toBe("missing");
  });
});
