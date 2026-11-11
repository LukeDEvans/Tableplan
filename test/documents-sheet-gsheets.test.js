// Google Sheets in (SPREADSHEET_DESIGN.md §7): the Sheets API's answer (shapes as the API
// documents them) → workbook → model, through the same writer as Excel.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { gsheetToWorkbook, styleOf, rectsOf } from "../documents/sheet/gsheets-import.js";
import { workbookIntoModel } from "../documents/sheet/xlsx-import.js";
import { cellThreads } from "../documents/sheet/history.js";
import { rangeBounds } from "../documents/sheet/rules.js";

const rgb = (r, g, b) => ({ rgbColor: { red: r / 255, green: g / 255, blue: b / 255 } });
const META = {
  properties: {
    title: "Household budget",
    defaultFormat: { textFormat: { fontFamily: "Arial", fontSize: 10 } },
    spreadsheetTheme: { themeColors: [{ colorType: "ACCENT1", color: { rgbColor: { red: 0.2588, green: 0.5216, blue: 0.9569 } } }, { colorType: "TEXT", color: { rgbColor: {} } }] },
  },
  namedRanges: [{ namedRangeId: "n1", name: "Costs", range: { sheetId: 0, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 } }],
  sheets: [
    {
      properties: { sheetId: 0, title: "Budget", index: 0, sheetType: "GRID", tabColorStyle: { themeColor: "ACCENT1" }, gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } },
      merges: [{ sheetId: 0, startRowIndex: 9, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 3 }],
      conditionalFormats: [
        { ranges: [{ sheetId: 0, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 }], booleanRule: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "1000" }] }, format: { backgroundColorStyle: rgb(244, 204, 204), textFormat: { bold: true } } } },
        { ranges: [{ sheetId: 0, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 1 }], booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: "=$C2=TRUE" }] }, format: { textFormat: { strikethrough: true } } } },
        { ranges: [{ sheetId: 0, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 3, endColumnIndex: 4 }], gradientRule: { minpoint: { colorStyle: rgb(255, 255, 255), type: "MIN" }, maxpoint: { colorStyle: rgb(87, 187, 138), type: "MAX" } } },
      ],
      basicFilter: { range: { sheetId: 0, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 3 } },
      charts: [
        { chartId: 1, spec: { title: "Costs", basicChart: { chartType: "COLUMN", legendPosition: "NO_LEGEND", headerCount: 1, axis: [{ position: "LEFT_AXIS", title: "Dollars" }], domains: [{ domain: { sourceRange: { sources: [{ sheetId: 0, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 }] } } }], series: [{ series: { sourceRange: { sources: [{ sheetId: 0, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }] } }, targetAxis: "LEFT_AXIS" }] } }, position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 1, columnIndex: 5 }, offsetXPixels: 4, widthPixels: 400, heightPixels: 250 } } },
        { chartId: 2, spec: { pieChart: { domain: { sourceRange: { sources: [{ sheetId: 1, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 }] } }, series: { sourceRange: { sources: [{ sheetId: 1, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }] } } } }, position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 20, columnIndex: 0 } } } },
      ],
    },
    { properties: { sheetId: 1, title: "Pivot 'n stuff", index: 1, sheetType: "GRID", hidden: true, gridProperties: { rowCount: 100, columnCount: 10, hideGridlines: true } } },
    { properties: { sheetId: 2, title: "Chart1", index: 2, sheetType: "OBJECT" } },
  ],
};
const v = (x) => ({ userEnteredValue: x, effectiveValue: x });
const ROWS = {
  Budget: [{
    startRow: 0, startColumn: 0,
    rowMetadata: [{ pixelSize: 32 }, { pixelSize: 21 }, { pixelSize: 21 }, { pixelSize: 21, hiddenByUser: true }],
    columnMetadata: [{ pixelSize: 180 }, { pixelSize: 100 }, { pixelSize: 100 }, { pixelSize: 100 }],
    rowData: [
      { values: [
        { ...v({ stringValue: "Item" }), userEnteredFormat: { textFormat: { bold: true, fontFamily: "Arial", fontSize: 10 }, backgroundColorStyle: rgb(255, 229, 153), borders: { bottom: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: {} } } } } },
        { ...v({ stringValue: "Cost" }), userEnteredFormat: { textFormat: { bold: true } } },
        { ...v({ stringValue: "Paid" }), note: "Tick when it's paid" },
      ] },
      { values: [v({ stringValue: "Rent" }), { ...v({ numberValue: 1200 }), userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "\"$\"#,##0.00" }, horizontalAlignment: "RIGHT" } }, { ...v({ boolValue: true }), dataValidation: { condition: { type: "BOOLEAN" } } }, v({ numberValue: 3 })] },
      { values: [v({ stringValue: "Food" }), { ...v({ numberValue: 450.5 }), userEnteredFormat: { numberFormat: { type: "NUMBER" } } }, { ...v({ boolValue: false }), dataValidation: { condition: { type: "BOOLEAN" } } }, v({ numberValue: 7 })] },
      { values: [v({ stringValue: "007" }), {}, { dataValidation: { condition: { type: "BOOLEAN" } } }, { dataValidation: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "Low" }, { userEnteredValue: "High" }] }, strict: true, showCustomUi: true } }] },
      { values: [{}, { dataValidation: { condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "='Pivot ''n stuff'!A2:A" }] }, showCustomUi: true } }] },
      { values: [{}, { userEnteredValue: { formulaValue: "=SUM(Costs)" }, effectiveValue: { numberValue: 1650.5 } }, { userEnteredValue: { formulaValue: "=SEQUENCE(2)" }, effectiveValue: { numberValue: 1 } }] },
      { values: [{}, { userEnteredValue: { formulaValue: "=NOSUCHFN((" }, effectiveValue: { errorValue: { type: "NAME", message: "x" } } }, { effectiveValue: { numberValue: 2 } }] },
      { values: [{ userEnteredValue: { formulaValue: "='Pivot ''n stuff'!B2*2" }, effectiveValue: { numberValue: 20 } }, { ...v({ numberValue: 45658 }), userEnteredFormat: { numberFormat: { type: "DATE" }, textRotation: { angle: 45 }, wrapStrategy: "WRAP", verticalAlignment: "MIDDLE", textFormat: { foregroundColorStyle: { themeColor: "ACCENT1" }, fontFamily: "Roboto", fontSize: 12 } } }] },
      {},
      { values: [v({ stringValue: "A merged note" })] },
    ],
  }],
  "Pivot 'n stuff": [{
    startRow: 0, startColumn: 0,
    rowData: [
      { values: [{ effectiveValue: { stringValue: "Item" }, pivotTable: { source: { sheetId: 0 } } }, { effectiveValue: { stringValue: "SUM of Cost" } }] },
      { values: [{ effectiveValue: { stringValue: "Food" } }, { effectiveValue: { numberValue: 10 } }] },
      { values: [{ effectiveValue: { stringValue: "Grand Total" } }, { effectiveValue: { numberValue: 1650.5 } }] },
    ],
  }],
};

function book() {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  const engine = createEngine({ functions: functionCatalog() });
  connectEngine(model, engine);
  return { ydoc, model, engine };
}

describe("reading the Sheets API's answer", () => {
  it("maps formats, colours (theme too) and borders", () => {
    const theme = { ACCENT1: "#4285f4" };
    expect(styleOf({ textFormat: { bold: true, fontFamily: "Arial", fontSize: 10, foregroundColorStyle: { themeColor: "ACCENT1" } }, backgroundColorStyle: rgb(255, 255, 255), borders: { left: { style: "DASHED", colorStyle: rgb(255, 0, 0) } } }, theme)).toEqual({ bold: true, color: "#4285f4", borderLeft: { style: "dashed", color: "#ff0000" } });
    expect(styleOf({ numberFormat: { type: "PERCENT" }, wrapStrategy: "OVERFLOW_CELL", verticalAlignment: "BOTTOM" }, theme)).toEqual({ format: "0.00%" });
  });
  it("joins cells that share a rule into rectangles", () => {
    expect(rectsOf([{ r: 1, c: 2 }, { r: 2, c: 2 }, { r: 3, c: 2 }, { r: 1, c: 3 }, { r: 2, c: 3 }, { r: 3, c: 3 }, { r: 7, c: 2 }])).toEqual([{ r1: 1, r2: 3, c1: 2, c2: 3 }, { r1: 7, r2: 7, c1: 2, c2: 2 }]);
  });
  it("lists what didn't come over", () => {
    const wb = gsheetToWorkbook(META, ROWS, { hasComments: true });
    expect(wb.sheets.map((s) => s.name)).toEqual(["Budget", "Pivot 'n stuff"]);
    expect(wb.notes.join(" ")).toMatch(/Chart1.*left out/);
    expect(wb.notes.join(" ")).toMatch(/Pivot tables came over as their values/);
    expect(wb.notes.join(" ")).toMatch(/another tab's data/);
    expect(wb.notes.join(" ")).toMatch(/Comments weren't brought over; notes were/);
    expect(wb.names).toEqual([{ name: "Costs", ref: "'Budget'!B2:B3" }]);
  });
});

describe("into a spreadsheet", () => {
  const b = book();
  const { notes } = workbookIntoModel(b.model, gsheetToWorkbook(META, ROWS));
  const [t, t2] = b.model.tabIds();
  const val = (r, c, tab = t) => b.engine.valueAt(tab, r, c);
  const st = (r, c, tab = t) => b.model.style(b.model.cellAt(tab, r, c)?.s);

  it("brings values, formulas (named ranges and other tabs too) and spills", () => {
    expect([val(0, 0), val(1, 1), val(3, 0), val(1, 2)]).toEqual(["Item", 1200, "007", true]);
    expect(val(5, 1)).toBe(1650.5);
    expect([val(5, 2), val(6, 2)]).toEqual([1, 2]); // the spill wasn't blocked by Google's value
    expect(val(7, 0)).toBe(20);
    expect(b.model.inputText(t, 7, 0)).toBe("='Pivot ''n stuff'!B2*2");
  });
  it("keeps the last value of a formula it can't read, and says so", () => {
    expect(val(6, 1).code).toBe("#NAME?");
    expect(notes.join(" ")).toMatch(/1 formula couldn't be read/);
  });
  it("brings formats, sizes, merges, frozen rows, tab colour, hidden tab and gridlines", () => {
    expect(st(0, 0)).toEqual({ bold: true, fill: "#ffe599", borderBottom: { style: "medium", color: "#000000" } });
    expect(st(1, 1)).toEqual({ format: "\"$\"#,##0.00", halign: "right" });
    expect(st(7, 1)).toEqual({ format: "m/d/yyyy", rotate: 45, wrap: "wrap", valign: "middle", color: "#4285f4", font: "Roboto", size: 12 });
    const rows = b.model.rowIds(t), cols = b.model.colIds(t);
    expect(b.model.rowMeta(t, rows[0]).h).toBe(32);
    expect(b.model.rowMeta(t, rows[1])?.h ?? null).toBe(null);
    expect(b.model.rowMeta(t, rows[3]).hidden).toBe(true);
    expect(b.model.colMeta(t, cols[0]).w).toBe(180);
    expect(b.model.mergesOf(t).length).toBe(1);
    expect(b.model.tabInfo(t)).toMatchObject({ frozenRows: 1, color: "#4285f4" });
    expect(b.model.tabInfo(t2)).toMatchObject({ hidden: true, gridlines: false });
  });
  it("brings validation: checkboxes, a list, a range on another tab", () => {
    const rules = b.model.rulesOf(t).filter((r) => r.kind === "valid");
    const box = rules.find((r) => r.type === "checkbox");
    expect(rangeBounds(b.model, t, box.ranges[0])).toMatchObject({ r1: 1, r2: 3, c1: 2, c2: 2 });
    expect(rules.find((r) => r.type === "list")).toMatchObject({ items: ["Low", "High"], reject: true, display: "chip" });
    const rg = rules.find((r) => r.type === "range");
    expect(rg.source.tab).toBe(t2);
    expect(rg.source.bottom).toBe(null);
  });
  it("brings conditional formats in order, custom formulas and colour scales included", () => {
    const f = b.model.rulesOf(t).filter((r) => r.kind === "format");
    expect(f.map((r) => (r.type === "scale" ? "scale" : r.cond.op))).toEqual(["gt", "formula", "scale"]);
    expect(f[0]).toMatchObject({ cond: { a: "1000" }, style: { fill: "#f4cccc", bold: true } });
    expect(f[1].cond.f).toBeTruthy();
    expect(f[2]).toMatchObject({ min: { type: "min", color: "#ffffff" }, max: { type: "max", color: "#57bb8a" } });
  });
  it("brings the filter's range, a chart, notes as comments and pivot values", () => {
    const flt = b.model.filterOf(t);
    expect(rangeBounds(b.model, t, flt)).toMatchObject({ r1: 0, c1: 0, c2: 2 });
    expect(flt.bottom).toBe(null);
    const charts = b.model.chartsOf(t);
    expect(charts.length).toBe(1);
    expect(charts[0]).toMatchObject({ type: "column", title: "Costs", legend: "none", headers: true, yTitle: "Dollars", pos: { dx: 4, w: 400, h: 250 } });
    expect(rangeBounds(b.model, t, charts[0].range)).toMatchObject({ r1: 0, r2: 2, c1: 0, c2: 1 });
    const th = cellThreads(b.ydoc, b.model);
    expect(th.length).toBe(1);
    expect(th[0].replies[0]).toMatchObject({ name: "Note", text: "Tick when it's paid" });
    expect([val(0, 0, t2), val(1, 1, t2), val(2, 0, t2)]).toEqual(["Item", 10, "Grand Total"]);
  });
});

describe("fetching a Google Sheets file", () => {
  it("reads each grid tab in blocks, asks for fewer rows when an answer is too large, stops at the end", async () => {
    const { googleDocsApi } = await import("../documents/editor/host.js");
    const asked = [];
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      asked.push(body);
      const ok = (data) => ({ ok: true, status: 200, json: async () => data });
      if (body.action === "sheetMeta") return ok({ meta: { properties: { title: "Big one" }, sheets: [{ properties: { sheetId: 0, title: "A", gridProperties: { rowCount: 5000 } } }, { properties: { sheetId: 9, title: "Chart", sheetType: "OBJECT" } }] }, hasComments: false });
      if (body.count > 1000) return { ok: false, status: 413, json: async () => ({ error: "too large" }) };
      if (body.start >= 2000) return ok({ data: { startRow: body.start } });
      return ok({ data: { startRow: body.start, rowData: [{ values: [{ userEnteredValue: { numberValue: body.start } }] }] } });
    };
    const api = googleDocsApi({ fetchImpl, getToken: async () => "t" });
    const wb = await api.sheet("abcdefghijkl");
    expect(asked.filter((x) => x.action === "sheetRows").map((x) => [x.start, x.count])).toEqual([[0, 2000], [0, 1000], [1000, 1000], [2000, 1000]]);
    expect(wb.title).toBe("Big one");
    expect(wb.sheets[0].cells.map((x) => [x.r, x.value])).toEqual([[0, 0], [1000, 1000]]);
  });
});
