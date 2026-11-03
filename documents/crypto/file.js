// Encrypted document blobs (DOCUMENTS_DESIGN.md §4).
//
// Each document has a random FILE KEY. Its parts are separate encrypted blobs, each under its own subkey derived from the file
// key (crypto_kdf, one id per part), so a server can't swap the thumbnail in for
// the content. Parts: content, thumb, meta (name etc., in the database row) and
// text (what was read from the pages, for search).
//
// A blob is libsodium's secretstream (XChaCha20-Poly1305) in fixed-size chunks:
//
//   header:  "LDOC" ‖ version (1) ‖ part (1) ‖ chunk size (u32)      — 10 bytes
//   stream:  secretstream header (24)
//   chunks:  every chunk but the last is exactly chunkSize + 17 bytes;
//            the last is shorter or equal and carries the FINAL tag.
//
// Associated data on every chunk = header ‖ fileId, so the header can't be edited
// and a blob only opens as the file it was made for. Secretstream itself rejects
// reordered, dropped, repeated or extra chunks; a stream that ends without FINAL
// is refused as truncated. An empty file is one FINAL chunk with nothing in it.
//
// Whole-buffer API: scanned documents are a few MB and the app caps uploads at
// 50 MB (§15), so streaming isn't needed yet. MAX_PLAINTEXT is a hard ceiling so
// a hostile header can't make a device allocate without bound.

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, field, utf8, u32, readU32 } from "../../messaging/crypto/bytes.js";
import { requireId, requireKey } from "../../messaging/crypto/keys.js";

const MAGIC = utf8("LDOC");
const VERSION = 1;
const HEADER_LEN = 10;
const SS_HEADER = 24;
const ABYTES = 17;

export const DEFAULT_CHUNK = 64 * 1024;
const MIN_CHUNK = 4 * 1024;
const MAX_CHUNK = 1024 * 1024;
export const MAX_PLAINTEXT = 256 * 1024 * 1024;

export const PARTS = Object.freeze({ content: 1, thumb: 2, meta: 3, text: 4 });
const KDF_CTX = "LiveDocs"; // crypto_kdf context: exactly 8 bytes

function partId(part) {
  const id = PARTS[part];
  if (!id) throw new Error(`file: unknown part ${part}`);
  return id;
}

function subkey(fileKey, part) {
  requireKey("file key", fileKey);
  return sodium().crypto_kdf_derive_from_key(32, partId(part), KDF_CTX, fileKey);
}

function headerBytes(part, chunkSize) {
  return concat(MAGIC, Uint8Array.of(VERSION, partId(part)), u32(chunkSize));
}

const chunkAd = (header, fileId) => concat(header, field(utf8(fileId)));

export function encryptBlob(fileKey, fileId, part, plaintext, { chunkSize = DEFAULT_CHUNK } = {}) {
  requireId("fileId", fileId);
  if (!(plaintext instanceof Uint8Array)) throw new Error("file: plaintext must be bytes");
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("file: too large");
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) throw new Error("file: bad chunk size");
  const s = sodium();
  const key = subkey(fileKey, part);
  const header = headerBytes(part, chunkSize);
  const ad = chunkAd(header, fileId);
  const { state, header: ssHeader } = s.crypto_secretstream_xchacha20poly1305_init_push(key);
  const out = [header, ssHeader];
  const MSG = s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
  const FINAL = s.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
  let o = 0;
  // A plaintext that is an exact multiple of chunkSize (including 0) ends with an
  // empty FINAL chunk, so the reader can always tell where the stream ends.
  for (;;) {
    const end = Math.min(o + chunkSize, plaintext.length);
    const last = end === plaintext.length && (end - o < chunkSize);
    out.push(s.crypto_secretstream_xchacha20poly1305_push(state, plaintext.subarray(o, end), ad, last ? FINAL : MSG));
    o = end;
    if (last) break;
  }
  return concat(...out);
}

// Reads just the unencrypted header (to check a blob before downloading the rest).
export function readBlobHeader(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < HEADER_LEN) throw new Error("file: too short");
  for (let i = 0; i < 4; i++) if (blob[i] !== MAGIC[i]) throw new Error("file: not a document blob");
  if (blob[4] !== VERSION) throw new Error("file: unknown version");
  const part = Object.keys(PARTS).find((k) => PARTS[k] === blob[5]);
  if (!part) throw new Error("file: unknown part");
  const chunkSize = readU32(blob, 6);
  if (chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) throw new Error("file: bad chunk size");
  return { part, chunkSize };
}

export function decryptBlob(fileKey, fileId, part, blob) {
  requireId("fileId", fileId);
  const h = readBlobHeader(blob);
  if (h.part !== part) throw new Error("file: wrong part");
  const s = sodium();
  const header = blob.subarray(0, HEADER_LEN);
  const ad = chunkAd(header, fileId);
  if (blob.length < HEADER_LEN + SS_HEADER + ABYTES) throw new Error("file: truncated");
  const state = s.crypto_secretstream_xchacha20poly1305_init_pull(blob.subarray(HEADER_LEN, HEADER_LEN + SS_HEADER), subkey(fileKey, part));
  const FINAL = s.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
  const MSG = s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
  const frame = h.chunkSize + ABYTES;
  const body = blob.subarray(HEADER_LEN + SS_HEADER);
  const parts = [];
  let o = 0;
  let total = 0;
  let finished = false;
  while (o < body.length) {
    if (finished) throw new Error("file: data after the end");
    const c = body.subarray(o, Math.min(o + frame, body.length));
    if (c.length < ABYTES) throw new Error("file: truncated");
    const r = s.crypto_secretstream_xchacha20poly1305_pull(state, c, ad);
    if (!r) throw new Error("file: can't decrypt (wrong key, wrong file, or damaged)");
    o += c.length;
    if (r.tag === FINAL) {
      if (o !== body.length) throw new Error("file: data after the end");
      finished = true;
    } else if (r.tag !== MSG || c.length !== frame) {
      throw new Error("file: bad chunk");
    }
    total += r.message.length;
    if (total > MAX_PLAINTEXT) throw new Error("file: too large");
    parts.push(r.message);
  }
  if (!finished) throw new Error("file: truncated");
  return concat(...parts);
}
