// Audio tag reader — pulls title/artist/album/track + embedded cover art out of
// the two formats a personal library is overwhelmingly made of: MP3 (ID3v2) and
// MP4/M4A (iTunes-style `ilst` atoms). Pure and DOM-free (Uint8Array in, plain
// object out) so the library can call it directly and tests can feed it
// synthetic bytes. Everything is best-effort and defensive: a malformed or
// unsupported tag yields empty fields, never a throw, so import always succeeds
// and falls back to the filename.
//
//   readTags(bytes) → { title, artist, album, trackNo, artwork:{mime,bytes}|null, format }

const AA = 0x00a9; // the © that prefixes iTunes text atom names (©nam, ©ART, …)
const cc = (n) => String.fromCharCode(n);
const latin1 = (b, off, len) => { let s = ""; for (let i = 0; i < len; i++) s += cc(b[off + i]); return s; };
const beU32 = (b, o) => (b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

const dec = (label, bytes) => {
  try { return new TextDecoder(label).decode(bytes).replace(/\u0000+$/, "").trim(); }
  catch { return latin1(bytes, 0, bytes.length).replace(/\u0000+$/, "").trim(); }
};
// ID3 text-encoding byte → decoded string.
function decodeText(enc, bytes) {
  if (enc === 0) return dec("iso-8859-1", bytes);
  if (enc === 1) { // UTF-16 with BOM
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return dec("utf-16le", bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return dec("utf-16be", bytes.subarray(2));
    return dec("utf-16le", bytes);
  }
  if (enc === 2) return dec("utf-16be", bytes); // UTF-16BE, no BOM (v2.4)
  return dec("utf-8", bytes);                    // enc === 3
}

const emptyTags = (format = null) => ({ title: "", artist: "", album: "", trackNo: null, artwork: null, format });
const firstInt = (s) => { const m = String(s).match(/\d+/); return m ? Number(m[0]) : null; };

/** Public entry: sniff the container and dispatch. Never throws. */
export function readTags(bytes) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return readId3(b); // "ID3"
    if (b.length >= 12 && latin1(b, 4, 4) === "ftyp") return readMp4(b);
    return emptyTags();
  } catch { return emptyTags(); }
}

// ── ID3v2 (.mp3) ──────────────────────────────────────────────────────────────
function readId3(b) {
  const out = emptyTags("id3");
  const major = b[3];
  const tagEnd = Math.min(10 + synchsafe(b, 6), b.length);
  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const headerLen = v22 ? 6 : 10;
  let off = 10;
  while (off + headerLen <= tagEnd) {
    const id = latin1(b, off, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break; // hit padding / end of frames
    const size = v22 ? ((b[off + 3] << 16) | (b[off + 4] << 8) | b[off + 5])
      : major === 4 ? synchsafe(b, off + 4) : beU32(b, off + 4); // 2.4 synchsafe, 2.3 plain
    const dataOff = off + headerLen;
    if (size <= 0 || dataOff + size > tagEnd) break;
    applyId3Frame(id, b.subarray(dataOff, dataOff + size), out);
    off = dataOff + size;
  }
  return out;
}

function applyId3Frame(id, frame, out) {
  const text = () => decodeText(frame[0], frame.subarray(1));
  switch (id) {
    case "TIT2": case "TT2": out.title = text(); break;
    case "TPE1": case "TP1": out.artist = text(); break;
    case "TALB": case "TAL": out.album = text(); break;
    case "TRCK": case "TRK": out.trackNo = firstInt(text()); break;
    case "APIC": out.artwork = out.artwork || parseApic(frame); break;
    case "PIC":  out.artwork = out.artwork || parsePic(frame); break;
    default: break;
  }
}

// APIC: enc(1) · mime(latin1, NUL-terminated) · picType(1) · desc(NUL-term) · data
function parseApic(frame) {
  let p = 1; // skip text-encoding byte
  let mime = "";
  while (p < frame.length && frame[p] !== 0) { mime += cc(frame[p]); p++; }
  p++;                    // NUL after mime
  const enc = frame[0];
  p++;                    // picture type byte
  p = skipDescription(frame, p, enc);
  return { mime: mime || "image/jpeg", bytes: frame.subarray(p) };
}
// PIC (v2.2): enc(1) · format(3 chars) · picType(1) · desc(NUL-term) · data
function parsePic(frame) {
  const enc = frame[0];
  const fmt = latin1(frame, 1, 3);
  let p = 5;              // enc + 3-char format + picType
  p = skipDescription(frame, p, enc);
  return { mime: /png/i.test(fmt) ? "image/png" : "image/jpeg", bytes: frame.subarray(p) };
}
function skipDescription(frame, p, enc) {
  if (enc === 1 || enc === 2) { while (p + 1 < frame.length && !(frame[p] === 0 && frame[p + 1] === 0)) p += 2; p += 2; }
  else { while (p < frame.length && frame[p] !== 0) p++; p++; }
  return p;
}

// ── MP4 / M4A (iTunes atoms) ──────────────────────────────────────────────────
function readMp4(b) {
  const out = emptyTags("mp4");
  const ilst = findAtomPath(b, 0, b.length, ["moov", "udta", "meta", "ilst"]);
  if (!ilst) return out;
  let off = ilst.start;
  while (off + 8 <= ilst.end) {
    const size = beU32(b, off);
    const type = latin1(b, off + 4, 4);
    if (size < 8 || off + size > ilst.end) break;
    const data = readDataAtom(b, off + 8, off + size);
    if (data) applyMp4Item(type, data, out);
    off += size;
  }
  return out;
}
// Walk a nested atom path (e.g. moov→udta→meta→ilst). `meta` is a full atom:
// its children start 4 bytes past the header (version+flags).
function findAtomPath(b, start, end, path) {
  let s = start, e = end;
  for (const want of path) {
    let found = null, off = s;
    while (off + 8 <= e) {
      const size = beU32(b, off);
      const type = latin1(b, off + 4, 4);
      if (size < 8 || off + size > e) break;
      if (type === want) { found = { start: off + 8 + (want === "meta" ? 4 : 0), end: off + size }; break; }
      off += size;
    }
    if (!found) return null;
    s = found.start; e = found.end;
  }
  return { start: s, end: e };
}
// An ilst item wraps a `data` atom: size(4)·"data"(4)·typeFlags(4)·locale(4)·value
function readDataAtom(b, start, end) {
  let off = start;
  while (off + 8 <= end) {
    const size = beU32(b, off);
    const type = latin1(b, off + 4, 4);
    if (size < 8 || off + size > end) break;
    if (type === "data") return { flags: beU32(b, off + 8) & 0xffffff, bytes: b.subarray(off + 16, off + size) };
    off += size;
  }
  return null;
}
function applyMp4Item(type, data, out) {
  const txt = () => dec("utf-8", data.bytes);
  if (type === cc(AA) + "nam") out.title = txt();
  else if (type === cc(AA) + "ART" || type === "aART") { if (!out.artist) out.artist = txt(); }
  else if (type === cc(AA) + "alb") out.album = txt();
  else if (type === "trkn") { if (data.bytes.length >= 4) out.trackNo = (data.bytes[2] << 8) | data.bytes[3]; }
  else if (type === "covr") out.artwork = { mime: data.flags === 14 ? "image/png" : "image/jpeg", bytes: data.bytes };
}
