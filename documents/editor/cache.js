// The document on this device (WORD_PROCESSOR_DESIGN.md §3, offline): the last Yjs
// state seen, so a document opens at once and can be edited with no connection. It
// merges with what's stored when the connection is back.
//
// One IndexedDB database, "live-docs-cache", key "<scope>/<file id>". Everyday
// documents are kept as they are (like the rest of the app's offline copies). The
// Safe passes `seal` / `open` (encrypt with the file's key), so its copy is only
// ciphertext. Signing out deletes the database (app.js, with the other stores).

const DB = "live-docs-cache";
const STORE = "docs";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbp = null;
const db = () => (dbp ||= openDb().catch((e) => { dbp = null; throw e; }));

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function createDocCache(key, { seal = null, open = null } = {}) {
  return {
    async get() {
      try {
        const v = await tx("readonly", (s) => s.get(key));
        if (!(v instanceof Uint8Array)) return null;
        return open ? await open(v) : v;
      } catch { return null; }
    },
    async put(bytes) {
      try {
        const v = seal ? await seal(bytes) : bytes;
        await tx("readwrite", (s) => s.put(v, key));
      } catch { /* best-effort */ }
    },
    async remove() { try { await tx("readwrite", (s) => s.delete(key)); } catch { /* best-effort */ } },
  };
}
export function deleteDocCaches() {
  dbp = null;
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch { resolve(); }
  });
}
