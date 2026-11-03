// Statements signed by a person's PRIMARY IDENTITY (the Ed25519 key that lives
// only on their phone — messaging/crypto/keys.js). Devices check them against the
// identity they have PINNED for that person, never one supplied by the server.
//
// Only the identity can sign these, so a linked device that has been removed —
// whose device certificate still verifies — can't forge them.
//
// VAULT SETTLED — "vault V (scope S) is now at key version N, and these devices
// are removed". Signed on the phone after a rotation has re-wrapped everything.
// Each device keeps, per vault, the highest settled version it has verified and
// the removed device ids from every statement it accepted. Then:
//   - file and folder rows below that version are refused (vault.js
//     rowVersionAllowed), so an old key can't add new documents;
//   - grants from, and grants to, a removed device are refused;
//   - a removed device is never offered the new key.
// The removed list is cumulative (each statement repeats earlier removals), so a
// device that only ever sees the newest statement still knows all of them.
//
// RECOVERY KEY — "my recovery public key is P (made with these Argon2 settings),
// generation G". Each device keeps the highest generation it has verified per
// person and refuses a lower one, so after a re-print the old sheet's key stops
// receiving new vault keys even if the server keeps offering it.

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, field, utf8, u32 } from "../../messaging/crypto/bytes.js";
import { requireId, requireKey, generateDhKeyPair, dh } from "../../messaging/crypto/keys.js";
import { encodeRecoveryParams } from "./recovery-params.js";

const SETTLED_LABEL = utf8("LiveDocs/vault-settled/v1");
const RECOVERY_LABEL = utf8("LiveDocs/recovery-key/v1");
const MAX_REMOVED = 500;

const isSig = (s) => s instanceof Uint8Array && s.length === 64;

function requireCount(name, n) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 0xffffffff) throw new Error(`${name} must be a positive whole number`);
}

function settledBytes({ userId, vaultId, scope, keyVersion, removedDeviceIds }) {
  requireId("userId", userId);
  requireId("vaultId", vaultId);
  requireId("scope", scope);
  requireCount("keyVersion", keyVersion);
  if (!Array.isArray(removedDeviceIds) || removedDeviceIds.length > MAX_REMOVED) throw new Error("settled: bad removed list");
  const ids = [...new Set(removedDeviceIds)];
  ids.forEach((d) => requireId("removed deviceId", d));
  ids.sort();
  return concat(field(SETTLED_LABEL), field(utf8(userId)), field(utf8(vaultId)), field(utf8(scope)), u32(keyVersion), u32(ids.length), ...ids.map((d) => field(utf8(d))));
}

// identity = { signPub, signPriv } of the person signing (a member of the scope).
export function signVaultSettled(identity, statement) {
  return sodium().crypto_sign_detached(settledBytes(statement), identity.signPriv);
}

// identitySignPub = the PINNED identity of statement.userId; the app also checks
// that userId may hold the scope.
export function verifyVaultSettled(identitySignPub, statement, sig) {
  try {
    requireKey("identity signPub", identitySignPub);
    if (!isSig(sig)) return false;
    return sodium().crypto_sign_verify_detached(sig, settledBytes(statement), identitySignPub);
  } catch {
    return false;
  }
}

function recoveryBytes({ userId, recoveryPub, params, generation }) {
  requireId("userId", userId);
  requireKey("recovery public key", recoveryPub);
  requireCount("generation", generation);
  return concat(field(RECOVERY_LABEL), field(utf8(userId)), field(recoveryPub), field(encodeRecoveryParams(params)), u32(generation));
}

export function signRecoveryPub(identity, statement) {
  dh(generateDhKeyPair().priv, statement.recoveryPub);
  return sodium().crypto_sign_detached(recoveryBytes(statement), identity.signPriv);
}

export function verifyRecoveryPub(identitySignPub, statement, sig) {
  try {
    requireKey("identity signPub", identitySignPub);
    if (!isSig(sig)) return false;
    dh(generateDhKeyPair().priv, statement.recoveryPub);
    return sodium().crypto_sign_verify_detached(sig, recoveryBytes(statement), identitySignPub);
  } catch {
    return false;
  }
}
