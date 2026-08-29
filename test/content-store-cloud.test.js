import { describe, it, expect } from "vitest";
import { blobPath, uploadBlob, downloadBlob, cloudLocation } from "../content-store/cloud-blob.js";

const HASH = "a".repeat(64);
const BUCKET = "test-bucket";

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

describe("blobPath", () => {
  it("is userId/hash, sanitized + defaulted", () => {
    expect(blobPath("u-1", HASH)).toBe(`u-1/${HASH}`);
    expect(blobPath("a/b c", HASH)).toBe(`a-b-c/${HASH}`);
    expect(blobPath("", HASH)).toBe(`personal/${HASH}`);
  });
  it("requires a real sha-256 hex hash", () => {
    expect(() => blobPath("u", "nope")).toThrow();
    expect(() => blobPath("u", "A".repeat(64))).not.toThrow(); // case-insensitive
  });
});

describe("uploadBlob (bucket now explicit / required)", () => {
  it("uploads to the content-addressed path and returns {bucket,path}", async () => {
    const c = fakeClient();
    const out = await uploadBlob(c, { userId: "u", hash: HASH, bytes: new Uint8Array([9]), mimeType: "text/html", bucket: BUCKET });
    expect(out).toEqual({ bucket: BUCKET, path: `u/${HASH}` });
    expect(c.calls.upload[0].opts).toMatchObject({ contentType: "text/html", upsert: false });
  });
  it("treats already-exists (409) as success", async () => {
    const c = fakeClient({ uploadError: { statusCode: "409", message: "already exists" } });
    await expect(uploadBlob(c, { userId: "u", hash: HASH, bytes: new Uint8Array([1]), bucket: BUCKET })).resolves.toEqual({ bucket: BUCKET, path: `u/${HASH}` });
  });
  it("rethrows a genuine error, and throws without a bucket", async () => {
    const c = fakeClient({ uploadError: { statusCode: "500", message: "boom" } });
    await expect(uploadBlob(c, { userId: "u", hash: HASH, bytes: new Uint8Array([1]), bucket: BUCKET })).rejects.toBeTruthy();
    await expect(uploadBlob(c, { userId: "u", hash: HASH, bytes: new Uint8Array([1]) })).rejects.toThrow(/bucket/i);
  });
});

describe("downloadBlob", () => {
  it("returns bytes as a Uint8Array", async () => {
    const c = fakeClient({ downloadBytes: new Uint8Array([5, 6, 7]) });
    const out = await downloadBlob(c, { bucket: BUCKET, path: `u/${HASH}` });
    expect([...out]).toEqual([5, 6, 7]);
  });
  it("rethrows a download error and requires a bucket", async () => {
    await expect(downloadBlob(fakeClient({ downloadError: { message: "not found" } }), { bucket: BUCKET, path: "p" })).rejects.toBeTruthy();
    await expect(downloadBlob(fakeClient(), { path: "p" })).rejects.toThrow(/bucket/i);
  });
});

describe("cloudLocation", () => {
  it("is the BlobAsset cloud location shape", () => {
    expect(cloudLocation({ bucket: "b", path: "p" })).toEqual({ kind: "cloud", bucket: "b", path: "p" });
  });
});
