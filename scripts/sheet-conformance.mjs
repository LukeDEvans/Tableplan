// The spreadsheet engine's conformance table (SPREADSHEET_DESIGN.md §3, open point 8):
// Google Sheets itself computes the answers.
//
//   node scripts/sheet-conformance.mjs csv  > out.csv     # the sheet to upload to Drive
//   node scripts/sheet-conformance.mjs read in.csv        # the exported values → fixture
//
// Upload the CSV to Drive converted to a Google Sheet, export it back as CSV, then
// `read` writes test/fixtures/sheet-conformance.json. Row i holds case i: A = number,
// B = the formula, C = Sheets' answer encoded as "N|<number>", "S|<text>", "B|TRUE",
// "E|<ERROR.TYPE>" or "X|" (empty). E1:I10 hold the data the formulas read.

import { readFileSync, writeFileSync } from "node:fs";
import { CASES, DATA } from "../test/fixtures/sheet-conformance-cases.mjs";

const q = (s) => (s === null || s === undefined ? "" : /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const wrapper = (i) => `=IF(ISERROR(B${i}),"E|"&ERROR.TYPE(B${i}),IF(ISNUMBER(B${i}),"N|"&TEXT(B${i},"0.00000000000000E+00"),IF(ISLOGICAL(B${i}),"B|"&B${i},IF(ISTEXT(B${i}),"S|"&B${i},"X|"))))`;

function csv() {
  const lines = [];
  const n = Math.max(CASES.length, 10);
  for (let i = 1; i <= n; i++) {
    const row = [i <= CASES.length ? i : "", CASES[i - 1] ?? "", i <= CASES.length ? wrapper(i) : "", ""];
    for (const col of ["E", "F", "G", "H", "I"]) row.push(i <= 10 ? DATA[col][i - 1] : "");
    lines.push(row.map(q).join(","));
  }
  return lines.join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const [, , cmd, file] = process.argv;
if (cmd === "csv") process.stdout.write(csv());
else if (cmd === "read") {
  const rows = parseCsv(readFileSync(file, "utf8"));
  const out = {};
  CASES.forEach((f, i) => { out[f] = rows[i]?.[2] ?? null; });
  writeFileSync(new URL("../test/fixtures/sheet-conformance.json", import.meta.url), JSON.stringify({ source: "Google Sheets, US locale", made: new Date().toISOString().slice(0, 10), answers: out }, null, 1) + "\n");
  console.log(`${Object.keys(out).length} answers`);
} else {
  console.error("usage: sheet-conformance.mjs csv | read <file>");
  process.exit(1);
}
