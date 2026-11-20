// Engineering, database, matrix and other functions (SPREADSHEET_DESIGN.md §3, pass C).

import { def, numbersOf, flatValues, asMatrix, omitted, criterion, NUM_ERR, DIV_ERR, VAL_ERR, NA_ERR, ERR, err, isErr, isEmpty, isMatrix, Matrix, toText, compare } from "./helpers.js";

const N = "number", T = "text";

// ---- base conversion (10 characters, two's complement for negatives, as Sheets) ------------
const BASES = { BIN: 2, OCT: 8, DEC: 10, HEX: 16 };
const LIMIT = { 2: 512, 8: 536870912, 16: 549755813888 }; // 2^(bits-1) for 10 digits
function fromBase(s, base, name) {
  const t = String(s).trim().toUpperCase();
  if (!t) return 0;
  if (t.length > 10 || !/^[0-9A-F]+$/.test(t)) return NUM_ERR(`${name}: not a valid number.`);
  const n = parseInt(t, base);
  if (Number.isNaN(n) || n.toString(base).toUpperCase() !== t.replace(/^0+(?=.)/, "")) return NUM_ERR(`${name}: not a valid number.`);
  if (base !== 10 && t.length === 10 && n >= LIMIT[base]) return n - 2 * LIMIT[base];
  return n;
}
function toBase(n, base, places, name) {
  n = Math.trunc(n);
  if (base !== 10 && (n < -LIMIT[base] || n >= LIMIT[base])) return NUM_ERR(`${name}: value out of range.`);
  let s;
  if (n < 0) { if (base === 10) return NUM_ERR(`${name}: negative.`); s = (2 * LIMIT[base] + n).toString(base).toUpperCase(); return s; }
  s = n.toString(base).toUpperCase();
  if (!omitted(places)) { const p = Math.trunc(places); if (p < s.length || p > 10) return NUM_ERR(`${name}: places too small.`); s = s.padStart(p, "0"); }
  return s;
}
function baseFns() {
  const out = [];
  for (const [from, fb] of Object.entries(BASES)) for (const [to, tb] of Object.entries(BASES)) {
    if (from === to) continue;
    const name = `${from}2${to}`;
    if (to === "DEC") out.push(def(name, { args: ["scalar"] }, (ctx, v) => fromBase(toText(v), fb, name)));
    else if (from === "DEC") out.push(def(name, { args: [N, N], min: 1, max: 2 }, (ctx, n, p) => toBase(n, tb, p, name)));
    else out.push(def(name, { args: ["scalar", N], min: 1, max: 2 }, (ctx, v, p) => { const n = fromBase(toText(v), fb, name); return isErr(n) ? n : toBase(n, tb, p, name); }));
  }
  return out;
}

// ---- unit conversion (the common units) ------------------------------------------------
const UNITS = {
  // mass (kg)
  g: ["m", 1e-3], kg: ["m", 1], lbm: ["m", 0.45359237], ozm: ["m", 0.028349523125], stone: ["m", 6.35029318], ton: ["m", 907.18474], mg: ["m", 1e-6],
  // distance (m)
  m: ["l", 1], km: ["l", 1000], cm: ["l", 0.01], mm: ["l", 0.001], in: ["l", 0.0254], ft: ["l", 0.3048], yd: ["l", 0.9144], mi: ["l", 1609.344], Nmi: ["l", 1852],
  // time (s)
  sec: ["t", 1], s: ["t", 1], mn: ["t", 60], min: ["t", 60], hr: ["t", 3600], day: ["t", 86400], d: ["t", 86400], yr: ["t", 31557600],
  // volume (l)
  l: ["v", 1], L: ["v", 1], ml: ["v", 1e-3], mL: ["v", 1e-3], gal: ["v", 3.785411784], qt: ["v", 0.946352946], pt: ["v", 0.473176473], cup: ["v", 0.2365882365], oz: ["v", 0.0295735295625], tbs: ["v", 0.01478676478125], tsp: ["v", 0.00492892159375], "m3": ["v", 1000],
  // area (m²)
  "m2": ["a", 1], "km2": ["a", 1e6], "ft2": ["a", 0.09290304], "in2": ["a", 0.00064516], ha: ["a", 1e4], uk_acre: ["a", 4046.8564224], us_acre: ["a", 4046.87260987425], "mi2": ["a", 2589988.110336],
  // speed (m/s)
  "m/s": ["s", 1], "m/h": ["s", 1 / 3600], mph: ["s", 0.44704], kn: ["s", 0.514444444444444], "km/h": ["s", 1 / 3.6],
  // energy (J)
  J: ["e", 1], kJ: ["e", 1000], cal: ["e", 4.1868], kcal: ["e", 4186.8], Wh: ["e", 3600], kWh: ["e", 3.6e6], BTU: ["e", 1055.05585262],
  // pressure (Pa)
  Pa: ["p", 1], atm: ["p", 101325], mmHg: ["p", 133.322368421], psi: ["p", 6894.75729316836], bar: ["p", 1e5],
};
function convert(x, from, to) {
  const temps = { C: (v) => v, cel: (v) => v, F: (v) => ((v - 32) * 5) / 9, fah: (v) => ((v - 32) * 5) / 9, K: (v) => v - 273.15, kel: (v) => v - 273.15 };
  const back = { C: (v) => v, cel: (v) => v, F: (v) => (v * 9) / 5 + 32, fah: (v) => (v * 9) / 5 + 32, K: (v) => v + 273.15, kel: (v) => v + 273.15 };
  if (temps[from] && back[to]) return back[to](temps[from](x));
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b || a[0] !== b[0]) return NA_ERR(`CONVERT: can't convert ${from} to ${to}.`);
  return (x * a[1]) / b[1];
}

// ---- database functions ---------------------------------------------------------------
// database: a range with headers; field: header text or column number; criteria: a range
// whose first row names fields and each further row is one set of conditions (OR between rows).
function dbValues(ctx, db, field, crit, name) {
  const m = asMatrix(ctx, db), c = asMatrix(ctx, crit);
  if (m.h < 1 || c.h < 1) return VAL_ERR(`${name}: bad database or criteria.`);
  const heads = m.rows[0].map((h) => String(h ?? "").toLowerCase());
  let col = -1;
  if (!omitted(field) && field !== null) {
    col = typeof field === "number" ? Math.trunc(field) - 1 : heads.indexOf(String(field).toLowerCase());
    if (col < 0 || col >= m.w) return VAL_ERR(`${name}: field not found.`);
  }
  const critHeads = c.rows[0].map((h) => heads.indexOf(String(h ?? "").toLowerCase()));
  const rows = [];
  for (let r = 1; r < m.h; r++) {
    const row = m.rows[r];
    let ok = c.h === 1;
    for (let k = 1; k < c.h && !ok; k++) {
      let all = true;
      for (let j = 0; j < c.w; j++) {
        const cv = c.get(k, j);
        if (isEmpty(cv) || cv === "") continue;
        if (critHeads[j] < 0) { all = false; break; }
        if (!criterion(cv)(row[critHeads[j]])) { all = false; break; }
      }
      ok = all;
    }
    if (ok) rows.push(row);
  }
  return { rows, col };
}
const dbFn = (name, fn) => def(name, { args: ["any", "scalar", "any"], noLift: true }, (ctx, db, f, c) => {
  const r = dbValues(ctx, db, f, c, name);
  if (isErr(r)) return r;
  const vals = r.rows.map((row) => (r.col >= 0 ? row[r.col] : null));
  return fn(vals, r.rows);
});
const nums = (vals) => vals.filter((v) => typeof v === "number");
const varOf = (a, sample) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - (sample ? 1 : 0)); };

// ---- matrices --------------------------------------------------------------------------
function numMatrix(m, name) {
  for (const v of m.values()) if (typeof v !== "number") throw Object.assign(new Error("e"), { sheetError: VAL_ERR(`${name} expects numbers.`) });
  return m.rows.map((r) => r.slice());
}
function det(a) {
  const n = a.length; let d = 1;
  a = a.map((r) => r.slice());
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (a[p][i] === 0) return 0;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; d = -d; }
    d *= a[i][i];
    for (let r = i + 1; r < n; r++) { const f = a[r][i] / a[i][i]; for (let c = i; c < n; c++) a[r][c] -= f * a[i][c]; }
  }
  return d;
}
function inverse(a) {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    if (Math.abs(m[p][i]) < 1e-15) return null;
    [m[p], m[i]] = [m[i], m[p]];
    const f = m[i][i]; for (let c = 0; c < 2 * n; c++) m[i][c] /= f;
    for (let r = 0; r < n; r++) if (r !== i) { const g = m[r][i]; for (let c = 0; c < 2 * n; c++) m[r][c] -= g * m[i][c]; }
  }
  return m.map((r) => r.slice(n));
}
// least squares y = X b (X with a column of 1s when const) → b
function leastSquares(X, y) {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, row, r) => s + row[i] * y[r], 0));
  const inv = inverse(XtX);
  if (!inv) return null;
  return inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
}

const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function moreFunctions() {
  return [
    ...baseFns(),
    def("BITAND", { args: [N, N] }, (ctx, a, b) => (a < 0 || b < 0 || a >= 2 ** 48 || b >= 2 ** 48 || !Number.isInteger(a) || !Number.isInteger(b) ? NUM_ERR("BITAND values out of range.") : Number(BigInt(a) & BigInt(b)))),
    def("BITOR", { args: [N, N] }, (ctx, a, b) => (a < 0 || b < 0 || a >= 2 ** 48 || b >= 2 ** 48 || !Number.isInteger(a) || !Number.isInteger(b) ? NUM_ERR("BITOR values out of range.") : Number(BigInt(a) | BigInt(b)))),
    def("BITXOR", { args: [N, N] }, (ctx, a, b) => (a < 0 || b < 0 || a >= 2 ** 48 || b >= 2 ** 48 || !Number.isInteger(a) || !Number.isInteger(b) ? NUM_ERR("BITXOR values out of range.") : Number(BigInt(a) ^ BigInt(b)))),
    def("BITLSHIFT", { args: [N, N] }, (ctx, a, s) => { s = Math.trunc(s); if (a < 0 || !Number.isInteger(a) || Math.abs(s) > 53) return NUM_ERR("BITLSHIFT out of range."); const r = s >= 0 ? a * 2 ** s : Math.floor(a / 2 ** -s); return r >= 2 ** 48 ? NUM_ERR("BITLSHIFT out of range.") : r; }),
    def("BITRSHIFT", { args: [N, N] }, (ctx, a, s) => { s = Math.trunc(s); if (a < 0 || !Number.isInteger(a) || Math.abs(s) > 53) return NUM_ERR("BITRSHIFT out of range."); const r = s >= 0 ? Math.floor(a / 2 ** s) : a * 2 ** -s; return r >= 2 ** 48 ? NUM_ERR("BITRSHIFT out of range.") : r; }),
    def("DELTA", { args: [N, N], min: 1, max: 2 }, (ctx, a, b) => (a === (omitted(b) ? 0 : b) ? 1 : 0)),
    def("GESTEP", { args: [N, N], min: 1, max: 2 }, (ctx, a, b) => (a >= (omitted(b) ? 0 : b) ? 1 : 0)),
    def("CONVERT", { args: [N, T, T] }, (ctx, x, f, t) => convert(x, f, t)),
    def("ROMAN", { args: [N, N], min: 1, max: 2 }, (ctx, n) => { n = Math.trunc(n); if (n < 0 || n > 3999) return VAL_ERR("ROMAN takes 0 to 3999."); let s = ""; for (const [v, l] of ROMAN) while (n >= v) { s += l; n -= v; } return s; }),
    def("ARABIC", { args: [T] }, (ctx, s) => {
      const t = s.trim().toUpperCase();
      const neg = t.startsWith("-");
      const r = neg ? t.slice(1) : t;
      if (!/^[MDCLXVI]*$/.test(r)) return VAL_ERR("ARABIC: not a roman numeral.");
      const v = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
      let n = 0; for (let i = 0; i < r.length; i++) { const a = v[r[i]], b = v[r[i + 1]] || 0; n += a < b ? -a : a; }
      return neg ? -n : n;
    }),
    def("SERIESSUM", { args: [N, N, N, "any"] }, (ctx, x, n, m, coef) => numbersOf(ctx, [coef]).reduce((s, a, i) => s + a * Math.pow(x, n + i * m), 0)),
    def("MDETERM", { args: ["matrix"] }, (ctx, m) => (m.h !== m.w ? VAL_ERR("MDETERM needs a square range.") : det(numMatrix(m, "MDETERM")))),
    def("MINVERSE", { args: ["matrix"] }, (ctx, m) => { if (m.h !== m.w) return VAL_ERR("MINVERSE needs a square range."); const inv = inverse(numMatrix(m, "MINVERSE")); return inv ? new Matrix(inv) : NUM_ERR("MINVERSE: the matrix can't be inverted."); }),
    def("MUNIT", { args: [N] }, (ctx, n) => { n = Math.trunc(n); return n < 1 ? VAL_ERR("MUNIT size must be at least 1.") : Matrix.of(n, n, (r, c) => (r === c ? 1 : 0)); }),
    def("FREQUENCY", { args: ["any", "any"] }, (ctx, data, bins) => {
      const d = numbersOf(ctx, [data]), b = numbersOf(ctx, [bins]);
      const order = b.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
      const counts = new Array(b.length + 1).fill(0);
      for (const v of d) { const k = order.findIndex(([bv]) => v <= bv); counts[k < 0 ? b.length : order[k][1]]++; }
      return new Matrix(counts.map((c) => [c]));
    }),
    def("TREND", { args: ["any", "any", "any", "bool"], min: 1, max: 4 }, (ctx, ys, xs, newx, cst) => {
      const y = numbersOf(ctx, [ys]);
      const x = omitted(xs) ? y.map((_, i) => i + 1) : numbersOf(ctx, [xs]);
      if (x.length !== y.length) return err(ERR.REF, "TREND ranges differ in size.");
      const useC = omitted(cst) ? true : cst;
      const b = leastSquares(x.map((v) => (useC ? [1, v] : [v])), y);
      if (!b) return DIV_ERR("TREND can't fit.");
      const nx = omitted(newx) ? x : numbersOf(ctx, [newx]);
      return new Matrix(nx.map((v) => [useC ? b[0] + b[1] * v : b[0] * v]));
    }),
    def("GROWTH", { args: ["any", "any", "any", "bool"], min: 1, max: 4 }, (ctx, ys, xs, newx, cst) => {
      const y = numbersOf(ctx, [ys]);
      if (y.some((v) => v <= 0)) return NUM_ERR("GROWTH needs positive values.");
      const x = omitted(xs) ? y.map((_, i) => i + 1) : numbersOf(ctx, [xs]);
      const useC = omitted(cst) ? true : cst;
      const b = leastSquares(x.map((v) => (useC ? [1, v] : [v])), y.map(Math.log));
      if (!b) return DIV_ERR("GROWTH can't fit.");
      const nx = omitted(newx) ? x : numbersOf(ctx, [newx]);
      return new Matrix(nx.map((v) => [Math.exp(useC ? b[0] + b[1] * v : b[0] * v)]));
    }),
    def("LINEST", { args: ["any", "any", "bool", "bool"], min: 1, max: 4 }, (ctx, ys, xs, cst) => {
      // slope and intercept (the first row of Sheets' LINEST), one x column
      const y = numbersOf(ctx, [ys]);
      const x = omitted(xs) ? y.map((_, i) => i + 1) : numbersOf(ctx, [xs]);
      if (x.length !== y.length) return err(ERR.REF, "LINEST ranges differ in size.");
      const useC = omitted(cst) ? true : cst;
      const b = leastSquares(x.map((v) => (useC ? [1, v] : [v])), y);
      if (!b) return DIV_ERR("LINEST can't fit.");
      return new Matrix([useC ? [b[1], b[0]] : [b[0], 0]]);
    }),
    def("ISBETWEEN", { args: ["scalar", "scalar", "scalar", "bool", "bool"], min: 3, max: 5 }, (ctx, v, lo, hi, li, hiInc) => {
      const a = compare(v, lo), b = compare(v, hi);
      return (omitted(li) || li ? a >= 0 : a > 0) && (omitted(hiInc) || hiInc ? b <= 0 : b < 0);
    }),
    def("ENCODEURL", { args: [T] }, (ctx, s) => encodeURIComponent(s)),
    def("HYPERLINK", { args: [T, "scalar"], min: 1, max: 2 }, (ctx, url, label) => (omitted(label) ? url : label)),
    def("SPARKLINE", { args: ["matrix", "any"], min: 1, max: 2 }, () => null), // drawn by the grid from the formula; the value is empty
    // database
    dbFn("DSUM", (v) => nums(v).reduce((a, b) => a + b, 0)),
    dbFn("DAVERAGE", (v) => { const n = nums(v); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : DIV_ERR("DAVERAGE: no matching values."); }),
    dbFn("DCOUNT", (v) => nums(v).length),
    dbFn("DCOUNTA", (v) => v.filter((x) => !isEmpty(x) && x !== "").length),
    dbFn("DMAX", (v) => { const n = nums(v); return n.length ? Math.max(...n) : 0; }),
    dbFn("DMIN", (v) => { const n = nums(v); return n.length ? Math.min(...n) : 0; }),
    dbFn("DPRODUCT", (v) => { const n = nums(v); return n.length ? n.reduce((a, b) => a * b, 1) : 0; }),
    dbFn("DGET", (v) => (v.length === 0 ? VAL_ERR("DGET: no match.") : v.length > 1 ? NUM_ERR("DGET: more than one match.") : v[0])),
    dbFn("DSTDEV", (v) => { const n = nums(v); return n.length < 2 ? DIV_ERR("DSTDEV: too few values.") : Math.sqrt(varOf(n, true)); }),
    dbFn("DSTDEVP", (v) => { const n = nums(v); return n.length < 1 ? DIV_ERR("DSTDEVP: no values.") : Math.sqrt(varOf(n, false)); }),
    dbFn("DVAR", (v) => { const n = nums(v); return n.length < 2 ? DIV_ERR("DVAR: too few values.") : varOf(n, true); }),
    dbFn("DVARP", (v) => { const n = nums(v); return n.length < 1 ? DIV_ERR("DVARP: no values.") : varOf(n, false); }),
  ];
}

export { flatValues, isMatrix };
