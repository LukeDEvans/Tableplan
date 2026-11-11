// Pivot tables (SPREADSHEET_DESIGN.md §5): the computation, and PIVOT.TABLE in the
// engine — spilling from its corner, following its data, and its fields following
// inserted columns and sorts in the model.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { computePivot } from "../documents/sheet/pivot.js";
import { book } from "./documents-sheet-helpers.js";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { isErr } from "../documents/sheet/engine/values.js";

const T = [["Name", "Dept", "Salary", "Year"], ["Ann", "Ops", 50, 2025], ["Bob", "IT", 70, 2025], ["Cy", "ops", 55, 2026], ["Dee", "IT", 90, 2026], ["Eve", "HR", 40, 2026], ["Gus", "IT", 80, 2025], [null, null, null, null]];
const P = (s) => computePivot(T, s);

describe("computing a pivot", () => {
  it("groups rows (case folded, as Sheets), sums values and adds a grand total", () => {
    expect(P({ rows: [{ f: 1 }], values: [{ f: 2, fn: "SUM" }] })).toEqual([["Dept", "SUM of Salary"], ["HR", 40], ["IT", 240], ["Ops", 105], ["Grand Total", 385]]);
  });
  it("crosses rows with columns", () => {
    expect(P({ rows: [{ f: 1 }], cols: [{ f: 3 }], values: [{ f: 2, fn: "SUM" }] })).toEqual([
      ["SUM of Salary", 2025, 2026, "Grand Total"], ["Dept", null, null, null], ["HR", null, 40, 40], ["IT", 150, 90, 240], ["Ops", 50, 55, 105], ["Grand Total", 200, 185, 385]]);
  });
  it("nests rows with subtotals, and turns totals off", () => {
    const out = P({ rows: [{ f: 1 }, { f: 3 }], values: [{ f: 2, fn: "SUM" }] });
    expect(out.map((r) => r[0])).toEqual(["Dept", "HR", "HR Total", "IT", null, "IT Total", "Ops", null, "Ops Total", "Grand Total"]);
    const off = P({ rows: [{ f: 1, totals: false }, { f: 3 }], values: [{ f: 2, fn: "SUM" }] });
    expect(off.map((r) => r[0])).toEqual(["Dept", "HR", "IT", null, "Ops", null]);
  });
  it("summarizes, sorts by a value, filters, and shows a share of the total", () => {
    expect(P({ rows: [{ f: 1, order: "desc", sortBy: 0 }], values: [{ f: 2, fn: "AVERAGE" }] }).slice(1, 4).map((r) => r[0])).toEqual(["IT", "Ops", "HR"]);
    expect(P({ rows: [{ f: 1 }], values: [{ f: 0, fn: "COUNTA" }], filters: [{ f: 1, hide: ["IT"] }] })).toEqual([["Dept", "COUNTA of Name"], ["HR", 1], ["Ops", 2], ["Grand Total", 3]]);
    const pct = P({ rows: [{ f: 1 }], values: [{ f: 2, fn: "SUM", show: "total" }] });
    expect(pct[2][1]).toBeCloseTo(240 / 385, 12);
    expect(pct[4][1]).toBe(1);
    for (const fn of ["COUNT", "COUNTUNIQUE", "MAX", "MIN", "MEDIAN", "PRODUCT", "STDEV", "STDEVP", "VAR", "VARP"]) expect(P({ values: [{ f: 2, fn }] }).length, fn).toBe(2);
  });
  it("refuses a field outside the table", () => {
    expect(() => P({ rows: [{ f: 9 }] })).toThrow(RangeError);
  });
});

describe("PIVOT.TABLE in the engine", () => {
  const settings = JSON.stringify({ rows: [{ f: 0 }], values: [{ f: 1, fn: "SUM" }] }).replace(/"/g, '""');
  it("spills from its corner and follows its data", () => {
    const b = book();
    T.slice(0, 7).forEach((row, r) => row.forEach((v, c) => b.set(`${"ABCD"[c]}${r + 1}`, String(v))));
    b.set("F1", `=PIVOT.TABLE(A1:D7, "${settings}", B1, C1)`);
    expect([b.get("F1"), b.get("G1"), b.get("F3"), b.get("G3"), b.get("G5")]).toEqual(["Dept", "SUM of Salary", "IT", 240, 385]);
    b.set("C3", "100");
    expect(b.get("G3")).toBe(270);
    b.set("G4", "in the way");
    expect(isErr(b.get("F1")) && b.get("F1").code).toBe("#REF!");
  });
  it("is hidden from the function list but known to the engine", () => {
    expect(functionCatalog().get("PIVOT.TABLE").hidden).toBe(true);
  });
  it("keeps its fields when a column is inserted inside the source, and through a sort", () => {
    const ydoc = new Y.Doc();
    const model = createSheetModel(ydoc);
    model.init({ rows: 30, cols: 10 });
    const engine = createEngine({ functions: functionCatalog() });
    connectEngine(model, engine);
    const t = model.tabIds()[0];
    T.slice(0, 7).forEach((row, r) => row.forEach((v, c) => model.setInput(t, r, c, String(v))));
    model.setInput(t, 0, 6, `=PIVOT.TABLE(A1:D7, "${settings}", B1, C1)`);
    const col = (c) => [0, 1, 2, 3, 4].map((r) => engine.valueAt(t, r, c));
    expect(col(7)).toEqual(["SUM of Salary", 40, 240, 105, 385]);
    model.insertCols(t, 1, 1); // a new column B: Dept is now C, Salary D
    expect(model.inputText(t, 0, 7)).toMatch(/^=PIVOT\.TABLE\(A1:E7, ?".*", ?C1, ?D1\)$/);
    expect([0, 1, 2, 3, 4].map((r) => engine.valueAt(t, r, 8))).toEqual(["SUM of Salary", 40, 240, 105, 385]);
    model.sortRows(t, 1, 6, [{ col: 3, asc: true }], (r, c) => engine.valueAt(t, r, c), (a, b) => (a > b ? 1 : a < b ? -1 : 0));
    expect(model.inputText(t, 0, 7)).toMatch(/A1:E7/);
    expect(engine.valueAt(t, 4, 8)).toBe(385);
  });
});
