// Printing (SPREADSHEET_DESIGN.md §7): pages split where they should, the used range,
// fit to width, frozen rows repeated, and charts placed on their page.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { paginate, layoutPages } from "../documents/sheet/print.js";
import { rangeFromA1 } from "../documents/sheet/rules.js";

function book(rows = 200, cols = 30) {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  model.init({ rows, cols });
  const engine = createEngine({ functions: functionCatalog() });
  connectEngine(model, engine);
  return { model, engine, t: model.tabIds()[0] };
}

describe("printing", () => {
  it("splits lines into pages, a too-big line alone", () => {
    expect(paginate([10, 10, 10, 10, 10], 25)).toEqual([[0, 1], [2, 3], [4, 4]]);
    expect(paginate([10, 50, 10], 25)).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(paginate([10, 10, 10], 100, 1, 2)).toEqual([[1, 2]]);
  });
  it("prints the used range, across and down, and fits it to the width when asked", () => {
    const b = book();
    b.model.setInput(b.t, 0, 0, "Title");
    b.model.setInput(b.t, 99, 11, "corner"); // row 100, column L → 12 columns × 100 rows
    const normal = layoutPages(b.model, b.engine, { tabs: [b.t] });
    // 12 columns of 100px over a 720px-wide area → 2 across; 100 rows of 21px over 960px → 3 down
    expect(normal.pages.length).toBe(6);
    expect(normal.pages[0].html).toContain(">Title<");
    expect(normal.pages.some((p) => p.html.includes(">corner<"))).toBe(true);
    const fit = layoutPages(b.model, b.engine, { tabs: [b.t], fit: "width" });
    expect(fit.pages.length).toBeLessThan(normal.pages.length);
    expect(fit.pages[0].scale).toBeCloseTo(720 / 1200, 5);
    const land = layoutPages(b.model, b.engine, { tabs: [b.t], landscape: true });
    expect([land.pageW, land.pageH]).toEqual([1056, 816]);
  });
  it("repeats frozen rows on every page, prints formatting, and escapes text", () => {
    const b = book();
    b.model.setInput(b.t, 0, 0, "Header <b>");
    b.model.setStyle(b.t, 0, 0, 0, 0, { bold: true, fill: "#ffe599" });
    for (let r = 1; r < 120; r++) b.model.setInput(b.t, r, 0, String(r));
    b.model.setTabProps(b.t, { frozenRows: 1 });
    const { pages } = layoutPages(b.model, b.engine, { tabs: [b.t], gridlines: false });
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.html).toContain("Header &lt;b&gt;");
    expect(pages[0].html).toContain("background:#ffe599");
    expect(pages[0].html).toContain("font-weight:700");
  });
  it("draws charts on the page with their top-left corner", () => {
    const b = book();
    [["k", "n"], ["a", "1"], ["b", "2"]].forEach((row, r) => row.forEach((x, c) => b.model.setInput(b.t, r, c, x)));
    const rows = b.model.rowIds(b.t), cols = b.model.colIds(b.t);
    b.model.setChart(b.t, null, { type: "column", title: "Mine", range: rangeFromA1(b.model, b.t, "A1:B3"), pos: { row: rows[4], col: cols[0], dx: 0, dy: 0, w: 300, h: 200 } });
    const { pages } = layoutPages(b.model, b.engine, { tabs: [b.t] });
    expect(pages.filter((p) => p.html.includes("<svg")).length).toBe(1);
    expect(pages[0].html).toContain(">Mine<");
  });
  it("prints just the selection", () => {
    const b = book();
    b.model.setInput(b.t, 0, 0, "outside");
    b.model.setInput(b.t, 5, 5, "inside");
    const { pages } = layoutPages(b.model, b.engine, { tabs: [b.t], range: { r1: 5, c1: 5, r2: 6, c2: 6 } });
    expect(pages.length).toBe(1);
    expect(pages[0].html).toContain(">inside<");
    expect(pages[0].html).not.toContain("outside");
  });
});

describe("printing what another device wrote", () => {
  it("never puts raw values from the shared doc into the page markup", () => {
    const b = book(20, 6);
    const evil = '"><img src=x onerror=alert(1)>';
    b.model.setInput(b.t, 0, 0, "Hello");
    b.model.setStyle(b.t, 0, 0, 0, 0, { bold: true });
    const sid = b.model.cellAt(b.t, 0, 0).s;
    b.model.ydoc.getMap("styles").set(sid, { bold: true, halign: evil, valign: evil, size: evil }); // as a tampered device would
    b.model.setChart(b.t, null, { type: "column", range: rangeFromA1(b.model, b.t, "A1:A1"), pos: { row: b.model.rowIds(b.t)[2], col: b.model.colIds(b.t)[1], dx: evil, dy: evil, w: evil, h: evil } });
    const { pages } = layoutPages(b.model, b.engine, { tabs: [b.t] });
    const html = pages.map((p) => p.html).join("");
    expect(html).toContain(">Hello<");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });
});
