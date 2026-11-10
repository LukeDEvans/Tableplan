// Messages between the presenting phone and the TV page (SLIDES_DESIGN.md §9). The
// phone sends the presentation itself (its Yjs state, then each change), media on
// request in chunks, and where the show is; the TV draws the same slides with the same
// transitions and animations. Strings only (what the native plugin carries).

export const CHUNK = 512 * 1024; // bytes of media per message

export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const encode = (m) => JSON.stringify(m);
export function decode(s) {
  try {
    const m = JSON.parse(s);
    return m && typeof m === "object" && typeof m.t === "string" ? m : null;
  } catch { return null; }
}

// Reassembles chunked media: add(msg) → { id, bytes } when the last chunk arrives.
export function chunkJoiner(maxBytes = 80 * 1024 * 1024) {
  const parts = new Map();
  return {
    add(m) {
      if (!/^[0-9a-f]{32}$/.test(m.id) || !Number.isInteger(m.i) || !Number.isInteger(m.n) || m.n < 1 || m.n > Math.ceil(maxBytes / CHUNK) || m.i < 0 || m.i >= m.n) return null;
      let p = parts.get(m.id);
      if (!p) { p = { n: m.n, got: new Array(m.n), count: 0 }; parts.set(m.id, p); }
      if (p.n !== m.n || p.got[m.i]) return null;
      p.got[m.i] = fromB64(m.d || "");
      p.count++;
      if (p.count < p.n) return null;
      parts.delete(m.id);
      const total = p.got.reduce((a, b) => a + b.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const g of p.got) { out.set(g, at); at += g.length; }
      return { id: m.id, bytes: out };
    },
  };
}
