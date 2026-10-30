// X3DH key agreement (Signal spec, "The X3DH Key Agreement Protocol", rev. 1),
// device-to-device. Curve X25519, hash SHA-256, info "LiveMsg/X3DH/v1".
//
// The initiator (A) fetches the responder's (B) bundle: device keys (already checked
// against B's certificate by the caller), signed prekey, and at most one one-time
// prekey. Both sides arrive at the same 32-byte SK and associated data AD, which
// seed the Double Ratchet (ratchet.js).
//
//   DH1 = DH(IK_A, SPK_B)  DH2 = DH(EK_A, IK_B)  DH3 = DH(EK_A, SPK_B)  DH4 = DH(EK_A, OPK_B)
//   SK  = HKDF(salt = 0^32, ikm = 0xFF^32 ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4], info)

import { concat, field, utf8 } from "./bytes.js";
import { hkdf } from "./kdf.js";
import { dh, generateDhKeyPair, verifySignedPrekey, requireId, requireKey } from "./keys.js";

const INFO = utf8("LiveMsg/X3DH/v1");
const AD_LABEL = utf8("LiveMsg/AD/v1");
const F = new Uint8Array(32).fill(0xff);

function deriveSk(parts) {
  return hkdf(new Uint8Array(32), concat(F, ...parts), INFO, 32);
}

// AD binds both ends' full identity, initiator first: the person (userId + identity
// key) and the device (deviceId + both keys). A device certified under a different
// person or id produces different AD, so it can't decrypt — or be credited — as the
// real sender (fix for review finding 1, 2026-10-30).
function descriptorBytes(d) {
  requireId("userId", d.userId);
  requireId("deviceId", d.deviceId);
  requireKey("identitySignPub", d.identitySignPub);
  requireKey("signPub", d.signPub);
  requireKey("dhPub", d.dhPub);
  return concat(field(utf8(d.userId)), field(d.identitySignPub), field(utf8(d.deviceId)), field(d.signPub), field(d.dhPub));
}

export function associatedData(initiator, responder) {
  return concat(field(AD_LABEL), descriptorBytes(initiator), descriptorBytes(responder));
}

// me: my device descriptor + dhPriv; them: their certificate-verified descriptor
// ({ userId, deviceId, identitySignPub, signPub, dhPub } — keys.deviceDescriptor);
// spk: { id, pub, sig, createdAt }; opk: { id, pub } | null.
export function x3dhInitiate({ me, them, spk, opk = null, ephemeral = generateDhKeyPair(), now = Date.now() }) {
  if (!verifySignedPrekey(them.signPub, spk, now)) throw new Error("x3dh: signed prekey signature invalid or expired");
  const parts = [dh(me.dhPriv, spk.pub), dh(ephemeral.priv, them.dhPub), dh(ephemeral.priv, spk.pub)];
  if (opk) parts.push(dh(ephemeral.priv, opk.pub));
  return {
    sk: deriveSk(parts),
    ad: associatedData(me, them),
    ephemeralPub: ephemeral.pub,
    spkId: spk.id,
    opkId: opk ? opk.id : null,
  };
}

// me: my device descriptor + dhPriv; initiator: its certificate-verified descriptor;
// spk: { id, pub, priv }; opk: { id, pub, priv } | null; ephemeralPub from the message.
export function x3dhRespond({ me, initiator, spk, opk = null, ephemeralPub }) {
  const parts = [dh(spk.priv, initiator.dhPub), dh(me.dhPriv, ephemeralPub), dh(spk.priv, ephemeralPub)];
  if (opk) parts.push(dh(opk.priv, ephemeralPub));
  return { sk: deriveSk(parts), ad: associatedData(initiator, me) };
}
