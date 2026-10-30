// Double Ratchet (Signal spec, "The Double Ratchet Algorithm", rev. 4), without
// header encryption. Every function is pure: it takes a state and returns a NEW state,
// so a failed decrypt can never corrupt a session (the spec's "decrypt must not
// change state on failure"). States are plain JSON (binary as base64url) so they can
// be stored as-is.
//
//   KDF_RK(rk, dh)  = HKDF(salt = rk, ikm = dh, info "LiveMsg/ratchet/v1") → 64 bytes → (rk, ck)
//   KDF_CK(ck)      = (HMAC(ck, 0x02) → next ck, HMAC(ck, 0x01) → message key)
//   ENCRYPT(mk,…)   = XChaCha20-Poly1305, key = HKDF(mk, "LiveMsg/msg-keys/v1"), a RANDOM
//                     24-byte nonce sent with the message, associated data = AD ‖ header.
//                     (The nonce was first derived from mk too; a random one means even a
//                     state reused by mistake — two tabs, a retried save — never repeats a
//                     key+nonce pair. Review finding 2, 2026-10-30.)
//   header          = DH ratchet public key (32) ‖ PN (u32) ‖ N (u32)

import { sodium } from "./sodium.js";
import { concat, utf8, u32, readU32, toB64, fromB64 } from "./bytes.js";
import { hkdf, hmacSha256 } from "./kdf.js";
import { dh, generateDhKeyPair } from "./keys.js";

export const MAX_SKIP = 1000;            // most message keys one gap may skip
export const MAX_STORED_SKIPPED = 2000;  // most skipped keys a session keeps
export const SKIPPED_TTL_MS = 7 * 24 * 3600 * 1000;
export const HEADER_LEN = 40;
export const NONCE_LEN = 24;

const RK_INFO = utf8("LiveMsg/ratchet/v1");
const MK_INFO = utf8("LiveMsg/msg-keys/v1");

function kdfRk(rk, dhOut) {
  const out = hkdf(rk, dhOut, RK_INFO, 64);
  return [out.subarray(0, 32), out.subarray(32, 64)];
}

function kdfCk(ck) {
  return [hmacSha256(ck, Uint8Array.of(2)), hmacSha256(ck, Uint8Array.of(1))];
}

const aeadKey = (mk) => hkdf(new Uint8Array(32), mk, MK_INFO, 32);

export function encodeHeader({ dh: dhPub, pn, n }) {
  return concat(dhPub, u32(pn), u32(n));
}

export function decodeHeader(b) {
  if (!(b instanceof Uint8Array) || b.length !== HEADER_LEN) throw new Error("ratchet: bad header");
  return { dh: b.subarray(0, 32), pn: readU32(b, 32), n: readU32(b, 36) };
}

const B = fromB64;
const S = toB64;
const clone = (st) => JSON.parse(JSON.stringify(st));

// ---- initialisation (spec §3.3) -----------------------------------------------

// Initiator: knows the responder's signed prekey, which is the responder's first ratchet key.
export function initInitiator(sk, ad, theirRatchetPub) {
  const dhs = generateDhKeyPair();
  const [rk, cks] = kdfRk(sk, dh(dhs.priv, theirRatchetPub));
  return {
    v: 1, ad: S(ad), rk: S(rk),
    dhs: { pub: S(dhs.pub), priv: S(dhs.priv) }, dhr: S(theirRatchetPub),
    cks: S(cks), ckr: null, ns: 0, nr: 0, pn: 0, skipped: [],
  };
}

// Responder: its signed prekey pair is its first ratchet key pair.
export function initResponder(sk, ad, ownSpk) {
  return {
    v: 1, ad: S(ad), rk: S(sk),
    dhs: { pub: S(ownSpk.pub), priv: S(ownSpk.priv) }, dhr: null,
    cks: null, ckr: null, ns: 0, nr: 0, pn: 0, skipped: [],
  };
}

// ---- encrypt ------------------------------------------------------------------

export function ratchetEncrypt(state, plaintext) {
  if (!state.cks) throw new Error("ratchet: no sending chain yet");
  const st = clone(state);
  const [ck, mk] = kdfCk(B(st.cks));
  st.cks = S(ck);
  const header = encodeHeader({ dh: B(st.dhs.pub), pn: st.pn, n: st.ns });
  st.ns += 1;
  const nonce = sodium().randombytes_buf(NONCE_LEN);
  const ciphertext = sodium().crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, concat(B(st.ad), header), null, nonce, aeadKey(mk));
  return { state: st, header, nonce, ciphertext };
}

// ---- decrypt (spec §3.5) --------------------------------------------------------

function openWith(mk, ad, header, nonce, ciphertext) {
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_LEN) throw new Error("ratchet: bad nonce");
  try {
    return sodium().crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, concat(ad, header), nonce, aeadKey(mk));
  } catch {
    throw new Error("ratchet: message failed authentication");
  }
}

function skipKeys(st, until, now) {
  if (st.ckr === null) return;
  if (until - st.nr > MAX_SKIP) throw new Error("ratchet: too many skipped messages");
  let ck = B(st.ckr);
  while (st.nr < until) {
    const [next, mk] = kdfCk(ck);
    st.skipped.push([`${st.dhr}:${st.nr}`, S(mk), now]);
    ck = next;
    st.nr += 1;
  }
  st.ckr = S(ck);
}

function pruneSkipped(st, now) {
  st.skipped = st.skipped.filter(([, , at]) => now - at < SKIPPED_TTL_MS);
  if (st.skipped.length > MAX_STORED_SKIPPED) st.skipped = st.skipped.slice(st.skipped.length - MAX_STORED_SKIPPED);
}

export function ratchetDecrypt(state, header, nonce, ciphertext, now = Date.now()) {
  const h = decodeHeader(header);
  const st = clone(state);
  const ad = B(st.ad);
  const hdh = S(h.dh);

  // A key we skipped earlier?
  const idx = st.skipped.findIndex(([k]) => k === `${hdh}:${h.n}`);
  if (idx >= 0) {
    const plaintext = openWith(B(st.skipped[idx][1]), ad, header, nonce, ciphertext);
    st.skipped.splice(idx, 1);
    pruneSkipped(st, now);
    return { state: st, plaintext };
  }

  if (hdh !== st.dhr) {
    // New ratchet key from the other side: finish the old receiving chain, then step.
    if (st.dhr !== null && h.pn < st.nr) throw new Error("ratchet: header claims an earlier chain end");
    skipKeys(st, h.pn, now);
    st.pn = st.ns;
    st.ns = 0;
    st.nr = 0;
    st.dhr = hdh;
    const [rk1, ckr] = kdfRk(B(st.rk), dh(B(st.dhs.priv), h.dh));
    const next = generateDhKeyPair();
    const [rk2, cks] = kdfRk(rk1, dh(next.priv, h.dh));
    st.rk = S(rk2);
    st.ckr = S(ckr);
    st.cks = S(cks);
    st.dhs = { pub: S(next.pub), priv: S(next.priv) };
  }

  if (h.n < st.nr) throw new Error("ratchet: duplicate or expired message");
  skipKeys(st, h.n, now);
  const [ck, mk] = kdfCk(B(st.ckr));
  const plaintext = openWith(mk, ad, header, nonce, ciphertext);
  st.ckr = S(ck);
  st.nr += 1;
  pruneSkipped(st, now);
  return { state: st, plaintext };
}
