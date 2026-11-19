// HMAC-SHA256 / HKDF-SHA256 against the published RFC test vectors, plus the byte
// and padding helpers the messaging crypto core is built on.

import { describe, it, expect, beforeAll } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { hmacSha256, hkdf, hkdfExtract, hkdfExpand } from "../messaging/crypto/kdf.js";
import { fromHex, toHex, toB64, fromB64, utf8, equalBytes, u32, readU32 } from "../messaging/crypto/bytes.js";
import { pad, unpad, BLOCK } from "../messaging/crypto/padding.js";

beforeAll(async () => { await loadSodium(); });

describe("HMAC-SHA256 (RFC 4231)", () => {
  it("test case 1", () => {
    const key = new Uint8Array(20).fill(0x0b);
    expect(toHex(hmacSha256(key, utf8("Hi There")))).toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  });
  it("test case 2 (short key)", () => {
    expect(toHex(hmacSha256(utf8("Jefe"), utf8("what do ya want for nothing?"))))
      .toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  it("test case 6 (key longer than a block)", () => {
    const key = new Uint8Array(131).fill(0xaa);
    expect(toHex(hmacSha256(key, utf8("Test Using Larger Than Block-Size Key - Hash Key First"))))
      .toBe("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  });
});

describe("HKDF-SHA256 (RFC 5869)", () => {
  it("test case 1", () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = fromHex("000102030405060708090a0b0c");
    const info = fromHex("f0f1f2f3f4f5f6f7f8f9");
    const prk = hkdfExtract(salt, ikm);
    expect(toHex(prk)).toBe("077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5");
    expect(toHex(hkdfExpand(prk, info, 42)))
      .toBe("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
  });
  it("test case 2 (long inputs)", () => {
    const seq = (start, n) => Uint8Array.from({ length: n }, (_, i) => start + i);
    const okm = hkdf(seq(0x60, 80), seq(0x00, 80), seq(0xb0, 80), 82);
    expect(toHex(okm)).toBe(
      "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87"
    );
  });
  it("test case 3 (empty salt and info)", () => {
    const okm = hkdf(new Uint8Array(0), new Uint8Array(22).fill(0x0b), new Uint8Array(0), 42);
    expect(toHex(okm)).toBe("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8");
  });
});

describe("bytes", () => {
  it("base64url round-trips every length and rejects junk", () => {
    for (let n = 0; n < 70; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const s = toB64(b);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(equalBytes(fromB64(s), b)).toBe(true);
    }
    expect(() => fromB64("ab+c")).toThrow();
    expect(() => fromB64("a")).toThrow();
  });
  it("u32 round-trips and range-checks", () => {
    expect(readU32(u32(0xdeadbeef), 0)).toBe(0xdeadbeef);
    expect(() => u32(-1)).toThrow();
    expect(() => u32(2 ** 32)).toThrow();
  });
  it("equalBytes compares length and content", () => {
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(equalBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBe(false);
  });
});

describe("padding", () => {
  it("pads to whole blocks and always adds at least one byte", () => {
    for (let n = 0; n < 200; n++) {
      const b = Uint8Array.from({ length: n }, () => 0);
      const p = pad(b);
      expect(p.length % BLOCK).toBe(0);
      expect(p.length).toBeGreaterThan(n);
      expect(equalBytes(unpad(p), b)).toBe(true);
    }
  });
  it("rejects malformed padding", () => {
    expect(() => unpad(new Uint8Array(BLOCK))).toThrow();
    expect(() => unpad(new Uint8Array(10))).toThrow();
    const p = pad(utf8("hi"));
    p[p.length - 1] = 1;
    expect(() => unpad(p)).toThrow();
  });
});
