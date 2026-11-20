// Numeric building blocks for the statistics and financial functions
// (SPREADSHEET_DESIGN.md §3, pass C): gamma, beta, error function, the regularized
// incomplete gamma and beta functions, and a safe root finder. Standard methods
// (Lanczos, continued fractions as in Numerical Recipes), written here.

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function gammaln(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - gammaln(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
export function gamma(x) {
  if (Number.isInteger(x) && x <= 0) return NaN;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (Number.isInteger(x) && x < 171) { let r = 1; for (let i = 2; i < x; i++) r *= i; return r; }
  return Math.exp(gammaln(x));
}
export const betaln = (a, b) => gammaln(a) + gammaln(b) - gammaln(a + b);

export function erf(x) {
  // series for small |x|, continued fraction (via erfc) otherwise — ~1e-15
  const ax = Math.abs(x);
  if (ax < 2) {
    let sum = x, term = x, n = 0;
    const x2 = x * x;
    do { n++; term *= -x2 / n; sum += term / (2 * n + 1); } while (Math.abs(term / (2 * n + 1)) > 1e-17 * Math.abs(sum));
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  const r = 1 - erfc(ax);
  return x < 0 ? -r : r;
}
export function erfc(x) {
  if (x < 2) return 1 - erf(x);
  // Lentz continued fraction
  const tiny = 1e-300;
  let f = x, C = x, D = 0;
  for (let i = 1; i < 300; i++) {
    const a = i / 2;
    D = x + a * D; D = Math.abs(D) < tiny ? tiny : D; D = 1 / D;
    C = x + a / C; C = Math.abs(C) < tiny ? tiny : C;
    const delta = C * D; f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

// Regularized lower incomplete gamma P(a, x).
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = sum, n = a;
    for (let i = 0; i < 1000; i++) { n++; term *= x / n; sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-16) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  return 1 - gammaQcf(a, x);
}
function gammaQcf(a, x) {
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}
export const gammaQ = (a, x) => (x <= 0 ? 1 : x < a + 1 ? 1 - gammaP(a, x) : gammaQcf(a, x));

// Regularized incomplete beta I_x(a, b).
export function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}
function betacf(x, a, b) {
  const tiny = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

// Standard normal.
export const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
export const normCdf = (z) => 0.5 * erfc(-z / Math.SQRT2);
// Acklam's inverse with one Halley refinement step (~1e-15).
export function normInv(p) {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  let x;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= hi) { const q = p - 0.5, r = q * q; x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  for (let i = 0; i < 2; i++) { const e = normCdf(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2); x -= u / (1 + (x * u) / 2); }
  return x;
}

// Inverse of an increasing cdf on [lo, hi] by bisection (robust; ~1e-14).
export function invertCdf(cdf, p, lo, hi) {
  if (!(p > 0 && p < 1)) return NaN;
  // widen hi if needed
  let guard = 0;
  while (cdf(hi) < p && guard++ < 200) { lo = hi; hi *= 2; }
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid; else hi = mid;
    if (hi - lo <= 1e-15 * Math.max(1, Math.abs(mid))) break;
  }
  return (lo + hi) / 2;
}

// Distribution cdfs used by several functions.
export const tCdf = (t, df) => { const x = df / (df + t * t); const tail = 0.5 * betaI(x, df / 2, 0.5); return t >= 0 ? 1 - tail : tail; };
export const chisqCdf = (x, k) => gammaP(k / 2, x / 2);
export const fCdf = (x, d1, d2) => (x <= 0 ? 0 : betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2));

// Root of f near guess by Newton, falling back to secant; null if it doesn't settle.
export function solve(f, guess, { tol = 1e-10, max = 200 } = {}) {
  let x0 = guess, x1 = guess === 0 ? 0.01 : guess * 1.01 + 1e-4;
  let f0 = f(x0), f1 = f(x1);
  for (let i = 0; i < max; i++) {
    if (!Number.isFinite(f0) || !Number.isFinite(f1)) return null;
    if (Math.abs(f1) < tol) return x1;
    const d = f1 - f0;
    if (d === 0) return Math.abs(f1) < 1e-7 ? x1 : null;
    const x2 = x1 - (f1 * (x1 - x0)) / d;
    x0 = x1; f0 = f1; x1 = x2; f1 = f(x1);
    if (Math.abs(x1 - x0) < tol * Math.max(1, Math.abs(x1)) && Math.abs(f1) < 1e-6) return x1;
  }
  return Math.abs(f1) < 1e-7 ? x1 : null;
}
