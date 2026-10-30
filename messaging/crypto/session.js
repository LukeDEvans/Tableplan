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
//   normal : 0x02 ‖ 0x01 ‖ header(40) ‖ nonce(24) ‖ ciphertext
//   prekey : 0x02 ‖ 0x02 ‖ IK_A(32) ‖ EK_A(32) ‖ spkId(u32) ‖ opkId(u32, 0xFFFFFFFF = none) ‖ header(40) ‖ nonce(24) ‖ ciphertext
// The initiator keeps sending prekey messages until it first hears back, so the
// responder can set up the session from whichever message reaches it first.
//
// Caller rules (the core can't enforce them; MESSAGING_DESIGN.md §4):
//   - store the returned record BEFORE sending / acting, under a per-device-pair lock
//     or version check, so two tabs can't both advance the same record;
//   - after decryptFromDevice, record `newPrekeyMessage` in the seen-store for that
//     signed prekey's lifetime, and delete `usedOneTimePrekeyId` — both after storing.

import { concat, u32, readU32, toB64, fromB64, equalBytes } from "./bytes.js";
import { x3dhInitiate, x3dhRespond } from "./x3dh.js";
import { initInitiator, initResponder, ratchetEncrypt, ratchetDecrypt, HEADER_LEN, NONCE_LEN } from "./ratchet.js";

export const WIRE_VERSION = 2; // 1 was the pre-review format (derived nonces); never shipped
export const MAX_SESSIONS = 5;
const T_NORMAL = 1;
const T_PREKEY = 2;
const NO_OPK = 0xffffffff;
const TAG_LEN = 16;

export const emptyRecord = () => ({ v: 1, sessions: [] });

export function hasSession(record) {
  return Boolean(record && record.sessions && record.sessions.length);
}

function withActive(record, session) {
  const rest = record.sessions.filter((s) => s.id !== session.id);
  return { v: 1, sessions: [session, ...rest].slice(0, MAX_SESSIONS) };
}

function replaceKeepingOrder(record, session) {
  return { v: 1, sessions: record.sessions.map((s) => (s.id === session.id ? session : s)) };
}

// ---- starting a session (initiator) ----------------------------------------------

// me: my descriptor + dhPriv; them: their certificate-verified descriptor
// (keys.deviceDescriptor); bundle: { spk: { id, pub, sig, createdAt }, opk: { id, pub } | null }.
export function startSession(record, { me, them, bundle, now = Date.now() }) {
  const x = x3dhInitiate({ me, them, spk: bundle.spk, opk: bundle.opk || null, now });
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
  const { state, header, nonce, ciphertext } = ratchetEncrypt(active.ratchet, plaintext);
  let wire;
  if (active.pending) {
    const p = active.pending;
    wire = concat(
      Uint8Array.of(WIRE_VERSION, T_PREKEY), fromB64(p.ik), fromB64(p.ek),
      u32(p.spkId), u32(p.opkId === null ? NO_OPK : p.opkId), header, nonce, ciphertext
    );
  } else {
    wire = concat(Uint8Array.of(WIRE_VERSION, T_NORMAL), header, nonce, ciphertext);
  }
  return { record: withActive(record, { ...active, ratchet: state, usedAt: now }), wire };
}

// ---- decrypt ----------------------------------------------------------------------

function splitBody(wire, at) {
  if (wire.length < at + HEADER_LEN + NONCE_LEN + TAG_LEN) throw new Error("session: truncated message");
  return {
    header: wire.subarray(at, at + HEADER_LEN),
    nonce: wire.subarray(at + HEADER_LEN, at + HEADER_LEN + NONCE_LEN),
    ciphertext: wire.subarray(at + HEADER_LEN + NONCE_LEN),
  };
}

export function parseWire(wire) {
  if (!(wire instanceof Uint8Array) || wire.length < 2) throw new Error("session: empty message");
  if (wire[0] !== WIRE_VERSION) throw new Error("session: unsupported message version");
  if (wire[1] === T_NORMAL) return { type: "normal", ...splitBody(wire, 2) };
  if (wire[1] === T_PREKEY) {
    const base = 2 + 32 + 32 + 4 + 4;
    const body = splitBody(wire, base);
    const opkId = readU32(wire, 70);
    return {
      type: "prekey",
      ik: wire.subarray(2, 34),
      ek: wire.subarray(34, 66),
      spkId: readU32(wire, 66),
      opkId: opkId === NO_OPK ? null : opkId,
      ...body,
    };
  }
  throw new Error("session: unknown message type");
}

function tryDecrypt(session, m, now) {
  const { state, plaintext } = ratchetDecrypt(session.ratchet, m.header, m.nonce, m.ciphertext, now);
  // Hearing back means the other side has the session: stop sending prekey messages.
  return { session: { ...session, ratchet: state, pending: null, usedAt: now }, plaintext };
}

// Sessions that already know the header's ratchet key (current or skipped) go first:
// they're the only ones that can succeed without a DH step, which keeps the cost of a
// forged message low (review finding 4). The rest keep their newest-first order.
function candidateOrder(sessions, header) {
  const hdh = toB64(header.subarray(0, 32));
  const knows = (s) => s.ratchet.dhr === hdh || s.ratchet.skipped.some(([k]) => k.startsWith(`${hdh}:`));
  return [...sessions.filter(knows), ...sessions.filter((s) => !knows(s))];
}

// me: my descriptor + dhPriv. them: the sender's certificate-verified descriptor,
// looked up from the server row's sender_device_id — the message's own identity key
// is only compared with it, never trusted.
// prekeys.signed(id) → { id, pub, priv } | null
// prekeys.oneTime(id) → { id, pub, priv } | null
// prekeys.seen(spkId, ekB64) → true if a prekey message with this ephemeral key
//   already set up a session (the replay guard; review finding 3).
// Returns { record, plaintext, usedOneTimePrekeyId, newPrekeyMessage } — see the
// caller rules at the top.
export function decryptFromDevice(record, { me, them, wire, prekeys, now = Date.now() }) {
  const rec = record || emptyRecord();
  const m = parseWire(wire);
  const done = (r, extra = {}) => ({ record: r.record, plaintext: r.plaintext, usedOneTimePrekeyId: null, newPrekeyMessage: null, ...extra });

  if (m.type === "prekey") {
    if (!equalBytes(m.ik, them.dhPub)) throw new Error("session: sender identity key does not match its certificate");
    const ek = toB64(m.ek);
    const existing = rec.sessions.find((s) => s.id === ek);
    if (existing) {
      const r = tryDecrypt(existing, m, now);
      return done({ record: withActive(rec, r.session), plaintext: r.plaintext });
    }
    if (prekeys.seen(m.spkId, ek)) throw new Error("session: replayed prekey message");
    const spk = prekeys.signed(m.spkId);
    if (!spk) throw new Error("session: unknown signed prekey");
    const opk = m.opkId === null ? null : prekeys.oneTime(m.opkId);
    if (m.opkId !== null && !opk) throw new Error("session: one-time prekey already used or unknown");
    const x = x3dhRespond({ me, initiator: them, spk, opk, ephemeralPub: m.ek });
    const fresh = { id: ek, ratchet: initResponder(x.sk, x.ad, spk), pending: null, createdAt: now, usedAt: now };
    const r = tryDecrypt(fresh, m, now);
    return done(
      { record: withActive(rec, r.session), plaintext: r.plaintext },
      { usedOneTimePrekeyId: m.opkId, newPrekeyMessage: { spkId: m.spkId, ek } }
    );
  }

  let lastErr = new Error("session: no session with this device");
  for (const s of candidateOrder(rec.sessions, m.header)) {
    try {
      const r = tryDecrypt(s, m, now);
      // A straggler for an older session doesn't make it the sending session.
      const next = s.id === rec.sessions[0].id ? withActive(rec, r.session) : replaceKeepingOrder(rec, r.session);
      return done({ record: next, plaintext: r.plaintext });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
