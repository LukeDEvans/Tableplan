// Recently opened files, kept ENCRYPTED in this device's (locked) Documents store, so
// opening one again doesn't download it. What's kept is the file's ciphertext as it
// came from storage (it still needs the vault's file key), under "blob:<key>", with an
// index "blobidx" → [{ key, size, at }], least recently opened first.
//
// Limits: a file of at most fileMax, totalMax in all, counted as the bytes the store
// actually holds (base64 in the encrypted value, a third more than the file). The
// least recently opened go first. drop(prefix) removes a purged file's copies.

export const CACHE_FILE_MAX = 20 * 1024 * 1024;
export const CACHE_TOTAL_MAX = 200 * 1024 * 1024;

// What a value of n bytes takes in the store: base64 + its JSON wrapper + the GCM tag.
export const storedSize = (n) => 4 * Math.ceil(n / 3) + 32;

export function createBlobCache(store, { fileMax = CACHE_FILE_MAX, totalMax = CACHE_TOTAL_MAX, now = () => Date.now() } = {}) {
  const index = async () => {
    const list = await store.get("blobidx");
    return Array.isArray(list) ? list : [];
  };
  return {
    async get(key) {
      const bytes = await store.get(`blob:${key}`);
      if (!(bytes instanceof Uint8Array)) return null;
      const list = await index();
      const e = list.find((x) => x.key === key);
      if (e) {
        e.at = now();
        list.sort((a, b) => a.at - b.at);
        await store.set("blobidx", list);
      }
      return bytes;
    },
    async set(key, bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length > fileMax) return;
      const size = storedSize(bytes.length);
      const list = (await index()).filter((x) => x.key !== key);
      list.push({ key, size, at: now() });
      list.sort((a, b) => a.at - b.at);
      let total = list.reduce((n, x) => n + x.size, 0);
      while (total > totalMax && list.length) {
        const old = list.shift();
        total -= old.size;
        await store.remove(`blob:${old.key}`);
      }
      if (!list.some((x) => x.key === key)) return; // bigger than the whole cache
      await store.set(`blob:${key}`, bytes);
      await store.set("blobidx", list);
    },
    // Every copy whose key starts with prefix ("<scope>/<fileId>/"): the file is gone.
    async drop(prefix) {
      const list = await index();
      const gone = list.filter((x) => x.key.startsWith(prefix));
      for (const x of gone) await store.remove(`blob:${x.key}`);
      for (const k of await store.keys(`blob:${prefix}`)) await store.remove(k); // a copy the index lost
      if (gone.length) await store.set("blobidx", list.filter((x) => !x.key.startsWith(prefix)));
    },
  };
}
