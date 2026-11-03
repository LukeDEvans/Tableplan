// Vault keys, file keys, folder names and key rotation (DOCUMENTS_DESIGN.md §3.1,
// §3.4).
//
//   vault key (one per scope: Household, Personal; versioned)
//     ├─ wraps each document's FILE KEY        (doc_files.wrapped_key)
//     ├─ encrypts each FOLDER NAME             (doc_folders.enc_name)
//     └─ (version v+1) wraps version v          (doc_vault_keys_old)
//
// Every wrap is bound to where it lives (vault id, scope, file/folder id, key
// version) through wrap.js's context, so rows can't be swapped around.
//
// Rotation (after a device is removed): a new vault key at version v+1; the old key
// is wrapped under the new one, so files not yet re-wrapped still open; then each
// file key and folder name is re-wrapped to v+1. Older versions form a chain
// (v under v+1, v-1 under v, …) and unlockKeyring walks it.

import { utf8, fromUtf8 } from "../../messaging/crypto/bytes.js";
import { pad, unpad } from "../../messaging/crypto/padding.js";
import { requireKey } from "../../messaging/crypto/keys.js";
import { contextBytes, seal, open, openKey, randomKey } from "./wrap.js";

export const generateVaultKey = randomKey;
export const generateFileKey = randomKey;

const fileKeyCtx = ({ vaultId, scope, fileId, keyVersion }) =>
  contextBytes("LiveDocs/file-key/v1", [["vaultId", vaultId], ["scope", scope], ["fileId", fileId], ["keyVersion", keyVersion]]);

const folderCtx = ({ vaultId, scope, folderId, keyVersion }) =>
  contextBytes("LiveDocs/folder-name/v1", [["vaultId", vaultId], ["scope", scope], ["folderId", folderId], ["keyVersion", keyVersion]]);

const oldKeyCtx = ({ vaultId, scope, version }) =>
  contextBytes("LiveDocs/old-vault-key/v1", [["vaultId", vaultId], ["scope", scope], ["oldVersion", version], ["newVersion", version + 1]]);

// ---- file keys ------------------------------------------------------------------

export function wrapFileKey(vaultKey, fileKey, ctx) {
  requireKey("file key", fileKey);
  return seal(vaultKey, fileKey, fileKeyCtx(ctx));
}

export function unwrapFileKey(vaultKey, wrapped, ctx) {
  return openKey(vaultKey, wrapped, fileKeyCtx(ctx));
}

// Re-wrap one file key: rotation (same scope, new version) or a move between
// Household and Personal (other vault and scope). The blobs don't change — they
// are bound to the file id only, not to the scope.
export function rewrapFileKey(fromVaultKey, wrapped, from, toVaultKey, to) {
  if (from.fileId !== to.fileId) throw new Error("vault: a re-wrap keeps the file id");
  return wrapFileKey(toVaultKey, unwrapFileKey(fromVaultKey, wrapped, from), to);
}

// ---- folder names -------------------------------------------------------------

export const FOLDER_NAME_MAX = 80;

function cleanFolderName(name) {
  const n = typeof name === "string" ? name.normalize("NFC").trim() : "";
  if (!n || [...n].length > FOLDER_NAME_MAX) throw new Error(`folder name must be 1–${FOLDER_NAME_MAX} characters`);
  return n;
}

// Padded to 64-byte blocks so the stored size doesn't give the name's length away.
export function encryptFolderName(vaultKey, name, ctx) {
  return seal(vaultKey, pad(utf8(cleanFolderName(name))), folderCtx(ctx));
}

export function decryptFolderName(vaultKey, encName, ctx) {
  return cleanFolderName(fromUtf8(unpad(open(vaultKey, encName, folderCtx(ctx)))));
}

export function rewrapFolderName(fromVaultKey, encName, from, toVaultKey, to) {
  if (from.folderId !== to.folderId) throw new Error("vault: a re-wrap keeps the folder id");
  return encryptFolderName(toVaultKey, decryptFolderName(fromVaultKey, encName, from), to);
}

// ---- rotation & older versions -------------------------------------------------

function requireVersion(v) {
  if (!Number.isInteger(v) || v < 1 || v >= 0xffffffff) throw new Error("vault: bad key version");
}

// Returns the new current key and the row for doc_vault_keys_old (the old key,
// wrapped under the new one).
export function rotateVault({ vaultId, scope, key, version }) {
  requireKey("vault key", key);
  requireVersion(version);
  const next = generateVaultKey();
  return {
    key: next,
    version: version + 1,
    oldRow: { version, wrapped: seal(next, key, oldKeyCtx({ vaultId, scope, version })) },
  };
}

// current = { key, version }; oldRows = [{ version, wrapped }] from the server.
// Returns Map(version → key) for every version reachable by the chain. A row that
// doesn't open (wrong key, moved from another vault) stops the walk there — older
// files then report "can't open" rather than opening under a planted key.
export function unlockKeyring({ vaultId, scope, current, oldRows = [] }) {
  requireKey("vault key", current.key);
  requireVersion(current.version);
  const byVersion = new Map();
  for (const r of oldRows) {
    if (!r || !Number.isInteger(r.version)) continue;
    if (byVersion.has(r.version)) throw new Error("vault: duplicate old key version");
    byVersion.set(r.version, r.wrapped);
  }
  const ring = new Map([[current.version, current.key]]);
  let v = current.version;
  let k = current.key;
  while (v > 1 && byVersion.has(v - 1)) {
    try {
      k = openKey(k, byVersion.get(v - 1), oldKeyCtx({ vaultId, scope, version: v - 1 }));
    } catch {
      break;
    }
    v -= 1;
    ring.set(v, k);
  }
  return ring;
}
