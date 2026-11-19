// photos/cache.js — the Photos page's copy on this device (IndexedDB "live-photos"):
// each library's records with the cursor of the last pull, and thumbnail images.
// Nothing here is needed to be correct, only to be fast: if it's lost, the page pulls
// again. Removed on sign-out (deletePhotosCache).

export const PHOTOS_DB = "live-photos";
const VERSION = 1;

function promise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTOS_DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        const items = db.createObjectStore("items", { keyPath: ["scope", "id"] });
        items.createIndex("scope", "scope");
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// The newest thumbnails kept on the device; older ones are fetched again if needed.
export const MAX_THUMBS = 30000;

export function createPhotosCache() {
  let dbp = null;
  const db = () => (dbp ||= openDb());
  const tx = async (stores, mode) => (await db()).transaction(stores, mode);

  return {
    async getMeta(scope) { return (await promise((await tx("meta", "readonly")).objectStore("meta").get(scope))) || null; },
    async setMeta(scope, meta) { await promise((await tx("meta", "readwrite")).objectStore("meta").put(meta, scope)); },
    async getAll(scope) {
      const rows = await promise((await tx("items", "readonly")).objectStore("items").index("scope").getAll(scope));
      return rows.map(({ scope: _s, ...r }) => r);
    },
    async putMany(scope, rows) {
      const t = await tx("items", "readwrite");
      const store = t.objectStore("items");
      for (const r of rows) store.put({ ...r, scope });
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
    },
    async getThumb(id) { return (await promise((await tx("thumbs", "readonly")).objectStore("thumbs").get(id))) || null; },
    async putThumb(id, blob) { await promise((await tx("thumbs", "readwrite")).objectStore("thumbs").put(blob, id)); },
    async dropThumb(id) { await promise((await tx("thumbs", "readwrite")).objectStore("thumbs").delete(id)); },
    close() { dbp?.then((d) => d.close()).catch(() => {}); dbp = null; },
  };
}

export function deletePhotosCache() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(PHOTOS_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
}
