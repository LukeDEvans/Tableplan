// The printed recovery code (DOCUMENTS_DESIGN.md §3.5).
//
// CODE — 32 characters from a 32-letter alphabet with no 0/O/1/I, printed as 8
// groups of 4. 28 are random (140 bits); the last 4 are a check value, so a typo
// is reported as a typo instead of "wrong code".
//
// KEYS — Argon2id (recovery-params.js) stretches the code into 64 bytes: an ANCHOR
// key (32) and the seed of an X25519 RECOVERY KEY PAIR (32).
//
// WHAT'S STORED (per person, per vault):
//   - anchor: the vault key at the time the code was made, sealed with the anchor
//     key (AEAD). Only the code can make one, so the server can't forge it.
//   - sealed: each newer vault key sealed to the recovery PUBLIC key. Any of the
//     person's devices can add one after a rotation without knowing the code —
//     but only to a recovery key the person's identity signed, at the highest
//     generation the device has seen (statements.js).
//
// RESTORE — a sealed key is accepted only if the old-key chain (vault.js
// unlockKeyring) leads from it back down to the anchor's key, which the server
// can't fake without that key. The result says how far it got, so the app can
// tell a full restore from one that came back short (rows withheld or damaged)
// and must not re-print the code after a short one.
//
// Device removal and the code: a removed device still knows the vault keys it
// held, including the anchor's. With the server's help it could build a chain
// that ends at the real anchor. So removing a device REQUIRES a new code (the app
// doesn't finish the removal until it's printed); the new anchor is a key the
// removed device never had. Restore also refuses when two different chains both
// reach the anchor.

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, field, utf8, equalBytes } from "../../messaging/crypto/bytes.js";
import { requireKey, generateDhKeyPair, dh } from "../../messaging/crypto/keys.js";
import { contextBytes, seal, openKey } from "./wrap.js";
import { unlockKeyring } from "./vault.js";
import { checkRecoveryParams } from "./recovery-params.js";

export { newRecoveryParams, encodeRecoveryParams, decodeRecoveryParams, DEFAULT_PARAMS } from "./recovery-params.js";

export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RANDOM_CHARS = 28;
const CHECK_CHARS = 4;
const CODE_LEN = RANDOM_CHARS + CHECK_CHARS;
const CHECK_LABEL = utf8("LiveDocs/recovery-check/v1");
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

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

export function formatRecoveryCode(normalized) {
  if (typeof normalized !== "string" || !CODE_RE.test(normalized)) throw new Error("recovery: not a normalized code");
  return normalized.match(/.{4}/g).join("-");
}

// Accepts what a person types or pastes: any case, spaces, any kind of dash.
// Returns the 32-character form or throws a message fit to show.
export function parseRecoveryCode(input) {
  const n = String(input ?? "").toUpperCase().replace(/[\s\p{Pd}]+/gu, "");
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

// params = { salt (16 bytes), ops, memKiB } — stored with the person's recovery key.
export function deriveRecoveryKeys(code, params) {
  const normalized = parseRecoveryCode(code);
  checkRecoveryParams(params);
  const s = sodium();
  const out = s.crypto_pwhash(64, utf8(normalized), params.salt, params.ops, params.memKiB * 1024, s.crypto_pwhash_ALG_ARGON2ID13);
  const kp = s.crypto_box_seed_keypair(out.subarray(32, 64));
  return { anchorKey: out.slice(0, 32), recoveryPub: kp.publicKey, recoveryPriv: kp.privateKey };
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

// Made by any device of the person, only after verifyRecoveryPub (statements.js)
// at the highest generation it has seen.
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
//
// Returns {
//   key, version        — the newest key proven to descend from the anchor,
//   anchorVersion,
//   newestOffered       — the highest version any sealed row claimed,
//   complete            — version === newestOffered (nothing newer was offered),
//   rejected            — versions offered that didn't open or didn't prove out,
// }.
// The app compares `version` with the vault's current version: if it's lower, the
// restore is SHORT — newer files won't open. Warn, keep the old code, and don't
// re-print or rotate on top of a short restore.
// Throws if the anchor won't open (wrong code, or a damaged or substituted record
// — the message says so without claiming which), or if two different chains both
// reach the anchor (a sign of tampering).
export function restoreVaultKey({ keys, base, anchor, sealed = [], oldRows = [] }) {
  let anchorVaultKey;
  try {
    anchorVaultKey = openKey(keys.anchorKey, anchor.wrapped, anchorCtx({ ...base, keyVersion: anchor.keyVersion }));
  } catch {
    throw new Error("recovery: couldn't open the recovery record with this code");
  }
  const offered = sealed.filter((r) => r && typeof r.keyVersion === "number" && Number.isInteger(r.keyVersion) && r.keyVersion > anchor.keyVersion);
  const newestOffered = offered.reduce((m, r) => Math.max(m, r.keyVersion), anchor.keyVersion);
  const proven = [];
  const rejected = [];
  for (const r of offered) {
    let key, ring;
    try {
      key = openSealed(keys, r.sealed, { ...base, keyVersion: r.keyVersion });
      ring = unlockKeyring({ vaultId: base.vaultId, scope: base.scope, current: { key, version: r.keyVersion }, oldRows });
    } catch {
      rejected.push(r.keyVersion);
      continue;
    }
    const reached = ring.get(anchor.keyVersion);
    if (reached && equalBytes(reached, anchorVaultKey)) proven.push({ version: r.keyVersion, key, ring });
    else rejected.push(r.keyVersion);
  }
  proven.sort((a, b) => b.version - a.version);
  const top = proven[0];
  // Every proven candidate must agree with the newest one's chain.
  for (const p of proven.slice(1)) {
    const k = top.ring.get(p.version);
    if (!k || !equalBytes(k, p.key)) throw new Error("recovery: conflicting keys in the recovery record");
  }
  const result = top ? { key: top.key, version: top.version } : { key: anchorVaultKey, version: anchor.keyVersion };
  return {
    ...result,
    anchorVersion: anchor.keyVersion,
    newestOffered,
    complete: result.version === newestOffered,
    rejected: [...new Set(rejected)].sort((a, b) => a - b),
  };
}
