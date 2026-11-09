// CSV / TSV in and out (SPREADSHEET_DESIGN.md §8). parseCsv(text, delimiter?) → rows of
// strings (the delimiter is detected when not given: comma, tab or semicolon);
// toCsv(rows) → text, quoting only where needed. UTF-8 BOMs are dropped.

export function detectDelimiter(text) {
  const sample = text.slice(0, 20000);
  let best = ",", bestScore = -1;
  for (const d of [",", "\t", ";"]) {
    const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 20);
    if (!lines.length) continue;
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const steady = counts.every((x) => x === counts[0]);
    const score = avg * (steady ? 2 : 1);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}
function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch === d) n++; }
  return n;
}

export function parseCsv(text, delimiter = null) {
  let s = String(text ?? "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const d = delimiter || detectDelimiter(s);
  const rows = [];
  let row = [], cur = "", inQ = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i += 2; continue; } inQ = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"' && cur === "") { inQ = true; i++; continue; }
    if (ch === d) { row.push(cur); cur = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(cur); rows.push(row); row = []; cur = "";
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cur += ch; i++;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export function toCsv(rows, delimiter = ",") {
  const q = (v) => {
    const s = String(v ?? "");
    return s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(q).join(delimiter)).join("\r\n") + "\r\n";
}
