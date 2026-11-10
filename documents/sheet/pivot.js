// Pivot tables (SPREADSHEET_DESIGN.md §5). Pure: a table with a header row and a
// pivot's settings in, the pivot's cells out. It runs inside the calculation engine as
// the hidden function PIVOT.TABLE (engine/functions/pivot.js), so a pivot recalculates
// with its source, spills from its corner cell, and shows #REF! when something is in
// the way — like any array formula.
//
// settings: {
//   rows:    [{ f, order?: "asc"|"desc", sortBy?: valueIndex, totals?: bool }],
//   cols:    [{ f, order?, totals? }],
//   values:  [{ f, fn: "SUM"|"COUNTA"|…, show?: "default"|"row"|"col"|"total", name? }],
//   filters: [{ f, hide: [text…] }]
// }  where f is a field: the column's number in the source (0 = its first column).

import { isErr } from "./engine/values.js";

export const SUMMARIZE = ["SUM", "COUNTA", "COUNT", "COUNTUNIQUE", "AVERAGE", "MAX", "MIN", "MEDIAN", "PRODUCT", "STDEV", "STDEVP", "VAR", "VARP"];
export const SHOW_AS = [["default", "Default"], ["row", "% of row"], ["col", "% of column"], ["total", "% of grand total"]];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const blank = (v) => v === null || v === undefined || v === "";
// how a value is named in a pivot (and in a filter's value list)
export const keyText = (v) => (blank(v) ? "" : isErr(v) ? v.code : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
// grouping folds case, as Sheets does
const groupKey = (v) => (typeof v === "string" ? `s:${v.toLowerCase()}` : isNum(v) ? `n:${v}` : `o:${keyText(v)}`);

function aggregate(fn, vals) {
  const nums = vals.filter(isNum);
  const n = nums.length;
  const mean = () => nums.reduce((a, b) => a + b, 0) / n;
  const ss = () => { const m = mean(); return nums.reduce((a, b) => a + (b - m) ** 2, 0); };
  switch (fn) {
    case "SUM": return n ? nums.reduce((a, b) => a + b, 0) : 0;
    case "COUNTA": return vals.filter((v) => !blank(v)).length;
    case "COUNT": return n;
    case "COUNTUNIQUE": return new Set(vals.filter((v) => !blank(v)).map(groupKey)).size;
    case "AVERAGE": return n ? mean() : null;
    case "MAX": return n ? Math.max(...nums) : 0;
    case "MIN": return n ? Math.min(...nums) : 0;
    case "MEDIAN": { if (!n) return null; const s = [...nums].sort((a, b) => a - b); return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
    case "PRODUCT": return n ? nums.reduce((a, b) => a * b, 1) : 0;
    case "STDEV": return n > 1 ? Math.sqrt(ss() / (n - 1)) : null;
    case "STDEVP": return n ? Math.sqrt(ss() / n) : null;
    case "VAR": return n > 1 ? ss() / (n - 1) : null;
    case "VARP": return n ? ss() / n : null;
    default: return null;
  }
}

const fnLabel = (fn) => fn;
export const valueLabel = (v, headers) => v.name || `${fnLabel(v.fn || "SUM")} of ${headers[v.f] ?? `Column ${v.f + 1}`}`;

function compareKeys(a, b) {
  if (blank(a) !== blank(b)) return blank(a) ? 1 : -1; // blanks last
  if (isNum(a) && isNum(b)) return a - b;
  if (isNum(a) !== isNum(b)) return isNum(a) ? -1 : 1;
  return keyText(a).localeCompare(keyText(b), undefined, { numeric: true, sensitivity: "base" });
}

// table: rows of values, the first being headers. → rows of output values (null = empty).
export function computePivot(table, settings) {
  const headers = (table[0] || []).map((h) => keyText(h));
  const width = headers.length;
  const S = { rows: [], cols: [], values: [], filters: [], ...settings };
  const bad = [...S.rows, ...S.cols, ...S.values, ...S.filters].find((x) => !(Number.isInteger(x?.f) && x.f >= 0 && x.f < width));
  if (bad) throw new RangeError("A pivot field is outside the source range.");
  // filters drop rows first
  let data = table.slice(1).filter((row) => row.some((v) => !blank(v)));
  for (const flt of S.filters) {
    const hide = new Set((flt.hide || []).map(String));
    if (hide.size) data = data.filter((row) => !hide.has(keyText(row[flt.f])));
  }
  const values = S.values.length ? S.values : [];
  const k = values.length;

  // group keys along rows and columns (a path of values per level)
  const level = (fields) => {
    const tree = new Map(); // key → { value, kids: Map, rows: [] }
    for (const row of data) {
      let node = { kids: tree };
      for (const fd of fields) {
        const v = row[fd.f], gk = groupKey(v);
        if (!node.kids.has(gk)) node.kids.set(gk, { value: blank(v) ? null : v, kids: new Map(), rows: [] });
        node = node.kids.get(gk);
        node.rows.push(row);
      }
    }
    return tree;
  };
  const rowTree = level(S.rows), colTree = level(S.cols);

  // the totals each group is sorted by (by a value's grand total, or by its key)
  const cellValue = (rows, vi) => aggregate(values[vi].fn || "SUM", rows.map((r) => r[values[vi].f]));
  const sortKids = (map, fd) => {
    const list = [...map.values()];
    const dir = fd.order === "desc" ? -1 : 1;
    if (Number.isInteger(fd.sortBy) && values[fd.sortBy]) list.sort((a, b) => dir * ((cellValue(a.rows, fd.sortBy) ?? -Infinity) - (cellValue(b.rows, fd.sortBy) ?? -Infinity)));
    else list.sort((a, b) => dir * compareKeys(a.value, b.value));
    return list;
  };

  // flatten the row tree into output lines: { path, rows, kind: "item"|"subtotal" }
  const rowLines = [];
  const walkRows = (map, depth, path) => {
    for (const node of sortKids(map, S.rows[depth])) {
      const p = [...path, node.value];
      if (depth === S.rows.length - 1) rowLines.push({ path: p, rows: node.rows, kind: "item" });
      else {
        walkRows(node.kids, depth + 1, p);
        if (S.rows[depth].totals !== false) rowLines.push({ path: p, rows: node.rows, kind: "subtotal", depth });
      }
    }
  };
  if (S.rows.length) walkRows(rowTree, 0, []);
  const rowGrand = !S.rows.length || S.rows[0].totals !== false;

  const colCombos = [];
  const walkCols = (map, depth, path) => {
    for (const node of sortKids(map, S.cols[depth])) {
      const p = [...path, node.value];
      if (depth === S.cols.length - 1) colCombos.push({ path: p, rows: node.rows });
      else walkCols(node.kids, depth + 1, p);
    }
  };
  if (S.cols.length) walkCols(colTree, 0, []);
  const colGrand = S.cols.length > 0 && S.cols[0].totals !== false;

  // a set of rows → in which column combo (for the body)
  const inCombo = (row, combo) => S.cols.every((fd, i) => groupKey(row[fd.f]) === groupKey(combo.path[i]));
  const columns = []; // { combo|null (grand), vi }
  for (const combo of colCombos) for (let vi = 0; vi < k; vi++) columns.push({ combo, vi });
  if (colGrand || !S.cols.length) for (let vi = 0; vi < k; vi++) columns.push({ combo: null, vi });

  const nRowFields = Math.max(1, S.rows.length);
  const out = [];
  // header rows: one per column grouping (its keys over their columns), then one naming
  // the row groupings and the values; with one value, its name sits in the corner
  const valueNames = values.map((v) => valueLabel(v, headers));
  for (let j = 0; j < S.cols.length; j++) {
    const line = Array(nRowFields).fill(null);
    if (j === 0 && k === 1) line[0] = valueNames[0];
    let prev = null;
    for (const col of columns) {
      if (col.combo === null) { line.push(j === 0 && col.vi === 0 ? "Grand Total" : null); continue; }
      const key = col.combo.path.slice(0, j + 1).map(groupKey).join("\u0001");
      line.push(col.vi === 0 && key !== prev ? col.combo.path[j] : null);
      if (col.vi === 0) prev = key;
    }
    out.push(line);
  }
  const nameLine = S.rows.map((fd) => headers[fd.f] ?? null);
  while (nameLine.length < nRowFields) nameLine.push(null);
  for (const col of columns) nameLine.push(k > 1 || !S.cols.length ? valueNames[col.vi] ?? null : null);
  out.push(nameLine);
  if (!k) return out.length ? out : [[null]];

  // grand totals per value (for "% of grand total")
  const grandRows = data;
  const rowTotal = (rows, vi) => cellValue(rows, vi);
  const showAs = (v, vi, rows, combo) => {
    const mode = values[vi].show || "default";
    if (mode === "default" || !isNum(v)) return v;
    let base;
    if (mode === "total") base = cellValue(grandRows, vi);
    else if (mode === "row") base = rowTotal(rows, vi);
    else base = cellValue(combo ? grandRows.filter((r) => inCombo(r, combo)) : grandRows, vi);
    return isNum(base) && base !== 0 ? v / base : null;
  };
  const lineCells = (rows) => columns.map(({ combo, vi }) => {
    const sub = combo ? rows.filter((r) => inCombo(r, combo)) : rows;
    const v = sub.length || values[vi].fn === "SUM" || values[vi].fn === "COUNTA" || values[vi].fn === "COUNT" ? cellValue(sub, vi) : null;
    return showAs(sub.length ? v : null, vi, rows, combo);
  });

  // body
  let prevPath = [];
  for (const L of rowLines) {
    const line = Array(nRowFields).fill(null);
    if (L.kind === "subtotal") line[L.depth] = `${keyText(L.path[L.depth])} Total`;
    else L.path.forEach((v, i) => { if (i >= prevPath.length || groupKey(prevPath[i]) !== groupKey(v) || L.path.slice(0, i).some((x, j) => groupKey(x) !== groupKey(prevPath[j]))) line[i] = v; });
    if (L.kind === "item") prevPath = L.path;
    out.push([...line, ...lineCells(L.rows)]);
  }
  if (rowGrand) {
    const line = Array(nRowFields).fill(null);
    line[0] = "Grand Total";
    out.push([...line, ...lineCells(data)]);
  }
  // pad to a rectangle
  const w = Math.max(...out.map((r) => r.length));
  return out.map((r) => [...r, ...Array(w - r.length).fill(null)]);
}
