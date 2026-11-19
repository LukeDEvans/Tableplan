// HMAC-SHA256 and HKDF-SHA256 (RFC 2104 / RFC 5869) on libsodium's streaming HMAC,
// which accepts keys of any length. libsodium.js has no HKDF of its own.
// Checked against the RFC 4231 and RFC 5869 test vectors (test/messaging-crypto-kdf).

import { sodium } from "./sodium.js";
import { concat } from "./bytes.js";

export function hmacSha256(key, data) {
  const s = sodium();
  const st = s.crypto_auth_hmacsha256_init(key);
  s.crypto_auth_hmacsha256_update(st, data);
  return s.crypto_auth_hmacsha256_final(st);
}

export function hkdfExtract(salt, ikm) {
  return hmacSha256(salt && salt.length ? salt : new Uint8Array(32), ikm);
}

export function hkdfExpand(prk, info, length) {
  if (length > 255 * 32) throw new Error("hkdf: length too large");
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let o = 0;
  for (let i = 1; o < length; i++) {
    prev = hmacSha256(prk, concat(prev, info, Uint8Array.of(i)));
    out.set(prev.subarray(0, Math.min(32, length - o)), o);
    o += 32;
  }
  return out;
}

export const hkdf = (salt, ikm, info, length) => hkdfExpand(hkdfExtract(salt, ikm), info, length);
