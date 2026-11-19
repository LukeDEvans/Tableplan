// Deleting rows or columns at the edge of a range shrinks the range, as in Google Sheets
// (model.js deleteLines → keepRangesInPlace with shrink): formulas, rules, filters, charts
// and named ranges. A range wholly deleted becomes #REF!, not turned inside out.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { rangeFromA1, rangeToA1 } from "../documents/sheet/rules.js";

function setup() {
  const model = createSheetModel(new Y.Doc());
  const engine = createEngine({ functions: functionCatalog() });
  connectEngine(model, engine);
  model.init({ rows: 30, cols: 8 });
  const t = model.tabIds()[0];
  for (let i = 0; i < 5; i++) { model.setInput(t, i, 0, String(i + 1)); model.setInput(t, i, 1, String(10 * (i + 1))); }
  return { model, engine, t };
}

describe("deleting lines at a range's edge", () => {
  it("shrinks formula ranges from the top, the bottom and the side", () => {
    const { model, engine, t } = setup();
    model.setInput(t, 20, 3, "=SUM(A1:A5)");
    model.setInput(t, 21, 3, "=SUM(A1:B5)");
    model.setInput(t, 22, 3, "=A1");
    model.deleteRows(t, 0, 1);
    expect(model.inputText(t, 19, 3)).toBe("=SUM(A1:A4)");
    expect(engine.valueAt(t, 19, 3)).toBe(14);
    expect(model.inputText(t, 21, 3)).toBe("=#REF!"); // a single cell that went is #REF!, as in Sheets
    expect(model.inputText(t, 20, 3)).toBe("=SUM(A1:B4)");
    model.deleteRows(t, 3, 1);
    expect(model.inputText(t, 18, 3)).toBe("=SUM(A1:A3)");
    expect(model.inputText(t, 19, 3)).toBe("=SUM(A1:B3)");
    model.deleteCols(t, 1, 1);
    expect(model.inputText(t, 19, 2)).toBe("=SUM(A1:A3)");
    expect(engine.valueAt(t, 19, 2)).toBe(9);
  });
  it("a range wholly deleted becomes #REF!", () => {
    const { model, engine, t } = setup();
    model.setInput(t, 20, 3, "=SUM(A2:A3)");
    model.deleteRows(t, 1, 2);
    expect(engine.valueAt(t, 18, 3).code).toBe("#REF!");
  });
  it("shrinks rule ranges, filters, charts and named ranges; a chart anchored on a deleted row stays", () => {
    const { model, engine, t } = setup();
    model.setRule(t, null, { kind: "format", type: "single", ranges: [rangeFromA1(model, t, "A1:B5")], cond: { op: "gt", a: "1" }, style: { bold: true } });
    model.setFilter(t, "filter", rangeFromA1(model, t, "A1:B5"));
    model.setChart(t, null, { type: "column", range: rangeFromA1(model, t, "A1:B5"), pos: { row: model.rowIds(t)[4], col: model.colIds(t)[3], dx: 0, dy: 0, w: 300, h: 200 } });
    model.setName("Data", "A1:A5", t);
    model.deleteRows(t, 4, 1); // the last row of every range, and the chart's anchor row
    expect(rangeToA1(model, t, model.filterOf(t))).toBe("A1:B4");
    model.deleteRows(t, 0, 1); // the first row (for a filter, its header: the filter ends, as before)
    const rule = model.rulesOf(t)[0];
    expect(rangeToA1(model, t, rule.ranges[0])).toBe("A1:B3");
    expect(rangeToA1(model, t, model.filterOf(t))).toBe("#REF!");
    const ch = model.chartsOf(t)[0];
    expect(rangeToA1(model, t, ch.range)).toBe("A1:B3");
    expect(model.rowIds(t).indexOf(ch.pos.row)).toBe(3);
    model.setInput(t, 25, 0, "=ROWS(Data)");
    expect(engine.valueAt(t, 25, 0)).toBe(3);
  });
});
