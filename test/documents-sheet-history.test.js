// Comments and version history (SPREADSHEET_DESIGN.md §11 step 8): threads anchored to
// cells by id, restoring a version (comments kept), and which cells differ.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { docToContent, docFromContent } from "../documents/editor/doc-model.js";
import { addCellThread, cellThreads, restoreSheet, changedCells } from "../documents/sheet/history.js";
import { replyTo, setResolved } from "../documents/editor/doc-model.js";

function sheet() {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  model.init({ rows: 20, cols: 6 });
  return { ydoc, model, t: model.tabIds()[0] };
}
const me = { id: "u1", name: "Luke" };

describe("comments on cells", () => {
  it("anchor to a cell by id, follow it, and say when it's gone", () => {
    const s = sheet();
    const rows = s.model.rowIds(s.t), cols = s.model.colIds(s.t);
    addCellThread(s.ydoc, { id: "c1", tab: s.t, row: rows[3], col: cols[1], quote: "42", text: "Is this right?", user: me });
    replyTo(s.ydoc, "c1", { text: "Yes", user: { id: "u2", name: "Marijane" } });
    let [t] = cellThreads(s.ydoc, s.model);
    expect(t.cell).toEqual({ tab: s.t, row: rows[3], col: cols[1] });
    expect(t.replies.map((r) => r.text)).toEqual(["Is this right?", "Yes"]);
    s.model.insertRows(s.t, 0, 2);
    expect(s.model.rowIds(s.t).indexOf(cellThreads(s.ydoc, s.model)[0].cell.row)).toBe(5);
    setResolved(s.ydoc, "c1", true);
    expect(cellThreads(s.ydoc, s.model)[0].resolved).toBe(true);
    s.model.deleteRows(s.t, 5, 1);
    [t] = cellThreads(s.ydoc, s.model);
    expect(t.cell).toBe(null);
    expect(t.lostCell).toBe(true);
  });
});

describe("versions", () => {
  it("restore puts back cells, tabs and settings, and keeps the comments", () => {
    const s = sheet();
    s.model.setInput(s.t, 0, 0, "old");
    s.model.setInput(s.t, 1, 0, "=1+1");
    const rows = s.model.rowIds(s.t), cols = s.model.colIds(s.t);
    const saved = docToContent(s.ydoc);
    // then: edits, a new tab, a comment
    s.model.setInput(s.t, 0, 0, "new");
    s.model.clearRange(s.t, 1, 0, 1, 0);
    s.model.setInput(s.t, 5, 5, "added");
    s.model.insertRows(s.t, 0, 1);
    const t2 = s.model.addTab({ name: "Later" });
    addCellThread(s.ydoc, { id: "c1", tab: s.t, row: rows[0], col: cols[0], quote: "", text: "keep me", user: me });
    const vdoc = docFromContent(saved);
    const vmodel = createSheetModel(vdoc);
    expect([...changedCells(s.model, vmodel, s.t)].sort()).toEqual([`${rows[0]}.${cols[0]}`, `${rows[1]}.${cols[0]}`, `${rows[5]}.${cols[5]}`].sort());
    restoreSheet(s.ydoc, vdoc);
    expect(s.model.tabIds()).toEqual([s.t]);
    expect(s.model.tabIds().includes(t2)).toBe(false);
    expect(s.model.inputText(s.t, 0, 0)).toBe("old");
    expect(s.model.inputText(s.t, 1, 0)).toBe("=1+1");
    expect(s.model.inputText(s.t, 5, 5)).toBe("");
    expect(changedCells(s.model, vmodel, s.t).size).toBe(0);
    expect(cellThreads(s.ydoc, s.model).map((t) => t.replies[0].text)).toEqual(["keep me"]);
  });
  it("a restore reaches the other device as an ordinary change", () => {
    const a = sheet();
    a.model.setInput(a.t, 0, 0, "v1");
    const saved = docToContent(a.ydoc);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.ydoc));
    const bm = createSheetModel(b);
    a.model.setInput(a.t, 0, 0, "v2");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.ydoc));
    expect(bm.inputText(a.t, 0, 0)).toBe("v2");
    restoreSheet(a.ydoc, docFromContent(saved));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.ydoc));
    expect(bm.inputText(a.t, 0, 0)).toBe("v1");
  });
});
