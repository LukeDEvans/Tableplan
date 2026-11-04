// The cache of recently opened files (documents/blob-cache.js): least recently opened
// go first, sizes count what the store really holds, a file bigger than the limit is
// never kept, and drop() removes a purged file's copies (the index's and stray ones).

import { describe, it, expect } from "vitest";
import { createBlobCache, storedSize } from "../documents/blob-cache.js";
import { createKeystore, memoryBackend, encodeValue } from "../messaging/keystore.js";

const bytes = (n, fill = 1) => new Uint8Array(n).fill(fill);
const setup = (opts) => {
  let t = 1000;
  const store = createKeystore(memoryBackend());
  return { store, cache: createBlobCache(store, { now: () => ++t, ...opts }) };
};

describe("recently opened files cache", () => {
  it("counts the bytes the store holds, not the file's", async () => {
    for (const n of [0, 1, 2, 3, 1000, 4096]) expect(storedSize(n)).toBeGreaterThanOrEqual(encodeValue(bytes(n)).length + 16);
    const { store, cache } = setup();
    await cache.set("g/f1/content", bytes(3000));
    const [e] = await store.get("blobidx");
    expect(e.size).toBe(storedSize(3000));
    expect(e.size).toBeGreaterThan(4000);
  });

  it("drops the least recently OPENED first", async () => {
    const one = storedSize(1000);
    const { store, cache } = setup({ totalMax: one * 2 });
    await cache.set("a", bytes(1000));
    await cache.set("b", bytes(1000));
    await cache.get("a"); // a is now the newer one
    await cache.set("c", bytes(1000));
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("a")).toEqual(bytes(1000));
    expect(await cache.get("c")).toEqual(bytes(1000));
    expect((await store.get("blobidx")).map((x) => x.key).sort()).toEqual(["a", "c"]);
  });

  it("never keeps a file over the file limit, or one bigger than the whole cache", async () => {
    const { store, cache } = setup({ fileMax: 500, totalMax: storedSize(400) });
    await cache.set("big", bytes(600));
    expect(await store.get("blob:big")).toBeNull();
    await cache.set("ok", bytes(400));
    expect(await cache.get("ok")).toEqual(bytes(400));
    await cache.set("x", "not bytes");
    expect(await store.get("blob:x")).toBeNull();
  });

  it("drop(prefix) removes every copy of a file, including one the index lost", async () => {
    const { store, cache } = setup();
    await cache.set("g/f1/content", bytes(10));
    await cache.set("g/f2/content", bytes(10));
    await store.set("blob:g/f1/thumb", bytes(5)); // not in the index
    await cache.drop("g/f1/");
    expect(await store.keys("blob:g/f1/")).toEqual([]);
    expect(await cache.get("g/f2/content")).toEqual(bytes(10));
    expect((await store.get("blobidx")).map((x) => x.key)).toEqual(["g/f2/content"]);
  });

  it("a damaged index is treated as empty", async () => {
    const { store, cache } = setup();
    await store.set("blobidx", "garbage");
    await cache.set("a", bytes(10));
    expect(await cache.get("a")).toEqual(bytes(10));
  });
});
