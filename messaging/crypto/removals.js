// "DEVICES REMOVED" — a statement signed by a person's PRIMARY IDENTITY (the key that
// lives only on their phone): "these are all of my removed devices, generation G".
//
// Why: a removed linked device's certificate still verifies against the identity, so
// without this the only record of a removal is msg_devices.revoked_at, which the
// server sets — and could clear. Senders verify this list against the identity THEY
// pinned and never send to a device on it (account.js resolveDevices). The list is
// cumulative, and each device keeps the union of every list it has verified, so a
// server that serves an older list can't bring a device back. Same idea as the
// Documents "vault settled" statement (documents/crypto/statements.js).
//
// The person's userId is inside the signed bytes, so one person's statement can't be
// passed off as another's.

import { sodium } from "./sodium.js";
import { concat, field, utf8, u32 } from "./bytes.js";
import { requireId, requireKey } from "./keys.js";

const LABEL = utf8("LiveMsg/devices-removed/v1");
export const MAX_REMOVED_DEVICES = 500;

const isSig = (s) => s instanceof Uint8Array && s.length === 64;

// The ids, de-duplicated, lower-cased and sorted, so the same set always signs the same.
export function canonicalRemovedIds(ids) {
  if (!Array.isArray(ids)) throw new Error("removals: bad list");
  const out = [...new Set(ids.map((d) => { requireId("removed deviceId", d); return String(d).toLowerCase(); }))].sort();
  if (out.length > MAX_REMOVED_DEVICES) throw new Error("removals: too many devices");
  return out;
}

function removalBytes({ userId, generation, removedDeviceIds }) {
  requireId("userId", userId);
  if (!Number.isInteger(generation) || generation < 1 || generation > 0xffffffff) throw new Error("removals: bad generation");
  const ids = canonicalRemovedIds(removedDeviceIds);
  return concat(field(LABEL), field(utf8(String(userId).toLowerCase())), u32(generation), u32(ids.length), ...ids.map((d) => field(utf8(d))));
}

// identity = { signPub, signPriv } — the phone's identity key.
export function signDeviceRemovals(identity, statement) {
  return sodium().crypto_sign_detached(removalBytes(statement), identity.signPriv);
}

// identitySignPub = the PINNED identity of statement.userId (never one the server supplied).
export function verifyDeviceRemovals(identitySignPub, statement, sig) {
  try {
    requireKey("identity signPub", identitySignPub);
    if (!isSig(sig)) return false;
    return sodium().crypto_sign_verify_detached(sig, removalBytes(statement), identitySignPub);
  } catch {
    return false;
  }
}
