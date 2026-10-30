// Where a device keeps its messaging secrets: its keys, sessions, prekeys and messages
// (MESSAGING_DESIGN.md §3). Nothing here ever leaves the device.
//
// Values are JSON with Uint8Array fields kept as {"$b": base64url}. In the app they
// sit in IndexedDB ("live-messaging"), each value encrypted with AES-GCM under a
// wrapping key that can't be read out:
//   - browser: a non-extractable WebCrypto key, itself stored in IndexedDB;
//   - iPhone:  a 32-byte key kept in the iOS Keychain (MessagingKeys plugin),
//              imported as non-extractable on each launch.
// Clearing site data deletes it all; that browser is then simply re-linked (§0, 2).
//
// withLock() serializes everything that reads-then-writes a record (MESSAGING_DESIGN.md
// §4 app-layer rule: two tabs must never both advance one session).

import { toB64, fromB64 } from "./crypto/bytes.js";

export function encodeValue(v) {
  return JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? { $b: toB64(x) } : x));
}

export function decodeValue(s) {
  return JSON.parse(s, (_k, x) => (x && typeof x === "object" && typeof x.$b === "string" && Object.keys(x).length === 1 ? fromB64(x.$b) : x));
}

// ---- locks ------------------------------------------------------------------------

const localChains = new Map();

// Cross-tab when the browser has Web Locks (Chrome, iOS 15.4+); otherwise one tab.
export function withLock(name, fn, locks = globalThis.navigator?.locks) {
  if (locks?.request) return locks.request(`live-msg:${name}`, { mode: "exclusive" }, () => fn());
  const prev = localChains.get(name) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  localChains.set(name, run.catch(() => {}));
  return run;
}

// ---- backends ----------------------------------------------------------------------

export function memoryBackend() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); },
    async remove(k) { m.delete(k); },
    async keys(prefix = "") { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
    async clear() { m.clear(); },
    raw: m,
  };
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(name = "live-messaging") {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// IndexedDB, every value AES-GCM encrypted. getRawWrapKey: async () => Uint8Array(32)
// | null — the iPhone's Keychain key; when null, a browser key is created and kept.
export async function idbBackend({ dbName = "live-messaging", getRawWrapKey = async () => null } = {}) {
  const db = await openDb(dbName);
  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  let key;
  const raw = await getRawWrapKey();
  if (raw) {
    key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } else {
    key = await idbRequest(tx("meta", "readonly").get("wrapKey"));
    if (!key) {
      key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await idbRequest(tx("meta", "readwrite").put(key, "wrapKey"));
    }
  }
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    async get(k) {
      const box = await idbRequest(tx("kv", "readonly").get(k));
      if (!box) return null;
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv, additionalData: enc.encode(k) }, key, box.ct);
      return dec.decode(pt);
    },
    async set(k, v) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(k) }, key, enc.encode(v));
      await idbRequest(tx("kv", "readwrite").put({ iv, ct }, k));
    },
    async remove(k) { await idbRequest(tx("kv", "readwrite").delete(k)); },
    async keys(prefix = "") {
      const all = await idbRequest(tx("kv", "readonly").getAllKeys());
      return all.filter((k) => typeof k === "string" && k.startsWith(prefix));
    },
    async clear() {
      await idbRequest(tx("kv", "readwrite").clear());
    },
  };
}

// Typed access on top of a backend.
export function createKeystore(backend) {
  return {
    async get(k) { const s = await backend.get(k); return s === null ? null : decodeValue(s); },
    async set(k, v) { await backend.set(k, encodeValue(v)); },
    async remove(k) { await backend.remove(k); },
    async keys(prefix) { return backend.keys(prefix); },
    async clear() { await backend.clear(); },
  };
}
