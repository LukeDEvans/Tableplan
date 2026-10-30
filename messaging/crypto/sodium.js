// Loads libsodium once. Everything in messaging/crypto/ gets its primitives from
// here, so the library is only pulled in when messaging is actually used (the app
// imports messaging lazily; libsodium is ~1 MB of WebAssembly).
//
// Pinned to libsodium-wrappers-sumo 0.7.15 exactly: 0.7.16's ESM build imports a
// file that isn't in the package (PAPERCUTS.md, 2026-10-30). "sumo" is needed for
// the streaming HMAC-SHA256 API used by hkdf.js.

import sodiumModule from "libsodium-wrappers-sumo";

let readyPromise = null;

export function loadSodium() {
  if (!readyPromise) readyPromise = sodiumModule.ready.then(() => sodiumModule);
  return readyPromise;
}

// Synchronous access for code that runs after loadSodium() has resolved.
export function sodium() {
  if (!readyPromise) throw new Error("messaging crypto: call loadSodium() first");
  return sodiumModule;
}
