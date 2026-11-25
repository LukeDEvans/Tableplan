// email-receipt-pdf.js — PURE: an emailed receipt or order confirmation as a
// small text PDF, for Document › Receipts (Send to Finance, Luke 2026-11-22).
// No DOM, no network. The email's text (as the server read it) is laid out in
// Courier on US Letter pages under a short header (subject, from, date), so
// it reads like a paper receipt and opens in any PDF viewer. Pictures and the
// email's own layout aren't kept: the receipt's data is what Finance uses.
//
// Text is written in WinAnsi (the standard PDF fonts' encoding): curly quotes,
// dashes, bullets and Latin-1 letters come through; anything else becomes "?".

const PAGE_W = 612; // 8.5in × 72
const PAGE_H = 792; // 11in × 72
const MARGIN = 54; // 0.75in
const SIZE = 9.5; // body point size
const LEAD = 12.5; // line height
const CHAR_W = 0.6 * SIZE; // Courier: every glyph is 600/1000 em
export const LINE_CHARS = Math.floor((PAGE_W - 2 * MARGIN) / CHAR_W); // 88
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEAD);
const MAX_PAGES = 40;

// Unicode → WinAnsi for the characters emails actually use.
const WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x2c6, 0x88], [0x2030, 0x89], [0x160, 0x8a], [0x2039, 0x8b], [0x152, 0x8c], [0x17d, 0x8e],
  [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x2dc, 0x98], [0x2122, 0x99], [0x161, 0x9a], [0x203a, 0x9b], [0x153, 0x9c], [0x17e, 0x9e], [0x178, 0x9f],
]);
const SPACES = /[  -   　\t]/g;
const INVISIBLE = /[​-‍⁠﻿­͏؜᠎]/g;

export function toWinAnsiBytes(str) {
  const s = String(str || "").replace(SPACES, " ").replace(INVISIBLE, "");
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (WIN_ANSI.has(c)) out.push(WIN_ANSI.get(c));
    else if (c >= 0xd800 || c > 0xffff) continue; // emoji and the like: dropped
    else out.push(0x3f); // "?"
  }
  return out;
}

// Long lines wrap at word boundaries (a word longer than a line is cut).
export function wrapLines(text, width = LINE_CHARS) {
  const out = [];
  for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.replace(/\s+$/, "");
    if (!line) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
    while ([...line].length > width) {
      const chars = [...line];
      let cut = chars.slice(0, width + 1).join("").lastIndexOf(" ");
      if (cut < width * 0.4) cut = width; // no good space: cut the word
      out.push(chars.slice(0, cut).join("").replace(/\s+$/, ""));
      line = chars.slice(cut).join("").replace(/^\s+/, "");
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

// A PDF string literal: ( ) and \ escaped; bytes over 0x7e written as octal.
function pdfString(bytes) {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

// { subject, from, date, text } → Uint8Array (a complete PDF file).
export function emailReceiptPdf({ subject = "", from = "", date = "", text = "" } = {}) {
  const head = [
    ...wrapLines(subject || "(no subject)"),
    ...(from ? wrapLines(`From: ${from}`) : []),
    ...(date ? wrapLines(`Date: ${date}`) : []),
  ];
  const body = wrapLines(text);
  // Every line is { bold, text }; a rule of dashes separates the header from the body.
  const lines = [
    ...head.map((t, i) => ({ bold: i === 0, text: t })),
    { bold: false, text: "-".repeat(LINE_CHARS) },
    ...body.map((t) => ({ bold: false, text: t })),
  ];
  const pages = [];
  for (let i = 0; i < lines.length && pages.length < MAX_PAGES; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (!pages.length) pages.push([]);

  const enc = new TextEncoder();
  const parts = [];
  let length = 0;
  const offsets = [];
  const push = (chunk) => { const b = typeof chunk === "string" ? enc.encode(chunk) : chunk; parts.push(b); length += b.length; };
  const object = (id, dict, stream) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${dict}\n`);
    if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
    push("endobj\n");
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  // 1 catalog, 2 pages, 3 Courier, 4 Courier-Bold, then per page: page, content.
  const pageIds = pages.map((_, i) => 5 + i * 2);
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((pageLines, i) => {
    const page = pageIds[i], content = page + 1;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`);
    let ops = `BT\n${LEAD} TL\n${MARGIN} ${PAGE_H - MARGIN - SIZE} Td\n`;
    let font = "";
    for (const line of pageLines) {
      const want = line.bold ? "/F2" : "/F1";
      if (want !== font) { ops += `${want} ${SIZE} Tf\n`; font = want; }
      ops += `${pdfString(toWinAnsiBytes(line.text))} Tj T*\n`;
    }
    ops += "ET";
    const draw = enc.encode(ops);
    object(content, `<< /Length ${draw.length} >>`, draw);
  });
  const count = 5 + pages.length * 2;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let k = 1; k < count; k++) push(`${String(offsets[k]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
