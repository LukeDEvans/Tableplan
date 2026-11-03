// Encrypted document blobs and metadata (documents/crypto/file.js, meta.js).

import { describe, it, expect } from "vitest";
import { loadSodium, sodium } from "../messaging/crypto/sodium.js";
import { concat } from "../messaging/crypto/bytes.js";
import { encryptBlob, decryptBlob, readBlobHeader, DEFAULT_CHUNK, MAX_PLAINTEXT } from "../documents/crypto/file.js";
import { parseMeta, encryptMeta, decryptMeta, encryptText, decryptText, LIMITS } from "../documents/crypto/meta.js";
import { generateFileKey } from "../documents/crypto/vault.js";

const C = 4096; // smallest chunk size, so tests cover many chunks cheaply
const HEADER = 10, SS = 24, AB = 17;

await loadSodium();

const rand = (n) => (n ? sodium().randombytes_buf(n) : new Uint8Array(0));

// Splits a blob into [header, ssHeader, ...frames] using the known chunk size.
function frames(blob, chunk = C) {
  const out = [blob.subarray(0, HEADER), blob.subarray(HEADER, HEADER + SS)];
  for (let o = HEADER + SS; o < blob.length; o += chunk + AB) out.push(blob.subarray(o, Math.min(o + chunk + AB, blob.length)));
  return out;
}

const refuses = (fn) => expect(fn).toThrow();

describe("round trips", () => {
  const key = generateFileKey();
  for (const n of [0, 1, C - 1, C, C + 1, 3 * C, 3 * C + 7, 200_000]) {
    it(`${n} bytes`, () => {
      const p = rand(n);
      const blob = encryptBlob(key, "file-1", "content", p, { chunkSize: C });
      expect(decryptBlob(key, "file-1", "content", blob)).toEqual(p);
      // exact multiples (and 0) end with an empty final chunk
      const nFrames = Math.floor(n / C) + 1;
      expect(blob.length).toBe(HEADER + SS + n + nFrames * AB);
    });
  }

  it("default chunk size", () => {
    const p = rand(DEFAULT_CHUNK * 2 + 5);
    expect(decryptBlob(key, "f", "thumb", encryptBlob(key, "f", "thumb", p))).toEqual(p);
    expect(readBlobHeader(encryptBlob(key, "f", "thumb", p))).toEqual({ part: "thumb", chunkSize: DEFAULT_CHUNK });
  });

  it("two encryptions of the same file differ", () => {
    const p = rand(100);
    expect(encryptBlob(key, "f", "content", p)).not.toEqual(encryptBlob(key, "f", "content", p));
  });
});

describe("binding", () => {
  const key = generateFileKey();
  const p = rand(3 * C + 5);
  const blob = encryptBlob(key, "file-1", "content", p, { chunkSize: C });

  it("refuses another key", () => refuses(() => decryptBlob(generateFileKey(), "file-1", "content", blob)));
  it("refuses another file id", () => refuses(() => decryptBlob(key, "file-2", "content", blob)));
  it("refuses being read as another part", () => {
    refuses(() => decryptBlob(key, "file-1", "thumb", blob));
    // even with the part byte rewritten, the subkey and associated data differ
    const relabeled = blob.slice();
    relabeled[5] = 2;
    refuses(() => decryptBlob(key, "file-1", "thumb", relabeled));
  });
  it("refuses bad ids", () => {
    refuses(() => encryptBlob(key, "has space", "content", p));
    refuses(() => encryptBlob(key, "", "content", p));
  });
  it("refuses unknown parts and chunk sizes", () => {
    refuses(() => encryptBlob(key, "f", "other", p));
    refuses(() => encryptBlob(key, "f", "content", p, { chunkSize: 1024 }));
    refuses(() => encryptBlob(key, "f", "content", p, { chunkSize: 2 * 1024 * 1024 }));
  });
});

describe("tampering", () => {
  const key = generateFileKey();
  const p = rand(3 * C + 5);
  const blob = encryptBlob(key, "f", "content", p, { chunkSize: C });

  it("any flipped byte is refused", () => {
    // every header byte, the stream header, and bytes across each frame
    const positions = [...Array(HEADER + SS).keys()];
    for (let o = HEADER + SS; o < blob.length; o += 997) positions.push(o);
    positions.push(blob.length - 1);
    for (const i of positions) {
      const t = blob.slice();
      t[i] ^= 0x40;
      refuses(() => decryptBlob(key, "f", "content", t));
    }
  });

  it("an edited chunk size is refused", () => {
    const t = blob.slice();
    new DataView(t.buffer).setUint32(6, 8192, false);
    refuses(() => decryptBlob(key, "f", "content", t));
  });

  it("truncation is refused, including at a chunk boundary", () => {
    const f = frames(blob);
    expect(f.length).toBe(2 + 4);
    refuses(() => decryptBlob(key, "f", "content", concat(...f.slice(0, -1)))); // drop the FINAL chunk exactly
    refuses(() => decryptBlob(key, "f", "content", blob.subarray(0, blob.length - 1)));
    refuses(() => decryptBlob(key, "f", "content", blob.subarray(0, HEADER + SS)));
    refuses(() => decryptBlob(key, "f", "content", blob.subarray(0, HEADER)));
  });

  it("dropped, swapped, repeated and extra chunks are refused", () => {
    const [h, ss, a, b, c, fin] = frames(blob);
    refuses(() => decryptBlob(key, "f", "content", concat(h, ss, a, c, fin)));
    refuses(() => decryptBlob(key, "f", "content", concat(h, ss, b, a, c, fin)));
    refuses(() => decryptBlob(key, "f", "content", concat(h, ss, a, a, b, c, fin)));
    refuses(() => decryptBlob(key, "f", "content", concat(blob, a)));
    refuses(() => decryptBlob(key, "f", "content", concat(blob, new Uint8Array(20))));
  });

  it("chunks from another blob of the same file are refused", () => {
    const other = frames(encryptBlob(key, "f", "content", p, { chunkSize: C }));
    const [h, ss, a, , c, fin] = frames(blob);
    refuses(() => decryptBlob(key, "f", "content", concat(h, ss, a, other[3], c, fin)));
  });

  it("a stream whose last chunk isn't FINAL is refused, even if it decrypts", () => {
    // Built by hand with the real key: one short MESSAGE chunk and nothing after it.
    const s = sodium();
    const big = encryptBlob(key, "f", "content", rand(10), { chunkSize: C });
    expect(() => decryptBlob(key, "f", "content", big)).not.toThrow();
    const sub = s.crypto_kdf_derive_from_key(32, 1, "LiveDocs", key);
    const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(sub);
    const hdr = big.subarray(0, HEADER);
    const ad = concat(hdr, Uint8Array.of(0, 0, 0, 1), new TextEncoder().encode("f"));
    const m1 = s.crypto_secretstream_xchacha20poly1305_push(state, rand(5), ad, s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    expect(() => decryptBlob(key, "f", "content", concat(hdr, header, m1))).toThrow(/bad chunk|truncated/);
  });

  it("headers that aren't ours are refused", () => {
    refuses(() => readBlobHeader(new Uint8Array(5)));
    refuses(() => readBlobHeader(concat(new TextEncoder().encode("XDOC"), blob.subarray(4))));
    const v = blob.slice(); v[4] = 2;
    refuses(() => readBlobHeader(v));
    const part = blob.slice(); part[5] = 9;
    refuses(() => readBlobHeader(part));
  });

  it("refuses a plaintext over the ceiling before encrypting", () => {
    // a view claiming to be larger, without allocating 256 MB
    const fake = { length: MAX_PLAINTEXT + 1 };
    Object.setPrototypeOf(fake, Uint8Array.prototype);
    refuses(() => encryptBlob(key, "f", "content", fake));
  });
});

describe("metadata", () => {
  const key = generateFileKey();
  const good = { v: 1, name: "  Car title – Subaru  ", mime: "application/pdf", pages: 3, size: 120000, tags: ["car", "car", " title "], documentDate: "2024-02-29" };

  it("round trip, cleaned", () => {
    const m = decryptMeta(key, "f", encryptMeta(key, "f", good));
    expect(m).toEqual({ v: 1, name: "Car title – Subaru", originalName: "", mime: "application/pdf", pages: 3, size: 120000, tags: ["car", "title"], documentDate: "2024-02-29" });
  });

  it("drops unknown fields and prototype keys", () => {
    const m = parseMeta(JSON.parse(`{"v":1,"name":"x","mime":"image/jpeg","extra":1,"__proto__":{"polluted":true}}`));
    expect(Object.keys(m)).toEqual(["v", "name", "originalName", "mime", "pages", "size", "tags", "documentDate"]);
    expect({}.polluted).toBeUndefined();
    expect(m.polluted).toBeUndefined();
  });

  it("rejects bad shapes", () => {
    for (const bad of [
      null, [], "x", { ...good, v: 2 }, { ...good, name: "   " }, { ...good, name: 5 }, { ...good, mime: "" },
      { ...good, name: "x".repeat(LIMITS.name + 1) }, { ...good, pages: -1 }, { ...good, pages: 1.5 },
      { ...good, tags: "car" }, { ...good, tags: Array(LIMITS.tags + 1).fill("t") }, { ...good, tags: [5] },
      { ...good, documentDate: "2023-02-29" }, { ...good, documentDate: "2024-2-1" }, { ...good, documentDate: 20240101 },
    ]) refuses(() => parseMeta(bad));
  });

  it("is padded, so short names don't reveal their length", () => {
    const a = encryptMeta(key, "f", { v: 1, name: "a", mime: "x" });
    const b = encryptMeta(key, "f", { v: 1, name: "abcdefghij", mime: "x" });
    expect(a.length).toBe(b.length);
  });

  it("search text round trip and limit", () => {
    const t = "RECEIPT\nTOTAL $12.40\nÜber";
    expect(decryptText(key, "f", encryptText(key, "f", t))).toBe(t);
    refuses(() => encryptText(key, "f", "x".repeat(LIMITS.text + 1)));
    refuses(() => decryptText(key, "f", encryptMeta(key, "f", good))); // a meta blob isn't text
  });
});
