// Spreadsheet values (SPREADSHEET_DESIGN.md §3): what a cell or a formula part can
// hold, and Google Sheets' rules for turning one kind into another. No DOM, no I/O.
//
//   number   a JS number (finite; dates and times are serial numbers, §3)
//   string   a JS string
//   boolean  true / false
//   EMPTY    an empty cell (null): 0 in arithmetic, "" in text, FALSE in logic
//   SheetError  #DIV/0!, #N/A, … (errors flow through most calculations)
//   Matrix   a rectangular array of the above (ranges, array literals, array results)
//   Ref      a reference to cells (functions like ROW, OFFSET, SUM need the reference
//            itself, not only its values); made by the engine, see engine.js

export const EMPTY = null;

export class SheetError {
  constructor(code, message = "") { this.code = code; this.message = message; }
  toString() { return this.code; }
}

export const ERR = Object.freeze({
  NULL: "#NULL!", DIV0: "#DIV/0!", VALUE: "#VALUE!", REF: "#REF!", NAME: "#NAME?", NUM: "#NUM!", NA: "#N/A", ERROR: "#ERROR!", SPILL: "#REF!",
});
export const ERROR_CODES = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#ERROR!"];
// Sheets' ERROR.TYPE numbers.
export const ERROR_TYPE = { "#NULL!": 1, "#DIV/0!": 2, "#VALUE!": 3, "#REF!": 4, "#NAME?": 5, "#NUM!": 6, "#N/A": 7, "#ERROR!": 8 };

export const err = (code, message) => new SheetError(code, message);
export const isErr = (v) => v instanceof SheetError;
export const isEmpty = (v) => v === null || v === undefined;

export class Matrix {
  constructor(rows) {
    this.rows = rows; // array of arrays, all the same length
  }
  get h() { return this.rows.length; }
  get w() { return this.rows.length ? this.rows[0].length : 0; }
  get(r, c) { return this.rows[r][c]; }
  static of(h, w, fill) {
    const rows = [];
    for (let r = 0; r < h; r++) { const row = new Array(w); for (let c = 0; c < w; c++) row[c] = typeof fill === "function" ? fill(r, c) : fill; rows.push(row); }
    return new Matrix(rows);
  }
  map(fn) { return new Matrix(this.rows.map((row, r) => row.map((v, c) => fn(v, r, c)))); }
  *values() { for (const row of this.rows) for (const v of row) yield v; }
  flat() { return this.rows.flat(); }
}
export const isMatrix = (v) => v instanceof Matrix;

// ---- number <-> text (Sheets' "Automatic" display when a number becomes text) --------------

// Sheets turns a number into text with up to 15 significant digits, no trailing
// zeros, and scientific notation only for very large or small magnitudes.
export function numberToText(n) {
  if (!Number.isFinite(n)) return "#NUM!";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) {
    let s = n.toExponential(14).replace(/\.?0+e/, "e");
    const [m, e] = s.split("e");
    const exp = Number(e);
    return `${m}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  let s = Number(n.toPrecision(15)).toString();
  if (/e/.test(s)) s = Number(n.toPrecision(15)).toFixed(20).replace(/\.?0+$/, "");
  return s;
}

// A number typed or held as text: "12", " -3.5 ", "1e3", "12%", "$4", "1,234.5", "(5)".
// Dates and times are recognised by the parse layer in number-format.js, not here.
const NUM_TEXT = /^\s*([+-])?\s*(\$)?\s*(\()?\s*(\d{1,3}(,\d{3})+|\d*)(\.\d*)?([eE][+-]?\d+)?\s*(\))?\s*(%)?\s*$/;
export function textToNumber(s) {
  if (typeof s !== "string") return null;
  const m = NUM_TEXT.exec(s);
  if (!m) return null;
  const [, sign, , open, int, , frac, exp, close, pct] = m;
  if (!int && !frac) return null;
  if (frac === "." && !int) return null;
  if (Boolean(open) !== Boolean(close)) return null;
  let n = Number(`${(int || "0").replace(/,/g, "")}${frac || ""}${exp || ""}`);
  if (!Number.isFinite(n)) return null;
  if (sign === "-" || open) n = -n;
  if (pct) n /= 100;
  return n;
}

// ---- coercion (each returns a value or a SheetError) --------------------------------------------

export function toNumber(v) {
  if (typeof v === "number") return v;
  if (isEmpty(v)) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isErr(v)) return v;
  if (typeof v === "string") {
    if (v === "") return 0;
    const n = textToNumber(v);
    if (n !== null) return n;
    const d = textToDateSerial(v);
    if (d !== null) return d;
    return err(ERR.VALUE, `Function expects number values. But '${v.slice(0, 40)}' is a text and cannot be coerced to a number.`);
  }
  if (isMatrix(v)) return toNumber(v.get(0, 0));
  return err(ERR.VALUE);
}

export function toText(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return numberToText(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isEmpty(v)) return "";
  if (isErr(v)) return v;
  if (isMatrix(v)) return toText(v.get(0, 0));
  return err(ERR.VALUE);
}

export function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isEmpty(v)) return false;
  if (isErr(v)) return v;
  if (typeof v === "string") {
    const u = v.trim().toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE") return false;
    if (u === "") return false;
    return err(ERR.VALUE, `Function expects boolean values. But '${v.slice(0, 40)}' is a text and cannot be coerced to a boolean.`);
  }
  if (isMatrix(v)) return toBool(v.get(0, 0));
  return err(ERR.VALUE);
}

// ---- comparison ---------------------------------------------------------------------------------

// Order across kinds, as Sheets: numbers < text < booleans. Text compares without case.
const rank = (v) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 0);
export function compare(a, b) {
  if (isEmpty(a)) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (isEmpty(b)) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "string") {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "boolean") return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---- dates (serial numbers; day 0 = 1899-12-30, as Sheets and Excel) -------------------------

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
export const serialFromYMD = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY; // m, d may overflow
export function ymdFromSerial(serial) {
  const t = EPOCH + Math.floor(serial) * DAY;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}
// Hours, minutes, seconds of a serial, rounded to the nearest second as Sheets does
// (MINUTE(0.7604166) is 15: 18:14:59.99 rounds to 18:15:00).
export function timeFromSerial(serial) {
  let s = Math.round((serial - Math.floor(serial)) * 86400);
  if (s >= 86400) s = 0;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const mi = Math.floor(s / 60); s -= mi * 60;
  return { h, mi, s, ms: 0 };
}
export const serialFromMs = (ms) => (ms - EPOCH) / DAY;
export const msFromSerial = (serial) => EPOCH + serial * DAY;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (s) => { const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase()); return i < 0 ? null : i + 1; };

function parseTimePart(s) {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?\s*([ap]\.?m\.?)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2]); const sec = Number(m[3] || 0);
  if (mi > 59 || sec >= 60) return null;
  if (m[4]) { if (h < 1 || h > 12) return null; const pm = /p/i.test(m[4]); h = (h % 12) + (pm ? 12 : 0); }
  return (h * 3600 + mi * 60 + sec) / 86400;
}

// Text a person typed or a formula produced → a date/time serial, or null. US locale:
// M/D/YYYY, M/D (this year), YYYY-MM-DD, "Jan 2, 2026", "2 Jan 2026", times, both.
export function textToDateSerial(s, { year = new Date().getFullYear() } = {}) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > 40) return null;
  const onlyTime = parseTimePart(t);
  if (onlyTime !== null) return onlyTime;
  let datePart = t, timePart = "";
  const tm = /^(.*?)[\sT]+(\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?\s*(?:[ap]\.?m\.?)?)$/i.exec(t);
  if (tm) { datePart = tm[1]; timePart = tm[2]; }
  let y, m, d, mm;
  if ((mm = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(datePart))) { m = +mm[1]; d = +mm[2]; y = +mm[3]; }
  else if ((mm = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(datePart))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = /^(\d{1,2})\/(\d{1,2})$/.exec(datePart))) { m = +mm[1]; d = +mm[2]; y = year; }
  else if ((mm = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(datePart))) { m = monthIndex(mm[1]); d = +mm[2]; y = +mm[3]; }
  else if ((mm = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?[\s-]+(\d{2,4})$/.exec(datePart))) { d = +mm[1]; m = monthIndex(mm[2]); y = +mm[3]; }
  else if ((mm = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(datePart))) { m = monthIndex(mm[1]); d = +mm[2]; y = year; }
  else return null;
  if (!m || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += y < 30 ? 2000 : 1900; // as Sheets: 00–29 → 2000s
  const serial = serialFromYMD(y, m, d);
  const back = ymdFromSerial(serial);
  if (back.m !== m || back.d !== d) return null; // 2/30
  if (timePart) { const tp = parseTimePart(timePart); if (tp === null) return null; return serial + tp; }
  return serial;
}

// ---- a cell's typed input → its value (no formula) ---------------------------------------------

// What Sheets does with "Automatic" typing: numbers, percents, currency, dates, times,
// TRUE/FALSE become values; a leading apostrophe forces text. Returns { value, format? }
// where format is a number-format hint for the cell ("percent", "currency", "date"…).
export function parseTyped(input) {
  if (input === null || input === undefined || input === "") return { value: EMPTY };
  if (typeof input !== "string") return { value: input };
  if (input.startsWith("'")) return { value: input.slice(1) };
  const t = input.trim();
  const up = t.toUpperCase();
  if (up === "TRUE") return { value: true };
  if (up === "FALSE") return { value: false };
  if (ERROR_CODES.includes(up)) return { value: err(up) };
  const n = textToNumber(t);
  if (n !== null) {
    if (/%\s*$/.test(t)) return { value: n, format: "percent" };
    if (/\$/.test(t)) return { value: n, format: "currency" };
    return { value: n };
  }
  const d = textToDateSerial(t);
  if (d !== null) return { value: d, format: d < 1 && !/[/-]/.test(t) && /:/.test(t) ? "time" : /:/.test(t) ? "datetime" : "date" };
  return { value: input };
}
