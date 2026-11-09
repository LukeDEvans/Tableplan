// Math functions (SPREADSHEET_DESIGN.md §3, pass A), as Google Sheets computes them.

import { def, numbersOf, num, omitted, orDefault, matchIndices, flatValues, roundHalfAway, asMatrix, fail, NUM_ERR, DIV_ERR, VAL_ERR, ERR, err, isErr, isMatrix, Matrix, toNumber } from "./helpers.js";

const N = ["number"];
const unary = (name, fn) => def(name, { args: N }, (ctx, x) => fn(x));
const domain = (name, ok, fn) => def(name, { args: N }, (ctx, x) => (ok(x) ? fn(x) : NUM_ERR(`Function ${name} parameter 1 value is out of range.`)));

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function gcd2(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }

function roundTo(x, d, mode) {
  d = Math.trunc(d);
  const p = Math.pow(10, d);
  const y = Number((Math.abs(x) * p).toPrecision(15));
  const r = mode === "up" ? Math.ceil(y) : mode === "down" ? Math.floor(y) : null;
  const out = r === null ? roundHalfAway(Math.abs(x), d) : r / p;
  return x < 0 ? -out : out;
}

function ceilFloor(name, up) {
  return def(name, { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, sig) => {
    const s = omitted(sig) ? 1 : sig;
    if (s === 0) return 0;
    if (x > 0 && s < 0) return NUM_ERR(`${name} parameters must have the same sign or the value must be negative.`);
    const q = x / s;
    const qq = Number(q.toPrecision(15));
    return (up ? Math.ceil(qq) : Math.floor(qq)) * s;
  });
}
function ceilFloorMath(name, up) {
  return def(name, { args: ["number", "number", "number"], min: 1, max: 3 }, (ctx, x, sig, mode) => {
    let s = omitted(sig) ? 1 : Math.abs(sig);
    if (s === 0) return 0;
    const m = omitted(mode) ? 0 : mode;
    const q = Number((x / s).toPrecision(15));
    let r;
    if (x < 0 && m !== 0) r = (up ? Math.floor(q) : Math.ceil(q)) * s; // away from zero / toward zero
    else r = (up ? Math.ceil(q) : Math.floor(q)) * s;
    return r;
  });
}

const sumPairs = (name, f) => def(name, { args: ["matrix", "matrix"] }, (ctx, a, b) => {
  const x = a.flat(), y = b.flat();
  if (x.length !== y.length) return NA_ERR_SIZE(name);
  let s = 0;
  for (let i = 0; i < x.length; i++) if (typeof x[i] === "number" && typeof y[i] === "number") s += f(x[i], y[i]);
  return s;
});
const NA_ERR_SIZE = (name) => err(ERR.NA, `${name} has mismatched range sizes.`);

const SUBTOTAL_FNS = { 1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN", 6: "PRODUCT", 7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR", 11: "VARP" };

export function mathFunctions(all) {
  return [
    unary("ABS", Math.abs),
    domain("ACOS", (x) => x >= -1 && x <= 1, Math.acos),
    domain("ACOSH", (x) => x >= 1, Math.acosh),
    unary("ACOT", (x) => Math.PI / 2 - Math.atan(x)),
    domain("ACOTH", (x) => Math.abs(x) > 1, (x) => 0.5 * Math.log((x + 1) / (x - 1))),
    domain("ASIN", (x) => x >= -1 && x <= 1, Math.asin),
    unary("ASINH", Math.asinh),
    unary("ATAN", Math.atan),
    def("ATAN2", { args: ["number", "number"] }, (ctx, x, y) => (x === 0 && y === 0 ? DIV_ERR("Function ATAN2 caused a divide by zero error.") : Math.atan2(y, x))),
    domain("ATANH", (x) => x > -1 && x < 1, Math.atanh),
    def("BASE", { args: ["int", "int", "int"], min: 2, max: 3 }, (ctx, v, radix, len) => {
      if (v < 0 || radix < 2 || radix > 36) return NUM_ERR("BASE: value out of range.");
      const s = v.toString(radix).toUpperCase();
      return omitted(len) ? s : s.padStart(len, "0");
    }),
    ceilFloor("CEILING", true),
    ceilFloorMath("CEILING.MATH", true),
    def("CEILING.PRECISE", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, s) => { s = omitted(s) ? 1 : Math.abs(s); return s === 0 ? 0 : Math.ceil(Number((x / s).toPrecision(15))) * s; }),
    def("ISO.CEILING", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, s) => { s = omitted(s) ? 1 : Math.abs(s); return s === 0 ? 0 : Math.ceil(Number((x / s).toPrecision(15))) * s; }),
    def("COMBIN", { args: ["int", "int"] }, (ctx, n, k) => (n < 0 || k < 0 || k > n ? NUM_ERR("COMBIN: values out of range.") : Math.round(factorial(n) / (factorial(k) * factorial(n - k))))),
    def("COMBINA", { args: ["int", "int"] }, (ctx, n, k) => (n < 0 || k < 0 ? NUM_ERR("COMBINA: values out of range.") : Math.round(factorial(n + k - 1) / (factorial(k) * factorial(n - 1))))),
    unary("COS", Math.cos),
    unary("COSH", Math.cosh),
    def("COT", { args: N }, (ctx, x) => (x === 0 ? DIV_ERR("COT of 0.") : 1 / Math.tan(x))),
    def("COTH", { args: N }, (ctx, x) => (x === 0 ? DIV_ERR("COTH of 0.") : 1 / Math.tanh(x))),
    def("CSC", { args: N }, (ctx, x) => (x === 0 ? DIV_ERR("CSC of 0.") : 1 / Math.sin(x))),
    def("CSCH", { args: N }, (ctx, x) => (x === 0 ? DIV_ERR("CSCH of 0.") : 1 / Math.sinh(x))),
    def("DECIMAL", { args: ["text", "int"] }, (ctx, s, radix) => {
      if (radix < 2 || radix > 36) return NUM_ERR("DECIMAL: radix out of range.");
      const t = s.trim();
      if (!t) return 0;
      const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, radix);
      if (![...t.toUpperCase()].every((c) => digits.includes(c))) return NUM_ERR("DECIMAL: not a valid number in that base.");
      return parseInt(t, radix);
    }),
    unary("DEGREES", (x) => (x * 180) / Math.PI),
    unary("EVEN", (x) => { const s = Math.sign(x) || 1; const r = Math.ceil(Math.abs(x) / 2) * 2; return s * r; }),
    unary("EXP", Math.exp),
    def("FACT", { args: N }, (ctx, x) => (x < 0 ? NUM_ERR("FACT of a negative number.") : factorial(Math.trunc(x)))),
    def("FACTDOUBLE", { args: N }, (ctx, x) => { if (x < -1) return NUM_ERR("FACTDOUBLE: out of range."); let r = 1; for (let i = Math.trunc(x); i > 1; i -= 2) r *= i; return r; }),
    ceilFloor("FLOOR", false),
    ceilFloorMath("FLOOR.MATH", false),
    def("FLOOR.PRECISE", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, s) => { s = omitted(s) ? 1 : Math.abs(s); return s === 0 ? 0 : Math.floor(Number((x / s).toPrecision(15))) * s; }),
    def("GCD", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      const ns = numbersOf(ctx, args).map(Math.trunc);
      if (ns.some((n) => n < 0)) return NUM_ERR("GCD of negative values.");
      return ns.reduce(gcd2, 0);
    }),
    unary("INT", Math.floor),
    unary("ISEVEN", (x) => Math.trunc(x) % 2 === 0),
    unary("ISODD", (x) => Math.abs(Math.trunc(x)) % 2 === 1),
    def("LCM", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      const ns = numbersOf(ctx, args).map(Math.trunc);
      if (ns.some((n) => n < 0)) return NUM_ERR("LCM of negative values.");
      return ns.reduce((a, b) => (a === 0 || b === 0 ? 0 : Math.abs(a * b) / gcd2(a, b)), 1);
    }),
    domain("LN", (x) => x > 0, Math.log),
    def("LOG", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, b) => {
      b = omitted(b) ? 10 : b;
      if (x <= 0 || b <= 0) return NUM_ERR("LOG: values must be positive.");
      if (b === 1) return DIV_ERR("LOG with base 1.");
      return Math.log(x) / Math.log(b);
    }),
    domain("LOG10", (x) => x > 0, Math.log10),
    def("MOD", { args: ["number", "number"] }, (ctx, a, b) => {
      if (b === 0) return DIV_ERR("Function MOD parameter 2 cannot be zero.");
      const r = a - b * Math.floor(a / b);
      return Number(r.toPrecision(15));
    }),
    def("MROUND", { args: ["number", "number"] }, (ctx, x, m) => {
      if (m === 0) return 0;
      if (x * m < 0) return NUM_ERR("MROUND parameters must have the same sign.");
      return roundHalfAway(x / m, 0) * m;
    }),
    def("MULTINOMIAL", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      const ns = numbersOf(ctx, args).map(Math.trunc);
      if (ns.some((n) => n < 0)) return NUM_ERR("MULTINOMIAL of negative values.");
      return Math.round(factorial(ns.reduce((a, b) => a + b, 0)) / ns.reduce((p, n) => p * factorial(n), 1));
    }),
    unary("ODD", (x) => { const s = Math.sign(x) || 1; let r = Math.ceil(Math.abs(x)); if (r % 2 === 0) r += 1; return s * r; }),
    def("PI", { args: [] }, () => Math.PI),
    def("POWER", { args: ["number", "number"] }, (ctx, a, b) => (a === 0 && b < 0 ? DIV_ERR("POWER: 0 to a negative power.") : (a < 0 && !Number.isInteger(b) ? NUM_ERR("POWER: negative base with a fractional exponent.") : Math.pow(a, b)))),
    def("PRODUCT", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => { const ns = numbersOf(ctx, args); return ns.length ? ns.reduce((a, b) => a * b, 1) : 0; }),
    def("QUOTIENT", { args: ["number", "number"] }, (ctx, a, b) => (b === 0 ? DIV_ERR("QUOTIENT by 0.") : Math.trunc(a / b))),
    unary("RADIANS", (x) => (x * Math.PI) / 180),
    def("RAND", { args: [] }, (ctx) => ctx.random()),
    def("RANDBETWEEN", { args: ["number", "number"] }, (ctx, lo, hi) => {
      lo = Math.ceil(lo); hi = Math.floor(hi);
      if (lo > hi) return NUM_ERR("RANDBETWEEN: low is greater than high.");
      return lo + Math.floor(ctx.random() * (hi - lo + 1));
    }),
    def("ROUND", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, d) => roundTo(x, omitted(d) ? 0 : d, "half")),
    def("ROUNDDOWN", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, d) => roundTo(x, omitted(d) ? 0 : d, "down")),
    def("ROUNDUP", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, d) => roundTo(x, omitted(d) ? 0 : d, "up")),
    unary("SEC", (x) => 1 / Math.cos(x)),
    unary("SECH", (x) => 1 / Math.cosh(x)),
    unary("SIGN", (x) => Math.sign(x)),
    unary("SIN", Math.sin),
    unary("SINH", Math.sinh),
    domain("SQRT", (x) => x >= 0, Math.sqrt),
    domain("SQRTPI", (x) => x >= 0, (x) => Math.sqrt(x * Math.PI)),
    def("SUM", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => numbersOf(ctx, args).reduce((a, b) => a + b, 0)),
    def("SUMIF", { args: ["any", "scalar", "any"], min: 2, max: 3, noLift: true }, (ctx, range, crit, sumRange) => {
      const idx = matchIndices(ctx, [[range, crit]]);
      const vals = flatValues(ctx, omitted(sumRange) ? range : resizeLike(ctx, sumRange, range));
      let s = 0;
      for (const i of idx) if (typeof vals[i] === "number") s += vals[i];
      return s;
    }),
    def("SUMIFS", { args: ["any"], repeat: ["any", "scalar"], min: 3, max: Infinity, noLift: true }, (ctx, sumRange, ...rest) => {
      if (rest.length % 2) return err(ERR.NA, "SUMIFS needs criteria in pairs.");
      const vals = flatValues(ctx, sumRange);
      const pairs = [];
      for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
      const idx = matchIndices(ctx, pairs, vals.length);
      let s = 0;
      for (const i of idx) if (typeof vals[i] === "number") s += vals[i];
      return s;
    }),
    def("SUMPRODUCT", { args: ["matrix"], min: 1, max: Infinity }, (ctx, ...ms) => {
      const h = ms[0].h, w = ms[0].w;
      if (ms.some((m) => m.h !== h || m.w !== w)) return VAL_ERR("SUMPRODUCT has mismatched range sizes.");
      let s = 0;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        let p = 1;
        for (const m of ms) {
          const v = m.get(r, c);
          if (isErr(v)) return v;
          p *= typeof v === "number" ? v : 0;
        }
        s += p;
      }
      return s;
    }),
    def("SUMSQ", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => numbersOf(ctx, args).reduce((a, b) => a + b * b, 0)),
    sumPairs("SUMX2MY2", (x, y) => x * x - y * y),
    sumPairs("SUMX2PY2", (x, y) => x * x + y * y),
    sumPairs("SUMXMY2", (x, y) => (x - y) ** 2),
    unary("TAN", Math.tan),
    unary("TANH", Math.tanh),
    def("TRUNC", { args: ["number", "number"], min: 1, max: 2 }, (ctx, x, d) => roundTo(x, omitted(d) ? 0 : d, "down")),
    def("SUBTOTAL", { args: ["int", "any"], min: 2, max: Infinity, noLift: true }, (ctx, code, ...refs) => {
      const name = SUBTOTAL_FNS[code > 100 ? code - 100 : code];
      if (!name) return VAL_ERR("SUBTOTAL: unknown function code.");
      // nested SUBTOTALs are skipped, as Sheets
      const filtered = refs.map((r) => (ctx.engine && r && r.tab !== undefined ? withoutSubtotals(ctx, r) : r));
      return all().get(name).fn(ctx, ...filtered);
    }),
    // operator functions
    def("ADD", { args: ["number", "number"] }, (ctx, a, b) => a + b),
    def("MINUS", { args: ["number", "number"] }, (ctx, a, b) => a - b),
    def("MULTIPLY", { args: ["number", "number"] }, (ctx, a, b) => a * b),
    def("DIVIDE", { args: ["number", "number"] }, (ctx, a, b) => (b === 0 ? DIV_ERR("Function DIVIDE parameter 2 cannot be zero.") : a / b)),
    def("POW", { args: ["number", "number"] }, (ctx, a, b) => Math.pow(a, b)),
    def("UMINUS", { args: N }, (ctx, a) => -a),
    def("UPLUS", { args: ["scalar"] }, (ctx, a) => a),
    def("UNARY_PERCENT", { args: N }, (ctx, a) => a / 100),
  ];
}

// SUMIF's sum range takes the criteria range's shape from its top-left cell.
function resizeLike(ctx, sumRange, range) {
  if (!sumRange || sumRange.tab === undefined || !range || range.tab === undefined) return sumRange;
  const h = range.r2 - range.r1, w = range.c2 - range.c1;
  const size = ctx.tabSize(sumRange.tab);
  const r2 = Math.min(sumRange.r1 + h, size.rows - 1), c2 = Math.min(sumRange.c1 + w, size.cols - 1);
  const ref = ctx.refAt(sumRange.tab, sumRange.r1, sumRange.c1, r2, c2);
  return isErr(ref) ? sumRange : ref;
}

// A range's values with cells that are themselves SUBTOTAL formulas blanked out.
function withoutSubtotals(ctx, ref) {
  const m = ctx.deref(ref);
  return m.map((v, r, c) => {
    const tree = ctx.formulaAt(ref.tab, ref.r1 + r, ref.c1 + c);
    return tree && hasSubtotal(tree) ? null : v;
  });
}
function hasSubtotal(n) {
  if (!n || typeof n !== "object") return false;
  if (n.t === "fn" && n.name === "SUBTOTAL") return true;
  if (n.t === "fn") return n.args.some(hasSubtotal);
  if (n.t === "bin") return hasSubtotal(n.a) || hasSubtotal(n.b);
  if (n.t === "un" || n.t === "pct") return hasSubtotal(n.a);
  return false;
}

export { asMatrix, Matrix, isMatrix, toNumber, num, orDefault, fail };
