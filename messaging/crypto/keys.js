// Keys, device certificates, prekeys and safety numbers (MESSAGING_DESIGN.md §3).
//
// - A person's PRIMARY IDENTITY is an Ed25519 key that lives only on their phone.
//   It signs a certificate for each of their devices; it's what verification checks.
// - Every DEVICE (the phone included) has its own Ed25519 key (signs its prekeys) and
//   X25519 key (its X3DH identity key).
// - A recipient trusts a device only when its certificate verifies against the
//   person's primary identity key, so verifying someone once covers all their devices.

import { sodium } from "./sodium.js";
import { concat, field, utf8, u32, isAllZero, equalBytes, readU32 } from "./bytes.js";

const CERT_LABEL = utf8("LiveMsg/device-cert/v1");
const SPK_LABEL = utf8("LiveMsg/signed-prekey/v1");
const FP_VERSION = 0;
const FP_ITERATIONS = 5200; // Signal's safety-number iteration count

// Ids are UUIDs or similar: a fixed ASCII set, so there is exactly one byte form.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function requireId(name, v) {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new Error(`${name} must be 1–64 of A–Z a–z 0–9 _ -`);
}

export function requireKey(name, v, len = 32) {
  if (!(v instanceof Uint8Array) || v.length !== len) throw new Error(`${name} must be ${len} bytes`);
}

export function generateIdentity() {
  const kp = sodium().crypto_sign_keypair();
  return { signPub: kp.publicKey, signPriv: kp.privateKey };
}

export function generateDevice() {
  const s = sodium();
  const sk = s.crypto_sign_keypair();
  const dk = s.crypto_box_keypair();
  return { signPub: sk.publicKey, signPriv: sk.privateKey, dhPub: dk.publicKey, dhPriv: dk.privateKey };
}

export function generateDhKeyPair() {
  const kp = sodium().crypto_box_keypair();
  return { pub: kp.publicKey, priv: kp.privateKey };
}

// X25519, refusing low-order public keys (an all-zero shared secret).
export function dh(priv, pub) {
  requireKey("dh private key", priv);
  requireKey("dh public key", pub);
  let out;
  try {
    out = sodium().crypto_scalarmult(priv, pub);
  } catch {
    throw new Error("dh: rejected public key");
  }
  if (isAllZero(out)) throw new Error("dh: rejected public key");
  return out;
}

// ---- device certificates ---------------------------------------------------
// A certificate names the person (userId + their identity key) and the device
// (deviceId, kind, its two public keys). It carries TWO signatures:
//   - identitySig: the person's primary identity vouches for the device;
//   - deviceSig:   the device proves it holds the signing key being certified, so
//                  nobody can certify someone else's device keys as their own.
// X3DH then binds both ends' userId, deviceId and identity key into the session's
// associated data (x3dh.js), so a relabelled device can't decrypt as someone else.

const DEVICE_SIG_LABEL = utf8("LiveMsg/device-cert-self/v1");

function certBytes(c) {
  requireId("userId", c.userId);
  requireId("deviceId", c.deviceId);
  requireKey("identity signPub", c.identitySignPub);
  if (c.kind !== "phone" && c.kind !== "linked") throw new Error("kind must be phone or linked");
  requireKey("device signPub", c.signPub);
  requireKey("device dhPub", c.dhPub);
  if (!Number.isInteger(c.createdAt) || c.createdAt < 0) throw new Error("createdAt must be epoch ms");
  return concat(
    field(CERT_LABEL), field(utf8(c.userId)), field(c.identitySignPub), field(utf8(c.deviceId)), field(utf8(c.kind)),
    field(c.signPub), field(c.dhPub), field(utf8(String(c.createdAt)))
  );
}

// On the new device: prove it holds the certified signing key.
export function signCertAsDevice(device, cert) {
  if (!equalBytes(device.signPub, cert.signPub) || !equalBytes(device.dhPub, cert.dhPub)) throw new Error("cert: not this device's keys");
  return sodium().crypto_sign_detached(concat(field(DEVICE_SIG_LABEL), certBytes(cert)), device.signPriv);
}

// On the person's phone: vouch for the device.
export function signCertAsIdentity(identity, cert) {
  if (!equalBytes(identity.signPub, cert.identitySignPub)) throw new Error("cert: not this identity");
  return sodium().crypto_sign_detached(certBytes(cert), identity.signPriv);
}

// Convenience when both keys are at hand (the phone certifying itself, tests).
export function certifyDevice(identity, device, cert) {
  return { identitySig: signCertAsIdentity(identity, cert), deviceSig: signCertAsDevice(device, cert) };
}

const isSig = (s) => s instanceof Uint8Array && s.length === 64;

// identitySignPub is the key the caller trusts for that person (stored, and
// verified by safety number) — never just the one written in the certificate.
export function verifyDeviceCert(identitySignPub, cert, sigs) {
  try {
    requireKey("identity signPub", identitySignPub);
    if (!sigs || !isSig(sigs.identitySig) || !isSig(sigs.deviceSig)) return false;
    if (!equalBytes(identitySignPub, cert.identitySignPub)) return false;
    const bytes = certBytes(cert);
    const s = sodium();
    return s.crypto_sign_verify_detached(sigs.identitySig, bytes, identitySignPub)
      && s.crypto_sign_verify_detached(sigs.deviceSig, concat(field(DEVICE_SIG_LABEL), bytes), cert.signPub);
  } catch {
    return false;
  }
}

// The descriptor X3DH binds into a session: who the device belongs to and its keys.
export function deviceDescriptor(cert) {
  return { userId: cert.userId, deviceId: cert.deviceId, identitySignPub: cert.identitySignPub, signPub: cert.signPub, dhPub: cert.dhPub };
}

// ---- prekeys ------------------------------------------------------------------
// The signed prekey's creation time is signed too, so a server can't keep serving
// an old one past its life (initiators refuse ones older than SPK_MAX_AGE_MS).

export const SPK_MAX_AGE_MS = 60 * 24 * 3600 * 1000;

const spkBytes = (id, pub, createdAt) => {
  if (!Number.isInteger(createdAt) || createdAt < 0) throw new Error("spk createdAt must be epoch ms");
  return concat(field(SPK_LABEL), u32(id), field(pub), field(utf8(String(createdAt))));
};

export function generateSignedPrekey(device, id, now = Date.now()) {
  const kp = generateDhKeyPair();
  const sig = sodium().crypto_sign_detached(spkBytes(id, kp.pub, now), device.signPriv);
  return { id, pub: kp.pub, priv: kp.priv, sig, createdAt: now };
}

export function verifySignedPrekey(deviceSignPub, spk, now = Date.now()) {
  try {
    requireKey("spk pub", spk.pub);
    if (!isSig(spk.sig)) return false;
    if (!(now - spk.createdAt < SPK_MAX_AGE_MS) || spk.createdAt > now + 24 * 3600 * 1000) return false;
    return sodium().crypto_sign_verify_detached(spk.sig, spkBytes(spk.id, spk.pub, spk.createdAt), deviceSignPub);
  } catch {
    return false;
  }
}

export function generateOneTimePrekeys(startId, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ id: startId + i, ...generateDhKeyPair() });
  return out;
}

// ---- safety numbers -----------------------------------------------------------
// Signal's construction: per person, SHA-512 iterated 5200 times over the version,
// the identity key and a stable id; the first 30 bytes become 30 digits (six chunks
// of five bytes, each mod 100000). The pair is sorted so both phones show the same 60.

export function fingerprint(userId, identitySignPub) {
  requireId("userId", userId);
  requireKey("identity signPub", identitySignPub);
  const s = sodium();
  let h = concat(Uint8Array.of(0, FP_VERSION), identitySignPub, utf8(userId));
  for (let i = 0; i < FP_ITERATIONS; i++) h = s.crypto_hash_sha512(concat(h, identitySignPub));
  return h.subarray(0, 30);
}

function digits30(fp) {
  let out = "";
  for (let i = 0; i < 30; i += 5) {
    const v = fp[i] * 2 ** 32 + readU32(fp, i + 1);
    out += String(v % 100000).padStart(5, "0");
  }
  return out;
}

export function safetyNumber(a, b) {
  const da = digits30(fingerprint(a.userId, a.signPub));
  const db = digits30(fingerprint(b.userId, b.signPub));
  return da < db ? da + db : db + da;
}

// QR payload one phone shows; the other scans it and calls matchSafetyQr.
export function safetyQr(me, them) {
  return concat(Uint8Array.of(1), fingerprint(me.userId, me.signPub), fingerprint(them.userId, them.signPub));
}

export function matchSafetyQr(scanned, me, them) {
  if (!(scanned instanceof Uint8Array) || scanned.length !== 61 || scanned[0] !== 1) return false;
  // Scanned from THEIR phone: their key first, then what they believe is mine.
  return equalBytes(scanned.subarray(1, 31), fingerprint(them.userId, them.signPub))
    && equalBytes(scanned.subarray(31, 61), fingerprint(me.userId, me.signPub));
}
