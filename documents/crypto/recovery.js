// The printed recovery code (DOCUMENTS_DESIGN.md §3.5).
//
// CODE — 32 characters from a 32-letter alphabet with no 0/O/1/I, printed as 8
// groups of 4. 28 are random (140 bits); the last 4 are a check value, so a typo
// is reported as a typo instead of "wrong code".
//
// KEYS — Argon2id stretches the code into 64 bytes: an ANCHOR key (32) and the
// seed of an X25519 RECOVERY KEY PAIR (32). Argon2id is a second line of defence;
// 140 random bits can't be guessed anyway.
//
// WHAT'S STORED (per person, per vault):
//   - anchor: the vault key at the time the code was made, sealed with the anchor
//     key (AEAD). Only the code can make one, so it can't be forged.
//   - sealed: each newer vault key sealed to the recovery PUBLIC key. Any of the
//     person's devices can add one after a rotation without knowing the code.
//   - recoveryPub, signed by the device that made the code, so devices only ever
//     seal to the real one (verifyRecoveryPub against a verified certificate).
//
// RESTORE — the newest sealed key is accepted only if the old-key chain
// (vault.js unlockKeyring) leads from it back down to the anchor's key. A server
// can't fake that chain without knowing the anchor key.
//
// Known limit: a device removed from the account still knows the old keys; with
// the server's help it could build a fake chain. Re-printing the code after
// removing a device closes that (the app offers it).

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, field, utf8, u32, readU32, equalBytes } from "../../messaging/crypto/bytes.js";
import { requireId, requireKey, generateDhKeyPair, dh } from "../../messaging/crypto/keys.js";
import { contextBytes, seal, openKey } from "./wrap.js";
import { unlockKeyring } from "./vault.js";

export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RANDOM_CHARS = 28;
const CHECK_CHARS = 4;
const CODE_LEN = RANDOM_CHARS + CHECK_CHARS;
const CHECK_LABEL = utf8("LiveDocs/recovery-check/v1");
const RECOVERY_PUB_LABEL = utf8("LiveDocs/recovery-pub/v1");
const PARAMS_VERSION = 1;

// Argon2id cost. 64 MiB fits the iPhone web view; ~0.3 s in Node, ~1 s on a phone.
export const DEFAULT_PARAMS = Object.freeze({ ops: 3, memKiB: 64 * 1024 });
const MIN_OPS = 1, MAX_OPS = 10, MIN_MEM_KIB = 8 * 1024, MAX_MEM_KIB = 256 * 1024;

// ---- the code ---------------------------------------------------------------------

function checkChars(randomPart) {
  const h = sodium().crypto_generichash(4, concat(CHECK_LABEL, utf8(randomPart)));
  let n = ((h[0] << 16) | (h[1] << 8) | h[2]) >>> 4; // 20 bits
  let out = "";
  for (let i = 0; i < CHECK_CHARS; i++) { out = ALPHABET[n & 31] + out; n >>>= 5; }
  return out;
}

export function generateRecoveryCode() {
  const s = sodium();
  let r = "";
  for (let i = 0; i < RANDOM_CHARS; i++) r += ALPHABET[s.randombytes_uniform(32)];
  return formatRecoveryCode(r + checkChars(r));
}

export const formatRecoveryCode = (normalized) => normalized.match(/.{4}/g).join("-");

// Accepts what a person types: any case, spaces or dashes. Returns the 32-character
// form or throws a message fit to show.
export function parseRecoveryCode(input) {
  const n = String(input ?? "").toUpperCase().replace(/[\s-]+/g, "");
  if (n.length !== CODE_LEN) throw new Error(`The recovery code has ${CODE_LEN} characters (8 groups of 4).`);
  for (const ch of n) {
    if (!ALPHABET.includes(ch)) {
      throw new Error(/[0O1I]/.test(ch)
        ? "The code never uses 0, O, 1 or I — check that character."
        : `"${ch}" isn't used in recovery codes.`);
    }
  }
  if (checkChars(n.slice(0, RANDOM_CHARS)) !== n.slice(RANDOM_CHARS)) throw new Error("That code has a typo — check each group.");
  return n;
}

// ---- keys from the code ----------------------------------------------------------

function checkParams({ ops, memKiB }) {
  if (!Number.isInteger(ops) || ops < MIN_OPS || ops > MAX_OPS) throw new Error("recovery: bad cost");
  if (!Number.isInteger(memKiB) || memKiB < MIN_MEM_KIB || memKiB > MAX_MEM_KIB) throw new Error("recovery: bad memory cost");
}

// params = { salt (16 bytes), ops, memKiB } — stored with the person's recovery row.
export function deriveRecoveryKeys(code, params) {
  const normalized = parseRecoveryCode(code);
  checkParams(params);
  if (!(params.salt instanceof Uint8Array) || params.salt.length !== 16) throw new Error("recovery: bad salt");
  const s = sodium();
  const out = s.crypto_pwhash(64, utf8(normalized), params.salt, params.ops, params.memKiB * 1024, s.crypto_pwhash_ALG_ARGON2ID13);
  const kp = s.crypto_box_seed_keypair(out.subarray(32, 64));
  return { anchorKey: out.slice(0, 32), recoveryPub: kp.publicKey, recoveryPriv: kp.privateKey };
}

export function newRecoveryParams() {
  return { salt: sodium().randombytes_buf(16), ...DEFAULT_PARAMS };
}

// Stored form of params: version ‖ ops ‖ memKiB ‖ salt.
export function encodeRecoveryParams({ salt, ops, memKiB }) {
  checkParams({ ops, memKiB });
  return concat(Uint8Array.of(PARAMS_VERSION), u32(ops), u32(memKiB), salt);
}

export function decodeRecoveryParams(b) {
  if (!(b instanceof Uint8Array) || b.length !== 1 + 4 + 4 + 16 || b[0] !== PARAMS_VERSION) throw new Error("recovery: bad params");
  const p = { ops: readU32(b, 1), memKiB: readU32(b, 5), salt: b.slice(9) };
  checkParams(p);
  return p;
}

// ---- recovery public key, vouched for by a device --------------------------------

const recoveryPubBytes = ({ userId, recoveryPub, params }) => {
  requireId("userId", userId);
  requireKey("recovery public key", recoveryPub);
  return concat(field(RECOVERY_PUB_LABEL), field(utf8(userId)), field(recoveryPub), field(encodeRecoveryParams(params)));
};

export function signRecoveryPub(device, { userId, recoveryPub, params }) {
  dh(generateDhKeyPair().priv, recoveryPub);
  return sodium().crypto_sign_detached(recoveryPubBytes({ userId, recoveryPub, params }), device.signPriv);
}

// deviceSignPub must come from a certificate verified against the person's pinned
// identity, and that device must belong to userId.
export function verifyRecoveryPub(deviceSignPub, { userId, recoveryPub, params }, sig) {
  try {
    requireKey("device signPub", deviceSignPub);
    if (!(sig instanceof Uint8Array) || sig.length !== 64) return false;
    dh(generateDhKeyPair().priv, recoveryPub);
    return sodium().crypto_sign_verify_detached(sig, recoveryPubBytes({ userId, recoveryPub, params }), deviceSignPub);
  } catch {
    return false;
  }
}

// ---- wraps --------------------------------------------------------------------------

const anchorCtx = ({ userId, vaultId, scope, keyVersion }) =>
  contextBytes("LiveDocs/recovery-anchor/v1", [["userId", userId], ["vaultId", vaultId], ["scope", scope], ["keyVersion", keyVersion]]);

const sealedCtx = ({ userId, vaultId, scope, keyVersion }, recoveryPub) => concat(
  contextBytes("LiveDocs/recovery-sealed/v1", [["userId", userId], ["vaultId", vaultId], ["scope", scope], ["keyVersion", keyVersion]]),
  field(recoveryPub),
);

// Made while the code is on screen (setup, re-print, restore).
export function wrapAnchor(anchorKey, vaultKey, ctx) {
  requireKey("vault key", vaultKey);
  return seal(anchorKey, vaultKey, anchorCtx(ctx));
}

// Made by any device of the person, after checking recoveryPub with verifyRecoveryPub.
export function sealToRecovery(recoveryPub, vaultKey, ctx) {
  requireKey("vault key", vaultKey);
  dh(generateDhKeyPair().priv, recoveryPub);
  const context = sealedCtx(ctx, recoveryPub);
  return sodium().crypto_box_seal(concat(field(context), vaultKey), recoveryPub);
}

function openSealed(keys, sealedBytes, ctx) {
  const context = field(sealedCtx(ctx, keys.recoveryPub));
  let inner;
  try {
    inner = sodium().crypto_box_seal_open(sealedBytes, keys.recoveryPub, keys.recoveryPriv);
  } catch {
    throw new Error("recovery: can't open");
  }
  if (inner.length !== context.length + 32 || !equalBytes(inner.subarray(0, context.length), context)) throw new Error("recovery: sealed for somewhere else");
  return inner.slice(context.length);
}

// keys = deriveRecoveryKeys(code, params). base = { userId, vaultId, scope }.
// anchor = { keyVersion, wrapped }; sealed = [{ keyVersion, sealed }];
// oldRows = doc_vault_keys_old rows for the vault.
// Returns { key, version } for the newest version that provably descends to the anchor.
export function restoreVaultKey({ keys, base, anchor, sealed = [], oldRows = [] }) {
  const anchorVaultKey = openKey(keys.anchorKey, anchor.wrapped, anchorCtx({ ...base, keyVersion: anchor.keyVersion }));
  const candidates = sealed
    .filter((r) => Number.isInteger(r?.keyVersion) && r.keyVersion > anchor.keyVersion)
    .sort((a, b) => b.keyVersion - a.keyVersion);
  for (const r of candidates) {
    let key;
    try { key = openSealed(keys, r.sealed, { ...base, keyVersion: r.keyVersion }); } catch { continue; }
    let ring;
    try { ring = unlockKeyring({ vaultId: base.vaultId, scope: base.scope, current: { key, version: r.keyVersion }, oldRows }); } catch { continue; }
    const reached = ring.get(anchor.keyVersion);
    if (reached && equalBytes(reached, anchorVaultKey)) return { key, version: r.keyVersion };
  }
  return { key: anchorVaultKey, version: anchor.keyVersion };
}
