// Byte helpers for messaging/crypto/. Pure; no libsodium needed, so they work
// before loadSodium() and in tests that only handle bytes.

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export const utf8 = (s) => enc.encode(String(s));
export const fromUtf8 = (b) => dec.decode(b);

export function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function u32(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("u32 out of range");
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

export function readU32(b, at) {
  if (at + 4 > b.length) throw new Error("truncated");
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, false);
}

// Length-prefixed field, so concatenated values can't be re-split differently.
export const field = (b) => concat(u32(b.length), b);

// base64url without padding — the storage and wire-JSON form of every key.
export function toB64(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : s.length % 4 === 0 ? "" : null;
  if (pad === null) throw new Error("bad base64url length");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(h) {
  if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export const isAllZero = (b) => b.every((x) => x === 0);
