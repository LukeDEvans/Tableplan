// The printed recovery code (documents/crypto/recovery.js).

import { describe, it, expect } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { generateDevice } from "../messaging/crypto/keys.js";
import { generateVaultKey, rotateVault } from "../documents/crypto/vault.js";
import { seal, contextBytes } from "../documents/crypto/wrap.js";
import {
  ALPHABET, generateRecoveryCode, parseRecoveryCode, formatRecoveryCode,
  newRecoveryParams, encodeRecoveryParams, decodeRecoveryParams, deriveRecoveryKeys,
  signRecoveryPub, verifyRecoveryPub, wrapAnchor, sealToRecovery, restoreVaultKey,
} from "../documents/crypto/recovery.js";

await loadSodium();

const refuses = (fn) => expect(fn).toThrow();
// Cheapest allowed cost, so tests stay fast; one test uses the real default.
const fastParams = () => ({ ...newRecoveryParams(), ops: 1, memKiB: 8 * 1024 });

describe("the code", () => {
  it("looks right and parses back however it's typed", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateRecoveryCode();
      expect(c).toMatch(/^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
      const n = parseRecoveryCode(c);
      expect(formatRecoveryCode(n)).toBe(c);
      expect(parseRecoveryCode(` ${c.toLowerCase().replace(/-/g, " ")} `)).toBe(n);
    }
  });

  it("the alphabet has 32 unambiguous characters", () => {
    expect(new Set(ALPHABET).size).toBe(32);
    expect(ALPHABET).not.toMatch(/[01IO]/);
  });

  it("every single-character typo is caught", () => {
    const n = parseRecoveryCode(generateRecoveryCode());
    let caught = 0, total = 0;
    for (let i = 0; i < n.length; i++) {
      for (const ch of ALPHABET) {
        if (ch === n[i]) continue;
        total++;
        try { parseRecoveryCode(n.slice(0, i) + ch + n.slice(i + 1)); } catch { caught++; }
      }
    }
    // 20 check bits: a miss is ~1 in a million per typo; allow at most one.
    expect(total - caught).toBeLessThanOrEqual(1);
  });

  it("swapped neighbours are caught", () => {
    const n = parseRecoveryCode(generateRecoveryCode());
    let missed = 0;
    for (let i = 0; i < n.length - 1; i++) {
      if (n[i] === n[i + 1]) continue;
      const t = n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2);
      try { parseRecoveryCode(t); missed++; } catch {}
    }
    expect(missed).toBeLessThanOrEqual(1);
  });

  it("explains what's wrong", () => {
    const c = generateRecoveryCode();
    expect(() => parseRecoveryCode(c.slice(0, -1))).toThrow(/32 characters/);
    expect(() => parseRecoveryCode("0" + c.slice(1))).toThrow(/0, O, 1 or I/);
    expect(() => parseRecoveryCode("#" + c.slice(1))).toThrow(/isn't used/);
    expect(() => parseRecoveryCode(null)).toThrow();
  });
});

describe("params", () => {
  it("encode and decode, within bounds", () => {
    const p = newRecoveryParams();
    expect(decodeRecoveryParams(encodeRecoveryParams(p))).toEqual(p);
    refuses(() => decodeRecoveryParams(new Uint8Array(10)));
    const huge = encodeRecoveryParams(p); huge.set([0, 0x40, 0, 0], 5); // 4 GiB of memory
    refuses(() => decodeRecoveryParams(huge));
    const zero = encodeRecoveryParams(p); zero.set([0, 0, 0, 0], 1);
    refuses(() => decodeRecoveryParams(zero));
  });
});

describe("keys from the code", () => {
  it("same code and params give the same keys; anything else differs", () => {
    const code = generateRecoveryCode();
    const p = fastParams();
    const a = deriveRecoveryKeys(code, p);
    expect(deriveRecoveryKeys(code.toLowerCase(), p)).toEqual(a);
    expect(deriveRecoveryKeys(generateRecoveryCode(), p).anchorKey).not.toEqual(a.anchorKey);
    expect(deriveRecoveryKeys(code, { ...p, salt: newRecoveryParams().salt }).anchorKey).not.toEqual(a.anchorKey);
    expect(a.anchorKey).not.toEqual(a.recoveryPriv);
  });
  it("the default cost works (Argon2id, 64 MiB)", () => {
    const k = deriveRecoveryKeys(generateRecoveryCode(), newRecoveryParams());
    expect(k.anchorKey.length).toBe(32);
  });
  it("refuses a bad code or out-of-bounds params", () => {
    refuses(() => deriveRecoveryKeys("nope", fastParams()));
    refuses(() => deriveRecoveryKeys(generateRecoveryCode(), { ...fastParams(), memKiB: 1024 }));
    refuses(() => deriveRecoveryKeys(generateRecoveryCode(), { ...fastParams(), salt: new Uint8Array(8) }));
  });
});

describe("recovery public key", () => {
  const dev = generateDevice();
  const keys = deriveRecoveryKeys(generateRecoveryCode(), fastParams());
  const params = fastParams();
  const desc = { userId: "luke", recoveryPub: keys.recoveryPub, params };
  const sig = signRecoveryPub(dev, desc);

  it("verifies only against the device that vouched", () => {
    expect(verifyRecoveryPub(dev.signPub, desc, sig)).toBe(true);
    expect(verifyRecoveryPub(generateDevice().signPub, desc, sig)).toBe(false);
  });
  it("a swapped key, person or cost breaks it", () => {
    expect(verifyRecoveryPub(dev.signPub, { ...desc, recoveryPub: deriveRecoveryKeys(generateRecoveryCode(), fastParams()).recoveryPub }, sig)).toBe(false);
    expect(verifyRecoveryPub(dev.signPub, { ...desc, userId: "marijane" }, sig)).toBe(false);
    expect(verifyRecoveryPub(dev.signPub, { ...desc, params: { ...params, ops: 2 } }, sig)).toBe(false);
    expect(verifyRecoveryPub(dev.signPub, desc, null)).toBe(false);
  });
});

describe("restore", () => {
  const base = { userId: "luke", vaultId: "vault-p", scope: "u-luke" };
  const ids = { vaultId: base.vaultId, scope: base.scope };

  function setup(rotations) {
    const code = generateRecoveryCode();
    const params = fastParams();
    const keys = deriveRecoveryKeys(code, params);
    const vk = [null, generateVaultKey()];
    const anchor = { keyVersion: 1, wrapped: wrapAnchor(keys.anchorKey, vk[1], { ...base, keyVersion: 1 }) };
    const sealed = [];
    const oldRows = [];
    for (let v = 1; v <= rotations; v++) {
      const r = rotateVault({ ...ids, key: vk[v], version: v });
      vk.push(r.key);
      oldRows.push(r.oldRow);
      // a device without the code adds the new key for recovery
      sealed.push({ keyVersion: v + 1, sealed: sealToRecovery(keys.recoveryPub, r.key, { ...base, keyVersion: v + 1 }) });
    }
    return { code, params, keys, vk, anchor, sealed, oldRows };
  }

  it("no rotations: the anchor's key", () => {
    const s = setup(0);
    const out = restoreVaultKey({ keys: deriveRecoveryKeys(s.code, s.params), base, anchor: s.anchor });
    expect(out).toEqual({ key: s.vk[1], version: 1 });
  });

  it("after rotations: the newest key, proven by the chain", () => {
    const s = setup(3);
    const out = restoreVaultKey({ keys: deriveRecoveryKeys(s.code, s.params), base, anchor: s.anchor, sealed: s.sealed, oldRows: s.oldRows });
    expect(out.version).toBe(4);
    expect(out.key).toEqual(s.vk[4]);
  });

  it("a key the server sealed to the public key is not accepted", () => {
    const s = setup(2);
    const fake = generateVaultKey();
    // The server knows recoveryPub, so it can seal anything — and fake an old row too.
    const sealed = [...s.sealed, { keyVersion: 9, sealed: sealToRecovery(s.keys.recoveryPub, fake, { ...base, keyVersion: 9 }) }];
    const fakeRow = { version: 8, wrapped: seal(fake, generateVaultKey(), contextBytes("LiveDocs/old-vault-key/v1", [["vaultId", ids.vaultId], ["scope", ids.scope], ["oldVersion", 8], ["newVersion", 9]])) };
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed, oldRows: [...s.oldRows, fakeRow] });
    expect(out.version).toBe(3);
    expect(out.key).toEqual(s.vk[3]);
  });

  it("with the chain missing, it falls back to the anchor instead of trusting the seal", () => {
    const s = setup(2);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: s.sealed, oldRows: [] });
    expect(out).toEqual({ key: s.vk[1], version: 1 });
  });

  it("a wrong code can't open the anchor", () => {
    const s = setup(1);
    refuses(() => restoreVaultKey({ keys: deriveRecoveryKeys(generateRecoveryCode(), s.params), base, anchor: s.anchor, sealed: s.sealed, oldRows: s.oldRows }));
  });

  it("wraps don't move between people, vaults or versions", () => {
    const s = setup(1);
    refuses(() => restoreVaultKey({ keys: s.keys, base: { ...base, userId: "marijane" }, anchor: s.anchor }));
    refuses(() => restoreVaultKey({ keys: s.keys, base: { ...base, vaultId: "vault-h" }, anchor: s.anchor }));
    refuses(() => restoreVaultKey({ keys: s.keys, base, anchor: { ...s.anchor, keyVersion: 2 } }));
    // a sealed row relabelled to another version is ignored
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [{ ...s.sealed[0], keyVersion: 3 }], oldRows: s.oldRows });
    expect(out.version).toBe(1);
  });

  it("refuses to seal to a bad key", () => {
    refuses(() => sealToRecovery(new Uint8Array(32), generateVaultKey(), { ...base, keyVersion: 1 }));
  });
});
