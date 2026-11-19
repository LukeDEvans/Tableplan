// The printed recovery code (documents/crypto/recovery.js, recovery-params.js).

import { describe, it, expect } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { generateVaultKey, rotateVault } from "../documents/crypto/vault.js";
import { seal, contextBytes } from "../documents/crypto/wrap.js";
import {
  ALPHABET, generateRecoveryCode, parseRecoveryCode, formatRecoveryCode, deriveRecoveryKeys,
  wrapAnchor, sealToRecovery, restoreVaultKey,
} from "../documents/crypto/recovery.js";
import { newRecoveryParams, encodeRecoveryParams, decodeRecoveryParams, DEFAULT_PARAMS } from "../documents/crypto/recovery-params.js";

await loadSodium();

const refuses = (fn) => expect(fn).toThrow();
// Cheapest allowed cost, so tests stay fast; one test uses the real default.
const fastParams = () => ({ ...newRecoveryParams(), ops: 1, memKiB: 8 * 1024 });

describe("the code", () => {
  it("looks right and parses back however it's typed or pasted", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateRecoveryCode();
      expect(c).toMatch(/^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
      const n = parseRecoveryCode(c);
      expect(formatRecoveryCode(n)).toBe(c);
      expect(parseRecoveryCode(` ${c.toLowerCase().replace(/-/g, " ")} `)).toBe(n);
      expect(parseRecoveryCode(c.replace(/-/g, "–"))).toBe(n); // en dashes from a pasted note
      expect(parseRecoveryCode(c.replace(/-/g, "— "))).toBe(n);
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

  it("formatRecoveryCode only takes the normalized form", () => {
    refuses(() => formatRecoveryCode("AB"));
    refuses(() => formatRecoveryCode(null));
    refuses(() => formatRecoveryCode("O".repeat(32)));
  });
});

describe("params", () => {
  it("encode and decode", () => {
    const p = newRecoveryParams();
    expect(p).toMatchObject(DEFAULT_PARAMS);
    expect(decodeRecoveryParams(encodeRecoveryParams(p))).toEqual(p);
  });
  it("never more than the defaults, never less than the floor, salt exactly 16 bytes", () => {
    const p = newRecoveryParams();
    refuses(() => decodeRecoveryParams(new Uint8Array(10)));
    const more = encodeRecoveryParams(p); more.set([0, 0x40, 0, 0], 5); // 4 GiB
    refuses(() => decodeRecoveryParams(more));
    const slower = encodeRecoveryParams(p); slower.set([0, 0, 0, 4], 1);
    refuses(() => decodeRecoveryParams(slower));
    const zero = encodeRecoveryParams(p); zero.set([0, 0, 0, 0], 1);
    refuses(() => decodeRecoveryParams(zero));
    refuses(() => encodeRecoveryParams({ ...p, salt: new Uint8Array(8) }));
    refuses(() => encodeRecoveryParams({ ...p, memKiB: 128 * 1024 }));
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

describe("restore", () => {
  const base = { userId: "luke", vaultId: "vault-p", scope: "u-luke" };
  const ids = { vaultId: base.vaultId, scope: base.scope };
  const oldKeyCtx = (v) => contextBytes("LiveDocs/old-vault-key/v1", [["vaultId", ids.vaultId], ["scope", ids.scope], ["oldVersion", v], ["newVersion", v + 1]]);

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

  // A chain the attacker controls from `top` down to the anchor's version, ending
  // at `anchorKey` (a removed device that kept it can do this; the server can't).
  function fakeChain(top, anchorKey, keys) {
    const ks = { 1: anchorKey };
    for (let v = 2; v <= top; v++) ks[v] = generateVaultKey();
    const rows = [];
    for (let v = 1; v < top; v++) rows.push({ version: v, wrapped: seal(ks[v + 1], ks[v], oldKeyCtx(v)) });
    return { key: ks[top], rows, sealed: { keyVersion: top, sealed: sealToRecovery(keys.recoveryPub, ks[top], { ...base, keyVersion: top }) } };
  }

  it("no rotations: the anchor's key, complete", () => {
    const s = setup(0);
    const out = restoreVaultKey({ keys: deriveRecoveryKeys(s.code, s.params), base, anchor: s.anchor });
    expect(out).toEqual({ key: s.vk[1], version: 1, anchorVersion: 1, newestOffered: 1, complete: true, rejected: [] });
  });

  it("after rotations: the newest key, proven by the chain, complete", () => {
    const s = setup(3);
    const out = restoreVaultKey({ keys: deriveRecoveryKeys(s.code, s.params), base, anchor: s.anchor, sealed: s.sealed, oldRows: s.oldRows });
    expect(out.version).toBe(4);
    expect(out.key).toEqual(s.vk[4]);
    expect(out.complete).toBe(true);
  });

  it("duplicated rows don't shorten a restore", () => {
    const s = setup(3);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [...s.sealed, s.sealed[0]], oldRows: [...s.oldRows, s.oldRows[0], s.oldRows[1]] });
    expect(out.version).toBe(4);
    expect(out.complete).toBe(true);
  });

  it("a dropped old-key row gives a SHORT restore, reported as such", () => {
    const s = setup(3);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: s.sealed, oldRows: s.oldRows.filter((r) => r.version !== 2) });
    expect(out.version).toBe(2);
    expect(out.complete).toBe(false);
    expect(out.newestOffered).toBe(4);
    expect(out.rejected).toEqual([3, 4]);
  });

  it("a withheld newest seal gives an older version; the caller sees it against the vault's version", () => {
    const s = setup(3);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: s.sealed.slice(0, -1), oldRows: s.oldRows });
    expect(out.version).toBe(3);
    // nothing newer was offered, so only the vault's own version can reveal this
    expect(out.complete).toBe(true);
  });

  it("a key the server sealed to the public key is not accepted", () => {
    const s = setup(2);
    const fake = generateVaultKey();
    // The server knows recoveryPub, so it can seal anything — and fake old rows too.
    const sealed = [...s.sealed, { keyVersion: 9, sealed: sealToRecovery(s.keys.recoveryPub, fake, { ...base, keyVersion: 9 }) }];
    const fakeRow = { version: 8, wrapped: seal(fake, generateVaultKey(), oldKeyCtx(8)) };
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed, oldRows: [...s.oldRows, fakeRow] });
    expect(out.version).toBe(3);
    expect(out.key).toEqual(s.vk[3]);
    expect(out.rejected).toEqual([9]);
  });

  it("a chain that reaches the anchor's version with a different key is rejected", () => {
    const s = setup(1);
    const f = fakeChain(5, generateVaultKey(), s.keys);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [...s.sealed, f.sealed], oldRows: [...s.oldRows, ...f.rows] });
    expect(out.version).toBe(2);
    expect(out.key).toEqual(s.vk[2]);
    expect(out.rejected).toEqual([5]);
  });

  it("two different chains that both reach the anchor are refused (tampering)", () => {
    // Only possible with the anchor's real key — a removed device that kept it.
    const s = setup(2);
    const f = fakeChain(6, s.vk[1], s.keys);
    expect(() => restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [...s.sealed, f.sealed], oldRows: [...s.oldRows, ...f.rows] })).toThrow(/conflicting/);
  });

  it("known limit: with the legitimate rows withheld, a removed device's chain wins — hence a new code on removal", () => {
    const s = setup(2);
    const f = fakeChain(6, s.vk[1], s.keys);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [f.sealed], oldRows: f.rows });
    expect(out.version).toBe(6);
    expect(out.key).toEqual(f.key);
  });

  it("with the chain missing, it falls back to the anchor and says so", () => {
    const s = setup(2);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: s.sealed, oldRows: [] });
    expect(out).toMatchObject({ key: s.vk[1], version: 1, complete: false, newestOffered: 3, rejected: [2, 3] });
  });

  it("a wrong code can't open the anchor, and the message doesn't blame the code", () => {
    const s = setup(1);
    expect(() => restoreVaultKey({ keys: deriveRecoveryKeys(generateRecoveryCode(), s.params), base, anchor: s.anchor, sealed: s.sealed, oldRows: s.oldRows }))
      .toThrow(/couldn't open the recovery record/);
  });

  it("wraps don't move between people, vaults or versions", () => {
    const s = setup(1);
    refuses(() => restoreVaultKey({ keys: s.keys, base: { ...base, userId: "marijane" }, anchor: s.anchor }));
    refuses(() => restoreVaultKey({ keys: s.keys, base: { ...base, vaultId: "vault-h" }, anchor: s.anchor }));
    refuses(() => restoreVaultKey({ keys: s.keys, base, anchor: { ...s.anchor, keyVersion: 2 } }));
    // a sealed row relabelled to another version is rejected
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [{ ...s.sealed[0], keyVersion: 3 }], oldRows: s.oldRows });
    expect(out.version).toBe(1);
    expect(out.rejected).toEqual([3]);
  });

  it("ignores malformed sealed rows", () => {
    const s = setup(1);
    const out = restoreVaultKey({ keys: s.keys, base, anchor: s.anchor, sealed: [null, { keyVersion: "2", sealed: s.sealed[0].sealed }, { keyVersion: 1.5 }, ...s.sealed], oldRows: s.oldRows });
    expect(out.version).toBe(2);
  });

  it("refuses to seal to a bad key", () => {
    refuses(() => sealToRecovery(new Uint8Array(32), generateVaultKey(), { ...base, keyVersion: 1 }));
  });
});
