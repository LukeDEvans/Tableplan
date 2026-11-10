// Filters and filter views (SPREADSHEET_DESIGN.md §5): which rows hide, the value
// list, conditions, ids surviving edits, and two people filtering at once.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { displayOf } from "../documents/sheet/grid.js";
import { hiddenRows, valueList, filterBounds, passesCondition, regionAround, dateArg } from "../documents/sheet/filters.js";

const NOW = Date.UTC(2026, 10, 9, 12);

function device(update = null) {
  const ydoc = new Y.Doc();
  if (update) Y.applyUpdate(ydoc, update);
  const model = createSheetModel(ydoc);
  const engine = createEngine({ functions: functionCatalog() });
  connectEngine(model, engine);
  const tab = () => model.tabIds()[0];
  const info = (r, c) => { const d = displayOf(model, engine, tab(), r, c); return { text: d.text, value: d.value, fill: d.st.fill || null, color: d.st.color || null }; };
  return { ydoc, model, engine, tab, info };
}
const TABLE = [["Name", "Dept", "Salary"], ["Ann", "Ops", "50"], ["Bob", "IT", "70"], ["Cy", "Ops", "55"], ["Dee", "IT", "90"], ["Eve", "HR", "40"], ["", "", ""], ["Gus", "IT", "=40*2"]];
function withTable() {
  const d = device();
  d.model.init({ rows: 30, cols: 6 });
  TABLE.forEach((row, r) => row.forEach((x, c) => x && d.model.setInput(d.tab(), r, c, x)));
  return d;
}
function makeFilter(d, owner = "filter") {
  const t = d.tab(), rows = d.model.rowIds(t), cols = d.model.colIds(t);
  d.model.setFilter(t, owner, { top: rows[0], bottom: null, left: cols[0], right: cols[2] });
  return { t, rows, cols };
}
const hidden = (d, owner = "filter") => [...hiddenRows(d.model, d.tab(), d.model.filterOf(d.tab(), owner), d.info, { now: NOW })].sort((a, b) => a - b);

describe("a filter", () => {
  it("covers the header row down to the last filled row", () => {
    const d = withTable();
    makeFilter(d);
    expect(filterBounds(d.model, d.tab(), d.model.filterOf(d.tab()))).toEqual({ r1: 0, r2: 7, c1: 0, c2: 2 });
  });

  it("with a set bottom, grows only as rows are filled in right below it", () => {
    const d = withTable();
    const t = d.tab(), rows = d.model.rowIds(t), cols = d.model.colIds(t);
    d.model.setFilter(t, "filter", { top: rows[0], bottom: rows[5], left: cols[0], right: cols[2] });
    expect(filterBounds(d.model, t, d.model.filterOf(t)).r2).toBe(5); // row 6 is empty; Gus in row 7 is past the gap
    d.model.setInput(t, 6, 0, "Fay");
    expect(filterBounds(d.model, t, d.model.filterOf(t)).r2).toBe(7); // filling the gap joins Gus too
    d.model.setInput(t, 20, 1, "far away");
    expect(filterBounds(d.model, t, d.model.filterOf(t)).r2).toBe(7);
  });

  it("hides rows by value, including blanks, and shows the rest", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    d.model.setCriteria(t, "filter", cols[1], { hide: ["IT", ""] });
    expect(hidden(d)).toEqual([2, 4, 6, 7]);
    d.model.setCriteria(t, "filter", cols[1], null);
    expect(hidden(d)).toEqual([]);
  });

  it("hides rows by condition, on computed values too", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    d.model.setCriteria(t, "filter", cols[2], { cond: { op: "gte", a: "70" } });
    expect(hidden(d)).toEqual([1, 3, 5, 6]); // Gus's =40*2 is 80, kept
    d.model.setCriteria(t, "filter", cols[2], { cond: { op: "between", a: "60", b: "45" } });
    expect(hidden(d)).toEqual([2, 4, 5, 6, 7]);
  });

  it("combines columns: a row shows only if every column lets it through", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    d.model.setCriteria(t, "filter", cols[1], { hide: ["HR", ""] });
    d.model.setCriteria(t, "filter", cols[0], { cond: { op: "starts", a: "c" } });
    expect(hidden(d)).toEqual([1, 2, 4, 5, 6, 7]);
  });

  it("lists a column's values with counts, from rows the other columns let through", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    let list = valueList(d.model, t, d.model.filterOf(t), 1, d.info, { now: NOW });
    expect(list.map((x) => [x.text, x.count, x.shown])).toEqual([["HR", 1, true], ["IT", 3, true], ["Ops", 2, true], ["", 1, true]]);
    d.model.setCriteria(t, "filter", cols[2], { cond: { op: "gt", a: "60" } });
    d.model.setCriteria(t, "filter", cols[1], { hide: ["HR"] });
    list = valueList(d.model, t, d.model.filterOf(t), 1, d.info, { now: NOW });
    expect(list.map((x) => [x.text, x.count, x.shown])).toEqual([["HR", 0, false], ["IT", 3, true]]);
    // numbers sort by value, blanks last
    const nums = valueList(d.model, t, d.model.filterOf(t), 2, d.info, { now: NOW });
    expect(nums.map((x) => x.text)).toEqual(["50", "55", "70", "80", "90", ""]); // its own condition is left out; HR (40) hidden by Dept
  });

  it("filters by fill colour", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    d.model.setStyle(t, 2, 0, 3, 0, { fill: "#ffff00" });
    d.model.setCriteria(t, "filter", cols[0], { color: { fill: "#FFFF00" } });
    expect(hidden(d)).toEqual([1, 4, 5, 6, 7]);
  });

  it("keeps working through inserted and deleted rows (ids, not positions)", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    d.model.setCriteria(t, "filter", cols[1], { hide: ["IT"] });
    d.model.insertRows(t, 0, 2); // above the header
    expect(filterBounds(d.model, t, d.model.filterOf(t)).r1).toBe(2);
    expect(hidden(d)).toEqual([4, 6, 9]);
    d.model.deleteRows(t, 2, 1); // the header row itself
    expect(filterBounds(d.model, t, d.model.filterOf(t))).toBe(null);
    expect(hidden(d)).toEqual([]);
  });

  it("merges two people filtering different columns at the same time", () => {
    const a = withTable();
    const { t, cols } = makeFilter(a);
    const b = device(Y.encodeStateAsUpdate(a.ydoc));
    a.model.setCriteria(t, "filter", cols[1], { hide: ["HR"] });
    b.model.setCriteria(t, "filter", cols[2], { cond: { op: "lt", a: "80" } });
    const ua = Y.encodeStateAsUpdate(a.ydoc), ub = Y.encodeStateAsUpdate(b.ydoc);
    Y.applyUpdate(a.ydoc, ub); Y.applyUpdate(b.ydoc, ua);
    expect(hidden(a)).toEqual(hidden(b));
    expect(hidden(a)).toEqual([4, 5, 6, 7]);
  });
});

describe("filter views", () => {
  it("start from the tab's filter and change only themselves", () => {
    const d = withTable();
    const { t, cols } = makeFilter(d);
    d.model.setCriteria(t, "filter", cols[1], { hide: ["HR"] });
    const v = d.model.newFilterView(t, d.model.filterOf(t));
    expect(d.model.filterViews(t)).toEqual([{ id: v, name: "Filter 1" }]);
    expect(hidden(d, v)).toEqual([5]);
    d.model.setCriteria(t, v, cols[1], { hide: ["HR", "Ops"] });
    expect(hidden(d, v)).toEqual([1, 3, 5]);
    expect(hidden(d)).toEqual([5]); // the shared filter didn't change
    d.model.setFilter(t, v, { ...d.model.filterOf(t, v), name: "Ops out" });
    expect(d.model.filterViews(t)[0].name).toBe("Ops out");
    d.model.removeFilter(t, v);
    expect(d.model.filterViews(t)).toEqual([]);
    expect(d.model.filterOf(t, v)).toBe(null);
    expect(hidden(d)).toEqual([5]);
  });
});

describe("conditions", () => {
  const c = (op, a, b, value, text = String(value ?? "")) => passesCondition({ op, a, b }, { value, text }, NOW);
  it("text, numbers and dates as Sheets has them", () => {
    expect(c("contains", "PP", null, "apple")).toBe(true);
    expect(c("textIs", "Apple", null, "apple")).toBe(true);
    expect(c("empty", null, null, null)).toBe(true);
    expect(c("notEmpty", null, null, "")).toBe(false);
    expect(c("gt", "5", null, "text")).toBe(false); // text isn't greater than a number
    expect(c("eq", "5", null, 5)).toBe(true);
    expect(c("ne", "abc", null, "ABC")).toBe(false);
    expect(c("gt", "", null, 3)).toBe(true); // nothing typed yet hides nothing
    const today = dateArg("today", NOW);
    expect(c("dateIs", "today", null, today + 0.5)).toBe(true);
    expect(c("dateBefore", "11/9/2026", null, today - 1)).toBe(true);
    expect(c("dateAfter", "tomorrow", null, today + 1)).toBe(false);
  });
  it("finds the data region around a cell", () => {
    const filled = (r, c) => r >= 2 && r <= 5 && c >= 1 && c <= 3 && !(r === 4 && c === 2);
    expect(regionAround(filled, 3, 2, 50, 10)).toEqual({ r1: 2, r2: 5, c1: 1, c2: 3 });
  });
});
