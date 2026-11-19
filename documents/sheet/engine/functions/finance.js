// Financial functions (SPREADSHEET_DESIGN.md §3, pass C), as Sheets computes them.
// Payments are negative (money going out), as Sheets and Excel.

import { def, numbersOf, flatValues, omitted, NUM_ERR, DIV_ERR, VAL_ERR, ERR, err, isErr } from "./helpers.js";
import { solve } from "./special.js";

const o = (v, d) => (omitted(v) ? d : v);

function fv(rate, n, pmt, pv, type) {
  if (rate === 0) return -(pv + pmt * n);
  const f = Math.pow(1 + rate, n);
  return -(pv * f + (pmt * (1 + rate * type) * (f - 1)) / rate);
}
function pmt(rate, n, pv, fvv, type) {
  if (rate === 0) return -(pv + fvv) / n;
  const f = Math.pow(1 + rate, n);
  return (-rate * (pv * f + fvv)) / ((1 + rate * type) * (f - 1));
}
function pv(rate, n, pmtv, fvv, type) {
  if (rate === 0) return -(fvv + pmtv * n);
  const f = Math.pow(1 + rate, n);
  return -(fvv + (pmtv * (1 + rate * type) * (f - 1)) / rate) / f;
}
function ipmt(rate, per, n, pvv, fvv, type) {
  const p = pmt(rate, n, pvv, fvv, type);
  let i;
  if (per === 1) i = type === 1 ? 0 : -pvv * rate;
  else i = (type === 1 ? fv(rate, per - 2, p, pvv, 1) - p : fv(rate, per - 1, p, pvv, 0)) * rate;
  return i;
}
function npv(rate, cash) { let s = 0; cash.forEach((c, i) => { s += c / Math.pow(1 + rate, i + 1); }); return s; }

function ddb(cost, salvage, life, period, factor) {
  let total = 0, dep = 0;
  for (let p = 1; p <= Math.ceil(period); p++) {
    dep = Math.min((cost - total) * (factor / life), Math.max(0, cost - salvage - total));
    total += dep;
  }
  return dep;
}

export function financeFunctions() {
  const N = "number";
  return [
    def("FV", { args: [N, N, N, N, N], min: 3, max: 5 }, (ctx, r, n, p, v, t) => fv(r, n, p, o(v, 0), o(t, 0) ? 1 : 0)),
    def("PV", { args: [N, N, N, N, N], min: 3, max: 5 }, (ctx, r, n, p, f, t) => pv(r, n, p, o(f, 0), o(t, 0) ? 1 : 0)),
    def("PMT", { args: [N, N, N, N, N], min: 3, max: 5 }, (ctx, r, n, v, f, t) => (n === 0 ? NUM_ERR("PMT with no periods.") : pmt(r, n, v, o(f, 0), o(t, 0) ? 1 : 0))),
    def("IPMT", { args: [N, N, N, N, N, N], min: 4, max: 6 }, (ctx, r, per, n, v, f, t) => (per < 1 || per > n ? NUM_ERR("IPMT period out of range.") : ipmt(r, per, n, v, o(f, 0), o(t, 0) ? 1 : 0))),
    def("PPMT", { args: [N, N, N, N, N, N], min: 4, max: 6 }, (ctx, r, per, n, v, f, t) => (per < 1 || per > n ? NUM_ERR("PPMT period out of range.") : pmt(r, n, v, o(f, 0), o(t, 0) ? 1 : 0) - ipmt(r, per, n, v, o(f, 0), o(t, 0) ? 1 : 0))),
    def("NPER", { args: [N, N, N, N, N], min: 3, max: 5 }, (ctx, r, p, v, f, t) => {
      f = o(f, 0); t = o(t, 0) ? 1 : 0;
      if (r === 0) return p === 0 ? NUM_ERR("NPER: no payment.") : -(v + f) / p;
      const num = p * (1 + r * t) - f * r, den = v * r + p * (1 + r * t);
      if (num / den <= 0) return NUM_ERR("NPER has no solution.");
      return Math.log(num / den) / Math.log(1 + r);
    }),
    def("RATE", { args: [N, N, N, N, N, N], min: 3, max: 6 }, (ctx, n, p, v, f, t, guess) => {
      f = o(f, 0); t = o(t, 0) ? 1 : 0;
      const r = solve((x) => (Math.abs(x) < 1e-12 ? v + p * n + f : v * Math.pow(1 + x, n) + p * (1 + x * t) * ((Math.pow(1 + x, n) - 1) / x) + f), o(guess, 0.1));
      return r === null ? NUM_ERR("RATE could not find a result.") : r;
    }),
    def("NPV", { args: [N, "any"], min: 2, max: Infinity, noLift: true }, (ctx, r, ...vals) => npv(r, numbersOf(ctx, vals))),
    def("XNPV", { args: [N, "any", "any"] }, (ctx, r, v, d) => {
      const vs = flatValues(ctx, v), ds = flatValues(ctx, d);
      if (vs.length !== ds.length) return NUM_ERR("XNPV ranges differ in size.");
      let s = 0;
      for (let i = 0; i < vs.length; i++) s += vs[i] / Math.pow(1 + r, (ds[i] - ds[0]) / 365);
      return s;
    }),
    def("IRR", { args: ["any", N], min: 1, max: 2 }, (ctx, v, g) => {
      const cash = numbersOf(ctx, [v]);
      if (!cash.some((c) => c > 0) || !cash.some((c) => c < 0)) return NUM_ERR("IRR needs both positive and negative values.");
      const r = solve((x) => cash.reduce((s, c, i) => s + c / Math.pow(1 + x, i), 0), o(g, 0.1));
      return r === null ? NUM_ERR("IRR could not find a result.") : r;
    }),
    def("XIRR", { args: ["any", "any", N], min: 2, max: 3 }, (ctx, v, d, g) => {
      const vs = flatValues(ctx, v), ds = flatValues(ctx, d);
      if (vs.length !== ds.length) return NUM_ERR("XIRR ranges differ in size.");
      const r = solve((x) => vs.reduce((s, c, i) => s + c / Math.pow(1 + x, (ds[i] - ds[0]) / 365), 0), o(g, 0.1));
      return r === null ? NUM_ERR("XIRR could not find a result.") : r;
    }),
    def("MIRR", { args: ["any", N, N] }, (ctx, v, fr, rr) => {
      const cash = numbersOf(ctx, [v]);
      const n = cash.length;
      let pos = 0, neg = 0;
      cash.forEach((c, i) => { if (c > 0) pos += c * Math.pow(1 + rr, n - 1 - i); else neg += c / Math.pow(1 + fr, i); });
      if (neg === 0 || pos === 0) return DIV_ERR("MIRR needs positive and negative values.");
      return Math.pow(-pos / neg, 1 / (n - 1)) - 1;
    }),
    def("CUMIPMT", { args: [N, N, N, N, N, N] }, (ctx, r, n, v, s, e, t) => {
      if (r <= 0 || n <= 0 || v <= 0 || s < 1 || e < s || e > n || (t !== 0 && t !== 1)) return NUM_ERR("CUMIPMT values out of range.");
      let sum = 0; for (let p = Math.ceil(s); p <= Math.floor(e); p++) sum += ipmt(r, p, n, v, 0, t); return sum;
    }),
    def("CUMPRINC", { args: [N, N, N, N, N, N] }, (ctx, r, n, v, s, e, t) => {
      if (r <= 0 || n <= 0 || v <= 0 || s < 1 || e < s || e > n || (t !== 0 && t !== 1)) return NUM_ERR("CUMPRINC values out of range.");
      const p = pmt(r, n, v, 0, t);
      let sum = 0; for (let k = Math.ceil(s); k <= Math.floor(e); k++) sum += p - ipmt(r, k, n, v, 0, t); return sum;
    }),
    def("EFFECT", { args: [N, N] }, (ctx, r, n) => { n = Math.trunc(n); return r <= 0 || n < 1 ? NUM_ERR("EFFECT values out of range.") : Math.pow(1 + r / n, n) - 1; }),
    def("NOMINAL", { args: [N, N] }, (ctx, r, n) => { n = Math.trunc(n); return r <= 0 || n < 1 ? NUM_ERR("NOMINAL values out of range.") : n * (Math.pow(1 + r, 1 / n) - 1); }),
    def("RRI", { args: [N, N, N] }, (ctx, n, p, f) => (n <= 0 ? NUM_ERR("RRI needs periods.") : Math.pow(f / p, 1 / n) - 1)),
    def("PDURATION", { args: [N, N, N] }, (ctx, r, p, f) => (r <= 0 || p <= 0 || f <= 0 ? NUM_ERR("PDURATION values must be positive.") : (Math.log(f) - Math.log(p)) / Math.log(1 + r))),
    def("FVSCHEDULE", { args: [N, "any"] }, (ctx, p, rates) => flatValues(ctx, rates).reduce((a, r) => a * (1 + (typeof r === "number" ? r : 0)), p)),
    def("SLN", { args: [N, N, N] }, (ctx, c, s, l) => (l === 0 ? DIV_ERR("SLN life is 0.") : (c - s) / l)),
    def("SYD", { args: [N, N, N, N] }, (ctx, c, s, l, p) => (p < 1 || p > l ? NUM_ERR("SYD period out of range.") : ((c - s) * (l - p + 1) * 2) / (l * (l + 1)))),
    def("DDB", { args: [N, N, N, N, N], min: 4, max: 5 }, (ctx, c, s, l, p, f) => (p < 1 || p > l || c < 0 || s < 0 ? NUM_ERR("DDB values out of range.") : ddb(c, s, l, p, o(f, 2)))),
    def("DB", { args: [N, N, N, N, N], min: 4, max: 5 }, (ctx, c, s, l, p, m) => {
      m = o(m, 12);
      if (c < 0 || s < 0 || l <= 0 || p < 1 || p > l || m < 1 || m > 12) return NUM_ERR("DB values out of range.");
      const rate = Math.round((1 - Math.pow(s / c, 1 / l)) * 1000) / 1000;
      let total = c * rate * (m / 12), dep = total;
      for (let i = 2; i <= p; i++) { dep = i === Math.floor(l) + 1 ? (c - total) * rate * ((12 - m) / 12) : (c - total) * rate; total += dep; }
      return p === 1 ? c * rate * (m / 12) : dep;
    }),
    def("ISPMT", { args: [N, N, N, N] }, (ctx, r, per, n, v) => (n === 0 ? DIV_ERR("ISPMT periods is 0.") : v * r * (per / n - 1))),
    def("DOLLARDE", { args: [N, N] }, (ctx, d, f) => { f = Math.trunc(f); if (f < 0) return NUM_ERR("DOLLARDE fraction negative."); if (f === 0) return DIV_ERR("DOLLARDE fraction 0."); const i = Math.trunc(d); return i + ((d - i) * Math.pow(10, Math.ceil(Math.log10(f)))) / f; }),
    def("DOLLARFR", { args: [N, N] }, (ctx, d, f) => { f = Math.trunc(f); if (f < 0) return NUM_ERR("DOLLARFR fraction negative."); if (f === 0) return DIV_ERR("DOLLARFR fraction 0."); const i = Math.trunc(d); return i + ((d - i) * f) / Math.pow(10, Math.ceil(Math.log10(f))); }),
  ];
}

export { VAL_ERR, ERR, err, isErr };
