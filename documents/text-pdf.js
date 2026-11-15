// Plain text → a small PDF (Luke, 2026-11-14: "Send to Finance" files an emailed
// receipt in Document › Receipts; an email with no PDF/image attachment is kept as
// a PDF of its text). Letter pages, Helvetica 10 pt, lines wrapped by width.
// Characters outside Latin-1 become "?" (WinAnsi font, no embedding). No deps.

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54, SIZE = 10, LEAD = 13;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEAD);
const MAX_CHARS = 98; // ~Helvetica 10 pt across 504 pt; long words are split

function toLatin1(str) {
  return String(str || "")
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-").replace(/…/g, "...").replace(/ /g, " ")
    .replace(/\t/g, "    ")
    .replace(/[^\x0A\x20-\x7E\xA1-\xFF]/gu, (c) => (c === "\r" ? "" : "?"));
}

export function wrapLines(text, max = MAX_CHARS) {
  const out = [];
  for (const raw of toLatin1(text).split("\n")) {
    let line = raw.replace(/\s+$/, "");
    if (!line) { out.push(""); continue; }
    while (line.length > max) {
      let cut = line.lastIndexOf(" ", max);
      if (cut < max * 0.5) cut = max;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ /, "");
    }
    out.push(line);
  }
  // At most two blank lines in a row (emails converted from HTML have many).
  return out.filter((l, i, a) => l || a[i - 1] || a[i - 2]);
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// → Uint8Array (application/pdf). title is bolded on the first line.
export function textToPdf(text, { title = "" } = {}) {
  const lines = wrapLines(text);
  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  pages.forEach((pageLines, p) => {
    let y = PAGE_H - MARGIN - SIZE;
    const ops = ["BT"];
    if (p === 0 && title) {
      ops.push(`/F2 12 Tf 1 0 0 1 ${MARGIN} ${y} Tm (${esc(toLatin1(title).slice(0, 90))}) Tj`);
      y -= LEAD * 2;
    }
    ops.push(`/F1 ${SIZE} Tf`);
    for (const line of pageLines) {
      if (y < MARGIN) break;
      if (line) ops.push(`1 0 0 1 ${MARGIN} ${y} Tm (${esc(line)}) Tj`);
      y -= LEAD;
    }
    ops.push("ET");
    const stream = ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  // Latin-1 throughout, so one char = one byte and offsets are string lengths.
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
