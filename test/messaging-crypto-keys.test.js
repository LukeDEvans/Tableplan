// Device certificates, signed prekeys, X25519 key checks and safety numbers.

import { describe, it, expect, beforeAll } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import {
  generateIdentity, generateDevice, certifyDevice, verifyDeviceCert,
  generateSignedPrekey, verifySignedPrekey, dh, generateDhKeyPair,
  safetyNumber, safetyQr, matchSafetyQr, generateOneTimePrekeys,
} from "../messaging/crypto/keys.js";

beforeAll(async () => { await loadSodium(); });

function certFor(device, overrides = {}) {
  return { userId: "luke", deviceId: "dev-1", kind: "linked", signPub: device.signPub, dhPub: device.dhPub, createdAt: 1761800000000, ...overrides };
}

describe("device certificates", () => {
  it("verify against the signing identity only", () => {
    const id = generateIdentity();
    const other = generateIdentity();
    const dev = generateDevice();
    const cert = certFor(dev);
    const sig = certifyDevice(id, cert);
    expect(verifyDeviceCert(id.signPub, cert, sig)).toBe(true);
    expect(verifyDeviceCert(other.signPub, cert, sig)).toBe(false);
  });

  it("break when any certified field changes", () => {
    const id = generateIdentity();
    const dev = generateDevice();
    const swap = generateDevice();
    const cert = certFor(dev);
    const sig = certifyDevice(id, cert);
    for (const change of [
      { userId: "marijane" }, { deviceId: "dev-2" }, { kind: "phone" },
      { signPub: swap.signPub }, { dhPub: swap.dhPub }, { createdAt: cert.createdAt + 1 },
    ]) {
      expect(verifyDeviceCert(id.signPub, { ...cert, ...change }, sig)).toBe(false);
    }
  });

  it("can't be re-split across fields (length-prefixed)", () => {
    const id = generateIdentity();
    const dev = generateDevice();
    const sig = certifyDevice(id, certFor(dev, { userId: "ab", deviceId: "c" }));
    expect(verifyDeviceCert(id.signPub, certFor(dev, { userId: "a", deviceId: "bc" }), sig)).toBe(false);
  });

  it("reject malformed input instead of throwing", () => {
    const id = generateIdentity();
    const dev = generateDevice();
    const cert = certFor(dev);
    const sig = certifyDevice(id, cert);
    expect(verifyDeviceCert(id.signPub, cert, sig.subarray(0, 10))).toBe(false);
    expect(verifyDeviceCert(id.signPub, { ...cert, kind: "laptop" }, sig)).toBe(false);
    expect(verifyDeviceCert(new Uint8Array(5), cert, sig)).toBe(false);
    expect(() => certifyDevice(id, { ...cert, userId: "" })).toThrow();
  });
});

describe("prekeys", () => {
  it("signed prekeys verify under their device key only", () => {
    const dev = generateDevice();
    const other = generateDevice();
    const spk = generateSignedPrekey(dev, 7);
    expect(verifySignedPrekey(dev.signPub, spk)).toBe(true);
    expect(verifySignedPrekey(other.signPub, spk)).toBe(false);
    expect(verifySignedPrekey(dev.signPub, { ...spk, id: 8 })).toBe(false);
    expect(verifySignedPrekey(dev.signPub, { ...spk, pub: generateDhKeyPair().pub })).toBe(false);
  });

  it("one-time prekeys are numbered and distinct", () => {
    const opks = generateOneTimePrekeys(100, 20);
    expect(opks.map((k) => k.id)).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(new Set(opks.map((k) => k.pub.join(","))).size).toBe(20);
  });
});

describe("X25519", () => {
  it("both sides agree", () => {
    const a = generateDhKeyPair();
    const b = generateDhKeyPair();
    expect(dh(a.priv, b.pub)).toEqual(dh(b.priv, a.pub));
  });

  it("rejects low-order public keys", () => {
    const a = generateDhKeyPair();
    expect(() => dh(a.priv, new Uint8Array(32))).toThrow(/rejected/);
    const one = new Uint8Array(32); one[0] = 1;
    expect(() => dh(a.priv, one)).toThrow(/rejected/);
  });
});

describe("safety numbers", () => {
  const luke = () => ({ userId: "luke", signPub: generateIdentity().signPub });

  it("are 60 digits and the same on both phones", () => {
    const a = luke();
    const b = { userId: "marijane", signPub: generateIdentity().signPub };
    const n = safetyNumber(a, b);
    expect(n).toMatch(/^\d{60}$/);
    expect(safetyNumber(b, a)).toBe(n);
  });

  it("change when either identity key changes", () => {
    const a = luke();
    const b = { userId: "marijane", signPub: generateIdentity().signPub };
    const b2 = { userId: "marijane", signPub: generateIdentity().signPub };
    expect(safetyNumber(a, b2)).not.toBe(safetyNumber(a, b));
  });

  it("QR scan matches only when both sides hold the right keys", () => {
    const me = luke();
    const them = { userId: "marijane", signPub: generateIdentity().signPub };
    const shownOnTheirPhone = safetyQr(them, me);
    expect(matchSafetyQr(shownOnTheirPhone, me, them)).toBe(true);
    // Their phone has a forged key for me (server swapped it):
    const forgedMe = { userId: "luke", signPub: generateIdentity().signPub };
    expect(matchSafetyQr(safetyQr(them, forgedMe), me, them)).toBe(false);
    // I hold a forged key for them:
    const forgedThem = { userId: "marijane", signPub: generateIdentity().signPub };
    expect(matchSafetyQr(shownOnTheirPhone, me, forgedThem)).toBe(false);
    // My own QR scanned back is not a match.
    expect(matchSafetyQr(safetyQr(me, them), me, them)).toBe(false);
    expect(matchSafetyQr(new Uint8Array(3), me, them)).toBe(false);
  });
});
