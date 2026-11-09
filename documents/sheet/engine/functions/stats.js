// Counting and statistics (SPREADSHEET_DESIGN.md §3, pass A).

import { def, numbersOf, eachValue, matchIndices, flatValues, omitted, criterion, asMatrix, NUM_ERR, DIV_ERR, VAL_ERR, ERR, err, isErr, isEmpty, isMatrix, toNumber, compare } from "./helpers.js";

const ANY = { args: ["any"], min: 1, max: Infinity };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => sum(a) / a.length;
function variance(a, sample) {
  const n = a.length;
  if (n < (sample ? 2 : 1)) return null;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) ** 2;
  return s / (sample ? n - 1 : n);
}
const sorted = (a) => [...a].sort((x, y) => x - y);

function percentileInc(a, p) {
  const s = sorted(a);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}
function percentileExc(a, p) {
  const s = sorted(a);
  const n = s.length;
  const h = (n + 1) * p - 1;
  if (h < 0 || h > n - 1) return null;
  const lo = Math.floor(h);
  return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}

function varFn(name, sample, a = false) {
  return def(name, ANY, (ctx, ...args) => {
    const v = variance(numbersOf(ctx, args, { a }), sample);
    return v === null ? DIV_ERR(`Function ${name} parameter 1 has too few values.`) : v;
  });
}
function stdevFn(name, sample, a = false) {
  return def(name, ANY, (ctx, ...args) => {
    const v = variance(numbersOf(ctx, args, { a }), sample);
    return v === null ? DIV_ERR(`Function ${name} parameter 1 has too few values.`) : Math.sqrt(v);
  });
}

// Two ranges of numbers, paired, skipping pairs where either isn't a number.
function pairs(ctx, ys, xs, name) {
  const y = flatValues(ctx, ys), x = flatValues(ctx, xs);
  if (y.length !== x.length) throw Object.assign(new Error("e"), { sheetError: err(ERR.NA, `${name} has mismatched range sizes.`) });
  const px = [], py = [];
  for (let i = 0; i < x.length; i++) {
    if (isErr(x[i])) throw Object.assign(new Error("e"), { sheetError: x[i] });
    if (isErr(y[i])) throw Object.assign(new Error("e"), { sheetError: y[i] });
    if (typeof x[i] === "number" && typeof y[i] === "number") { px.push(x[i]); py.push(y[i]); }
  }
  return { x: px, y: py };
}
function linreg(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return { mx, my, sxy, sxx, syy, n: x.length };
}

function rankOf(ctx, value, ref, order, mode) {
  const nums = numbersOf(ctx, [ref]);
  if (!nums.includes(value)) return err(ERR.NA, `RANK's value ${value} is not in the range.`);
  const asc = !omitted(order) && order !== 0;
  const better = nums.filter((n) => (asc ? n < value : n > value)).length;
  if (mode === "avg") { const ties = nums.filter((n) => n === value).length; return better + (ties + 1) / 2; }
  return better + 1;
}

export function statsFunctions() {
  return [
    def("AVERAGE", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); return ns.length ? mean(ns) : DIV_ERR("Evaluation of function AVERAGE caused a divide by zero error."); }),
    def("AVERAGEA", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args, { a: true }); return ns.length ? mean(ns) : DIV_ERR("Evaluation of function AVERAGEA caused a divide by zero error."); }),
    def("AVERAGEIF", { args: ["any", "scalar", "any"], min: 2, max: 3, noLift: true }, (ctx, range, crit, avgRange) => {
      const idx = matchIndices(ctx, [[range, crit]]);
      const vals = flatValues(ctx, omitted(avgRange) ? range : avgRange);
      const ns = idx.map((i) => vals[i]).filter((v) => typeof v === "number");
      return ns.length ? mean(ns) : DIV_ERR("Evaluation of function AVERAGEIF caused a divide by zero error.");
    }),
    def("AVERAGEIFS", { args: ["any"], repeat: ["any", "scalar"], min: 3, max: Infinity, noLift: true }, (ctx, avgRange, ...rest) => {
      const vals = flatValues(ctx, avgRange);
      const ps = []; for (let i = 0; i < rest.length; i += 2) ps.push([rest[i], rest[i + 1]]);
      const ns = matchIndices(ctx, ps, vals.length).map((i) => vals[i]).filter((v) => typeof v === "number");
      return ns.length ? mean(ns) : DIV_ERR("Evaluation of function AVERAGEIFS caused a divide by zero error.");
    }),
    def("AVEDEV", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); if (!ns.length) return NUM_ERR("AVEDEV of no values."); const m = mean(ns); return mean(ns.map((x) => Math.abs(x - m))); }),
    def("COUNT", ANY, (ctx, ...args) => {
      let n = 0;
      for (const a of args) for (const { v, direct } of eachValue(ctx, a)) {
        if (typeof v === "number") n++;
        else if (direct && (typeof v === "boolean" || (typeof v === "string" && !isErr(toNumber(v)) && v !== ""))) n++;
      }
      return n;
    }),
    def("COUNTA", ANY, (ctx, ...args) => {
      let n = 0;
      for (const a of args) for (const { v, direct } of eachValue(ctx, a)) if (!isEmpty(v) || direct) n++;
      return n;
    }),
    def("COUNTBLANK", { args: ["any"] }, (ctx, r) => { let n = 0; for (const { v } of eachValue(ctx, r)) if (isEmpty(v) || v === "") n++; return n; }),
    def("COUNTIF", { args: ["any", "scalar"], noLift: true }, (ctx, range, crit) => matchIndices(ctx, [[range, crit]]).length),
    def("COUNTIFS", { args: [], repeat: ["any", "scalar"], min: 2, max: Infinity, noLift: true }, (ctx, ...rest) => {
      if (rest.length % 2) return err(ERR.NA, "COUNTIFS needs criteria in pairs.");
      const ps = []; for (let i = 0; i < rest.length; i += 2) ps.push([rest[i], rest[i + 1]]);
      return matchIndices(ctx, ps).length;
    }),
    def("COUNTUNIQUE", ANY, (ctx, ...args) => {
      const seen = new Set();
      for (const a of args) for (const { v } of eachValue(ctx, a)) {
        if (isEmpty(v) || v === "") continue;
        seen.add(typeof v === "string" ? `s:${v}` : typeof v === "number" ? `n:${v}` : isErr(v) ? `e:${v.code}` : `b:${v}`);
      }
      return seen.size;
    }),
    def("DEVSQ", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); if (!ns.length) return NUM_ERR("DEVSQ of no values."); const m = mean(ns); return sum(ns.map((x) => (x - m) ** 2)); }),
    def("GEOMEAN", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); if (!ns.length || ns.some((x) => x <= 0)) return NUM_ERR("GEOMEAN needs positive values."); return Math.exp(mean(ns.map(Math.log))); }),
    def("HARMEAN", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); if (!ns.length || ns.some((x) => x <= 0)) return NUM_ERR("HARMEAN needs positive values."); return ns.length / sum(ns.map((x) => 1 / x)); }),
    def("LARGE", { args: ["any", "int"], noLift: false }, (ctx, r, k) => { const s = sorted(numbersOf(ctx, [r])).reverse(); return k < 1 || k > s.length ? NUM_ERR(`Function LARGE parameter 2 value ${k} is out of range.`) : s[k - 1]; }),
    def("SMALL", { args: ["any", "int"] }, (ctx, r, k) => { const s = sorted(numbersOf(ctx, [r])); return k < 1 || k > s.length ? NUM_ERR(`Function SMALL parameter 2 value ${k} is out of range.`) : s[k - 1]; }),
    def("MAX", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); return ns.length ? ns.reduce((a, b) => (b > a ? b : a), -Infinity) : 0; }),
    def("MAXA", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args, { a: true }); return ns.length ? Math.max(...ns) : 0; }),
    def("MIN", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); return ns.length ? ns.reduce((a, b) => (b < a ? b : a), Infinity) : 0; }),
    def("MINA", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args, { a: true }); return ns.length ? Math.min(...ns) : 0; }),
    def("MAXIFS", { args: ["any"], repeat: ["any", "scalar"], min: 3, max: Infinity, noLift: true }, (ctx, range, ...rest) => {
      const vals = flatValues(ctx, range);
      const ps = []; for (let i = 0; i < rest.length; i += 2) ps.push([rest[i], rest[i + 1]]);
      const ns = matchIndices(ctx, ps, vals.length).map((i) => vals[i]).filter((v) => typeof v === "number");
      return ns.length ? Math.max(...ns) : 0;
    }),
    def("MINIFS", { args: ["any"], repeat: ["any", "scalar"], min: 3, max: Infinity, noLift: true }, (ctx, range, ...rest) => {
      const vals = flatValues(ctx, range);
      const ps = []; for (let i = 0; i < rest.length; i += 2) ps.push([rest[i], rest[i + 1]]);
      const ns = matchIndices(ctx, ps, vals.length).map((i) => vals[i]).filter((v) => typeof v === "number");
      return ns.length ? Math.min(...ns) : 0;
    }),
    def("MEDIAN", ANY, (ctx, ...args) => { const ns = numbersOf(ctx, args); if (!ns.length) return NUM_ERR("MEDIAN has no valid input data."); return percentileInc(ns, 0.5); }),
    ...["MODE", "MODE.SNGL"].map((nm) => def(nm, ANY, (ctx, ...args) => {
      const ns = numbersOf(ctx, args);
      const counts = new Map();
      let best = null, bestN = 1;
      for (const x of ns) { const c = (counts.get(x) || 0) + 1; counts.set(x, c); if (c > bestN) { bestN = c; best = x; } }
      return best === null ? err(ERR.NA, `No mode for the values.`) : best;
    })),
    ...["PERCENTILE", "PERCENTILE.INC"].map((nm) => def(nm, { args: ["any", "number"] }, (ctx, r, p) => { const ns = numbersOf(ctx, [r]); if (!ns.length || p < 0 || p > 1) return NUM_ERR(`Function ${nm} parameter 2 value is out of range.`); return percentileInc(ns, p); })),
    def("PERCENTILE.EXC", { args: ["any", "number"] }, (ctx, r, p) => { const ns = numbersOf(ctx, [r]); const v = ns.length ? percentileExc(ns, p) : null; return v === null ? NUM_ERR("PERCENTILE.EXC value is out of range.") : v; }),
    ...["QUARTILE", "QUARTILE.INC"].map((nm) => def(nm, { args: ["any", "int"] }, (ctx, r, q) => { const ns = numbersOf(ctx, [r]); if (!ns.length || q < 0 || q > 4) return NUM_ERR(`Function ${nm} parameter 2 value is out of range.`); return percentileInc(ns, q / 4); })),
    def("QUARTILE.EXC", { args: ["any", "int"] }, (ctx, r, q) => { const ns = numbersOf(ctx, [r]); const v = q <= 0 || q >= 4 || !ns.length ? null : percentileExc(ns, q / 4); return v === null ? NUM_ERR("QUARTILE.EXC value is out of range.") : v; }),
    ...["PERCENTRANK", "PERCENTRANK.INC"].map((nm) => def(nm, { args: ["any", "number", "int"], min: 2, max: 3 }, (ctx, r, x, sig) => {
      const s = sorted(numbersOf(ctx, [r]));
      const digits = omitted(sig) ? 3 : sig;
      if (!s.length || x < s[0] || x > s[s.length - 1]) return err(ERR.NA, `${nm}: value out of range.`);
      const n = s.length;
      let pos;
      const i = s.findIndex((v) => v >= x);
      if (s[i] === x) pos = s.indexOf(x) / (n - 1);
      else pos = (i - 1 + (x - s[i - 1]) / (s[i] - s[i - 1])) / (n - 1);
      const p = Math.pow(10, digits);
      return Math.round(pos * p + 1e-9) / p;
    })),
    def("PERCENTRANK.EXC", { args: ["any", "number", "int"], min: 2, max: 3 }, (ctx, r, x, sig) => {
      const s = sorted(numbersOf(ctx, [r]));
      const digits = omitted(sig) ? 3 : sig;
      if (!s.length || x < s[0] || x > s[s.length - 1]) return err(ERR.NA, "PERCENTRANK.EXC: value out of range.");
      const n = s.length;
      const i = s.findIndex((v) => v >= x);
      const rank = s[i] === x ? s.indexOf(x) + 1 : i + (x - s[i - 1]) / (s[i] - s[i - 1]);
      const p = Math.pow(10, digits);
      return Math.round((rank / (n + 1)) * p + 1e-9) / p;
    }),
    ...["RANK", "RANK.EQ"].map((nm) => def(nm, { args: ["number", "any", "scalar"], min: 2, max: 3 }, (ctx, v, r, o) => rankOf(ctx, v, r, o, "eq"))),
    def("RANK.AVG", { args: ["number", "any", "scalar"], min: 2, max: 3 }, (ctx, v, r, o) => rankOf(ctx, v, r, o, "avg")),
    stdevFn("STDEV", true), stdevFn("STDEV.S", true), stdevFn("STDEVP", false), stdevFn("STDEV.P", false), stdevFn("STDEVA", true, true), stdevFn("STDEVPA", false, true),
    varFn("VAR", true), varFn("VAR.S", true), varFn("VARP", false), varFn("VAR.P", false), varFn("VARA", true, true), varFn("VARPA", false, true),
    def("TRIMMEAN", { args: ["any", "number"] }, (ctx, r, p) => {
      if (p < 0 || p >= 1) return NUM_ERR("TRIMMEAN: percent out of range.");
      const s = sorted(numbersOf(ctx, [r]));
      if (!s.length) return NUM_ERR("TRIMMEAN of no values.");
      const cut = Math.floor((s.length * p) / 2);
      return mean(s.slice(cut, s.length - cut));
    }),
    ...["CORREL", "PEARSON"].map((nm) => def(nm, { args: ["any", "any"] }, (ctx, a, b) => {
      const { x, y } = pairs(ctx, a, b, nm);
      const L = linreg(x, y);
      if (L.n < 2 || L.sxx === 0 || L.syy === 0) return DIV_ERR(`${nm}: divide by zero.`);
      return L.sxy / Math.sqrt(L.sxx * L.syy);
    })),
    def("RSQ", { args: ["any", "any"] }, (ctx, a, b) => { const { x, y } = pairs(ctx, a, b, "RSQ"); const L = linreg(x, y); if (L.n < 2 || L.sxx === 0 || L.syy === 0) return DIV_ERR("RSQ: divide by zero."); return (L.sxy * L.sxy) / (L.sxx * L.syy); }),
    ...["COVAR", "COVARIANCE.P"].map((nm) => def(nm, { args: ["any", "any"] }, (ctx, a, b) => { const { x, y } = pairs(ctx, a, b, nm); const L = linreg(x, y); return L.n ? L.sxy / L.n : DIV_ERR(`${nm} of no values.`); })),
    def("COVARIANCE.S", { args: ["any", "any"] }, (ctx, a, b) => { const { x, y } = pairs(ctx, a, b, "COVARIANCE.S"); const L = linreg(x, y); return L.n > 1 ? L.sxy / (L.n - 1) : DIV_ERR("COVARIANCE.S of too few values."); }),
    def("SLOPE", { args: ["any", "any"] }, (ctx, ys, xs) => { const { x, y } = pairs(ctx, ys, xs, "SLOPE"); const L = linreg(x, y); return L.sxx === 0 || L.n < 2 ? DIV_ERR("SLOPE: divide by zero.") : L.sxy / L.sxx; }),
    def("INTERCEPT", { args: ["any", "any"] }, (ctx, ys, xs) => { const { x, y } = pairs(ctx, ys, xs, "INTERCEPT"); const L = linreg(x, y); return L.sxx === 0 || L.n < 2 ? DIV_ERR("INTERCEPT: divide by zero.") : L.my - (L.sxy / L.sxx) * L.mx; }),
    ...["FORECAST", "FORECAST.LINEAR"].map((nm) => def(nm, { args: ["number", "any", "any"] }, (ctx, at, ys, xs) => { const { x, y } = pairs(ctx, ys, xs, nm); const L = linreg(x, y); if (L.sxx === 0 || L.n < 2) return DIV_ERR(`${nm}: divide by zero.`); const b = L.sxy / L.sxx; return L.my - b * L.mx + b * at; })),
    def("STEYX", { args: ["any", "any"] }, (ctx, ys, xs) => { const { x, y } = pairs(ctx, ys, xs, "STEYX"); const L = linreg(x, y); if (L.n < 3 || L.sxx === 0) return DIV_ERR("STEYX: too few values."); return Math.sqrt((L.syy - (L.sxy * L.sxy) / L.sxx) / (L.n - 2)); }),
  ];
}

export { asMatrix, criterion, compare, isMatrix, VAL_ERR };
