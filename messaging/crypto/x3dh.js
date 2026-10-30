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
import { dh, generateDhKeyPair, verifySignedPrekey } from "./keys.js";

const INFO = utf8("LiveMsg/X3DH/v1");
const AD_LABEL = utf8("LiveMsg/AD/v1");
const F = new Uint8Array(32).fill(0xff);

function deriveSk(parts) {
  return hkdf(new Uint8Array(32), concat(F, ...parts), INFO, 32);
}

// AD binds both devices' full identities (signing and DH keys), initiator first.
export function associatedData(initiator, responder) {
  return concat(field(AD_LABEL), field(initiator.signPub), field(initiator.dhPub), field(responder.signPub), field(responder.dhPub));
}

// me: { signPub, dhPub, dhPriv }; them: { signPub, dhPub } (certificate-verified);
// spk: { id, pub, sig }; opk: { id, pub } | null.
export function x3dhInitiate({ me, them, spk, opk = null, ephemeral = generateDhKeyPair() }) {
  if (!verifySignedPrekey(them.signPub, spk)) throw new Error("x3dh: signed prekey signature invalid");
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

// me: { signPub, dhPub, dhPriv }; initiator: { signPub, dhPub } (certificate-verified);
// spk: { id, pub, priv }; opk: { id, pub, priv } | null; ephemeralPub from the message.
export function x3dhRespond({ me, initiator, spk, opk = null, ephemeralPub }) {
  const parts = [dh(spk.priv, initiator.dhPub), dh(me.dhPriv, ephemeralPub), dh(spk.priv, ephemeralPub)];
  if (opk) parts.push(dh(opk.priv, ephemeralPub));
  return { sk: deriveSk(parts), ad: associatedData(initiator, me) };
}
