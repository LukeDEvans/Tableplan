// The word processor in the Safe (WORD_PROCESSOR_DESIGN.md §12). A Safe document's
// main content is the file's "content" blob (file.js, secretstream under the file
// key, as any Safe file). Its other pieces — version snapshots, images, live-editing
// messages between devices, the device's offline copy and version names — are sealed
// here with XChaCha20-Poly1305 under a key derived from the file key (its own KDF
// context, so it never doubles as a file.js subkey), each bound to the file id and
// to what the piece is ("vh07", "i<hex>", "live", "cache", "name-…"). A server that
// moves a piece onto another file or another slot gets a failure, not a quiet swap.
//
// sealPart(fileKey, fileId, part, bytes) → bytes; openPart(fileKey, fileId, part, sealed) → bytes

import { sodium } from "../../messaging/crypto/sodium.js";
import { requireKey } from "../../messaging/crypto/keys.js";
import { seal, open, contextBytes } from "./wrap.js";

const KDF_CTX = "LiveEdit"; // 8 bytes; distinct from file.js's "LiveDocs"
const LABEL = "LiveDocs/editor-part/v1";
const PART_RE = /^(content|live|cache|v(h\d\d|d\d\d|w\d\d|n[0-9a-f]{32})|i[0-9a-f]{32}|name-(h\d\d|d\d\d|w\d\d|n[0-9a-f]{32}))$/;
export const MAX_PART = 64 * 1024 * 1024;

function editorKey(fileKey) {
  requireKey("fileKey", fileKey);
  return sodium().crypto_kdf_derive_from_key(32, 1, KDF_CTX, fileKey);
}
function ad(fileId, part) {
  if (!PART_RE.test(part)) throw new Error("editor part: bad part");
  return contextBytes(LABEL, [["fileId", fileId], ["part", part]]);
}

export function sealPart(fileKey, fileId, part, bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("editor part: bytes expected");
  if (bytes.length > MAX_PART) throw new Error("editor part: too large");
  return seal(editorKey(fileKey), bytes, ad(fileId, part));
}

export function openPart(fileKey, fileId, part, sealed) {
  if (!(sealed instanceof Uint8Array) || sealed.length > MAX_PART + 64) throw new Error("editor part: bad input");
  return open(editorKey(fileKey), sealed, ad(fileId, part));
}
