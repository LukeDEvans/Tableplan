// Slides: charts and tables linked to spreadsheets (SLIDES_DESIGN.md §6).

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { sheetYdoc } from "../documents/sheet/host.js";
import { rangeFromA1 } from "../documents/sheet/rules.js";
import { docToContent } from "../documents/editor/doc-model.js";
import { createSlidesModel } from "../documents/slides/model.js";
import { openSheetReader, computeLink, refreshLinks, cleanChartCache, cleanSrc } from "../documents/slides/linked.js";

function sheetFile() {
  const { ydoc, model } = sheetYdoc({ tables: [{ name: "Budget", rows: [["Month", "Food", "Gas"], ["Jan", "300", "80"], ["Feb", "320", "=B3/4"], ["Mar", "290", "90"]] }] });
  const tab = model.tabIds()[0];
  const chart = model.setChart(tab, null, { type: "column", title: "Spending", range: rangeFromA1(model, tab, "A1:C4") });
  const files = new Map([["s1", { content: docToContent(ydoc) }]]);
  return { ydoc, model, tab, chart, files, sheets: { list: async () => [{ id: "s1", name: "Budget" }], open: async (id) => ({ loadContent: async () => files.get(id).content }) } };
}

describe("linked charts and tables", () => {
  it("reads a chart with the spreadsheet's computed values", async () => {
    const f = sheetFile();
    const r = await openSheetReader(await f.sheets.open("s1"));
    const res = computeLink(r, { tab: f.tab, chart: f.chart });
    expect(res.kind).toBe("chart");
    expect(res.cache.spec.title).toBe("Spending");
    expect(res.cache.data.categories).toEqual(["Jan", "Feb", "Mar"]);
    expect(res.cache.data.series.map((s) => s.name)).toEqual(["Food", "Gas"]);
    expect(res.cache.data.series[1].values).toEqual([80, 80, 90]); // =B3/4 worked out
    r.close();
  });
  it("reads a range as a table with formatting", async () => {
    const f = sheetFile();
    const r = await openSheetReader(await f.sheets.open("s1"));
    const res = computeLink(r, { tab: f.tab, range: rangeFromA1(f.model, f.tab, "A1:C3") });
    expect(res.rows.map((row) => row.map((c) => c.text))).toEqual([["Month", "Food", "Gas"], ["Jan", "300", "80"], ["Feb", "320", "80"]]);
    expect(res.rows[1][1].align).toBe("right");
  });
  it("refreshes a slide's linked chart and table when the spreadsheet changes, following moved rows", async () => {
    const f = sheetFile();
    const m = createSlidesModel(new Y.Doc());
    m.init();
    const sid = m.slideIds()[0];
    const r0 = await openSheetReader(await f.sheets.open("s1"));
    const src = { file: "s1", tab: f.tab, chart: f.chart, name: "Budget" };
    const cid = m.addItem(sid, { t: "chart", src, cache: computeLink(r0, src).cache });
    const tsrc = { file: "s1", tab: f.tab, range: rangeFromA1(f.model, f.tab, "A1:B4"), name: "Budget" };
    const tid = m.addItem(sid, { t: "table", rows: 1, cols: 1, src: tsrc });
    m.setTableText(sid, tid, computeLink(r0, tsrc).rows);
    expect(m.item(sid, tid).rows).toBe(4);
    // nothing changed yet
    expect((await refreshLinks(m, f.sheets)).updated).toBe(0);
    // edit the spreadsheet: a new row above the data, and a new number
    f.model.insertRows(f.tab, 0, 1);
    f.model.setInput(f.tab, 2, 1, "999");
    f.files.get("s1").content = docToContent(f.ydoc);
    const res = await refreshLinks(m, f.sheets);
    expect(res.updated).toBe(2);
    expect(m.item(sid, cid).cache.data.series[0].values).toEqual([999, 320, 290]);
    expect(m.item(sid, tid).cells["1.1"].text).toBe("999");
    expect(m.item(sid, tid).cells["0.0"].text).toBe("Month");
  });
  it("keeps what it showed when the spreadsheet can't be read", async () => {
    const m = createSlidesModel(new Y.Doc());
    m.init();
    const sid = m.slideIds()[0];
    const cache = { spec: { type: "pie" }, data: { categories: ["a"], series: [{ name: "x", values: [1] }] } };
    const id = m.addItem(sid, { t: "chart", src: { file: "gone", tab: "t1", chart: "c1" }, cache });
    const res = await refreshLinks(m, { open: async () => { throw new Error("no"); } });
    expect(res).toEqual({ updated: 0, failed: 1 });
    expect(m.item(sid, id).cache).toEqual(cache);
  });
  it("checks what a shared presentation stores", () => {
    const c = cleanChartCache({ spec: { type: "evil", title: 5, colors: { 0: "red", 1: "#123456" }, onload: "x" }, data: { categories: [1, "<b>"], series: [{ name: "s", values: [1, "2", NaN, null] }] } });
    expect(c.spec).toEqual({ type: "column", colors: { 1: "#123456" } });
    expect(c.data.categories).toEqual(["1", "<b>"]);
    expect(c.data.series[0].values).toEqual([1, null, null, null]);
    expect(cleanSrc({ file: "a/../b", tab: "t", chart: "c" })).toBeNull();
    expect(cleanSrc({ file: "f1", tab: "t1", range: { top: "r1", bottom: null, left: "c1", right: "c2" } })).toMatchObject({ range: { bottom: null } });
  });
});
