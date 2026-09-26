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

// ── CSV → durable transaction rows (FINANCE_TRANSACTIONS_DESIGN.md §4) ──────────
// Unlike aggregateCsvBackfill (month totals only), these turn each CSV row into a
// real transaction for the finance_transactions store.

// First column matching the EARLIEST name in `names` (priority order, unlike
// findCol's any-match) — so "description" beats a later "name" column.
function findColByPriority(header, names) {
  for (const n of names) {
    const i = header.findIndex((h) => String(h || "").trim().toLowerCase().includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

// "2026-09-08" / "09/08/2026" / "9/8/26" → "YYYY-MM-DD", or null.
export function parseCsvDate(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    const [, mo, da, yr] = us;
    let y = Number(yr);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const m = Number(mo), d = Number(da);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

// cyrb53 — small, stable, dependency-free 53-bit string hash (deterministic ids).
export function stableHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const normDesc = (d) => String(d || "").toLowerCase().replace(/\s+/g, " ").trim();

// rows (parseCsvRows output, header first) → { txns, invalid, error? }.
// Each txn: { id, account_id, posted, amount, description, import_label, import_batch }.
// The id is csv_<hash(account|date|amount|description|n)> where n is the
// occurrence index of an identical row WITHIN THIS FILE — so two genuine identical
// same-day charges stay two rows, while re-importing the same file yields the
// same ids (and inserts nothing).
export function csvRowsToTxns(rows, { accountId, nameToKey, batchId = "" } = {}) {
  const out = { txns: [], invalid: 0 };
  if (!Array.isArray(rows) || rows.length < 2) return out;
  if (!accountId) { out.error = "missing-account"; return out; }
  const lookup = nameToKey instanceof Map ? nameToKey : new Map(Object.entries(nameToKey || {}));
  const header = rows[0];
  const dateIdx = findColByPriority(header, ["date", "posted", "when"]);
  const amtIdx = findColByPriority(header, ["amount", "debit", "value"]);
  const descIdx = findColByPriority(header, ["description", "payee", "merchant", "memo", "name"]);
  const catIdx = findColByPriority(header, ["category", "label"]);
  if (dateIdx < 0 || amtIdx < 0) { out.error = "missing-columns"; return out; }
  const occurrences = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseCsvDate(r[dateIdx]);
    const amount = parseCsvAmount(r[amtIdx]);
    if (!date || amount == null || amount === 0) { out.invalid++; continue; }
    const description = String(descIdx >= 0 ? r[descIdx] || "" : "").trim().slice(0, 200);
    const catText = catIdx >= 0 ? String(r[catIdx] || "").trim().toLowerCase() : "";
    const base = `${accountId}|${date}|${amount.toFixed(2)}|${normDesc(description)}`;
    const n = occurrences.get(base) || 0;
    occurrences.set(base, n + 1);
    out.txns.push({
      id: `csv_${stableHash(`${base}|${n}`)}`,
      account_id: String(accountId),
      posted: `${date}T12:00:00.000Z`,
      amount: Math.round(amount * 100) / 100,
      description,
      import_label: (catText && lookup.get(catText)) || null,
      import_batch: batchId || null,
    });
  }
  return out;
}

// Split CSV candidates into { fresh, sameFile, fromBank }:
//   sameFile — id already stored and not soft-deleted (this file was imported before);
//   fromBank — a stored NON-CSV row on the same account, date ±1 day, same amount,
//              sharing a merchant token (the bank already gave us this charge).
// Bank rows are claimed one-to-one in date order so two identical CSV charges can't
// both collapse onto a single bank row. `merchantTokens` is injected (pure).
export function dedupeImport(candidates, existingRows, merchantTokens) {
  const tokens = typeof merchantTokens === "function" ? merchantTokens : (d) => normDesc(d).split(" ").filter(Boolean);
  // A soft-deleted row (an undone import) doesn't count: re-importing revives it
  // (the insert upserts it back to status "active").
  const existingIds = new Set((existingRows || []).filter((r) => r && r.status !== "deleted").map((r) => String(r.id)));
  const bankByAccount = new Map();
  for (const r of existingRows || []) {
    if (!r || r.origin === "csv" || (r.status && r.status !== "active")) continue;
    const k = String(r.account_id);
    if (!bankByAccount.has(k)) bankByAccount.set(k, []);
    bankByAccount.get(k).push(r);
  }
  const claimed = new Set();
  const res = { fresh: [], sameFile: [], fromBank: [] };
  const sorted = [...(candidates || [])].sort((a, b) => String(a.posted).localeCompare(String(b.posted)));
  for (const c of sorted) {
    if (existingIds.has(String(c.id))) { res.sameFile.push(c); continue; }
    const cTok = new Set(tokens(c.description).slice(0, 3));
    const cTime = new Date(c.posted).getTime();
    const pool = (bankByAccount.get(String(c.account_id)) || [])
      .filter((b) => !claimed.has(String(b.id)))
      .filter((b) => Math.abs((Number(b.amount) || 0) - c.amount) < 0.005)
      .filter((b) => Math.abs(new Date(b.posted).getTime() - cTime) <= 86400000 * 1.5)
      .filter((b) => !cTok.size || tokens(b.description).slice(0, 3).some((t) => cTok.has(t)))
      .sort((a, b) => Math.abs(new Date(a.posted).getTime() - cTime) - Math.abs(new Date(b.posted).getTime() - cTime));
    if (pool.length) { claimed.add(String(pool[0].id)); res.fromBank.push({ ...c, duplicateOf: String(pool[0].id) }); continue; }
    res.fresh.push(c);
  }
  return res;
}
