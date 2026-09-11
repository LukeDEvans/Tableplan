// Pure CSV → month-actuals backfill for the finance page.
//
// Turns a transaction CSV (a bank export, or the app's own "Export CSV") into
// per-month, per-category spend totals that budget-from-history reads. Kept
// pure and dependency-free so it can be unit-tested away from the app shell.
//
// Sign convention matches the app's Export CSV: a NEGATIVE amount is spending,
// a POSITIVE amount is income. Amounts are aggregated as positive magnitudes
// into `cats` (identical to updateFinanceMonthActuals), so the output can drop
// straight into state.financeMonthActuals.

// RFC-4180-ish parser: handles quoted fields, "" escapes, and CR/LF/CRLF rows.
// Returns an array of rows, each an array of cell strings.
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  // Flush the last cell/row if the file didn't end with a newline.
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  // Drop fully-empty rows (e.g. a trailing blank line).
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// "$1,234.56" / "(12.34)" / "-12.34" → signed Number, or null if unparseable.
export function parseCsvAmount(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$\s,]/g, "");
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

// "2026-09-08" / "09/08/2026" / "9/8/26" → "YYYY-MM", or null. Prefers ISO;
// otherwise treats the first field as the month for MM/DD/YYYY US ordering.
export function parseCsvMonth(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    let [, mo, , yr] = us;
    let y = Number(yr);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const m = String(Math.min(12, Math.max(1, Number(mo)))).padStart(2, "0");
    return `${y}-${m}`;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 7);
  return null;
}

// Find the column index whose header matches any of `names` (case-insensitive
// substring). Returns -1 if none.
function findCol(header, names) {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || "").trim().toLowerCase();
    if (names.some((n) => h.includes(n))) return i;
  }
  return -1;
}

// Aggregate parsed CSV rows into month-actuals.
//   rows: output of parseCsvRows (first row = header)
//   nameToKey: { <lowercased category name> -> "cat:gid:cid" } lookup
// Returns { months, applied, income, uncategorized, invalid, matched, total,
//           unrecognized } where `months` = { "YYYY-MM": { cats, income, incomeBy } }.
export function aggregateCsvBackfill(rows, nameToKey) {
  const out = { months: {}, applied: 0, income: 0, uncategorized: 0, invalid: 0, matched: 0, total: 0, unrecognized: [] };
  if (!Array.isArray(rows) || rows.length < 2) return out;
  const lookup = nameToKey instanceof Map ? nameToKey : new Map(Object.entries(nameToKey || {}));
  const header = rows[0];
  const dateIdx = findCol(header, ["date", "posted", "when"]);
  const amtIdx = findCol(header, ["amount", "debit", "value"]);
  const catIdx = findCol(header, ["category", "label"]);
  if (dateIdx < 0 || amtIdx < 0) { out.error = "missing-columns"; return out; }
  const seenUnrecognized = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    out.total++;
    const amount = parseCsvAmount(r[amtIdx]);
    const month = parseCsvMonth(r[dateIdx]);
    if (amount == null || amount === 0 || !month) { out.invalid++; continue; }
    const catText = catIdx >= 0 ? String(r[catIdx] || "").trim().toLowerCase() : "";
    const key = catText ? lookup.get(catText) : undefined;
    if (!out.months[month]) out.months[month] = { cats: {}, income: 0, incomeBy: {} };
    const m = out.months[month];
    if (key) {
      m.cats[key] = Math.round(((m.cats[key] || 0) + Math.abs(amount)) * 100) / 100;
      out.matched++;
    } else if (amount > 0) {
      m.income = Math.round((m.income + amount) * 100) / 100;
      out.income++;
      out.matched++;
    } else {
      out.uncategorized++;
      if (catText && !seenUnrecognized.has(catText)) { seenUnrecognized.add(catText); out.unrecognized.push(catText); }
    }
  }
  out.applied = Object.keys(out.months).length;
  return out;
}
