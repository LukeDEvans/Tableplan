// Pads plaintext to a multiple of BLOCK bytes before encryption, so ciphertext
// length only reveals a rough size (ISO/IEC 7816-4: 0x80 then zeros).

export const BLOCK = 64;

export function pad(bytes) {
  const len = (Math.floor(bytes.length / BLOCK) + 1) * BLOCK;
  const out = new Uint8Array(len);
  out.set(bytes);
  out[bytes.length] = 0x80;
  return out;
}

export function unpad(bytes) {
  if (!bytes.length || bytes.length % BLOCK !== 0) throw new Error("padding: bad length");
  let i = bytes.length - 1;
  while (i >= 0 && bytes[i] === 0) i--;
  if (i < 0 || bytes[i] !== 0x80) throw new Error("padding: bad padding");
  return bytes.subarray(0, i);
}
