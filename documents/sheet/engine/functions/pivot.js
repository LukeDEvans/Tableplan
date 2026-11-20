// PIVOT.TABLE — a pivot table as a calculation (SPREADSHEET_DESIGN.md §5). The sheet
// writes it into a pivot's corner cell; people make and change pivots in the pivot
// editor (documents/sheet/pivot-ui.js), not by typing it, so it's hidden from the
// function list. The work is documents/sheet/pivot.js.
//
//   =PIVOT.TABLE(source, settings, field1, field2, …)
//   source: the table (header row first); settings: JSON (pivot.js) whose field numbers
//   point at the field arguments; each field is the header cell of a source column, so
//   fields follow inserted, deleted and moved columns.

import { def, VAL_ERR, isRef, Matrix, err, ERR } from "./helpers.js";
import { EMPTY } from "../values.js";
import { computePivot } from "../../pivot.js";

export function pivotFunctions() {
  return [
    def("PIVOT.TABLE", { args: ["any", "text", "any"], min: 2, max: Infinity, noLift: true, hidden: true }, (ctx, source, settingsText, ...fields) => {
      if (!isRef(source)) return VAL_ERR("A pivot table needs a source range.");
      let settings;
      try { settings = JSON.parse(settingsText); } catch { return VAL_ERR("The pivot table's settings can't be read."); }
      // field n → its column within the source
      const at = fields.map((f) => (isRef(f) && f.tab === source.tab ? f.c1 - source.c1 : -1));
      if (at.some((c) => c < 0 || c >= source.w)) return err(ERR.REF, "A pivot field is outside the source range.");
      const map = (list) => (list || []).map((x) => ({ ...x, f: at[x.f] ?? -1 }));
      const m = ctx.deref(source);
      const table = m.rows.map((row) => row.map((v) => (v === EMPTY ? null : v)));
      let out;
      try { out = computePivot(table, { rows: map(settings.rows), cols: map(settings.cols), values: map(settings.values), filters: map(settings.filters) }); }
      catch (e) { if (e instanceof RangeError) return err(ERR.REF, e.message); throw e; }
      return new Matrix(out.map((row) => row.map((v) => (v === null || v === undefined ? EMPTY : v))));
    }),
  ];
}
