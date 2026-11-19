// Argon2id settings for the recovery code (DOCUMENTS_DESIGN.md §3.5), stored with
// the person's recovery key so a restore uses the same ones.
//
// The stored settings come from the server, and a restoring phone has nothing yet
// to check them against, so the allowed range is narrow: never more than the
// defaults (64 MiB fits the iPhone web view), so a hostile row can't crash or
// stall a restore. 140 random bits don't need more stretching than that.

import { sodium } from "../../messaging/crypto/sodium.js";
import { concat, u32, readU32 } from "../../messaging/crypto/bytes.js";

const PARAMS_VERSION = 1;
export const DEFAULT_PARAMS = Object.freeze({ ops: 3, memKiB: 64 * 1024 });
const MIN_OPS = 1, MAX_OPS = DEFAULT_PARAMS.ops;
const MIN_MEM_KIB = 8 * 1024, MAX_MEM_KIB = DEFAULT_PARAMS.memKiB;
const SALT = 16;

export function checkRecoveryParams(p) {
  if (!p || !Number.isInteger(p.ops) || p.ops < MIN_OPS || p.ops > MAX_OPS) throw new Error("recovery: bad cost");
  if (!Number.isInteger(p.memKiB) || p.memKiB < MIN_MEM_KIB || p.memKiB > MAX_MEM_KIB) throw new Error("recovery: bad memory cost");
  if (!(p.salt instanceof Uint8Array) || p.salt.length !== SALT) throw new Error("recovery: bad salt");
  return p;
}

export function newRecoveryParams() {
  return { salt: sodium().randombytes_buf(SALT), ...DEFAULT_PARAMS };
}

// Stored form: version ‖ ops ‖ memKiB ‖ salt.
export function encodeRecoveryParams(p) {
  checkRecoveryParams(p);
  return concat(Uint8Array.of(PARAMS_VERSION), u32(p.ops), u32(p.memKiB), p.salt);
}

export function decodeRecoveryParams(b) {
  if (!(b instanceof Uint8Array) || b.length !== 1 + 4 + 4 + SALT || b[0] !== PARAMS_VERSION) throw new Error("recovery: bad params");
  return checkRecoveryParams({ ops: readU32(b, 1), memKiB: readU32(b, 5), salt: b.slice(9) });
}
