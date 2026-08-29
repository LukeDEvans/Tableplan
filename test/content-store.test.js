import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { createContentStore } from "../content-store/content-store.js";
import { createMemoryStorage } from "../content-store/storage.js";

const BUCKET = "content-test";

function fakeCloud({ uploadError = null, downloadError = null, store = new Map() } = {}) {
  const calls = { upload: 0, download: 0 };
  return {
    calls, store,
    storage: {
      from() {
        return {
          async upload(path, body) { calls.upload++; if (uploadError) return { error: uploadError }; store.set(path, new Uint8Array(body)); return { error: null }; },
          async download(path) {
            calls.download++;
            if (downloadError) return { data: null, error: downloadError };
            const u8 = store.get(path);
            if (!u8) return { data: null, error: { message: "not found" } };
            return { data: { arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }, error: null };
          },
        };
      },
    },
  };
}

describe("ContentStore.putBytes / getBytes / has / delete", () => {
  it("stores bytes locally and returns a BlobAsset with an idb location", async () => {
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]) });
    const asset = await cs.putBytes("b1", new Uint8Array([1, 2, 3]), { mimeType: "text/html" });
    expect(asset).toMatchObject({ blobId: "b1", size: 3, mimeType: "text/html", ownership: "owned" });
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.locations).toContainEqual({ kind: "idb", key: "b1" });
    expect([...(await cs.getBytes("b1"))]).toEqual([1, 2, 3]);
    expect(await cs.has("b1")).toBe(true);
    await cs.delete("b1");
    expect(await cs.has("b1")).toBe(false);
  });

  it("uploads to the cloud backstop when configured and adds a cloud location", async () => {
    const cloud = fakeCloud();
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, bucket: BUCKET, userId: "u" });
    const asset = await cs.putBytes("b1", new Uint8Array([7, 7]));
    expect(cloud.calls.upload).toBe(1);
    expect(asset.locations.some((l) => l.kind === "cloud" && l.bucket === BUCKET)).toBe(true);
  });

  it("keeps the local copy when the cloud upload fails (offline) — no cloud location, no throw", async () => {
    const cloud = fakeCloud({ uploadError: { statusCode: "500", message: "boom" } });
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, bucket: BUCKET, userId: "u" });
    const asset = await cs.putBytes("b1", new Uint8Array([1]));
    expect(await cs.has("b1")).toBe(true);                 // local stands
    expect(asset.locations.some((l) => l.kind === "cloud")).toBe(false); // retried later
  });
});

describe("ContentStore.ensureAvailable — layered read", () => {
  it("local hit: returns bytes without touching the network", async () => {
    const cloud = fakeCloud();
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, bucket: BUCKET, userId: "u" });
    const asset = await cs.putBytes("b1", new Uint8Array([1, 2]));
    cloud.calls.download = 0;
    expect([...(await cs.ensureAvailable(asset))]).toEqual([1, 2]);
    expect(cloud.calls.download).toBe(0);
  });

  it("local miss + remote hit: downloads and rehydrates local", async () => {
    const cloud = fakeCloud();
    // device A uploads
    const csA = createContentStore({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, bucket: BUCKET, userId: "u" });
    const asset = await csA.putBytes("b1", new Uint8Array([5, 6, 7]));
    // device B has the catalog record (synced) but empty local storage
    const storageB = createMemoryStorage(["bytes"]);
    const csB = createContentStore({ storage: storageB, cloudClient: cloud, bucket: BUCKET, userId: "u" });
    expect(await csB.has("b1")).toBe(false);
    const bytes = await csB.ensureAvailable(asset);
    expect([...bytes]).toEqual([5, 6, 7]);
    expect(cloud.calls.download).toBe(1);
    expect(await csB.has("b1")).toBe(true); // rehydrated
  });

  it("local miss + no remote location: throws code 'missing'", async () => {
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]) });
    const asset = { blobId: "b1", locations: [{ kind: "idb", key: "b1" }] }; // idb only, but no bytes
    await expect(cs.ensureAvailable(asset)).rejects.toMatchObject({ code: "missing" });
  });

  it("local miss + remote location but no cloud client: throws code 'remote-unavailable'", async () => {
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]) }); // no cloudClient
    const asset = { blobId: "b1", locations: [{ kind: "cloud", bucket: BUCKET, path: "u/x" }] };
    await expect(cs.ensureAvailable(asset)).rejects.toMatchObject({ code: "remote-unavailable" });
  });

  it("propagates a genuine download error (does NOT mask it as 'missing')", async () => {
    const cloud = fakeCloud({ downloadError: { message: "permission denied" } });
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, bucket: BUCKET });
    const asset = { blobId: "b1", locations: [{ kind: "cloud", bucket: BUCKET, path: "u/x" }] };
    await expect(cs.ensureAvailable(asset)).rejects.toMatchObject({ message: expect.stringMatching(/permission/i) });
  });
});

describe("ContentStore ownership / eviction / availability", () => {
  it("evicts cache content but preserves owned content", async () => {
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]) });
    const owned = await cs.putBytes("b1", new Uint8Array([1]), { ownership: "owned" });
    const cached = await cs.putBytes("b2", new Uint8Array([2]), { ownership: "cache" });
    expect(await cs.evictIfCache(cached)).toBe(true);
    expect(await cs.has("b2")).toBe(false);
    expect(await cs.evictIfCache(owned)).toBe(false);
    expect(await cs.has("b1")).toBe(true);
  });

  it("availability reflects local presence then catalog locations", async () => {
    const cs = createContentStore({ storage: createMemoryStorage(["bytes"]) });
    const asset = await cs.putBytes("b1", new Uint8Array([1]));
    expect(await cs.availability(asset)).toBe("local");
    await cs.delete("b1");
    // no local bytes, only an idb location on the asset → missing
    expect(await cs.availability(asset)).toBe("missing");
  });
});
