// MusicXML container handling. A `.mxl` file is a ZIP archive (compressed
// MusicXML); a `.xml`/`.musicxml` file is plain text. This normalizes both to
// the raw MusicXML bytes so the parser and the renderer only ever see plain XML.
//
// The ZIP's META-INF/container.xml names the primary score file (rootfile);
// we fall back to the first .xml/.musicxml entry outside META-INF.

import { unzipSync, strFromU8 } from "fflate";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

export function isZip(bytes) {
  return bytes && bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/** Return plain MusicXML bytes from either a .mxl (zip) or a plain .xml/.musicxml. */
export function extractMusicXml(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isZip(bytes)) return bytes; // already plain XML

  const files = unzipSync(bytes);
  let path = null;

  const container = files["META-INF/container.xml"];
  if (container) {
    const m = strFromU8(container).match(/full-path\s*=\s*"([^"]+)"/i);
    if (m && files[m[1]]) path = m[1];
  }
  if (!path) {
    path = Object.keys(files).find((k) => /\.(musicxml|xml)$/i.test(k) && !/^META-INF\//i.test(k));
  }
  if (!path || !files[path]) throw new Error("no MusicXML file found inside the .mxl archive");
  return files[path];
}
