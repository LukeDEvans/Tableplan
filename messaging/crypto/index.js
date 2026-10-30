// The messaging crypto core's public API (MESSAGING_DESIGN.md §2, §4). The rest of
// the app imports only from here — never from the files behind it — so the code
// that touches keys stays small, rarely changed and easy to review.
//
// Load it lazily (await import("./messaging/crypto/index.js")) and call
// loadSodium() once before anything else.

import { utf8, fromUtf8 } from "./bytes.js";
import { pad, unpad } from "./padding.js";
import { encryptToDevice, decryptFromDevice } from "./session.js";
import { parseEnvelope } from "../envelope.js";

export { loadSodium } from "./sodium.js";
export { toB64, fromB64 } from "./bytes.js";
export {
  generateIdentity, generateDevice, certifyDevice, verifyDeviceCert,
  generateSignedPrekey, verifySignedPrekey, generateOneTimePrekeys,
  safetyNumber, safetyQr, matchSafetyQr,
} from "./keys.js";
export { emptyRecord, hasSession, startSession } from "./session.js";

// Encrypt one envelope for one device. Returns { record, wire }; store the record
// before sending the wire.
export function sealEnvelope(record, envelope, now = Date.now()) {
  const checked = parseEnvelope(envelope);
  return encryptToDevice(record, pad(utf8(JSON.stringify(checked))), now);
}

// Decrypt one wire message from one device. Returns { record, envelope,
// usedOneTimePrekeyId }; a session or envelope problem throws and leaves the
// stored record untouched.
export function openEnvelope(record, args) {
  const r = decryptFromDevice(record, args);
  let parsed;
  try {
    parsed = JSON.parse(fromUtf8(unpad(r.plaintext)));
  } catch {
    throw new Error("envelope: not valid JSON");
  }
  return { record: r.record, envelope: parseEnvelope(parsed), usedOneTimePrekeyId: r.usedOneTimePrekeyId };
}
