// StoragePort — the domain's only door to LOCAL persistence. Domain/app code
// talks to this small interface, never to IndexedDB directly, so the backing
// store can later become OPFS, a home-server, or a native layer without touching
// callers, and so everything is testable against an in-memory fake.
//
// Named object stores: large binary "bytes" plus small JSON record stores. Bytes
// and metadata are deliberately separate — the sync layer only ever carries the
// small records, never blobs.
//
// Domain-neutral: extracted from Cadence (music/storage.js) as Phase 0. The only
// change from the original is that the store-name list is INJECTED rather than a
// hardcoded Cadence list, so each domain configures its own database + stores
// (Cadence keeps db "cadence" + its stores via the music/storage.js shim).
//
//   put(store, key, value) → Promise
//   get(store, key)        → Promise<value | undefined>
//   getAll(store)          → Promise<value[]>
//   has(store, key)        → Promise<boolean>
//   delete(store, key)     → Promise
//   close()

/**
 * In-memory StoragePort — the test/dev fake and offline scratch. `stores`
 * pre-seeds the named stores; any unknown store is created on first access, so
 * callers can also pass nothing.
 */
export function createMemoryStorage(stores = []) {
  const db = new Map((stores || []).map((s) => [s, new Map()]));
  const store = (s) => { if (!db.has(s)) db.set(s, new Map()); return db.get(s); };
  return {
    kind: "memory",
    async put(s, key, value) { store(s).set(String(key), value); },
    async get(s, key) { return store(s).get(String(key)); },
    async getAll(s) { return [...store(s).values()]; },
    async has(s, key) { return store(s).has(String(key)); },
    async delete(s, key) { store(s).delete(String(key)); },
    close() { /* nothing to release */ },
    _dump() { return db; },
  };
}

/**
 * IndexedDB-backed StoragePort. Same interface as the memory fake. Used in the
 * browser; throws a clear error where IndexedDB is unavailable (callers should
 * prefer createMemoryStorage in that case — see the private-browsing fallback).
 * `stores` are the object stores created on upgrade.
 */
export function createIdbStorage(dbName, version = 1, stores = []) {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable in this environment");
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const idb = req.result;
        for (const s of stores) if (!idb.objectStoreNames.contains(s)) idb.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  const tx = async (s, mode, fn) => {
    const idb = await open();
    return new Promise((resolve, reject) => {
      const t = idb.transaction(s, mode);
      const os = t.objectStore(s);
      let out;
      const r = fn(os);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    kind: "idb",
    async put(s, key, value) { await tx(s, "readwrite", (os) => os.put(value, String(key))); },
    async get(s, key) { return tx(s, "readonly", (os) => os.get(String(key))); },
    async getAll(s) { return tx(s, "readonly", (os) => os.getAll()); },
    async has(s, key) { const v = await tx(s, "readonly", (os) => os.getKey(String(key))); return v !== undefined; },
    async delete(s, key) { await tx(s, "readwrite", (os) => os.delete(String(key))); },
    async close() { const idb = await open(); idb.close(); dbp = null; },
  };
}

/** Does this blobId currently have bytes on this device? (backs blobAvailability's checker) */
export async function hasLocalBytes(storage, blobId, bytesStore = "bytes") { return storage.has(bytesStore, blobId); }
