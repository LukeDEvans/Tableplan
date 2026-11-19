// Small-secret encryption for Documents (DOCUMENTS_DESIGN.md §3, §4): a 32-byte key
// wrapped under another key, or a short value (a folder name) under the vault key.
//
// XChaCha20-Poly1305 with a random 24-byte nonce. Every call names its CONTEXT —
// a label plus the ids it belongs to — which goes in as associated data, so a
// wrapped value only opens in the exact place it was made for. A server that moves
// a wrapped file key onto another file, another scope or another key version gets
// a failure, not a quietly wrong key.
//
// Wire: version (1) ‖ nonce (24) ‖ ciphertext.

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, field, utf8, u32 } from "../../messaging/crypto/bytes.js";
import { requireId, requireKey } from "../../messaging/crypto/keys.js";

const WRAP_VERSION = 1;
const NONCE = 24;
const TAG = 16;

export const KEY_BYTES = 32;

// A context is a label plus [name, value] pairs. Each field's TYPE is fixed by its
// name — the names in NUMERIC_FIELDS are u32 numbers, every other name is an id —
// and written as a type byte, so "1" and 1 can never be confused (a version read
// back from a database as text is refused, not quietly encoded differently).
// Every field is length-prefixed or fixed-size, so values can't be re-split.
const NUMERIC_FIELDS = new Set(["keyVersion", "oldVersion", "newVersion", "generation"]);
const T_ID = 1, T_U32 = 2;

export function contextBytes(label, parts) {
  if (typeof label !== "string" || !/^LiveDocs\/[a-z-]+\/v\d+$/.test(label)) throw new Error("wrap: bad label");
  const out = [field(utf8(label))];
  for (const [name, value] of parts) {
    out.push(field(utf8(name)));
    if (NUMERIC_FIELDS.has(name)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 0xffffffff) throw new Error(`${name} must be a positive whole number`);
      out.push(Uint8Array.of(T_U32), u32(value));
    } else {
      requireId(name, value);
      out.push(Uint8Array.of(T_ID), field(utf8(value)));
    }
  }
  return concat(...out);
}

export function seal(key, plaintext, ad) {
  requireKey("wrapping key", key);
  if (!(plaintext instanceof Uint8Array)) throw new Error("wrap: plaintext must be bytes");
  const s = sodium();
  const nonce = s.randombytes_buf(NONCE);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, concat(Uint8Array.of(WRAP_VERSION), ad), null, nonce, key);
  return concat(Uint8Array.of(WRAP_VERSION), nonce, ct);
}

export function open(key, wrapped, ad) {
  requireKey("wrapping key", key);
  if (!(wrapped instanceof Uint8Array) || wrapped.length < 1 + NONCE + TAG) throw new Error("wrap: too short");
  if (wrapped[0] !== WRAP_VERSION) throw new Error("wrap: unknown version");
  const nonce = wrapped.subarray(1, 1 + NONCE);
  try {
    return sodium().crypto_aead_xchacha20poly1305_ietf_decrypt(null, wrapped.subarray(1 + NONCE), concat(Uint8Array.of(WRAP_VERSION), ad), nonce, key);
  } catch {
    throw new Error("wrap: can't open (wrong key or wrong place)");
  }
}

export function openKey(key, wrapped, ad) {
  const out = open(key, wrapped, ad);
  if (out.length !== KEY_BYTES) throw new Error("wrap: not a key");
  return out;
}

export const randomKey = () => sodium().randombytes_buf(KEY_BYTES);
