import { describe, it, expect } from "vitest";
import { blobPath, uploadBlob, downloadBlob, cloudLocation, CADENCE_BLOB_BUCKET } from "../music/cloud-blob.js";

const HASH = "a".repeat(64); // valid-looking sha-256 hex

// Minimal fake of the Supabase Storage client surface this module uses.
function fakeClient({ uploadError = null, downloadBytes = null, downloadError = null } = {}) {
  const calls = { upload: [], download: [] };
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async upload(path, body, opts) { calls.upload.push({ bucket, path, body, opts }); return { error: uploadError }; },
          async download(path) {
            calls.download.push({ bucket, path });
            if (downloadError) return { data: null, error: downloadError };
            const u8 = downloadBytes || new Uint8Array([1, 2, 3]);
            return { data: { arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }, error: null };
          },
        };
      },
    },
  };
}

describe("blobPath — content-addressed path", () => {
  it("is userId/hash", () => expect(blobPath("u-123", HASH)).toBe(`u-123/${HASH}`));
  it("sanitizes the user segment and defaults it", () => {
    expect(blobPath("a/b c", HASH)).toBe(`a-b-c/${HASH}`);
    expect(blobPath("", HASH)).toBe(`personal/${HASH}`);
  });
  it("requires a real sha-256 hex hash (integrity)", () => {
    expect(() => blobPath("u", "not-a-hash")).toThrow();
    expect(() => blobPath("u", "")).toThrow();
    expect(() => blobPath("u", "A".repeat(64))).not.toThrow(); // case-insensitive
  });
});

describe("uploadBlob", () => {
  it("uploads bytes to the content-addressed path and returns {bucket,path}", async () => {
    const c = fakeClient();
    const out = await uploadBlob(c, { userId: "u-1", hash: HASH, bytes: new Uint8Array([9, 9]), mimeType: "application/xml" });
    expect(out).toEqual({ bucket: CADENCE_BLOB_BUCKET, path: `u-1/${HASH}` });
    expect(c.calls.upload).toHaveLength(1);
    expect(c.calls.upload[0].opts.contentType).toBe("application/xml");
    expect(c.calls.upload[0].opts.upsert).toBe(false);
  });
  it("treats an already-exists (409) as success — content addressing means identical bytes", async () => {
    const c = fakeClient({ uploadError: { statusCode: "409", message: "The resource already exists" } });
    await expect(uploadBlob(c, { userId: "u", hash: HASH, bytes: new Uint8Array([1]) })).resolves.toEqual({ bucket: CADENCE_BLOB_BUCKET, path: `u/${HASH}` });
  });
  it("rethrows a genuine upload error", async () => {
    const c = fakeClient({ uploadError: { statusCode: "500", message: "boom" } });
    await expect(uploadBlob(c, { userId: "u", hash: HASH, bytes: new Uint8Array([1]) })).rejects.toBeTruthy();
  });
});

describe("downloadBlob", () => {
  it("returns the bytes as a Uint8Array", async () => {
    const c = fakeClient({ downloadBytes: new Uint8Array([5, 6, 7]) });
    const out = await downloadBlob(c, { bucket: CADENCE_BLOB_BUCKET, path: `u/${HASH}` });
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...out]).toEqual([5, 6, 7]);
  });
  it("rethrows a download error", async () => {
    const c = fakeClient({ downloadError: { message: "not found" } });
    await expect(downloadBlob(c, { path: `u/${HASH}` })).rejects.toBeTruthy();
  });
});

describe("cloudLocation", () => {
  it("is the BlobAsset location shape music/blob.js accepts", () => {
    expect(cloudLocation({ bucket: "b", path: "p" })).toEqual({ kind: "cloud", bucket: "b", path: "p" });
  });
});
