// Session records and the wire format: everything between one of my devices and one
// of theirs (MESSAGING_DESIGN.md §4). Pure — every call returns a new record, and
// nothing is committed unless decryption succeeded.
//
// A record holds up to MAX_SESSIONS sessions, newest-used first (a light form of
// Signal's Sesame): if both devices start a session at the same moment, or one side
// resets, the older session keeps decrypting its stragglers while the newest is used
// for sending.
//
// Wire (all integers big-endian):
//   normal : 0x01 ‖ 0x01 ‖ header(40) ‖ ciphertext
//   prekey : 0x01 ‖ 0x02 ‖ IK_A(32) ‖ EK_A(32) ‖ spkId(u32) ‖ opkId(u32, 0xFFFFFFFF = none) ‖ header(40) ‖ ciphertext
// The initiator keeps sending prekey messages until it first hears back, so the
// responder can set up the session from whichever message reaches it first.

import { concat, u32, readU32, toB64, fromB64, equalBytes } from "./bytes.js";
import { x3dhInitiate, x3dhRespond } from "./x3dh.js";
import { initInitiator, initResponder, ratchetEncrypt, ratchetDecrypt, HEADER_LEN } from "./ratchet.js";

export const WIRE_VERSION = 1;
export const MAX_SESSIONS = 5;
const T_NORMAL = 1;
const T_PREKEY = 2;
const NO_OPK = 0xffffffff;

export const emptyRecord = () => ({ v: 1, sessions: [] });

export function hasSession(record) {
  return Boolean(record && record.sessions && record.sessions.length);
}

function withActive(record, session) {
  const rest = record.sessions.filter((s) => s.id !== session.id);
  return { v: 1, sessions: [session, ...rest].slice(0, MAX_SESSIONS) };
}

// ---- starting a session (initiator) ----------------------------------------------

// me: my device { signPub, dhPub, dhPriv }; them: their certificate-verified device
// { signPub, dhPub }; bundle: { spk: { id, pub, sig }, opk: { id, pub } | null }.
export function startSession(record, { me, them, bundle, now = Date.now() }) {
  const x = x3dhInitiate({ me, them, spk: bundle.spk, opk: bundle.opk || null });
  const session = {
    id: toB64(x.ephemeralPub),
    ratchet: initInitiator(x.sk, x.ad, bundle.spk.pub),
    pending: { ik: toB64(me.dhPub), ek: toB64(x.ephemeralPub), spkId: x.spkId, opkId: x.opkId },
    createdAt: now,
    usedAt: now,
  };
  return withActive(record || emptyRecord(), session);
}

// ---- encrypt ----------------------------------------------------------------------

export function encryptToDevice(record, plaintext, now = Date.now()) {
  if (!hasSession(record)) throw new Error("session: no session with this device");
  const active = record.sessions[0];
  const { state, header, ciphertext } = ratchetEncrypt(active.ratchet, plaintext);
  let wire;
  if (active.pending) {
    const p = active.pending;
    wire = concat(
      Uint8Array.of(WIRE_VERSION, T_PREKEY), fromB64(p.ik), fromB64(p.ek),
      u32(p.spkId), u32(p.opkId === null ? NO_OPK : p.opkId), header, ciphertext
    );
  } else {
    wire = concat(Uint8Array.of(WIRE_VERSION, T_NORMAL), header, ciphertext);
  }
  return { record: withActive(record, { ...active, ratchet: state, usedAt: now }), wire };
}

// ---- decrypt ----------------------------------------------------------------------

export function parseWire(wire) {
  if (!(wire instanceof Uint8Array) || wire.length < 2) throw new Error("session: empty message");
  if (wire[0] !== WIRE_VERSION) throw new Error("session: unsupported message version");
  if (wire[1] === T_NORMAL) {
    if (wire.length < 2 + HEADER_LEN + 16) throw new Error("session: truncated message");
    return { type: "normal", header: wire.subarray(2, 2 + HEADER_LEN), ciphertext: wire.subarray(2 + HEADER_LEN) };
  }
  if (wire[1] === T_PREKEY) {
    const base = 2 + 32 + 32 + 4 + 4;
    if (wire.length < base + HEADER_LEN + 16) throw new Error("session: truncated message");
    const opkId = readU32(wire, 70);
    return {
      type: "prekey",
      ik: wire.subarray(2, 34),
      ek: wire.subarray(34, 66),
      spkId: readU32(wire, 66),
      opkId: opkId === NO_OPK ? null : opkId,
      header: wire.subarray(base, base + HEADER_LEN),
      ciphertext: wire.subarray(base + HEADER_LEN),
    };
  }
  throw new Error("session: unknown message type");
}

function tryDecrypt(session, header, ciphertext, now) {
  const { state, plaintext } = ratchetDecrypt(session.ratchet, header, ciphertext, now);
  // Hearing back means the other side has the session: stop sending prekey messages.
  return { session: { ...session, ratchet: state, pending: null, usedAt: now }, plaintext };
}

// me: my device { signPub, dhPub, dhPriv }; them: the sender's certificate-verified
// device { signPub, dhPub } (looked up from the server row's sender_device_id — the
// message's own claim is only compared, never trusted).
// prekeys.signed(id) → { id, pub, priv } | null; prekeys.oneTime(id) → { id, pub, priv } | null.
// Returns { record, plaintext, usedOneTimePrekeyId } — the caller deletes that
// one-time prekey only after it has stored the new record.
export function decryptFromDevice(record, { me, them, wire, prekeys, now = Date.now() }) {
  const rec = record || emptyRecord();
  const m = parseWire(wire);

  if (m.type === "prekey") {
    if (!equalBytes(m.ik, them.dhPub)) throw new Error("session: sender identity key does not match its certificate");
    const existing = rec.sessions.find((s) => s.id === toB64(m.ek));
    if (existing) {
      const r = tryDecrypt(existing, m.header, m.ciphertext, now);
      return { record: withActive(rec, r.session), plaintext: r.plaintext, usedOneTimePrekeyId: null };
    }
    const spk = prekeys.signed(m.spkId);
    if (!spk) throw new Error("session: unknown signed prekey");
    const opk = m.opkId === null ? null : prekeys.oneTime(m.opkId);
    if (m.opkId !== null && !opk) throw new Error("session: one-time prekey already used or unknown");
    const x = x3dhRespond({ me, initiator: them, spk, opk, ephemeralPub: m.ek });
    const fresh = {
      id: toB64(m.ek),
      ratchet: initResponder(x.sk, x.ad, spk),
      pending: null,
      createdAt: now,
      usedAt: now,
    };
    const r = tryDecrypt(fresh, m.header, m.ciphertext, now);
    return { record: withActive(rec, r.session), plaintext: r.plaintext, usedOneTimePrekeyId: m.opkId };
  }

  let lastErr = new Error("session: no session with this device");
  for (const s of rec.sessions) {
    try {
      const r = tryDecrypt(s, m.header, m.ciphertext, now);
      return { record: withActive(rec, r.session), plaintext: r.plaintext, usedOneTimePrekeyId: null };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
