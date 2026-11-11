// Charts (SPREADSHEET_DESIGN.md §5): what a chart is, how its data is read from the
// sheet (as Sheets guesses it: a header row names the series, a first column of text
// or dates labels the x axis), and a first guess from a selection. Pure; drawing is
// chart-svg.js, the screen chart-ui.js, storage model.js ("charts:<tab>").
//
// A chart: { type, stacked?: "none"|"stacked"|"percent", smooth?, donut?,
//   range: { top, bottom, left, right } (ids, rules.js), headers?: bool, labels?: bool
//   (first column labels the x axis), byRow?: bool (series along rows),
//   title?, subtitle?, xTitle?, yTitle?, legend?: "auto"|"none"|"top"|"bottom"|"right",
//   colors?: { [seriesIndex]: "#rrggbb" }, yMin?, yMax?, dataLabels?: bool,
//   pos: { row, col (ids of the top-left cell), dx, dy, w, h } }

import { rangeBounds } from "./rules.js";
import { isErr } from "./engine/values.js";

export const CHART_TYPES = [
  ["column", "Column"], ["column:stacked", "Stacked column"], ["column:percent", "100% stacked column"],
  ["bar", "Bar"], ["bar:stacked", "Stacked bar"], ["bar:percent", "100% stacked bar"],
  ["line", "Line"], ["line:smooth", "Smooth line"], ["area", "Area"], ["area:stacked", "Stacked area"],
  ["pie", "Pie"], ["pie:donut", "Donut"], ["scatter", "Scatter"], ["combo", "Combo (columns and a line)"],
];
// "column:stacked" ↔ { type: "column", stacked: "stacked" } and so on
export function typeKey(spec) {
  if (spec.type === "pie") return spec.donut ? "pie:donut" : "pie";
  if (spec.type === "line" && spec.smooth) return "line:smooth";
  if (["column", "bar", "area"].includes(spec.type) && spec.stacked && spec.stacked !== "none") return `${spec.type}:${spec.stacked}`;
  return spec.type;
}
export function fromTypeKey(key) {
  const [type, v] = key.split(":");
  return { type, stacked: v === "stacked" || v === "percent" ? v : "none", smooth: v === "smooth", donut: v === "donut" };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isText = (v) => typeof v === "string" && v !== "";

// The values in the chart's range as a grid (rows × columns), turned if byRow.
// cell(tab, r, c) → { value, text } as shown.
export function readGrid(model, tab, spec, cell) {
  const b = rangeBounds(model, tab, spec.range);
  if (!b) return null;
  // whole columns: stop at the last row with anything in it
  let r2 = b.r2;
  if (spec.range.bottom === null || spec.range.bottom === undefined) {
    while (r2 > b.r1) { let any = false; for (let c = b.c1; c <= b.c2 && !any; c++) { const v = cell(tab, r2, c).value; any = v !== null && v !== undefined && v !== ""; } if (any) break; r2--; }
  }
  const rows = [];
  for (let r = b.r1; r <= Math.min(r2, b.r1 + 5000); r++) { const row = []; for (let c = b.c1; c <= Math.min(b.c2, b.c1 + 200); c++) row.push(cell(tab, r, c)); rows.push(row); }
  if (!spec.byRow) return rows;
  return rows[0] ? rows[0].map((_, c) => rows.map((row) => row[c])) : [];
}

// Sheets' guesses, for a grid whose series run down the columns.
export function guessLayout(grid) {
  if (!grid?.length || !grid[0]?.length) return { headers: false, labels: false };
  const first = grid[0], body = grid.slice(1);
  const colIsNumeric = (c) => body.some((row) => isNum(row[c]?.value)) && body.every((row) => !isText(row[c]?.value));
  // a header row: text over at least one column of numbers
  const headers = grid.length > 1 && first.some((x, c) => isText(x.value) && colIsNumeric(c));
  // a label column: the first column holds text (or it's the only non-number column)
  const rowsBelow = headers ? body : grid;
  const labels = first.length > 1 && rowsBelow.some((row) => isText(row[0]?.value) || isErr(row[0]?.value));
  return { headers, labels };
}

// → { categories: [text], series: [{ name, values: [number|null], col }], xNumbers?: [number|null] }
export function chartData(grid, spec) {
  if (!grid?.length) return { categories: [], series: [] };
  const guess = guessLayout(grid);
  const headers = spec.headers ?? guess.headers;
  const labels = spec.type === "scatter" ? true : spec.labels ?? guess.labels;
  const head = headers ? grid[0] : null;
  const body = headers ? grid.slice(1) : grid;
  const width = grid[0].length;
  const cats = body.map((row, i) => (labels ? String(row[0]?.text ?? "") : String(i + 1)));
  const series = [];
  for (let c = labels ? 1 : 0; c < width; c++) {
    const name = head ? String(head[c]?.text || `Series ${series.length + 1}`) : `Series ${series.length + 1}`;
    const values = body.map((row) => (isNum(row[c]?.value) ? row[c].value : typeof row[c]?.value === "boolean" ? Number(row[c].value) : null));
    series.push({ name, values, col: c });
  }
  const out = { categories: cats, series };
  if (spec.type === "scatter") out.xNumbers = body.map((row) => (isNum(row[0]?.value) ? row[0].value : null));
  // drop trailing rows that are empty in every series (whole-column ranges)
  let n = cats.length;
  while (n > 0 && !cats[n - 1] && series.every((s) => s.values[n - 1] === null)) n--;
  if (n < cats.length) { out.categories = cats.slice(0, n); for (const s of series) s.values = s.values.slice(0, n); if (out.xNumbers) out.xNumbers = out.xNumbers.slice(0, n); }
  return out;
}

// A first chart for a selection: column over categories, a line over many points or
// dates, a pie for one series of a few parts.
export function guessChart(grid, { dateColumn = false } = {}) {
  const { headers, labels } = guessLayout(grid);
  const rows = grid.length - (headers ? 1 : 0);
  const nSeries = (grid[0]?.length || 0) - (labels ? 1 : 0);
  let type = "column";
  if (dateColumn || rows > 12) type = "line";
  else if (nSeries === 1 && rows >= 2 && rows <= 6) type = "pie";
  if (!labels && nSeries === 2 && rows > 3 && grid.slice(headers ? 1 : 0).every((r) => isNum(r[0]?.value))) type = "scatter";
  return { type, stacked: "none", headers, labels, legend: "auto" };
}
