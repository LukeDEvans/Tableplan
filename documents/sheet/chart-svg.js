// Drawing a chart as SVG (SPREADSHEET_DESIGN.md §5). Pure: chart data (charts.js) and
// a spec in, an SVG string out. Our own renderer (no chart library), following the
// house chart rules: categorical colours in a fixed order with separate light and dark
// steps, thin marks (bars ≤ 24px with a 4px rounded data end, square at the baseline;
// 2px lines; ≥ 8px dots with a 2px surface ring), a 2px surface gap between touching
// fills, a quiet grid, a legend for two or more series, one y axis (never two), text in
// text colours (never a series colour). Every mark carries data-tip for hover tooltips.
//
//   renderChart(data, spec, { w, h, theme: { surface, ink, muted, grid, dark } }) → "<svg …>"

export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const OTHER = { light: "#8a8986", dark: "#77766f" }; // past eight series: "Other" grey, never a new hue

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const safeColor = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const r1 = (n) => Math.round(n * 10) / 10;
// text on a coloured mark: near-black on light fills, white on dark ones
function onColor(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? "#0b0b0b" : "#ffffff";
}

export function seriesColor(i, spec, dark) {
  return safeColor(spec.colors?.[i]) || (dark ? PALETTE.dark : PALETTE.light)[i] || (dark ? OTHER.dark : OTHER.light);
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function fmtNum(n, percent = false) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  if (percent) return `${plain.format(n)}%`;
  return Math.abs(n) >= 10000 ? compact.format(n) : plain.format(n);
}

// Round axis ends and a step of 1, 2, 2.5 or 5 × 10^k, about `count` ticks.
export function niceScale(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 0.2 };
  if (lo === hi) { if (lo === 0) return { min: 0, max: 1, step: 0.2 }; const d = Math.abs(lo) * 0.5; lo -= d; hi += d; if (lo > 0 && lo - d < 0) lo = 0; }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
}

// a bar with a 4px rounded end away from the baseline
function barPath(x, y, w, h, end) {
  if (w <= 0 || h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  switch (end) {
    case "top": return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h)}Z`;
    case "bottom": return `M${r1(x)},${r1(y)}V${r1(y + h - r)}Q${r1(x)},${r1(y + h)} ${r1(x + r)},${r1(y + h)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w)},${r1(y + h - r)}V${r1(y)}Z`;
    case "right": { const rr = Math.min(4, h / 2, w); return `M${r1(x)},${r1(y)}H${r1(x + w - rr)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + rr)}V${r1(y + h - rr)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w - rr)},${r1(y + h)}H${r1(x)}Z`; }
    case "left": { const rr = Math.min(4, h / 2, w); return `M${r1(x + w)},${r1(y)}H${r1(x + rr)}Q${r1(x)},${r1(y)} ${r1(x)},${r1(y + rr)}V${r1(y + h - rr)}Q${r1(x)},${r1(y + h)} ${r1(x + rr)},${r1(y + h)}H${r1(x + w)}Z`; }
    default: return `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
  }
}

// a smooth line through points (monotone in x, so it never overshoots between points)
function smoothPath(pts) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${r1(p[0])},${r1(p[1])}`).join("");
  const n = pts.length, dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
  m[0] = dy[0]; m[n - 1] = dy[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r1(pts[i][0] + h)},${r1(pts[i][1] + m[i] * h)} ${r1(pts[i + 1][0] - h)},${r1(pts[i + 1][1] - m[i + 1] * h)} ${r1(pts[i + 1][0])},${r1(pts[i + 1][1])}`;
  }
  return d;
}
// runs of points without gaps (a missing value breaks a line)
function runs(points) {
  const out = []; let cur = [];
  for (const p of points) { if (p) cur.push(p); else if (cur.length) { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}
const textW = (s, size = 11) => String(s).length * size * 0.56;
function fit(s, width, size = 11) {
  s = String(s ?? "");
  if (textW(s, size) <= width) return s;
  const n = Math.max(1, Math.floor(width / (size * 0.56)) - 1);
  return `${s.slice(0, n)}…`;
}

export function renderChart(data, spec, { w = 480, h = 300, theme = {} } = {}) {
  const T = { surface: "#fcfcfb", ink: "#0b0b0b", muted: "#52514e", grid: "#e4e3df", dark: false, ...theme };
  const dark = !!T.dark;
  const font = `font-family="Arial, Helvetica, sans-serif"`;
  const parts = [];
  const type = spec.type || "column";
  const pct = spec.stacked === "percent" && ["column", "bar", "area"].includes(type);
  const stacked = spec.stacked && spec.stacked !== "none" && ["column", "bar", "area"].includes(type);
  const series = (data.series || []).filter((s) => s.values.some((v) => v !== null));
  const cats = data.categories || [];
  const color = (i) => seriesColor(i, spec, dark);
  const P = 12;
  let top = P;

  // titles
  if (spec.title) { parts.push(`<text x="${P}" y="${top + 13}" font-size="14" font-weight="600" fill="${T.ink}" ${font}>${esc(fit(spec.title, w - 2 * P, 14))}</text>`); top += 20; }
  if (spec.subtitle) { parts.push(`<text x="${P}" y="${top + 11}" font-size="12" fill="${T.muted}" ${font}>${esc(fit(spec.subtitle, w - 2 * P, 12))}</text>`); top += 17; }
  if (spec.title || spec.subtitle) top += 10; // the top tick label is centred on its line

  const empty = (msg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(spec.title || "Chart")}"><rect width="${w}" height="${h}" fill="${T.surface}"/>${parts.join("")}<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="12" fill="${T.muted}" ${font}>${esc(msg)}</text></svg>`;
  if (!series.length) return empty("No numbers in the chart's range");

  // legend: series (or slices for a pie); for two or more, unless turned off
  const isPie = type === "pie";
  const legendItems = isPie ? cats.map((c, i) => ({ name: c || `(${i + 1})`, color: color(i) })) : series.map((s, i) => ({ name: s.name, color: color(i) }));
  let legendPos = spec.legend || "auto";
  if (legendPos === "auto") legendPos = legendItems.length >= 2 ? (isPie ? "right" : "top") : "none";
  if (legendPos === "right" && w < 360) legendPos = "bottom";
  let right = w - P, bottom = h - P;
  const legend = [];
  if (legendPos === "top" || legendPos === "bottom") {
    let x = P, y = 0, rowsH = 16;
    for (const it of legendItems) {
      const label = fit(it.name, 140);
      const iw = 14 + textW(label) + 14;
      if (x + iw > w - P && x > P) { x = P; y += 16; rowsH += 16; }
      legend.push({ x, y, label, color: it.color });
      x += iw;
    }
    const y0 = legendPos === "top" ? top + 2 : h - P - rowsH + 4;
    for (const l of legend) parts.push(`<rect x="${l.x}" y="${y0 + l.y + 1}" width="10" height="10" rx="2" fill="${l.color}"/><text x="${l.x + 14}" y="${y0 + l.y + 10}" font-size="11" fill="${T.ink}" ${font}>${esc(l.label)}</text>`);
    if (legendPos === "top") top += rowsH + 6; else bottom -= rowsH + 4;
  } else if (legendPos === "right") {
    const lw = Math.min(150, Math.max(...legendItems.map((it) => 16 + textW(fit(it.name, 130)))));
    let y = top + 4;
    for (const it of legendItems.slice(0, Math.floor((h - top - P) / 16))) {
      parts.push(`<rect x="${w - P - lw}" y="${y + 1}" width="10" height="10" rx="2" fill="${it.color}"/><text x="${w - P - lw + 14}" y="${y + 10}" font-size="11" fill="${T.ink}" ${font}>${esc(fit(it.name, 130))}</text>`);
      y += 16;
    }
    right -= lw + 10;
  }

  // ---- pie / donut ----------------------------------------------------------------------
  if (isPie) {
    const vals = (series[0].values || []).map((v) => (v > 0 ? v : 0));
    const total = vals.reduce((a, b) => a + b, 0);
    if (!total) return empty("No positive numbers to show");
    const cx = (P + right) / 2, cy = (top + bottom) / 2, R = Math.max(10, Math.min(right - P, bottom - top) / 2 - 2), hole = spec.donut ? R * 0.58 : 0;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!v) return;
      const frac = v / total, a2 = a + frac * Math.PI * 2;
      const large = a2 - a > Math.PI ? 1 : 0;
      const p = (ang, rad) => `${r1(cx + rad * Math.cos(ang))},${r1(cy + rad * Math.sin(ang))}`;
      const d = frac >= 0.9999
        ? (hole ? `M${p(0, R)}A${R},${R} 0 1 1 ${p(Math.PI, R)}A${R},${R} 0 1 1 ${p(0, R)}M${p(0, hole)}A${hole},${hole} 0 1 0 ${p(Math.PI, hole)}A${hole},${hole} 0 1 0 ${p(0, hole)}Z` : `M${p(0, R)}A${R},${R} 0 1 1 ${p(Math.PI, R)}A${R},${R} 0 1 1 ${p(0, R)}Z`)
        : hole ? `M${p(a, R)}A${R},${R} 0 ${large} 1 ${p(a2, R)}L${p(a2, hole)}A${hole},${hole} 0 ${large} 0 ${p(a, hole)}Z` : `M${cx},${cy}L${p(a, R)}A${R},${R} 0 ${large} 1 ${p(a2, R)}Z`;
      const tip = `${cats[i] || `(${i + 1})`}: ${fmtNum(series[0].values[i])} (${plain.format(frac * 100)}%)`;
      parts.push(`<path d="${d}" fill="${color(i)}" stroke="${T.surface}" stroke-width="2" stroke-linejoin="round" data-tip="${esc(tip)}"/>`);
      // a share label on big slices only
      if (frac >= 0.06 && R > 50) { const mid = (a + a2) / 2, lr = hole ? (R + hole) / 2 : R * 0.64; parts.push(`<text x="${r1(cx + lr * Math.cos(mid))}" y="${r1(cy + lr * Math.sin(mid) + 4)}" text-anchor="middle" font-size="11" fill="${onColor(color(i))}" ${font} pointer-events="none">${Math.round(frac * 100)}%</text>`); }
      a = a2;
    });
    return wrap();
  }

  // ---- axes ------------------------------------------------------------------------------
  const horizontal = type === "bar";
  const scatter = type === "scatter";
  // value range
  let lo = Infinity, hi = -Infinity;
  if (stacked) {
    cats.forEach((_, i) => {
      let pos = 0, neg = 0;
      series.forEach((s) => { const v = s.values[i]; if (v > 0) pos += v; else if (v < 0) neg += v; });
      if (pct) { const t = pos - neg; if (t) { pos = (pos / t) * 100; neg = (neg / t) * 100; } }
      lo = Math.min(lo, neg); hi = Math.max(hi, pos);
    });
  } else for (const s of series) for (const v of s.values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (["column", "bar", "area", "combo"].includes(type) || stacked) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (pct) { lo = Math.min(lo, 0); hi = Math.max(hi, 100); if (hi > 100) hi = 100; }
  const yUser = { min: Number.isFinite(Number(spec.yMin)) && spec.yMin !== "" && spec.yMin !== null && spec.yMin !== undefined ? Number(spec.yMin) : null, max: Number.isFinite(Number(spec.yMax)) && spec.yMax !== "" && spec.yMax !== null && spec.yMax !== undefined ? Number(spec.yMax) : null };
  const ys = niceScale(yUser.min ?? lo, yUser.max ?? hi);
  if (yUser.min !== null) ys.min = yUser.min;
  if (yUser.max !== null) ys.max = yUser.max;
  if (ys.max <= ys.min) ys.max = ys.min + 1;
  let xs = null;
  if (scatter) {
    const xv = (data.xNumbers || []).filter((v) => v !== null);
    xs = niceScale(Math.min(...xv), Math.max(...xv));
  }

  // room for labels and axis titles
  const yTicks = []; for (let v = ys.min; v <= ys.max + ys.step * 1e-6 && yTicks.length < 20; v += ys.step) yTicks.push(Math.abs(v) < ys.step * 1e-9 ? 0 : v);
  const valueLabelW = Math.max(...yTicks.map((v) => textW(fmtNum(v, pct)))) + 8;
  const catLabelW = Math.min(110, Math.max(20, ...cats.map((c) => textW(fit(c, 110))))) + 8;
  let left = P + (spec.yTitle ? 18 : 0) + (horizontal ? catLabelW : valueLabelW);
  bottom -= 18 + (spec.xTitle ? 18 : 0);
  right -= 4;
  if (right - left < 40 || bottom - top < 30) return empty("Make the chart bigger to see it");
  const PW = right - left, PH = bottom - top;

  // value → pixel along the value axis (y for columns, x for bars)
  const vpos = horizontal ? (v) => left + ((v - ys.min) / (ys.max - ys.min)) * PW : (v) => bottom - ((v - ys.min) / (ys.max - ys.min)) * PH;
  const clampV = (v) => Math.max(ys.min, Math.min(ys.max, v));
  const base = vpos(clampV(0));

  // grid + value labels
  for (const v of yTicks) {
    const p = vpos(v);
    if (horizontal) {
      parts.push(`<line x1="${r1(p)}" y1="${top}" x2="${r1(p)}" y2="${bottom}" stroke="${T.grid}" stroke-width="1"/>`);
      parts.push(`<text x="${r1(p)}" y="${bottom + 14}" text-anchor="middle" font-size="11" fill="${T.muted}" ${font}>${esc(fmtNum(v, pct))}</text>`);
    } else {
      parts.push(`<line x1="${left}" y1="${r1(p)}" x2="${right}" y2="${r1(p)}" stroke="${T.grid}" stroke-width="1"/>`);
      parts.push(`<text x="${left - 6}" y="${r1(p + 4)}" text-anchor="end" font-size="11" fill="${T.muted}" ${font}>${esc(fmtNum(v, pct))}</text>`);
    }
  }
  // category positions
  const n = cats.length || 1;
  const band = (horizontal ? PH : PW) / n;
  const cpos = (i) => (horizontal ? top : left) + band * (i + 0.5);
  const xpos = scatter ? (v) => left + ((v - xs.min) / (xs.max - xs.min || 1)) * PW : null;
  if (scatter) {
    for (let v = xs.min; v <= xs.max + xs.step * 1e-6; v += xs.step) parts.push(`<text x="${r1(xpos(v))}" y="${bottom + 14}" text-anchor="middle" font-size="11" fill="${T.muted}" ${font}>${esc(fmtNum(v))}</text>`);
  } else {
    // category labels, thinned so they don't collide
    const every = Math.max(1, Math.ceil((horizontal ? 14 : 44) / Math.max(1, band)));
    cats.forEach((c, i) => {
      if (i % every) return;
      if (horizontal) parts.push(`<text x="${left - 6}" y="${r1(cpos(i) + 4)}" text-anchor="end" font-size="11" fill="${T.muted}" ${font}>${esc(fit(c, catLabelW - 8))}</text>`);
      else parts.push(`<text x="${r1(cpos(i))}" y="${bottom + 14}" text-anchor="middle" font-size="11" fill="${T.muted}" ${font}>${esc(fit(c, band * every - 4))}</text>`);
    });
  }
  // the baseline
  if (horizontal) parts.push(`<line x1="${r1(base)}" y1="${top}" x2="${r1(base)}" y2="${bottom}" stroke="${T.muted}" stroke-width="1"/>`);
  else parts.push(`<line x1="${left}" y1="${r1(base)}" x2="${right}" y2="${r1(base)}" stroke="${T.muted}" stroke-width="1"/>`);
  // axis titles
  if (spec.xTitle) parts.push(`<text x="${r1((left + right) / 2)}" y="${r1(bottom + 32)}" text-anchor="middle" font-size="11" fill="${T.muted}" ${font}>${esc(fit(spec.xTitle, PW))}</text>`);
  if (spec.yTitle) parts.push(`<text transform="translate(${P + 10},${r1((top + bottom) / 2)}) rotate(-90)" text-anchor="middle" font-size="11" fill="${T.muted}" ${font}>${esc(fit(spec.yTitle, PH))}</text>`);

  const tipFor = (i) => `${cats[i] ?? ""}${series.map((s) => `\n${s.name}: ${s.values[i] === null ? "—" : fmtNum(s.values[i])}`).join("")}`;
  const labelText = (x, y, v, anchor = "middle") => (spec.dataLabels && v !== null ? `<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" font-size="10" fill="${T.muted}" ${font} pointer-events="none">${esc(fmtNum(v))}</text>` : "");

  // ---- bars and columns ------------------------------------------------------------------
  const barSeries = type === "combo" ? series.slice(0, Math.max(1, series.length - 1)) : ["column", "bar"].includes(type) ? series : [];
  if (barSeries.length) {
    const groups = stacked ? 1 : barSeries.length;
    const thick = Math.max(2, Math.min(24, (band * 0.72 - 2 * (groups - 1)) / groups));
    cats.forEach((_, i) => {
      let pos = 0, neg = 0;
      const total = pct ? barSeries.reduce((t, s) => t + Math.abs(s.values[i] || 0), 0) : 0;
      // the outermost segment each way gets the rounded end
      const lastPos = stacked ? barSeries.map((s, k) => [s.values[i], k]).filter(([v]) => v > 0).pop()?.[1] : null;
      const lastNeg = stacked ? barSeries.map((s, k) => [s.values[i], k]).filter(([v]) => v < 0).pop()?.[1] : null;
      barSeries.forEach((s, k) => {
        let v = s.values[i];
        if (v === null || v === 0) return;
        if (pct) v = total ? (v / total) * 100 : 0;
        let from, to;
        if (stacked) { if (v > 0) { from = pos; to = pos += v; } else { from = neg; to = neg += v; } }
        else { from = 0; to = v; }
        let a = vpos(clampV(from)), b = vpos(clampV(to));
        const offset = stacked ? -thick / 2 : -((groups * thick + 2 * (groups - 1)) / 2) + k * (thick + 2);
        const c = cpos(i) + offset;
        const outer = !stacked || (v > 0 ? k === lastPos : k === lastNeg);
        const tip = `${cats[i] ?? ""}\n${s.name}: ${fmtNum(s.values[i])}${pct ? ` (${plain.format(v)}%)` : ""}`;
        // stacked segments keep a 2px surface gap between them (1px off each touching end)
        const dir = Math.sign(b - a) || 1;
        if (stacked && from !== 0) a += dir;
        if (stacked && !outer) b -= dir;
        const lo2 = Math.min(a, b), len = Math.abs(b - a);
        const end = !outer ? "none" : horizontal ? (v > 0 ? "right" : "left") : v > 0 ? "top" : "bottom";
        const d = horizontal ? barPath(lo2, c, len, thick, end) : barPath(c, lo2, thick, len, end);
        if (d) parts.push(`<path d="${d}" fill="${color(series.indexOf(s))}" data-tip="${esc(tip)}"/>`);
        if (!stacked) parts.push(horizontal ? labelText(Math.max(a, b) + 4, c + thick / 2 + 3, s.values[i], "start") : labelText(c + thick / 2, Math.min(a, b) - 4, s.values[i]));
      });
    });
  }

  // ---- lines and areas --------------------------------------------------------------------
  const lineSeries = type === "combo" ? series.slice(-1) : ["line", "area"].includes(type) ? series : [];
  if (lineSeries.length) {
    const stackBase = cats.map(() => 0);
    const totals = cats.map((_, i) => lineSeries.reduce((t, s) => t + Math.abs(s.values[i] || 0), 0));
    const layers = [];
    lineSeries.forEach((s) => {
      const idx = series.indexOf(s);
      const lowerArr = stackBase.slice();
      const pts = s.values.map((v, i) => {
        if (v === null) return null;
        let val = v;
        if (stacked) { if (pct) val = totals[i] ? (v / totals[i]) * 100 : 0; val = stackBase[i] += val; }
        return [cpos(i), vpos(clampV(val))];
      });
      layers.push({ s, idx, pts, lower: lowerArr.map((v) => vpos(clampV(v))) });
    });
    if (type === "area") {
      // fills first (lowest layer last for stacks so the 2px edge reads as a gap)
      for (const L of layers) for (const run of runs(L.pts.map((p, i) => (p ? [...p, i] : null)))) {
        const upper = run.map(([x, y]) => [x, y]);
        const lowerPts = stacked ? run.map(([x, , i]) => [x, L.lower[i]]).reverse() : [[run[run.length - 1][0], base], [run[0][0], base]];
        const d = `${(spec.smooth ? smoothPath(upper) : upper.map((p, k) => `${k ? "L" : "M"}${r1(p[0])},${r1(p[1])}`).join(""))}L${lowerPts.map((p) => `${r1(p[0])},${r1(p[1])}`).join("L")}Z`;
        parts.push(`<path d="${d}" fill="${color(L.idx)}" fill-opacity="${stacked ? 0.85 : 0.22}" pointer-events="none"/>`);
      }
    }
    for (const L of layers) {
      for (const run of runs(L.pts)) {
        const d = spec.smooth ? smoothPath(run) : run.map((p, k) => `${k ? "L" : "M"}${r1(p[0])},${r1(p[1])}`).join("");
        if (stacked && type === "area") parts.push(`<path d="${d}" fill="none" stroke="${T.surface}" stroke-width="2" pointer-events="none"/>`);
        else parts.push(`<path d="${d}" fill="none" stroke="${color(L.idx)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`);
      }
      // dots only when there are few points; a lone point always (it has no line)
      const few = cats.length <= 16 && !(stacked && type === "area");
      L.pts.forEach((p, i) => {
        if (!p) return;
        const alone = !L.pts[i - 1] && !L.pts[i + 1];
        if (few || alone) parts.push(`<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="4" fill="${color(L.idx)}" stroke="${T.surface}" stroke-width="2" pointer-events="none"/>`);
        parts.push(labelText(p[0], p[1] - 8, L.s.values[i]));
      });
    }
    // a hover band per category with every series' value (a crosshair readout)
    if (type !== "combo") cats.forEach((_, i) => parts.push(`<rect x="${r1(cpos(i) - band / 2)}" y="${top}" width="${r1(band)}" height="${PH}" fill="transparent" data-tip="${esc(tipFor(i))}" data-cross="${r1(cpos(i))}"/>`));
    else lineSeries.forEach((s) => s.values.forEach((v, i) => { if (v !== null) parts.push(`<circle cx="${r1(cpos(i))}" cy="${r1(vpos(clampV(v)))}" r="8" fill="transparent" data-tip="${esc(`${cats[i] ?? ""}\n${s.name}: ${fmtNum(v)}`)}"/>`); }));
  }

  // ---- scatter ----------------------------------------------------------------------------
  if (scatter) {
    series.forEach((s, k) => s.values.forEach((v, i) => {
      const x = data.xNumbers?.[i];
      if (v === null || x === null || x === undefined) return;
      const tip = `${s.name}\nx: ${fmtNum(x)}, y: ${fmtNum(v)}`;
      parts.push(`<circle cx="${r1(xpos(x))}" cy="${r1(vpos(clampV(v)))}" r="4" fill="${color(k)}" stroke="${T.surface}" stroke-width="2" data-tip="${esc(tip)}"/>`);
    }));
  }

  return wrap();

  function wrap() {
    const label = spec.title || `${type} chart`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><rect width="${w}" height="${h}" fill="${T.surface}"/>${parts.join("")}</svg>`;
  }
}
