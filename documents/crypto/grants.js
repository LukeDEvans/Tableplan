// Handing a vault key to a device (DOCUMENTS_DESIGN.md §3.2–3.3).
//
// BOX KEY — each device has an X25519 key used only for receiving vault keys
// (never its messaging keys, so one key never serves two protocols). The device
// signs it with its own Ed25519 key; anyone checking it uses the signing key from
// that device's verified certificate (messaging/crypto/keys.js verifyDeviceCert).
//
// GRANT — the vault key sealed to the recipient's box key (crypto_box_seal), with
// the grant's context sealed alongside it, plus the granting device's signature
// over context ‖ granter ‖ sealed bytes. The server stores grants but can't make
// one: it has no device's signing key, and a sealed box moved to another vault,
// version or device fails both the signature and the sealed-context check.
//
// What the APP must check before calling openGrant (this module can't know):
//   - granterSignPub comes from a device certificate that verifies against the
//     PINNED identity of granterUserId (not one taken from the grant row);
//   - granterUserId may hold this scope: for Personal (u-<uid>) only the owner,
//     for Household a current member of the group.

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, field, utf8, equalBytes } from "../../messaging/crypto/bytes.js";
import { requireId, requireKey, generateDhKeyPair, dh } from "../../messaging/crypto/keys.js";
import { contextBytes } from "./wrap.js";

const BOX_LABEL = utf8("LiveDocs/box-key/v1");
const GRANT_SIG_LABEL = utf8("LiveDocs/vault-grant-sig/v1");

function requireUsablePub(pub) {
  requireKey("box public key", pub);
  // dh() refuses low-order points (all-zero shared secret).
  dh(generateDhKeyPair().priv, pub);
}

export function generateBoxKey() {
  const kp = sodium().crypto_box_keypair();
  return { pub: kp.publicKey, priv: kp.privateKey };
}

const boxKeyBytes = ({ userId, deviceId, boxPub }) => {
  requireId("userId", userId);
  requireId("deviceId", deviceId);
  requireKey("box public key", boxPub);
  return concat(field(BOX_LABEL), field(utf8(userId)), field(utf8(deviceId)), field(boxPub));
};

// device = the messaging device keys ({ signPub, signPriv }).
export function signBoxKey(device, { userId, deviceId, boxPub }) {
  requireUsablePub(boxPub);
  return sodium().crypto_sign_detached(boxKeyBytes({ userId, deviceId, boxPub }), device.signPriv);
}

export function verifyBoxKey(deviceSignPub, { userId, deviceId, boxPub }, sig) {
  try {
    requireKey("device signPub", deviceSignPub);
    if (!(sig instanceof Uint8Array) || sig.length !== 64) return false;
    requireUsablePub(boxPub);
    return sodium().crypto_sign_verify_detached(sig, boxKeyBytes({ userId, deviceId, boxPub }), deviceSignPub);
  } catch {
    return false;
  }
}

// ctx = { vaultId, scope, keyVersion, recipientUserId, recipientDeviceId, recipientBoxPub }
function grantContext(ctx) {
  requireKey("box public key", ctx.recipientBoxPub);
  return concat(
    contextBytes("LiveDocs/vault-grant/v1", [
      ["vaultId", ctx.vaultId], ["scope", ctx.scope], ["keyVersion", ctx.keyVersion],
      ["recipientUserId", ctx.recipientUserId], ["recipientDeviceId", ctx.recipientDeviceId],
    ]),
    field(ctx.recipientBoxPub),
  );
}

function grantSigBytes(context, granterUserId, granterDeviceId, sealed) {
  requireId("granterUserId", granterUserId);
  requireId("granterDeviceId", granterDeviceId);
  return concat(field(GRANT_SIG_LABEL), field(context), field(utf8(granterUserId)), field(utf8(granterDeviceId)), field(sealed));
}

// granter = { userId, deviceId, device: { signPriv } }. The recipient's box key
// must already be checked with verifyBoxKey against its verified certificate.
export function createGrant({ granter, vaultKey, ctx }) {
  requireKey("vault key", vaultKey);
  requireUsablePub(ctx.recipientBoxPub);
  const context = grantContext(ctx);
  const sealed = sodium().crypto_box_seal(concat(field(context), vaultKey), ctx.recipientBoxPub);
  const sig = sodium().crypto_sign_detached(grantSigBytes(context, granter.userId, granter.deviceId, sealed), granter.device.signPriv);
  return { sealed, sig, granterUserId: granter.userId, granterDeviceId: granter.deviceId };
}

// grant = { sealed, sig, granterUserId, granterDeviceId }; ctx = what this device
// expects (its own ids and box key, the vault, scope and version it asked for);
// box = this device's { pub, priv }. Returns the vault key or throws.
export function openGrant({ grant, ctx, box, granterSignPub }) {
  requireKey("granter signPub", granterSignPub);
  if (!equalBytes(box.pub, ctx.recipientBoxPub)) throw new Error("grant: not this device's box key");
  if (!(grant?.sealed instanceof Uint8Array) || !(grant?.sig instanceof Uint8Array) || grant.sig.length !== 64) throw new Error("grant: malformed");
  const s = sodium();
  const context = grantContext(ctx);
  if (!s.crypto_sign_verify_detached(grant.sig, grantSigBytes(context, grant.granterUserId, grant.granterDeviceId, grant.sealed), granterSignPub)) {
    throw new Error("grant: bad signature");
  }
  let inner;
  try {
    inner = s.crypto_box_seal_open(grant.sealed, box.pub, box.priv);
  } catch {
    throw new Error("grant: can't open");
  }
  const expected = field(context);
  if (inner.length !== expected.length + 32 || !equalBytes(inner.subarray(0, expected.length), expected)) {
    throw new Error("grant: sealed for somewhere else");
  }
  return inner.slice(expected.length);
}
