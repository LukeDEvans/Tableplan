// Identity-signed statements: vault settled (with removed devices) and the
// recovery key (documents/crypto/statements.js).

import { describe, it, expect } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { generateIdentity, generateDevice } from "../messaging/crypto/keys.js";
import { signVaultSettled, verifyVaultSettled, signRecoveryPub, verifyRecoveryPub } from "../documents/crypto/statements.js";
import { deriveRecoveryKeys, generateRecoveryCode } from "../documents/crypto/recovery.js";
import { newRecoveryParams } from "../documents/crypto/recovery-params.js";

await loadSodium();

const refuses = (fn) => expect(fn).toThrow();

describe("vault settled", () => {
  const luke = generateIdentity();
  const st = { userId: "luke", vaultId: "vault-h", scope: "group-1", keyVersion: 3, removedDeviceIds: ["old-browser", "lost-laptop"] };
  const sig = signVaultSettled(luke, st);

  it("verifies against the signer's identity only — not a device key", () => {
    expect(verifyVaultSettled(luke.signPub, st, sig)).toBe(true);
    expect(verifyVaultSettled(generateIdentity().signPub, st, sig)).toBe(false);
    // A removed linked device has a device key, not the identity: its signature fails.
    const removed = generateDevice();
    expect(verifyVaultSettled(luke.signPub, st, signVaultSettled({ signPriv: removed.signPriv }, st))).toBe(false);
  });

  it("covers every field", () => {
    for (const change of [{ userId: "marijane" }, { vaultId: "vault-p" }, { scope: "u-luke" }, { keyVersion: 4 }, { removedDeviceIds: ["old-browser"] }, { removedDeviceIds: [] }]) {
      expect(verifyVaultSettled(luke.signPub, { ...st, ...change }, sig)).toBe(false);
    }
  });

  it("the removed list is a set: order and repeats don't matter", () => {
    expect(verifyVaultSettled(luke.signPub, { ...st, removedDeviceIds: ["lost-laptop", "old-browser", "lost-laptop"] }, sig)).toBe(true);
  });

  it("refuses bad input", () => {
    refuses(() => signVaultSettled(luke, { ...st, keyVersion: "3" }));
    refuses(() => signVaultSettled(luke, { ...st, removedDeviceIds: "x" }));
    refuses(() => signVaultSettled(luke, { ...st, removedDeviceIds: ["a b"] }));
    refuses(() => signVaultSettled(luke, { ...st, removedDeviceIds: Array.from({ length: 501 }, (_, i) => `d${i}`) }));
    expect(verifyVaultSettled(luke.signPub, st, null)).toBe(false);
    expect(verifyVaultSettled(luke.signPub, st, sig.subarray(0, 10))).toBe(false);
  });
});

describe("recovery key", () => {
  const luke = generateIdentity();
  const params = { ...newRecoveryParams(), ops: 1, memKiB: 8 * 1024 };
  const keys = deriveRecoveryKeys(generateRecoveryCode(), params);
  const st = { userId: "luke", recoveryPub: keys.recoveryPub, params, generation: 2 };
  const sig = signRecoveryPub(luke, st);

  it("verifies against the person's identity only", () => {
    expect(verifyRecoveryPub(luke.signPub, st, sig)).toBe(true);
    expect(verifyRecoveryPub(generateIdentity().signPub, st, sig)).toBe(false);
    const removed = generateDevice();
    expect(verifyRecoveryPub(luke.signPub, st, signRecoveryPub({ signPriv: removed.signPriv }, st))).toBe(false);
  });

  it("covers the key, person, settings and generation (an old sheet's key can't be re-labelled newer)", () => {
    const other = deriveRecoveryKeys(generateRecoveryCode(), params);
    for (const change of [{ recoveryPub: other.recoveryPub }, { userId: "marijane" }, { params: { ...params, ops: 2 } }, { generation: 3 }, { generation: 1 }]) {
      expect(verifyRecoveryPub(luke.signPub, { ...st, ...change }, sig)).toBe(false);
    }
  });

  it("refuses bad input", () => {
    refuses(() => signRecoveryPub(luke, { ...st, recoveryPub: new Uint8Array(32) }));
    refuses(() => signRecoveryPub(luke, { ...st, generation: 0 }));
    refuses(() => signRecoveryPub(luke, { ...st, generation: "2" }));
    refuses(() => signRecoveryPub(luke, { ...st, params: { ...params, memKiB: 512 * 1024 } }));
    expect(verifyRecoveryPub(luke.signPub, st, null)).toBe(false);
  });
});
