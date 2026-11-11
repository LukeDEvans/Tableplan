// Comments and version history for spreadsheets (SPREADSHEET_DESIGN.md §5, §11 step 8).
// Comment threads are the word processor's ("comments" map, editor/doc-model.js), each
// anchored to a cell by ids, so it follows the cell through inserts and sorts. Versions
// are the session's snapshots; restoring copies the spreadsheet's own data back (the
// comments stay as they are, as in Docs), and a preview shows which cells differ.

import * as Y from "yjs";
import { addThread, listThreads } from "../editor/doc-model.js";

// ---- comments -----------------------------------------------------------------------------------

export function addCellThread(ydoc, { id, tab, row, col, quote, text, user }) {
  ydoc.transact(() => {
    addThread(ydoc, { id, quote, text, user });
    ydoc.getMap("comments").get(id)?.set("cell", { tab, row, col });
  });
}
// Threads with their cell ({ tab, row, col } or null when it was deleted).
export function cellThreads(ydoc, model) {
  const m = ydoc.getMap("comments");
  return listThreads(ydoc).map((t) => {
    const cell = m.get(t.id)?.get?.("cell") || null;
    const alive = cell && model.tabIds().includes(cell.tab) && model.rowIds(cell.tab).includes(cell.row) && model.colIds(cell.tab).includes(cell.col);
    return { ...t, cell: alive ? cell : null, lostCell: Boolean(cell && !alive) };
  });
}

// ---- versions ------------------------------------------------------------------------------------

const isArrayRoot = (name) => name === "tabs" || name.startsWith("rows:") || name.startsWith("cols:");
const KEEP = new Set(["comments"]); // not part of a restore
const plain = (v) => (v instanceof Y.AbstractType ? v.toJSON() : v);

// Makes ydoc's spreadsheet what vdoc's is, in one transaction (undo-able as one step).
export function restoreSheet(ydoc, vdoc, origin = "restore") {
  const names = new Set();
  for (const n of vdoc.share.keys()) names.add(n);
  for (const n of ydoc.share.keys()) names.add(n);
  ydoc.transact(() => {
    for (const name of names) {
      if (KEEP.has(name)) continue;
      if (isArrayRoot(name)) {
        const to = ydoc.getArray(name), from = vdoc.share.has(name) ? vdoc.getArray(name).toArray() : [];
        const cur = to.toArray();
        if (cur.length === from.length && cur.every((x, i) => x === from[i])) continue;
        if (cur.length) to.delete(0, cur.length);
        if (from.length) to.insert(0, from);
      } else {
        const to = ydoc.getMap(name), from = vdoc.share.has(name) ? vdoc.getMap(name) : null;
        for (const k of [...to.keys()]) if (!from || !from.has(k)) to.delete(k);
        if (from) for (const [k, v] of from.entries()) { const val = plain(v); if (JSON.stringify(plain(to.get(k))) !== JSON.stringify(val)) to.set(k, val); }
      }
    }
  }, origin);
}

// The cells of a tab whose contents differ between two models: "rowId.colId" keys.
export function changedCells(now, then, tab) {
  const out = new Set();
  const a = now.tabIds().includes(tab) ? now._cells(tab) : new Map();
  const b = then.tabIds().includes(tab) ? then._cells(tab) : new Map();
  const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  for (const [k, v] of b.entries()) if (!same(v, a.get(k))) out.add(k);
  for (const [k, v] of a.entries()) if (!b.has(k) && v) out.add(k);
  return out;
}
