// Statistical distributions and tests (SPREADSHEET_DESIGN.md §3, pass C).

import { def, numbersOf, flatValues, omitted, NUM_ERR, DIV_ERR, NA_ERR, ERR, err, isErr } from "./helpers.js";
import { gamma, gammaln, erf, erfc, gammaP, betaI, normPdf, normCdf, normInv, invertCdf, tCdf, chisqCdf, fCdf, betaln } from "./special.js";

const N = "number", B = "bool";
const choose = (n, k) => Math.exp(gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sampVar = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
const bad = (name) => NUM_ERR(`Function ${name}: a value is out of range.`);

function normDist(name, x, m, s, cum) { if (s <= 0) return bad(name); const z = (x - m) / s; return cum ? normCdf(z) : normPdf(z) / s; }
function normInvF(name, p, m, s) { if (p <= 0 || p >= 1 || s <= 0) return bad(name); return m + s * normInv(p); }
function tInv(p, df) { return invertCdf((t) => tCdf(t, df), p, -1e3, 1e3); }

export function distributionFunctions() {
  return [
    ...["NORM.DIST", "NORMDIST"].map((nm) => def(nm, { args: [N, N, N, B] }, (ctx, x, m, s, c) => normDist(nm, x, m, s, c))),
    ...["NORM.INV", "NORMINV"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, p, m, s) => normInvF(nm, p, m, s))),
    def("NORM.S.DIST", { args: [N, B] }, (ctx, z, c) => (c ? normCdf(z) : normPdf(z))),
    def("NORMSDIST", { args: [N] }, (ctx, z) => normCdf(z)),
    ...["NORM.S.INV", "NORMSINV"].map((nm) => def(nm, { args: [N] }, (ctx, p) => (p <= 0 || p >= 1 ? bad(nm) : normInv(p)))),
    def("STANDARDIZE", { args: [N, N, N] }, (ctx, x, m, s) => (s <= 0 ? bad("STANDARDIZE") : (x - m) / s)),
    def("GAUSS", { args: [N] }, (ctx, z) => normCdf(z) - 0.5),
    def("PHI", { args: [N] }, (ctx, z) => normPdf(z)),
    def("ERF", { args: [N, N], min: 1, max: 2 }, (ctx, a, b) => (omitted(b) ? erf(a) : erf(b) - erf(a))),
    def("ERF.PRECISE", { args: [N] }, (ctx, a) => erf(a)),
    ...["ERFC", "ERFC.PRECISE"].map((nm) => def(nm, { args: [N] }, (ctx, a) => erfc(a))),
    def("GAMMA", { args: [N] }, (ctx, x) => { if (x < 0) return bad("GAMMA"); /* Sheets: no negatives */ const g = gamma(x); return Number.isFinite(g) ? g : bad("GAMMA"); }),
    ...["GAMMALN", "GAMMALN.PRECISE"].map((nm) => def(nm, { args: [N] }, (ctx, x) => (x <= 0 ? bad(nm) : gammaln(x)))),
    ...["GAMMA.DIST", "GAMMADIST"].map((nm) => def(nm, { args: [N, N, N, B] }, (ctx, x, a, b, c) => {
      if (x < 0 || a <= 0 || b <= 0) return bad(nm);
      return c ? gammaP(a, x / b) : Math.exp((a - 1) * Math.log(x) - x / b - gammaln(a) - a * Math.log(b));
    })),
    ...["GAMMA.INV", "GAMMAINV"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, p, a, b) => (p < 0 || p >= 1 || a <= 0 || b <= 0 ? bad(nm) : p === 0 ? 0 : invertCdf((x) => gammaP(a, x / b), p, 0, a * b * 10 + 10)))),
    ...["BINOM.DIST", "BINOMDIST"].map((nm) => def(nm, { args: [N, N, N, B] }, (ctx, k, n, p, c) => {
      k = Math.trunc(k); n = Math.trunc(n);
      if (k < 0 || k > n || p < 0 || p > 1) return bad(nm);
      const pmf = (i) => choose(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
      if (!c) return pmf(k);
      let s = 0; for (let i = 0; i <= k; i++) s += pmf(i); return Math.min(1, s);
    })),
    ...["BINOM.INV", "CRITBINOM"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, n, p, a) => {
      n = Math.trunc(n);
      if (n < 0 || p < 0 || p > 1 || a <= 0 || a >= 1) return bad(nm);
      let s = 0;
      for (let k = 0; k <= n; k++) { s += choose(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k); if (s >= a - 1e-12) return k; }
      return n;
    })),
    ...["NEGBINOM.DIST", "NEGBINOMDIST"].map((nm) => def(nm, { args: [N, N, N, B], min: 3, max: 4 }, (ctx, f, s, p, c) => {
      f = Math.trunc(f); s = Math.trunc(s);
      if (f < 0 || s < 1 || p < 0 || p > 1) return bad(nm);
      const pmf = (i) => choose(i + s - 1, i) * Math.pow(p, s) * Math.pow(1 - p, i);
      if (omitted(c) || !c) return pmf(f);
      let t = 0; for (let i = 0; i <= f; i++) t += pmf(i); return t;
    })),
    ...["HYPGEOM.DIST", "HYPGEOMDIST"].map((nm) => def(nm, { args: [N, N, N, N, B], min: 4, max: 5 }, (ctx, k, n, K, Np, c) => {
      [k, n, K, Np] = [k, n, K, Np].map(Math.trunc);
      if (k < 0 || n < 0 || K < 0 || Np < 0 || n > Np || K > Np || k > n || k > K) return bad(nm);
      const pmf = (i) => (choose(K, i) * choose(Np - K, n - i)) / choose(Np, n);
      if (omitted(c) || !c) return pmf(k);
      let t = 0; for (let i = Math.max(0, n - Np + K); i <= k; i++) t += pmf(i); return t;
    })),
    ...["POISSON.DIST", "POISSON"].map((nm) => def(nm, { args: [N, N, B] }, (ctx, k, l, c) => {
      k = Math.trunc(k);
      if (k < 0 || l < 0) return bad(nm);
      return c ? 1 - gammaP(k + 1, l) : Math.exp(k * Math.log(l) - l - gammaln(k + 1));
    })),
    ...["EXPON.DIST", "EXPONDIST"].map((nm) => def(nm, { args: [N, N, B] }, (ctx, x, l, c) => (x < 0 || l <= 0 ? bad(nm) : c ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x)))),
    ...["WEIBULL.DIST", "WEIBULL"].map((nm) => def(nm, { args: [N, N, N, B] }, (ctx, x, a, b, c) => (x < 0 || a <= 0 || b <= 0 ? bad(nm) : c ? 1 - Math.exp(-Math.pow(x / b, a)) : (a / Math.pow(b, a)) * Math.pow(x, a - 1) * Math.exp(-Math.pow(x / b, a))))),
    ...["LOGNORM.DIST", "LOGNORMDIST"].map((nm) => def(nm, { args: [N, N, N, B], min: 3, max: 4 }, (ctx, x, m, s, c) => {
      if (x <= 0 || s <= 0) return bad(nm);
      const z = (Math.log(x) - m) / s;
      return omitted(c) || c ? normCdf(z) : normPdf(z) / (x * s);
    })),
    ...["LOGNORM.INV", "LOGINV"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, p, m, s) => (p <= 0 || p >= 1 || s <= 0 ? bad(nm) : Math.exp(m + s * normInv(p))))),
    ...["BETA.DIST", "BETADIST"].map((nm) => def(nm, { args: [N, N, N, B, N, N], min: 3, max: 6 }, (ctx, x, a, b, c, lo, hi) => {
      lo = omitted(lo) ? 0 : lo; hi = omitted(hi) ? 1 : hi;
      if (a <= 0 || b <= 0 || x < lo || x > hi || lo === hi) return bad(nm);
      const y = (x - lo) / (hi - lo);
      if (nm === "BETADIST" || omitted(c) || c) return betaI(y, a, b);
      return Math.exp((a - 1) * Math.log(y) + (b - 1) * Math.log(1 - y) - betaln(a, b)) / (hi - lo);
    })),
    ...["BETA.INV", "BETAINV"].map((nm) => def(nm, { args: [N, N, N, N, N], min: 3, max: 5 }, (ctx, p, a, b, lo, hi) => {
      lo = omitted(lo) ? 0 : lo; hi = omitted(hi) ? 1 : hi;
      if (p <= 0 || p > 1 || a <= 0 || b <= 0) return bad(nm);
      return lo + (hi - lo) * invertCdf((y) => betaI(y, a, b), p === 1 ? 1 - 1e-16 : p, 0, 1);
    })),
    def("T.DIST", { args: [N, N, B] }, (ctx, t, df, c) => {
      if (df < 1) return bad("T.DIST");
      if (c) return tCdf(t, df);
      return Math.exp(gammaln((df + 1) / 2) - gammaln(df / 2)) / Math.sqrt(df * Math.PI) * Math.pow(1 + (t * t) / df, -(df + 1) / 2);
    }),
    def("T.DIST.2T", { args: [N, N] }, (ctx, t, df) => (t < 0 || df < 1 ? bad("T.DIST.2T") : 2 * (1 - tCdf(t, df)))),
    def("T.DIST.RT", { args: [N, N] }, (ctx, t, df) => (df < 1 ? bad("T.DIST.RT") : 1 - tCdf(t, df))),
    def("TDIST", { args: [N, N, N] }, (ctx, t, df, tails) => { df = Math.trunc(df); tails = Math.trunc(tails); if (t < 0 || df < 1 || (tails !== 1 && tails !== 2)) return bad("TDIST"); return tails * (1 - tCdf(t, df)); }),
    def("T.INV", { args: [N, N] }, (ctx, p, df) => (p <= 0 || p >= 1 || df < 1 ? bad("T.INV") : tInv(p, Math.trunc(df)))),
    ...["T.INV.2T", "TINV"].map((nm) => def(nm, { args: [N, N] }, (ctx, p, df) => (p <= 0 || p > 1 || df < 1 ? bad(nm) : Math.abs(tInv(p / 2, Math.trunc(df)))))),
    def("CHISQ.DIST", { args: [N, N, B] }, (ctx, x, k, c) => {
      if (x < 0 || k < 1) return bad("CHISQ.DIST");
      k = Math.trunc(k);
      return c ? chisqCdf(x, k) : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.log(2) - gammaln(k / 2));
    }),
    ...["CHISQ.DIST.RT", "CHIDIST"].map((nm) => def(nm, { args: [N, N] }, (ctx, x, k) => (x < 0 || k < 1 ? bad(nm) : 1 - chisqCdf(x, Math.trunc(k))))),
    def("CHISQ.INV", { args: [N, N] }, (ctx, p, k) => (p < 0 || p >= 1 || k < 1 ? bad("CHISQ.INV") : p === 0 ? 0 : invertCdf((x) => chisqCdf(x, Math.trunc(k)), p, 0, k * 10 + 10))),
    ...["CHISQ.INV.RT", "CHIINV"].map((nm) => def(nm, { args: [N, N] }, (ctx, p, k) => (p <= 0 || p > 1 || k < 1 ? bad(nm) : invertCdf((x) => chisqCdf(x, Math.trunc(k)), 1 - p, 0, k * 10 + 10)))),
    ...["CHISQ.TEST", "CHITEST"].map((nm) => def(nm, { args: ["matrix", "matrix"] }, (ctx, obs, exp) => {
      if (obs.h !== exp.h || obs.w !== exp.w) return NA_ERR(`${nm} ranges differ in size.`);
      let x = 0;
      for (let r = 0; r < obs.h; r++) for (let c = 0; c < obs.w; c++) { const o = obs.get(r, c), e = exp.get(r, c); if (typeof o === "number" && typeof e === "number") { if (e === 0) return DIV_ERR(`${nm} expected value 0.`); x += (o - e) ** 2 / e; } }
      const df = obs.h > 1 && obs.w > 1 ? (obs.h - 1) * (obs.w - 1) : obs.h * obs.w - 1;
      return 1 - chisqCdf(x, df);
    })),
    def("F.DIST", { args: [N, N, N, B] }, (ctx, x, d1, d2, c) => {
      if (x < 0 || d1 < 1 || d2 < 1) return bad("F.DIST");
      d1 = Math.trunc(d1); d2 = Math.trunc(d2);
      if (c) return fCdf(x, d1, d2);
      return Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - betaln(d1 / 2, d2 / 2));
    }),
    ...["F.DIST.RT", "FDIST"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, x, d1, d2) => (x < 0 || d1 < 1 || d2 < 1 ? bad(nm) : 1 - fCdf(x, Math.trunc(d1), Math.trunc(d2))))),
    def("F.INV", { args: [N, N, N] }, (ctx, p, d1, d2) => (p < 0 || p >= 1 || d1 < 1 || d2 < 1 ? bad("F.INV") : p === 0 ? 0 : invertCdf((x) => fCdf(x, Math.trunc(d1), Math.trunc(d2)), p, 0, 100))),
    ...["F.INV.RT", "FINV"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, p, d1, d2) => (p <= 0 || p > 1 || d1 < 1 || d2 < 1 ? bad(nm) : invertCdf((x) => fCdf(x, Math.trunc(d1), Math.trunc(d2)), 1 - p, 0, 100)))),
    ...["CONFIDENCE", "CONFIDENCE.NORM"].map((nm) => def(nm, { args: [N, N, N] }, (ctx, a, s, n) => (a <= 0 || a >= 1 || s <= 0 || n < 1 ? bad(nm) : (normInv(1 - a / 2) * s) / Math.sqrt(Math.trunc(n))))),
    def("CONFIDENCE.T", { args: [N, N, N] }, (ctx, a, s, n) => { n = Math.trunc(n); if (a <= 0 || a >= 1 || s <= 0 || n < 1) return bad("CONFIDENCE.T"); if (n === 1) return DIV_ERR("CONFIDENCE.T needs at least 2."); return (Math.abs(tInv(a / 2, n - 1)) * s) / Math.sqrt(n); }),
    ...["Z.TEST", "ZTEST"].map((nm) => def(nm, { args: ["any", N, N], min: 2, max: 3 }, (ctx, r, x, s) => {
      const a = numbersOf(ctx, [r]);
      if (a.length < 2 && omitted(s)) return DIV_ERR(`${nm} needs more values.`);
      const sd = omitted(s) ? Math.sqrt(sampVar(a)) : s;
      return 1 - normCdf((mean(a) - x) / (sd / Math.sqrt(a.length)));
    })),
    ...["T.TEST", "TTEST"].map((nm) => def(nm, { args: ["any", "any", N, N] }, (ctx, r1, r2, tails, type) => {
      tails = Math.trunc(tails); type = Math.trunc(type);
      if ((tails !== 1 && tails !== 2) || type < 1 || type > 3) return bad(nm);
      let t, df;
      if (type === 1) {
        const x = flatValues(ctx, r1), y = flatValues(ctx, r2);
        if (x.length !== y.length) return NA_ERR(`${nm} ranges differ in size.`);
        const d = []; x.forEach((v, i) => { if (typeof v === "number" && typeof y[i] === "number") d.push(v - y[i]); });
        if (d.length < 2) return DIV_ERR(`${nm} needs more values.`);
        df = d.length - 1; t = mean(d) / Math.sqrt(sampVar(d) / d.length);
      } else {
        const a = numbersOf(ctx, [r1]), b = numbersOf(ctx, [r2]);
        if (a.length < 2 || b.length < 2) return DIV_ERR(`${nm} needs more values.`);
        const va = sampVar(a), vb = sampVar(b), na = a.length, nb = b.length;
        if (type === 2) { df = na + nb - 2; const sp = ((na - 1) * va + (nb - 1) * vb) / df; t = (mean(a) - mean(b)) / Math.sqrt(sp * (1 / na + 1 / nb)); }
        else { const sa = va / na, sb = vb / nb; t = (mean(a) - mean(b)) / Math.sqrt(sa + sb); df = (sa + sb) ** 2 / (sa * sa / (na - 1) + sb * sb / (nb - 1)); }
      }
      const tail = 1 - tCdf(Math.abs(t), df);
      return tails * tail;
    })),
    ...["F.TEST", "FTEST"].map((nm) => def(nm, { args: ["any", "any"] }, (ctx, r1, r2) => {
      const a = numbersOf(ctx, [r1]), b = numbersOf(ctx, [r2]);
      if (a.length < 2 || b.length < 2) return DIV_ERR(`${nm} needs more values.`);
      const f = sampVar(a) / sampVar(b);
      const p = fCdf(f, a.length - 1, b.length - 1);
      return 2 * Math.min(p, 1 - p);
    })),
    def("FISHER", { args: [N] }, (ctx, x) => (x <= -1 || x >= 1 ? bad("FISHER") : 0.5 * Math.log((1 + x) / (1 - x)))),
    def("FISHERINV", { args: [N] }, (ctx, y) => Math.tanh(y)),
    def("KURT", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      const a = numbersOf(ctx, args), n = a.length;
      if (n < 4) return DIV_ERR("KURT needs at least 4 values.");
      const m = mean(a), s = Math.sqrt(sampVar(a));
      if (s === 0) return DIV_ERR("KURT of identical values.");
      const sum4 = a.reduce((t, x) => t + ((x - m) / s) ** 4, 0);
      return (n * (n + 1) * sum4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    }),
    def("SKEW", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      const a = numbersOf(ctx, args), n = a.length;
      if (n < 3) return DIV_ERR("SKEW needs at least 3 values.");
      const m = mean(a), s = Math.sqrt(sampVar(a));
      if (s === 0) return DIV_ERR("SKEW of identical values.");
      return (n / ((n - 1) * (n - 2))) * a.reduce((t, x) => t + ((x - m) / s) ** 3, 0);
    }),
    def("SKEW.P", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      const a = numbersOf(ctx, args), n = a.length;
      if (n < 1) return DIV_ERR("SKEW.P needs values.");
      const m = mean(a), s = Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / n);
      if (s === 0) return DIV_ERR("SKEW.P of identical values.");
      return a.reduce((t, x) => t + ((x - m) / s) ** 3, 0) / n;
    }),
    def("PERMUT", { args: [N, N] }, (ctx, n, k) => { n = Math.trunc(n); k = Math.trunc(k); return n < 0 || k < 0 || k > n ? bad("PERMUT") : Math.round(Math.exp(gammaln(n + 1) - gammaln(n - k + 1))); }),
    def("PERMUTATIONA", { args: [N, N] }, (ctx, n, k) => { n = Math.trunc(n); k = Math.trunc(k); return n < 0 || k < 0 ? bad("PERMUTATIONA") : Math.pow(n, k); }),
    def("PROB", { args: ["any", "any", N, N], min: 3, max: 4 }, (ctx, xs, ps, lo, hi) => {
      const x = flatValues(ctx, xs), p = flatValues(ctx, ps);
      if (x.length !== p.length) return NA_ERR("PROB ranges differ in size.");
      const total = p.reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
      if (Math.abs(total - 1) > 1e-9 || p.some((v) => typeof v === "number" && (v < 0 || v > 1))) return bad("PROB");
      const h = omitted(hi) ? lo : hi;
      let s = 0; x.forEach((v, i) => { if (typeof v === "number" && v >= lo && v <= h) s += p[i]; });
      return s;
    }),
  ];
}

export { ERR, err, isErr };
