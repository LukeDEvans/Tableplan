// Box keys and vault grants (documents/crypto/grants.js).

import { describe, it, expect } from "vitest";
import { loadSodium, sodium } from "../messaging/crypto/sodium.js";
import { concat, field } from "../messaging/crypto/bytes.js";
import { generateDevice } from "../messaging/crypto/keys.js";
import { generateVaultKey } from "../documents/crypto/vault.js";
import { generateBoxKey, signBoxKey, verifyBoxKey, createGrant, openGrant } from "../documents/crypto/grants.js";
import { contextBytes } from "../documents/crypto/wrap.js";

await loadSodium();

const refuses = (fn) => expect(fn).toThrow();
// Order-4 point on Curve25519 (a classic low-order key).
const LOW_ORDER = Uint8Array.from([0xe0, 0xeb, 0x7a, 0x7c, 0x3b, 0x41, 0xb8, 0xae, 0x16, 0x56, 0xe3, 0xfa, 0xf1, 0x9f, 0xc4, 0x6a, 0xda, 0x09, 0x8d, 0xeb, 0x9c, 0x32, 0xb1, 0xfd, 0x86, 0x62, 0x05, 0x16, 0x5f, 0x49, 0xb8, 0x00]);

describe("box keys", () => {
  const dev = generateDevice();
  const box = generateBoxKey();
  const desc = { userId: "marijane", deviceId: "phone-1", boxPub: box.pub };
  const sig = signBoxKey(dev, desc);

  it("verify against the device's signing key only", () => {
    expect(verifyBoxKey(dev.signPub, desc, sig)).toBe(true);
    expect(verifyBoxKey(generateDevice().signPub, desc, sig)).toBe(false);
  });
  it("break when anything changes", () => {
    for (const change of [{ userId: "luke" }, { deviceId: "phone-2" }, { boxPub: generateBoxKey().pub }]) {
      expect(verifyBoxKey(dev.signPub, { ...desc, ...change }, sig)).toBe(false);
    }
    const bad = sig.slice(); bad[0] ^= 1;
    expect(verifyBoxKey(dev.signPub, desc, bad)).toBe(false);
    expect(verifyBoxKey(dev.signPub, desc, sig.subarray(0, 63))).toBe(false);
    expect(verifyBoxKey(dev.signPub, desc, null)).toBe(false);
  });
  it("low-order and zero keys are refused", () => {
    refuses(() => signBoxKey(dev, { ...desc, boxPub: LOW_ORDER }));
    refuses(() => signBoxKey(dev, { ...desc, boxPub: new Uint8Array(32) }));
    expect(verifyBoxKey(dev.signPub, { ...desc, boxPub: LOW_ORDER }, sig)).toBe(false);
  });
});

describe("grants", () => {
  const lukePhone = generateDevice();
  const granter = { userId: "luke", deviceId: "luke-phone", device: lukePhone };
  const herBox = generateBoxKey();
  const vaultKey = generateVaultKey();
  const ctx = { vaultId: "vault-h", scope: "group-1", keyVersion: 1, recipientUserId: "marijane", recipientDeviceId: "her-phone", recipientBoxPub: herBox.pub };
  const grant = createGrant({ granter, vaultKey, ctx, removedDeviceIds: [] });
  const openIt = (over = {}) => openGrant({ grant, ctx, box: herBox, granterSignPub: lukePhone.signPub, removedDeviceIds: [], ...over });

  it("opens on the recipient's device", () => expect(openIt()).toEqual(vaultKey));

  it("refuses every other expectation", () => {
    for (const change of [{ vaultId: "vault-p" }, { scope: "u-luke" }, { keyVersion: 2 }, { recipientUserId: "luke" }, { recipientDeviceId: "her-browser" }]) {
      refuses(() => openIt({ ctx: { ...ctx, ...change } }));
    }
  });

  it("refuses another device's box key", () => {
    const other = generateBoxKey();
    refuses(() => openIt({ box: other }));
    refuses(() => openIt({ box: other, ctx: { ...ctx, recipientBoxPub: other.pub } }));
  });

  it("refuses an unknown granter or an edited grant", () => {
    refuses(() => openIt({ granterSignPub: generateDevice().signPub }));
    refuses(() => openIt({ grant: { ...grant, granterUserId: "someone" } }));
    refuses(() => openIt({ grant: { ...grant, granterDeviceId: "luke-browser" } }));
    const s = grant.sealed.slice(); s[s.length - 1] ^= 1;
    refuses(() => openIt({ grant: { ...grant, sealed: s } }));
    const g = grant.sig.slice(); g[5] ^= 1;
    refuses(() => openIt({ grant: { ...grant, sig: g } }));
    refuses(() => openIt({ grant: { ...grant, sig: grant.sig.subarray(0, 10) } }));
    refuses(() => openIt({ grant: null }));
  });

  it("a sealed key can't move to another grant", () => {
    const other = createGrant({ granter, vaultKey: generateVaultKey(), ctx: { ...ctx, vaultId: "vault-p", scope: "u-marijane" }, removedDeviceIds: [] });
    refuses(() => openIt({ grant: { ...grant, sealed: other.sealed } }));
  });

  it("a validly signed grant whose sealed box was made for elsewhere is refused", () => {
    // Defence in depth: even a signing device that seals the wrong context is caught.
    const elsewhere = { ...ctx, vaultId: "vault-p" };
    const inner = concat(field(concat(
      contextBytes("LiveDocs/vault-grant/v1", [["vaultId", elsewhere.vaultId], ["scope", elsewhere.scope], ["keyVersion", 1], ["recipientUserId", "marijane"], ["recipientDeviceId", "her-phone"]]),
      field(herBox.pub),
    )), vaultKey);
    const sealed = sodium().crypto_box_seal(inner, herBox.pub);
    const ctxBytes = concat(contextBytes("LiveDocs/vault-grant/v1", [["vaultId", ctx.vaultId], ["scope", ctx.scope], ["keyVersion", 1], ["recipientUserId", "marijane"], ["recipientDeviceId", "her-phone"]]), field(herBox.pub));
    const sigBytes = concat(field(new TextEncoder().encode("LiveDocs/vault-grant-sig/v1")), field(ctxBytes), field(new TextEncoder().encode("luke")), field(new TextEncoder().encode("luke-phone")), field(sealed));
    const sig = sodium().crypto_sign_detached(sigBytes, lukePhone.signPriv);
    expect(() => openIt({ grant: { sealed, sig, granterUserId: "luke", granterDeviceId: "luke-phone" } })).toThrow(/somewhere else/);
  });

  it("refuses to seal to a low-order key or a non-key", () => {
    refuses(() => createGrant({ granter, vaultKey, ctx: { ...ctx, recipientBoxPub: LOW_ORDER }, removedDeviceIds: [] }));
    refuses(() => createGrant({ granter, vaultKey: new Uint8Array(16), ctx, removedDeviceIds: [] }));
  });

  it("a device can grant itself (first setup)", () => {
    const myBox = generateBoxKey();
    const self = { ...ctx, recipientUserId: "luke", recipientDeviceId: "luke-phone", recipientBoxPub: myBox.pub, scope: "u-luke", vaultId: "vault-p" };
    const g = createGrant({ granter, vaultKey, ctx: self, removedDeviceIds: [] });
    expect(openGrant({ grant: g, ctx: self, box: myBox, granterSignPub: lukePhone.signPub, removedDeviceIds: [] })).toEqual(vaultKey);
  });

  it("removed devices can't grant or be granted, and the list is required", () => {
    refuses(() => createGrant({ granter, vaultKey, ctx }));
    refuses(() => openIt({ removedDeviceIds: undefined }));
    expect(() => createGrant({ granter, vaultKey, ctx, removedDeviceIds: ["her-phone"] })).toThrow(/removed/);
    expect(() => createGrant({ granter, vaultKey, ctx, removedDeviceIds: ["luke-phone"] })).toThrow(/removed/);
    // a removed device's grant fails even with a valid signature
    expect(() => openIt({ removedDeviceIds: ["luke-phone"] })).toThrow(/removed/);
    expect(() => openIt({ removedDeviceIds: ["her-phone"] })).toThrow(/removed/);
  });
});
