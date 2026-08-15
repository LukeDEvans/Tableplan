import { describe, it, expect } from "vitest";
import { readTags } from "../music-tags.js";

// ── tiny binary builders ──────────────────────────────────────────────────────
const u8 = (a) => (a instanceof Uint8Array ? a : new Uint8Array(a));
function cat(...parts) {
  const ps = parts.map(u8);
  const out = new Uint8Array(ps.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of ps) { out.set(p, o); o += p.length; }
  return out;
}
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s) => new TextEncoder().encode(s);
const beU32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const synchsafe = (n) => new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);

// ID3v2.3: text frames carry [encoding][text]; frame size is a plain BE u32.
function id3TextFrame(id, text, enc = 3) {
  const body = cat([enc], enc === 3 ? utf8(text) : ascii(text));
  return cat(ascii(id), beU32(body.length), [0, 0], body);
}
function id3ApicFrame(mime, img) {
  const body = cat([0], ascii(mime), [0], [3], [0], img); // enc0 · mime · NUL · picType3 · desc NUL · data
  return cat(ascii("APIC"), beU32(body.length), [0, 0], body);
}
function id3(...frames) {
  const all = cat(...frames);
  return cat(ascii("ID3"), [0x03, 0x00, 0x00], synchsafe(all.length), all);
}

// MP4 atoms
function atom(type, payload) { const p = u8(payload); return cat(beU32(p.length + 8), ascii(type), p); }
function dataAtom(flags, value) { return atom("data", cat(beU32(flags), beU32(0), value)); }
const textItem = (type, s) => atom(type, dataAtom(1, utf8(s)));
const trknItem = (n) => atom("trkn", dataAtom(0, new Uint8Array([0, 0, (n >> 8) & 255, n & 255, 0, 0])));
const covrItem = (img, png) => atom("covr", dataAtom(png ? 14 : 13, img));
function mp4(...items) {
  const ilst = atom("ilst", cat(...items));
  const meta = atom("meta", cat(beU32(0), ilst)); // full atom: 4-byte version/flags then children
  return cat(atom("ftyp", ascii("M4A ")), atom("moov", atom("udta", meta)));
}

const CO = String.fromCharCode(0xa9); // © for iTunes atom names

// ── ID3 ───────────────────────────────────────────────────────────────────────
describe("readTags — ID3v2 (.mp3)", () => {
  it("reads title/artist/album/track and utf-8 text", () => {
    const t = readTags(id3(
      id3TextFrame("TIT2", "Café Solo"),
      id3TextFrame("TPE1", "The Artist"),
      id3TextFrame("TALB", "Greatest Hits"),
      id3TextFrame("TRCK", "7/12"),
    ));
    expect(t.format).toBe("id3");
    expect(t.title).toBe("Café Solo");
    expect(t.artist).toBe("The Artist");
    expect(t.album).toBe("Greatest Hits");
    expect(t.trackNo).toBe(7);
    expect(t.artwork).toBeNull();
  });

  it("extracts embedded APIC cover art with its mime", () => {
    const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]); // jpeg-ish
    const t = readTags(id3(id3TextFrame("TIT2", "X"), id3ApicFrame("image/jpeg", img)));
    expect(t.artwork).not.toBeNull();
    expect(t.artwork.mime).toBe("image/jpeg");
    expect(t.artwork.bytes).toEqual(img);
  });

  it("decodes latin-1 (encoding 0) text frames", () => {
    const t = readTags(id3(id3TextFrame("TPE1", "Bjorn", 0)));
    expect(t.artist).toBe("Bjorn");
  });
});

// ── MP4 ───────────────────────────────────────────────────────────────────────
describe("readTags — MP4 / M4A", () => {
  it("reads ©nam/©ART/©alb/trkn and covr art", () => {
    const img = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]); // png-ish
    const t = readTags(mp4(
      textItem(CO + "nam", "Clair de lune"),
      textItem(CO + "ART", "Debussy"),
      textItem(CO + "alb", "Suite bergamasque"),
      trknItem(3),
      covrItem(img, true),
    ));
    expect(t.format).toBe("mp4");
    expect(t.title).toBe("Clair de lune");
    expect(t.artist).toBe("Debussy");
    expect(t.album).toBe("Suite bergamasque");
    expect(t.trackNo).toBe(3);
    expect(t.artwork.mime).toBe("image/png");
    expect(t.artwork.bytes).toEqual(img);
  });

  it("returns empty tags (not a throw) when ilst is absent", () => {
    const t = readTags(cat(atom("ftyp", ascii("M4A ")), atom("moov", atom("mvhd", new Uint8Array(20)))));
    expect(t.format).toBe("mp4");
    expect(t.title).toBe("");
    expect(t.artwork).toBeNull();
  });
});

// ── robustness ────────────────────────────────────────────────────────────────
describe("readTags — unknown / malformed input", () => {
  it("returns empty tags for non-audio bytes", () => {
    expect(readTags(new Uint8Array([1, 2, 3, 4]))).toMatchObject({ title: "", artist: "", album: "", trackNo: null, artwork: null, format: null });
  });
  it("never throws on truncated ID3", () => {
    expect(() => readTags(cat(ascii("ID3"), [3, 0, 0], synchsafe(999), ascii("TIT2"), beU32(999)))).not.toThrow();
  });
});
