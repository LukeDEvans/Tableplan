// The storage adapter (documents/storage.js), the S3 presigner (documents/s3-presign.js)
// and the doc-storage function's copy of it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { presignS3 } from "../documents/s3-presign.js";
import { createDocumentsStorage, memoryObjectStore, objectKey, edgePresigner, StorageError } from "../documents/storage.js";

describe("presignS3 (AWS Signature Version 4, query string)", () => {
  it("matches the AWS documentation's worked example", async () => {
    // docs.aws.amazon.com — "Authenticating Requests: Using Query Parameters", example GET.
    const url = await presignS3({
      method: "GET", endpoint: "https://examplebucket.s3.amazonaws.com", key: "test.txt", region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expires: 86400, now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toBe("https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  const base = { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "liv-documents", key: "u-x/f/content", accessKeyId: "k", secretAccessKey: "s", now: new Date("2026-11-03T12:00:00Z") };
  it("R2 path style; a pinned size is signed, so a different size gets a different signature", async () => {
    const a = await presignS3({ ...base, method: "PUT", headers: { "content-length": "100" } });
    const b = await presignS3({ ...base, method: "PUT", headers: { "content-length": "101" } });
    expect(a.startsWith("https://acct.r2.cloudflarestorage.com/liv-documents/u-x/f/content?")).toBe(true);
    expect(a).toContain("X-Amz-SignedHeaders=content-length%3Bhost");
    expect(a).toContain("%2Fauto%2Fs3%2F");
    expect(a.split("Signature=")[1]).not.toBe(b.split("Signature=")[1]);
  });
  it("refuses odd methods and expiries", async () => {
    await expect(presignS3({ ...base, method: "POST" })).rejects.toThrow();
    await expect(presignS3({ ...base, method: "GET", expires: 0 })).rejects.toThrow();
    await expect(presignS3({ ...base, method: "GET", expires: 8 * 24 * 3600 })).rejects.toThrow();
  });
  it("the function's copy is identical to documents/s3-presign.js", () => {
    const a = readFileSync(new URL("../documents/s3-presign.js", import.meta.url), "utf8");
    const b = readFileSync(new URL("../supabase/functions/doc-storage/s3-presign.js", import.meta.url), "utf8");
    expect(b).toBe(a);
  });
});

describe("storage adapter", () => {
  const scope = "u-11111111-1111-1111-1111-111111111111";
  const fileId = "d0000000-0000-0000-0000-00000000000a";

  it("object keys are scope/file/part and nothing else", () => {
    expect(objectKey({ scope, fileId: fileId.toUpperCase(), part: "thumb" })).toBe(`${scope}/${fileId}/thumb`);
    for (const bad of [{ scope: "../x", fileId, part: "content" }, { scope, fileId: "x", part: "content" }, { scope, fileId, part: "html" }]) {
      expect(() => objectKey(bad)).toThrow();
    }
  });

  it("put, get and remove round trip through the memory store", async () => {
    const mem = memoryObjectStore();
    const st = createDocumentsStorage(mem);
    const content = new Uint8Array([1, 2, 3]);
    const thumb = new Uint8Array([4]);
    expect(await st.put(scope, fileId, { content, thumb })).toBe(4);
    expect(await st.get(scope, fileId, "content")).toEqual(content);
    expect(await st.get(scope, fileId, "thumb")).toEqual(thumb);
    await st.remove(scope, fileId);
    await expect(st.get(scope, fileId, "content")).rejects.toMatchObject({ code: "MISSING" });
  });

  it("refuses: no content, too large, too many, not bytes, a scope the server says no to", async () => {
    const st = createDocumentsStorage(memoryObjectStore({ canAccess: (s) => s === scope }));
    await expect(st.put(scope, fileId, { thumb: new Uint8Array(1) })).rejects.toThrow(/content/);
    await expect(st.put(scope, fileId, { content: "x" })).rejects.toThrow(/bytes/);
    const big = { length: 70 * 1024 * 1024 + 1 };
    Object.setPrototypeOf(big, Uint8Array.prototype);
    await expect(st.put(scope, fileId, { content: big })).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(st.put("group-x", fileId, { content: new Uint8Array(1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a URL for one operation doesn't work for another, and a size mismatch is refused", async () => {
    const mem = memoryObjectStore();
    const [putUrl] = await mem.presign("put", [{ scope, fileId, part: "content", size: 3 }]);
    expect((await mem.fetchImpl(putUrl.url, { method: "PUT", headers: putUrl.headers, body: new Uint8Array(4) })).status).toBe(403);
    const [getUrl] = await mem.presign("get", [{ scope, fileId, part: "content" }]);
    expect((await mem.fetchImpl(getUrl.url, { method: "PUT", headers: { "content-length": "1" }, body: new Uint8Array(1) })).status).toBe(403);
  });

  it("the edge presigner sends the token and maps errors", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const op = JSON.parse(init.body).op;
      if (op === "delete") return { ok: false, status: 503 };
      if (op === "get") return { ok: false, status: 403 };
      return { ok: true, status: 200, json: async () => ({ urls: [{ url: "https://x", headers: {} }] }) };
    };
    const presign = edgePresigner({ functionsUrl: "https://p.supabase.co/functions/v1/", getToken: async () => "tok", fetchImpl });
    expect(await presign("put", [{ scope, fileId, part: "content", size: 1 }])).toEqual([{ url: "https://x", headers: {} }]);
    expect(calls[0].url).toBe("https://p.supabase.co/functions/v1/doc-storage");
    expect(calls[0].init.headers.authorization).toBe("Bearer tok");
    await expect(presign("get", [])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(presign("delete", [])).rejects.toMatchObject({ code: "OFF" });
    expect(new StorageError("X", "y", 1)).toBeInstanceOf(Error);
  });
});
