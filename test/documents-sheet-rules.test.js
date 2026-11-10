// Rules on cells (SPREADSHEET_DESIGN.md §5): conditional formatting (conditions,
// custom formulas, colour scales, priority) and data validation.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createWorkerEngine } from "../documents/sheet/worker-client.js";
import { displayOf } from "../documents/sheet/grid.js";
import { storedFromText } from "../documents/sheet/engine/binding.js";
import { compileRules, rangeFromA1, rangeToA1, scaleColor, isValid, mix, describeRule } from "../documents/sheet/rules.js";

function setup() {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  model.init({ rows: 30, cols: 6 });
  // the page's engine with no worker: the same host code, run in place
  const engine = createWorkerEngine({ makeWorker: () => null });
  connectEngine(model, engine);
  const tab = () => model.tabIds()[0];
  const info = (r, c) => { const d = displayOf(model, engine, tab(), r, c); return { text: d.text, value: d.value }; };
  const compiled = () => compileRules(model, tab(), { cellInfo: info, hits: (id) => engine.ruleHits(id) });
  const grid = () => ({ tabIdByName: () => tab(), tabName: () => "Sheet1", rowId: (t, i) => model.rowIds(t)[i], colId: (t, i) => model.colIds(t)[i], rowIndex: (t, id) => model.rowIds(t).indexOf(id), colIndex: (t, id) => model.colIds(t).indexOf(id) });
  return { ydoc, model, engine, tab, info, compiled, grid };
}

describe("ranges by id", () => {
  it("read A1, follow inserted rows, and print back", () => {
    const s = setup();
    const rg = rangeFromA1(s.model, s.tab(), "B2:C5");
    expect(rangeToA1(s.model, s.tab(), rg)).toBe("B2:C5");
    s.model.insertRows(s.tab(), 0, 3);
    expect(rangeToA1(s.model, s.tab(), rg)).toBe("B5:C8");
    expect(rangeToA1(s.model, s.tab(), rangeFromA1(s.model, s.tab(), "c:c"))).toBe("C:C");
    expect(rangeToA1(s.model, s.tab(), rangeFromA1(s.model, s.tab(), "A2:A"))).toBe("A2:A");
    expect(rangeFromA1(s.model, s.tab(), "nonsense")).toBe(null);
    expect(rangeFromA1(s.model, s.tab(), "A1:B2 junk")).toBe(null);
  });
});

describe("conditional formatting", () => {
  it("applies a condition's style, and the first matching rule wins", async () => {
    const s = setup();
    const t = s.tab();
    ["5", "50", "500", "hello"].forEach((x, i) => s.model.setInput(t, i, 0, x));
    s.model.setRule(t, null, { kind: "format", type: "single", ranges: [rangeFromA1(s.model, t, "A1:A10")], cond: { op: "gt", a: "10" }, style: { fill: "#ff0000", bold: true } });
    s.model.setRule(t, null, { kind: "format", type: "single", ranges: [rangeFromA1(s.model, t, "A1:A10")], cond: { op: "gt", a: "100" }, style: { fill: "#00ff00" } });
    await s.engine.whenIdle();
    const c = s.compiled();
    expect(c.formatAt(0, 0, s.info(0, 0))).toBe(null);
    expect(c.formatAt(1, 0, s.info(1, 0))).toEqual({ fill: "#ff0000", bold: true });
    expect(c.formatAt(2, 0, s.info(2, 0))).toEqual({ fill: "#ff0000", bold: true }); // first rule matches first
    expect(c.formatAt(1, 1, s.info(1, 1))).toBe(null); // outside the range
    // move the second rule up: now it wins for 500
    const second = s.model.rulesOf(t)[1].id;
    s.model.moveRule(t, second, -1);
    expect(s.compiled().formatAt(2, 0, s.info(2, 0))).toEqual({ fill: "#00ff00" });
  });

  it("evaluates a custom formula at each cell, relative to the range's top-left", async () => {
    const s = setup();
    const t = s.tab();
    ["10", "40", "20", "30"].forEach((x, i) => s.model.setInput(t, i + 1, 1, x));
    const f = storedFromText("=B2>AVERAGE($B$2:$B$5)", s.grid(), t);
    s.model.setRule(t, null, { kind: "format", type: "single", ranges: [rangeFromA1(s.model, t, "B2:B5")], cond: { op: "formula", f }, style: { color: "#0000ff" } });
    await s.engine.whenIdle();
    let c = s.compiled();
    expect([1, 2, 3, 4].map((r) => Boolean(c.formatAt(r, 1, s.info(r, 1))))).toEqual([false, true, false, true]);
    s.model.setInput(t, 1, 1, "100"); // the answers follow the values
    await s.engine.whenIdle();
    c = s.compiled();
    expect([1, 2, 3, 4].map((r) => Boolean(c.formatAt(r, 1, s.info(r, 1))))).toEqual([true, false, false, false]);
    s.model.insertRows(t, 0, 1); // and the rows
    await s.engine.whenIdle();
    c = s.compiled();
    expect([2, 3, 4, 5].map((r) => Boolean(c.formatAt(r, 1, s.info(r, 1))))).toEqual([true, false, false, false]);
    s.model.removeRule(t, s.model.rulesOf(t)[0].id);
    await s.engine.whenIdle();
    expect(s.engine.ruleHits(s.model.rulesOf(t)[0]?.id)).toBe(null);
  });

  it("colours a scale between its points", () => {
    const sorted = [0, 50, 100];
    const rule = { min: { type: "min", color: "#000000" }, max: { type: "max", color: "#ffffff" } };
    expect(scaleColor(rule, 0, sorted)).toBe("#000000");
    expect(scaleColor(rule, 100, sorted)).toBe("#ffffff");
    expect(scaleColor(rule, 50, sorted)).toBe("#808080");
    const three = { ...rule, mid: { type: "percentile", v: 50, color: "#ff0000" } };
    expect(scaleColor(three, 50, sorted)).toBe("#ff0000");
    expect(scaleColor(three, 25, sorted)).toBe(mix("#000000", "#ff0000", 0.5));
    expect(scaleColor(rule, "text", sorted)).toBe(null);
    expect(scaleColor({ min: { type: "num", v: 10, color: "#000000" }, max: { type: "num", v: 20, color: "#ffffff" } }, 5, sorted)).toBe("#000000");
  });
});

describe("data validation", () => {
  const v = (rule, value, text = String(value), extra) => isValid(rule, { value, text }, extra);
  it("checks values as Sheets does (blanks always pass)", () => {
    expect(v({ type: "list", items: ["Yes", "No"] }, "Yes")).toBe(true);
    expect(v({ type: "list", items: ["Yes", "No"] }, "Maybe")).toBe(false);
    expect(v({ type: "list", items: ["Yes"] }, null, "")).toBe(true);
    expect(v({ type: "range" }, "b", "b", { options: ["a", "b"] })).toBe(true);
    expect(v({ type: "checkbox" }, true)).toBe(true);
    expect(v({ type: "checkbox" }, "x")).toBe(false);
    expect(v({ type: "checkbox", checked: "Done", unchecked: "Open" }, "done")).toBe(true);
    expect(v({ type: "number", op: "between", a: "1", b: "10" }, 5)).toBe(true);
    expect(v({ type: "number", op: "between", a: "1", b: "10" }, 11)).toBe(false);
    expect(v({ type: "number", op: "gt", a: "0" }, "text")).toBe(false);
    expect(v({ type: "text", op: "email" }, "luke@example.com")).toBe(true);
    expect(v({ type: "text", op: "email" }, "not an email")).toBe(false);
    expect(v({ type: "text", op: "url" }, "example.com/page")).toBe(true);
    expect(v({ type: "text", op: "contains", a: "ab" }, "xABy")).toBe(true);
    expect(v({ type: "date", op: "valid" }, 46335)).toBe(true);
    expect(v({ type: "date", op: "valid" }, "soon")).toBe(false);
    expect(v({ type: "date", op: "between", a: "1/1/2026", b: "12/31/2026" }, 46335)).toBe(true);
    expect(v({ type: "formula" }, 3, "3", { formulaHit: false })).toBe(false);
    expect(describeRule({ type: "number", op: "between", a: "1", b: "10" })).toBe("Enter a number that is between 1 and 10");
  });

  it("finds the rule for a cell (the newest covering it) and checks it", async () => {
    const s = setup();
    const t = s.tab();
    s.model.setRule(t, null, { kind: "valid", type: "list", ranges: [rangeFromA1(s.model, t, "A1:A5")], items: ["Yes", "No"], display: "chip" });
    s.model.setRule(t, "z-later", { kind: "valid", type: "checkbox", ranges: [rangeFromA1(s.model, t, "A3")] });
    s.model.setInput(t, 0, 0, "Yes");
    s.model.setInput(t, 1, 0, "Maybe");
    s.model.setInput(t, 2, 0, "TRUE");
    await s.engine.whenIdle();
    const c = s.compiled();
    expect(c.check(0, 0, s.info(0, 0)).valid).toBe(true);
    expect(c.check(1, 0, s.info(1, 0))).toMatchObject({ valid: false, options: ["Yes", "No"] });
    expect(c.check(2, 0, s.info(2, 0))).toMatchObject({ valid: true, rule: { type: "checkbox" } });
    expect(c.check(9, 0, s.info(9, 0)).rule).toBe(null);
  });

  it("checks a custom-formula validation in the worker", async () => {
    const s = setup();
    const t = s.tab();
    const f = storedFromText("=ISEVEN(C1)", s.grid(), t);
    s.model.setRule(t, null, { kind: "valid", type: "formula", ranges: [rangeFromA1(s.model, t, "C1:C3")], f, reject: true });
    ["2", "3", "4"].forEach((x, i) => s.model.setInput(t, i, 2, x));
    await s.engine.whenIdle();
    const c = s.compiled();
    expect([0, 1, 2].map((r) => c.check(r, 2, s.info(r, 2)).valid)).toEqual([true, false, true]);
  });
});
