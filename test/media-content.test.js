import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { createArticleContent, READING_CONTENT_BUCKET } from "../media-content.js";
import { createMemoryStorage } from "../content-store/storage.js";

function fakeCloud() {
  const store = new Map();
  const calls = { upload: 0, download: 0 };
  return {
    calls, store,
    storage: {
      from() {
        return {
          async upload(path, body) { calls.upload++; store.set(path, new Uint8Array(body)); return { error: null }; },
          async download(path) {
            calls.download++;
            const u8 = store.get(path);
            if (!u8) return { data: null, error: { message: "not found" } };
            return { data: { arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }, error: null };
          },
        };
      },
    },
  };
}

const BODY = "<p>Urban gardening has grown across cities worldwide.</p><h3>Why</h3><p>Because…</p>";

describe("createArticleContent.saveBody", () => {
  it("stores the body locally and returns a cloud ref when a backstop is configured", async () => {
    const cloud = fakeCloud();
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, userId: "u" });
    const ref = await ac.saveBody("a1", BODY);
    expect(cloud.calls.upload).toBe(1);
    expect(ref).toMatchObject({ cloud: { bucket: READING_CONTENT_BUCKET } });
    expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await ac.hasLocal("a1")).toBe(true);
  });
  it("works local-only (no cloud client): stores locally, null cloud ref", async () => {
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]) });
    const ref = await ac.saveBody("a1", BODY);
    expect(ref.cloud).toBe(null);
    expect(await ac.hasLocal("a1")).toBe(true);
  });
  it("returns null for empty/invalid input", async () => {
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]) });
    expect(await ac.saveBody("a1", "")).toBe(null);
    expect(await ac.saveBody("a1", null)).toBe(null);
  });
});

describe("createArticleContent.loadBody — local → remote → fallback", () => {
  it("local hit: returns the exact body, no download", async () => {
    const cloud = fakeCloud();
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, userId: "u" });
    await ac.saveBody("a1", BODY);
    cloud.calls.download = 0;
    expect(await ac.loadBody("a1", { fallbackText: "FB" })).toBe(BODY);
    expect(cloud.calls.download).toBe(0);
  });

  it("local miss + remote hit via ref: downloads, rehydrates, returns the body", async () => {
    const cloud = fakeCloud();
    // device A saves
    const acA = createArticleContent({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, userId: "u" });
    const ref = await acA.saveBody("a1", BODY);
    // device B: empty local, has the synced metadata ref
    const acB = createArticleContent({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, userId: "u" });
    expect(await acB.hasLocal("a1")).toBe(false);
    expect(await acB.loadBody("a1", { ref, fallbackText: "FB" })).toBe(BODY);
    expect(cloud.calls.download).toBe(1);
    expect(await acB.hasLocal("a1")).toBe(true); // rehydrated
  });

  it("local miss + no usable remote: returns the fallback text (behavior-preserving)", async () => {
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]) });
    expect(await ac.loadBody("a1", { fallbackText: "FALLBACK" })).toBe("FALLBACK");
  });

  it("remote error falls back to text rather than throwing", async () => {
    const cloud = fakeCloud();
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]), cloudClient: cloud, userId: "u" });
    const ref = { cloud: { bucket: READING_CONTENT_BUCKET, path: "u/deadbeef" } }; // not in the fake store
    expect(await ac.loadBody("a1", { ref, fallbackText: "FB" })).toBe("FB");
  });

  it("round-trips unicode faithfully", async () => {
    const ac = createArticleContent({ storage: createMemoryStorage(["bytes"]) });
    const body = "<p>café — “quotes”, emoji 🌱, math ∑</p>";
    await ac.saveBody("a1", body);
    expect(await ac.loadBody("a1", {})).toBe(body);
  });
});
