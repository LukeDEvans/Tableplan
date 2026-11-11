// The spreadsheet's shared data (SPREADSHEET_DESIGN.md §2) and the engine bridge:
// identities, concurrent edits from two devices, sorting, styles, copy/paste.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { compare, isErr } from "../documents/sheet/engine/values.js";

function device(fromUpdate = null) {
  const ydoc = new Y.Doc();
  if (fromUpdate) Y.applyUpdate(ydoc, fromUpdate);
  const model = createSheetModel(ydoc);
  const engine = createEngine({ functions: functionCatalog(), now: () => Date.UTC(2026, 10, 9) });
  connectEngine(model, engine);
  const tab = () => model.tabIds()[0];
  const val = (r, c, t = tab()) => { const v = engine.valueAt(t, r, c); return isErr(v) ? v.code : v; };
  return { ydoc, model, engine, tab, val };
}
// Exchanges all changes both ways (as saving / the live channel does).
function sync(a, b) {
  const ua = Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc));
  const ub = Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc));
  Y.applyUpdate(b.ydoc, ua, "remote");
  Y.applyUpdate(a.ydoc, ub, "remote");
}
function twoDevices() {
  const a = device();
  a.model.init({ rows: 50, cols: 10 });
  const b = device(Y.encodeStateAsUpdate(a.ydoc));
  return { a, b };
}

describe("a workbook", () => {
  it("starts with one tab of the default size", () => {
    const { model } = device();
    model.init();
    expect(model.tabIds()).toHaveLength(1);
    expect(model.tabInfo(model.tabIds()[0]).name).toBe("Sheet1");
    expect(model.size(model.tabIds()[0])).toEqual({ rows: 1000, cols: 26 });
  });
  it("typing values, formats, formulas and errors", () => {
    const d = device(); d.model.init({ rows: 20, cols: 5 });
    const t = d.tab();
    d.model.setInput(t, 0, 0, "12%");
    d.model.setInput(t, 1, 0, "=A1*2");
    d.model.setInput(t, 2, 0, "'=not a formula");
    d.model.setInput(t, 3, 0, "=SUM(");
    expect(d.val(0, 0)).toBe(0.12);
    expect(d.model.style(d.model.cellAt(t, 0, 0).s).format).toBe("0.00%");
    expect(d.val(1, 0)).toBe(0.24);
    expect(d.val(2, 0)).toBe("=not a formula");
    expect(d.model.inputText(t, 2, 0)).toBe("'=not a formula");
    expect(d.val(3, 0)).toBe("#ERROR!");
    expect(d.model.inputText(t, 3, 0)).toBe("=SUM(");
    expect(d.model.inputText(t, 1, 0)).toBe("=A1*2");
  });
  it("tabs: names are unique, references follow renames", () => {
    const d = device(); d.model.init({ rows: 10, cols: 5 });
    const t1 = d.tab();
    const t2 = d.model.addTab({ name: "Data", rows: 10, cols: 5 });
    d.model.setInput(t2, 0, 0, "7");
    d.model.setInput(t1, 0, 0, "=Data!A1+1");
    expect(d.val(0, 0, t1)).toBe(8);
    expect(d.model.renameTab(t2, "sheet1").ok).toBe(false);
    d.model.renameTab(t2, "Numbers 2026");
    expect(d.model.inputText(t1, 0, 0)).toBe("='Numbers 2026'!A1+1");
    expect(d.val(0, 0, t1)).toBe(8);
    d.model.removeTab(t2);
    expect(d.val(0, 0, t1)).toBe("#REF!");
  });
});

describe("two devices", () => {
  it("Marijane inserts rows while Luke types further down: nothing lands in the wrong row", () => {
    const { a, b } = twoDevices();
    const t = a.tab();
    a.model.setInput(t, 9, 0, "100");
    a.model.setInput(t, 0, 1, "=A10*2");
    sync(a, b);
    b.model.insertRows(t, 2, 3);          // Marijane: three rows above
    a.model.setInput(t, 9, 1, "luke");    // Luke, at the same time: row 10, column B
    sync(a, b);
    for (const d of [a, b]) {
      expect(d.val(12, 0)).toBe(100);     // the 100 moved down with its row
      expect(d.val(12, 1)).toBe("luke");  // Luke's typing stayed beside it
      expect(d.val(0, 1)).toBe(200);
      expect(d.model.inputText(t, 0, 1)).toBe("=A13*2");
    }
  });
  it("both type in the same cell: one value wins on both", () => {
    const { a, b } = twoDevices();
    const t = a.tab();
    a.model.setInput(t, 0, 0, "1");
    b.model.setInput(t, 0, 0, "2");
    sync(a, b);
    expect(a.val(0, 0)).toBe(b.val(0, 0));
  });
  it("a sort while the other types: no row is lost or doubled", () => {
    const { a, b } = twoDevices();
    const t = a.tab();
    [5, 3, 9, 1].forEach((n, i) => a.model.setInput(t, i, 0, String(n)));
    sync(a, b);
    a.model.sortRows(t, 0, 3, [{ col: 0, asc: true }], (r, c) => a.engine.valueAt(t, r, c), compare);
    b.model.setInput(t, 0, 1, "next to five");
    sync(a, b);
    for (const d of [a, b]) {
      expect([0, 1, 2, 3].map((r) => d.val(r, 0))).toEqual([1, 3, 5, 9]);
      expect(d.val(2, 1)).toBe("next to five"); // stayed with the 5's row
      expect(d.model.size(t).rows).toBe(50);
    }
  });
  it("two sorts at once: duplicates are tidied, every row kept once", () => {
    const { a, b } = twoDevices();
    const t = a.tab();
    [5, 3, 9, 1].forEach((n, i) => a.model.setInput(t, i, 0, String(n)));
    sync(a, b);
    a.model.sortRows(t, 0, 3, [{ col: 0, asc: true }], (r, c) => a.engine.valueAt(t, r, c), compare);
    b.model.sortRows(t, 0, 3, [{ col: 0, asc: false }], (r, c) => b.engine.valueAt(t, r, c), compare);
    sync(a, b);
    expect(a.model.size(t).rows).toBe(50); // reads skip duplicates
    a.model.tidy(); b.model.tidy();
    sync(a, b);
    expect(a.model.rowIds(t)).toEqual(b.model.rowIds(t));
    expect(a.model._rows(t).length).toBe(50);
    expect(new Set([0, 1, 2, 3].map((r) => a.val(r, 0)))).toEqual(new Set([1, 3, 5, 9]));
  });
  it("deleting a row a formula uses gives #REF! on both", () => {
    const { a, b } = twoDevices();
    const t = a.tab();
    a.model.setInput(t, 4, 0, "3");
    a.model.setInput(t, 0, 0, "=A5+1");
    sync(a, b);
    b.model.deleteRows(t, 4, 1);
    sync(a, b);
    expect(a.val(0, 0)).toBe("#REF!");
    expect(a.model.inputText(t, 0, 0)).toBe("=#REF!+1");
  });
  it("offline on both sides, merged later", () => {
    const { a, b } = twoDevices();
    const t = a.tab();
    a.model.setInput(t, 0, 0, "10");
    b.model.setInput(t, 1, 0, "20");
    b.model.setInput(t, 2, 0, "=SUM(A1:A2)");
    sync(a, b);
    expect(a.val(2, 0)).toBe(30);
    expect(b.val(2, 0)).toBe(30);
  });
});

describe("styles, merges, notes, copy and paste", () => {
  it("styles are shared by content", () => {
    const d = device(); d.model.init({ rows: 10, cols: 5 });
    const t = d.tab();
    d.model.setStyle(t, 0, 0, 4, 4, { bold: true, fill: "#FFEE00", evil: "<script>" });
    const ids = new Set();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) ids.add(d.model.cellAt(t, r, c).s);
    expect(ids.size).toBe(1);
    expect(d.model.style([...ids][0])).toEqual({ bold: true, fill: "#ffee00" });
    d.model.setStyle(t, 0, 0, 0, 0, { bold: null });
    expect(d.model.style(d.model.cellAt(t, 0, 0).s)).toEqual({ fill: "#ffee00" });
  });
  it("merging keeps the top-left value", () => {
    const d = device(); d.model.init({ rows: 10, cols: 5 });
    const t = d.tab();
    d.model.setInput(t, 0, 0, "keep"); d.model.setInput(t, 0, 1, "drop");
    d.model.mergeRange(t, 0, 0, 1, 1);
    expect(d.model.mergesOf(t)).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
    expect(d.val(0, 1)).toBe(null);
    d.model.insertRows(t, 0, 1);
    expect(d.model.mergesOf(t)).toEqual([{ r1: 1, c1: 0, r2: 2, c2: 1 }]); // moves with its rows
  });
  it("paste moves the relative parts of formulas, keeps $ parts", () => {
    const d = device(); d.model.init({ rows: 10, cols: 5 });
    const t = d.tab();
    d.model.setInput(t, 0, 0, "1"); d.model.setInput(t, 1, 0, "2");
    d.model.setInput(t, 0, 1, "=A1*$A$1");
    const block = d.model.copyBlock(t, 0, 1, 0, 1);
    d.model.pasteBlock(t, 1, 1, block);
    expect(d.model.inputText(t, 1, 1)).toBe("=A2*$A$1");
    expect(d.val(1, 1)).toBe(2);
    d.model.pasteBlock(t, 0, 3, block); // two columns right
    expect(d.model.inputText(t, 0, 3)).toBe("=C1*$A$1");
    const up = d.model.copyBlock(t, 1, 1, 1, 1);
    d.model.pasteBlock(t, 0, 4, { ...up, from: { tab: t, r: 1, c: 1 } }); // pasting a formula above row 1 → #REF!
    expect(d.model.inputText(t, 0, 4)).toBe("=D1*$A$1");
  });
  it("named ranges", () => {
    const d = device(); d.model.init({ rows: 10, cols: 5 });
    const t = d.tab();
    d.model.setInput(t, 0, 0, "4"); d.model.setInput(t, 1, 0, "6");
    expect(d.model.setName("Totals", "A1:A2", t).ok).toBe(true);
    d.model.setInput(t, 0, 1, "=SUM(totals)");
    expect(d.val(0, 1)).toBe(10);
    expect(d.model.setName("A1", "A1:A2", t).ok).toBe(false);
    d.model.setName("Totals", null, t);
    expect(d.val(0, 1)).toBe("#NAME?");
  });
});
