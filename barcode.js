// barcode.js — draws the barcodes Wallet shows at a checkout (UTILITIES_MENU_DESIGN.md
// §8). Pure: Code 128 (auto B/C) as bar widths → an SVG string. QR codes use the
// qrcode-generator package (already used by Messaging's verification codes).

// Code 128 bar/space widths for values 0–106 (106 = stop). Each pattern is six
// widths summing to 11 modules (the stop has seven, summing to 13).
const CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
export const CODE128_PATTERNS = CODE128;
const START_B = 104, START_C = 105, STOP = 106;

// Text → the Code 128 values (start, data, checksum, stop). Digits-only text of
// even length uses set C (two digits per symbol); anything else set B (ASCII 32–126).
export function code128Values(text) {
  const s = String(text ?? "");
  if (!s) throw new Error("Nothing to encode");
  const values = [];
  if (/^\d+$/.test(s) && s.length % 2 === 0 && s.length >= 4) {
    values.push(START_C);
    for (let i = 0; i < s.length; i += 2) values.push(Number(s.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error("Code 128 can't hold that character");
      values.push(c - 32);
    }
  }
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return [...values, check, STOP];
}

// Values → widths, starting with a bar.
export function code128Widths(text) {
  return code128Values(text).flatMap((v) => CODE128[v].split("").map(Number));
}

// SVG of a Code 128 barcode, `height` modules tall, with a quiet zone of 10
// modules each side. Black on white whatever the theme, so scanners read it.
export function code128Svg(text, { height = 60, module = 2 } = {}) {
  const widths = code128Widths(text);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const rects = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" stroke="none" viewBox="0 0 ${total} ${height}" width="${total * module}" height="${height * module / 2}" preserveAspectRatio="none" role="img" aria-label="Barcode ${escapeAttr(text)}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects.join("")}</g></svg>`;
}

// SVG of a QR code (qrcode-generator instance passed in, so this file stays
// importable without the package in tests).
export function qrSvg(text, qrcode, { cell = 6, margin = 4 } = {}) {
  const qr = qrcode(0, "M");
  qr.addData(String(text ?? ""));
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cell;
  const rects = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) rects.push(`<rect x="${(c + margin) * cell}" y="${(r + margin) * cell}" width="${cell}" height="${cell}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" stroke="none" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects.join("")}</g></svg>`;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
