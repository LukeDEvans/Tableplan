// Charts (SPREADSHEET_DESIGN.md §5): reading a range as Sheets does, the first guess,
// drawing every type (no broken numbers, the house mark rules), and storage by id.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { displayOf } from "../documents/sheet/grid.js";
import { readGrid, chartData, guessLayout, guessChart, typeKey, fromTypeKey, CHART_TYPES } from "../documents/sheet/charts.js";
import { renderChart, niceScale, fmtNum, seriesColor, PALETTE } from "../documents/sheet/chart-svg.js";
import { rangeFromA1, rangeToA1 } from "../documents/sheet/rules.js";

function setup(rows) {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  model.init({ rows: 40, cols: 8 });
  const engine = createEngine({ functions: functionCatalog() });
  connectEngine(model, engine);
  const t = model.tabIds()[0];
  rows.forEach((row, r) => row.forEach((x, c) => x !== "" && model.setInput(t, r, c, x)));
  const cell = (tab, r, c) => { const d = displayOf(model, engine, tab, r, c); return { value: d.value, text: d.text }; };
  return { model, engine, t, cell };
}
const TABLE = [["Month", "Food", "Fuel"], ["Jan", "420", "90"], ["Feb", "380", "110"], ["Mar", "=400+55", ""]];

describe("reading a chart's range", () => {
  it("takes the header row as series names and the first column as labels", () => {
    const s = setup(TABLE);
    const spec = { type: "column", range: rangeFromA1(s.model, s.t, "A1:C4") };
    const grid = readGrid(s.model, s.t, spec, s.cell);
    expect(guessLayout(grid)).toEqual({ headers: true, labels: true });
    const d = chartData(grid, spec);
    expect(d.categories).toEqual(["Jan", "Feb", "Mar"]);
    expect(d.series.map((x) => [x.name, x.values])).toEqual([["Food", [420, 380, 455]], ["Fuel", [90, 110, null]]]);
  });
  it("switches rows and columns, and follows the person's choices over the guess", () => {
    const s = setup(TABLE);
    const spec = { type: "column", range: rangeFromA1(s.model, s.t, "A1:C4"), byRow: true };
    const d = chartData(readGrid(s.model, s.t, spec, s.cell), spec);
    expect(d.categories).toEqual(["Food", "Fuel"]);
    expect(d.series.map((x) => x.name)).toEqual(["Jan", "Feb", "Mar"]);
    const noHead = { type: "column", range: rangeFromA1(s.model, s.t, "B2:C4"), headers: false, labels: false };
    expect(chartData(readGrid(s.model, s.t, noHead, s.cell), noHead).series.map((x) => x.name)).toEqual(["Series 1", "Series 2"]);
  });
  it("stops a whole-column range at the last filled row", () => {
    const s = setup(TABLE);
    const spec = { type: "line", range: rangeFromA1(s.model, s.t, "A:C") };
    expect(chartData(readGrid(s.model, s.t, spec, s.cell), spec).categories).toEqual(["Jan", "Feb", "Mar"]);
  });
  it("guesses a sensible first chart", () => {
    const g = (rows) => rows.map((r) => r.map((v) => ({ value: v, text: String(v ?? "") })));
    expect(guessChart(g([["Kind", "Count"], ["A", 1], ["B", 2], ["C", 3]])).type).toBe("pie");
    expect(guessChart(g([["Kind", "x", "y"], ["A", 1, 2], ["B", 2, 3]])).type).toBe("column");
    expect(guessChart(g([["Day", "n"], ...Array.from({ length: 20 }, (_, i) => [`d${i}`, i])])).type).toBe("line");
    expect(guessChart(g([["x", "y"], [1, 2], [2, 4], [3, 5], [4, 9], [5, 11]])).type).toBe("scatter");
  });
  it("names chart types both ways", () => {
    for (const [k] of CHART_TYPES) expect(typeKey({ ...fromTypeKey(k) })).toBe(k);
  });
});

describe("drawing", () => {
  const data = { categories: ["Jan", "Feb", "Mar"], series: [{ name: "Food <&>", values: [420, -40, 455] }, { name: "Fuel", values: [90, 110, null] }] };
  it("draws every type with no broken numbers, and escapes names", () => {
    for (const [k] of CHART_TYPES) {
      const spec = { ...fromTypeKey(k), title: "Spend \"2026\"", xTitle: "Month", yTitle: "$", dataLabels: true };
      const svg = renderChart(k === "scatter" ? { ...data, xNumbers: [1, 2, 3] } : data, spec, { w: 420, h: 260 });
      expect(svg, k).toMatch(/^<svg /);
      expect(svg, k).not.toMatch(/NaN|undefined|Infinity/);
      expect(svg, k).not.toContain("<&>");
    }
  });
  it("keeps bars thin with rounded ends, and lines 2px", () => {
    const wide = { categories: ["A", "B"], series: [{ name: "x", values: [1, 2] }] };
    const svg = renderChart(wide, { type: "column" }, { w: 900, h: 300 });
    const widths = [...svg.matchAll(/<path d="M([\d.]+),[\d.]+V[\d.]+Q[\d.]+,[\d.]+ [\d.]+,[\d.]+H([\d.]+)/g)].map((m) => Number(m[2]) - Number(m[1]));
    expect(widths.length).toBe(2);
    for (const w of widths) expect(w + 4).toBeLessThanOrEqual(24.1); // the path's H ends where the 4px right corner starts
    expect(renderChart(wide, { type: "line" }, { w: 400, h: 240 })).toContain('stroke-width="2"');
  });
  it("uses the palette in order, the dark steps on dark, and the person's colours", () => {
    expect(seriesColor(0, {}, false)).toBe(PALETTE.light[0]);
    expect(seriesColor(1, {}, true)).toBe(PALETTE.dark[1]);
    expect(seriesColor(2, { colors: { 2: "#123456" } }, false)).toBe("#123456");
    expect(seriesColor(2, { colors: { 2: "red\" onclick=x" } }, false)).toBe(PALETTE.light[2]);
    expect(seriesColor(9, {}, false)).not.toBe(PALETTE.light[1]); // never cycled
  });
  it("one series: no legend box; two: a legend", () => {
    const one = renderChart({ categories: ["A"], series: [{ name: "Only", values: [1] }] }, { type: "column" }, { w: 400, h: 240 });
    expect(one).not.toContain(">Only<");
    expect(renderChart(data, { type: "column" }, { w: 400, h: 240 })).toContain(">Fuel<");
  });
  it("rounds axes", () => {
    expect(niceScale(0, 455)).toEqual({ min: 0, max: 500, step: 100 });
    expect(niceScale(-40, 455).min).toBe(-100);
    expect(fmtNum(12500)).toBe("12.5K");
    expect(fmtNum(25, true)).toBe("25%");
  });
});

describe("storage", () => {
  it("keeps charts by id; a sort leaves the range and the chart's place alone", () => {
    const s = setup([["n"], ["3"], ["1"], ["2"]]);
    const rows = s.model.rowIds(s.t), cols = s.model.colIds(s.t);
    const id = s.model.setChart(s.t, null, { type: "column", range: rangeFromA1(s.model, s.t, "A1:A4"), pos: { row: rows[2], col: cols[3], dx: 0, dy: 0, w: 300, h: 200 } });
    s.model.sortRows(s.t, 1, 3, [{ col: 0, asc: true }], (r, c) => s.engine.valueAt(s.t, r, c), (a, b) => a - b);
    const c = s.model.chartsOf(s.t).find((x) => x.id === id);
    expect(rangeToA1(s.model, s.t, c.range)).toBe("A1:A4");
    expect(s.model.rowIds(s.t).indexOf(c.pos.row)).toBe(2);
    s.model.removeChart(s.t, id);
    expect(s.model.chartsOf(s.t)).toEqual([]);
  });
});
