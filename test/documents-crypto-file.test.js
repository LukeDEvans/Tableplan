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

// Test data only (libsodium's randombytes is slow for megabytes); keys still come from libsodium.
function rand(n) {
  const b = new Uint8Array(n);
  for (let o = 0; o < n; o += 65536) crypto.getRandomValues(b.subarray(o, Math.min(o + 65536, n)));
  return b;
}

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
    // a view claiming to be larger, without allocating 64 MB
    const fake = { length: MAX_PLAINTEXT + 1 };
    Object.setPrototypeOf(fake, Uint8Array.prototype);
    refuses(() => encryptBlob(key, "f", "content", fake));
  });
});

// Builds a blob by hand with the real subkey, to make streams the encoder never would.
function handmade(key, fileId, chunkSize, chunks) {
  const s = sodium();
  const hdr = encryptBlob(key, fileId, "content", rand(1), { chunkSize }).subarray(0, HEADER);
  const sub = s.crypto_kdf_derive_from_key(32, 1, "LiveDocs", key);
  const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(sub);
  const id = new TextEncoder().encode(fileId);
  const ad = concat(hdr, Uint8Array.of(0, 0, 0, id.length), id);
  return concat(hdr, header, ...chunks.map(([n, tag]) => s.crypto_secretstream_xchacha20poly1305_push(state, rand(n), ad, tag)));
}

describe("one encoding per file", () => {
  const s = () => sodium();
  const key = generateFileKey();

  it("the handmade encoder matches the real one (so the tests below mean something)", () => {
    const b = handmade(key, "f", C, [[C, 0], [5, 3]]);
    expect(decryptBlob(key, "f", "content", b).length).toBe(C + 5);
  });

  it("a full-size FINAL chunk is refused", () => {
    expect(() => decryptBlob(key, "f", "content", handmade(key, "f", C, [[C, s().crypto_secretstream_xchacha20poly1305_TAG_FINAL]]))).toThrow(/final/);
  });

  it("dropping the empty FINAL chunk of an exact multiple is refused", () => {
    const blob = encryptBlob(key, "f", "content", rand(2 * C), { chunkSize: C });
    const f = frames(blob);
    expect(f.at(-1).length).toBe(AB); // the empty final chunk
    refuses(() => decryptBlob(key, "f", "content", concat(...f.slice(0, -1))));
  });

  it("PUSH and REKEY tags are refused", () => {
    for (const tag of [s().crypto_secretstream_xchacha20poly1305_TAG_PUSH, s().crypto_secretstream_xchacha20poly1305_TAG_REKEY]) {
      refuses(() => decryptBlob(key, "f", "content", handmade(key, "f", C, [[C, tag], [3, 3]])));
    }
  });

  it("the largest chunk size works", () => {
    const p = rand(1024 * 1024 + 3);
    expect(decryptBlob(key, "f", "content", encryptBlob(key, "f", "content", p, { chunkSize: 1024 * 1024 }))).toEqual(p);
  });

  it("a size ceiling is checked before decrypting", () => {
    const blob = encryptBlob(key, "f", "content", rand(3 * C), { chunkSize: C });
    expect(() => decryptBlob(key, "f", "content", blob, { maxPlaintext: 2 * C })).toThrow(/too large/);
    expect(decryptBlob(key, "f", "content", blob, { maxPlaintext: 3 * C }).length).toBe(3 * C);
  });

  it("many small chunks decrypt without spreading them as arguments", () => {
    const p = rand(4096 * 300);
    expect(decryptBlob(key, "f", "content", encryptBlob(key, "f", "content", p, { chunkSize: 4096 }))).toEqual(p);
  });
});

describe("metadata", () => {
  const key = generateFileKey();
  const good = { v: 1, rev: 3, folderId: "folder-1", name: "  Car title – Subaru  ", mime: "application/pdf", pages: 3, size: 120000, tags: ["car", "car", " title "], documentDate: "2024-02-29" };

  it("round trip, cleaned", () => {
    const m = decryptMeta(key, "f", encryptMeta(key, "f", good));
    expect(m).toEqual({ v: 1, rev: 3, folderId: "folder-1", name: "Car title – Subaru", originalName: "", mime: "application/pdf", pages: 3, size: 120000, tags: ["car", "title"], documentDate: "2024-02-29" });
  });

  it("drops unknown fields and prototype keys", () => {
    const m = parseMeta(JSON.parse(`{"v":1,"rev":1,"name":"x","mime":"image/jpeg","extra":1,"__proto__":{"polluted":true}}`));
    expect(Object.keys(m)).toEqual(["v", "rev", "folderId", "name", "originalName", "mime", "pages", "size", "tags", "documentDate"]);
    expect(m.folderId).toBeNull();
    expect({}.polluted).toBeUndefined();
    expect(m.polluted).toBeUndefined();
  });

  it("rejects bad shapes", () => {
    for (const bad of [
      null, [], "x", { ...good, v: 2 }, { ...good, name: "   " }, { ...good, name: 5 }, { ...good, mime: "" },
      { ...good, name: "x".repeat(LIMITS.name + 1) }, { ...good, pages: -1 }, { ...good, pages: 1.5 },
      { ...good, tags: "car" }, { ...good, tags: Array(LIMITS.tags + 1).fill("t") }, { ...good, tags: [5] },
      { ...good, documentDate: "2023-02-29" }, { ...good, documentDate: "2024-2-1" }, { ...good, documentDate: 20240101 },
      { ...good, rev: 0 }, { ...good, rev: "3" }, { ...good, rev: undefined }, { ...good, folderId: "a b" },
    ]) refuses(() => parseMeta(bad));
  });

  it("only known file types; never HTML, SVG or XML", () => {
    for (const mime of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "application/xml", "text/xml", "application/javascript", "application/octet-stream"]) {
      expect(() => parseMeta({ ...good, mime })).toThrow(/not allowed/);
    }
    expect(parseMeta({ ...good, mime: "IMAGE/JPEG" }).mime).toBe("image/jpeg");
    expect(parseMeta({ ...good, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }).mime).toMatch(/wordprocessingml/);
  });

  it("names and tags lose direction overrides, zero-width and control characters", () => {
    const m = parseMeta({ ...good, name: "invoice\u202Efdp.exe", originalName: "a\u200Bb\nc\td", tags: ["x\u2066y"] });
    expect(m.name).toBe("invoicefdp.exe");
    expect(m.originalName).toBe("ab c d");
    expect(m.tags).toEqual(["xy"]);
    expect(parseMeta({ ...good, name: "Family 👨\u200D👩\u200D👧" }).name).toBe("Family 👨\u200D👩\u200D👧");
    refuses(() => parseMeta({ ...good, name: "\u202E\u200B" }));
  });

  it("is padded, so short names don't reveal their length", () => {
    const a = encryptMeta(key, "f", { v: 1, rev: 1, name: "a", mime: "image/png" });
    const b = encryptMeta(key, "f", { v: 1, rev: 1, name: "abcdefghij", mime: "image/png" });
    expect(a.length).toBe(b.length);
  });

  it("a metadata blob over its limit is refused before decrypting", () => {
    const huge = encryptBlob(key, "f", "meta", rand(LIMITS.metaBlob + 64));
    expect(() => decryptMeta(key, "f", huge)).toThrow(/too large/);
  });

  it("search text round trip, limit and padding", () => {
    const t = "RECEIPT\nTOTAL $12.40\nÜber";
    expect(decryptText(key, "f", encryptText(key, "f", t))).toBe(t);
    expect(decryptText(key, "f", encryptText(key, "f", ""))).toBe("");
    refuses(() => encryptText(key, "f", "x".repeat(LIMITS.text + 1)));
    refuses(() => decryptText(key, "f", encryptMeta(key, "f", good))); // a meta blob isn't text
    expect(encryptText(key, "f", "a").length).toBe(encryptText(key, "f", "a".repeat(900)).length);
  });
});
