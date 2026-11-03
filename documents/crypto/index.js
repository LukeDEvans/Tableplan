// The Documents crypto core's public API (DOCUMENTS_DESIGN.md §3–4). The rest of
// the app imports only from here, lazily (await import(...)), after loadSodium().
// It shares libsodium, byte helpers and device keys with messaging/crypto/.

export { loadSodium } from "../../messaging/crypto/sodium.js";
export { toB64, fromB64 } from "../../messaging/crypto/bytes.js";

export {
  generateVaultKey, generateFileKey,
  wrapFileKey, unwrapFileKey, rewrapFileKey,
  encryptFolderName, decryptFolderName, rewrapFolderName, FOLDER_NAME_MAX,
  rotateVault, unlockKeyring,
} from "./vault.js";

export { encryptBlob, decryptBlob, readBlobHeader, PARTS, MAX_PLAINTEXT } from "./file.js";
export { parseMeta, encryptMeta, decryptMeta, encryptText, decryptText, LIMITS as META_LIMITS } from "./meta.js";
export { generateBoxKey, signBoxKey, verifyBoxKey, createGrant, openGrant } from "./grants.js";
export {
  generateRecoveryCode, parseRecoveryCode, formatRecoveryCode,
  newRecoveryParams, encodeRecoveryParams, decodeRecoveryParams, deriveRecoveryKeys,
  signRecoveryPub, verifyRecoveryPub, wrapAnchor, sealToRecovery, restoreVaultKey,
} from "./recovery.js";
