// What the Document page needs from the spreadsheet (SPREADSHEET_DESIGN.md §10): make a
// new spreadsheet (empty, or from CSV rows), and open one. Loaded lazily by
// documents/page.js, so the spreadsheet's code is fetched only when one is made or opened.

import * as Y from "yjs";
import { createSheetModel, SHEET_MIME, DEFAULT_ROWS, DEFAULT_COLS } from "./model.js";
import { docToContent } from "../editor/doc-model.js";
import { createEverydayDocStore } from "../editor/store-everyday.js";
import { parseCsv } from "./csv.js";
import { xlsxIntoModel } from "./xlsx-import.js";

export { SHEET_MIME };

// A new spreadsheet's Y.Doc: one tab, one tab per given table of rows, or an Excel file.
export function sheetYdoc({ tables = null, xlsx = null } = {}) {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  if (xlsx) { const { notes } = xlsxIntoModel(model, xlsx); return { ydoc, model, notes }; }
  if (!tables?.length) { model.init(); return { ydoc, model }; }
  let first = true;
  for (const t of tables) {
    const rows = t.rows || [];
    const nRows = Math.max(DEFAULT_ROWS, rows.length + 50), nCols = Math.max(DEFAULT_COLS, ...rows.map((r) => r.length));
    if (first) { model.init({ tabName: t.name || "Sheet1", rows: nRows, cols: nCols }); first = false; }
    else model.addTab({ name: t.name, rows: nRows, cols: nCols });
    const tab = model.tabIds()[model.tabIds().length - 1];
    ydoc.transact(() => rows.forEach((row, i) => row.forEach((v, j) => { if (v !== "" && v !== null && v !== undefined) model.setInput(tab, i, j, String(v)); })), "import");
  }
  return { ydoc, model };
}

// Makes the file row and content; returns its id.
// onNotes(notes): what an Excel file had that didn't come over.
export async function createSheetFile({ library, scope, folderId = null, name = "Untitled spreadsheet", tables = null, xlsx = null, onNotes = null }) {
  const id = crypto.randomUUID();
  const { ydoc, model, notes } = sheetYdoc({ tables, xlsx });
  if (notes?.length) onNotes?.(notes);
  const content = docToContent(ydoc);
  await library.addFile(scope, { id, content, text: model.searchText(100_000), folderId, kind: "sheet", meta: { name, mime: SHEET_MIME, pages: 1 } });
  return id;
}

export const csvTables = (text, name) => [{ name, rows: parseCsv(text) }];

export function storeFor({ storage, transport, scope, fileId }) {
  return createEverydayDocStore({ storage, transport, scope, fileId });
}

export async function openSheetFor(opts) {
  const { openSheetEditor } = await import("./ui.js");
  return openSheetEditor(opts);
}
