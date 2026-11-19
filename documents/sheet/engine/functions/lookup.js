// Lookup and reference functions (SPREADSHEET_DESIGN.md §3, pass A).

import { def, asMatrix, omitted, criterion, VAL_ERR, NA_ERR, ERR, err, isErr, isEmpty, isMatrix, Matrix, isRef, compare } from "./helpers.js";
import { readRef, indexToCol, quoteSheet } from "../parser.js";

const notFound = (fn, key) => NA_ERR(`Did not find value '${key instanceof Object ? key : String(key)}' in ${fn} evaluation.`);

// Same kind for matching: numbers with numbers, text with text, booleans with booleans.
const sameKind = (a, b) => typeof a === typeof b;

function exactIndex(list, key, wildcard = true) {
  if (typeof key === "string" && wildcard && /[*?~]/.test(key)) {
    const test = criterion(key);
    return list.findIndex((v) => typeof v === "string" && test(v));
  }
  return list.findIndex((v) => sameKind(v, key) && compare(v, key) === 0);
}
// Largest value <= key in an ascending list (binary search, as Sheets for sorted lookups).
function approxIndex(list, key, descending = false) {
  let lo = 0, hi = list.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let v = list[mid];
    // skip empties and other kinds toward the low end
    let m = mid;
    while (m >= lo && (isEmpty(v) || !sameKind(v, key))) { m--; v = list[m]; }
    if (m < lo) { lo = mid + 1; continue; }
    const c = compare(v, key);
    if (descending ? c >= 0 : c <= 0) { best = m; lo = mid + 1; } else hi = m - 1;
  }
  return best;
}

function vec(ctx, v) {
  const m = asMatrix(ctx, v);
  if (m.h !== 1 && m.w !== 1) return null;
  return { list: m.h === 1 ? m.rows[0] : m.rows.map((r) => r[0]), horizontal: m.h === 1 && m.w > 1, m };
}

// A row or column of a Ref (or Matrix) by index, as a Ref when possible.
function slice(ctx, src, i, horizontal) {
  if (isRef(src)) {
    return horizontal ? ctx.refAt(src.tab, src.r1, src.c1 + i, src.r2, src.c1 + i) : ctx.refAt(src.tab, src.r1 + i, src.c1, src.r1 + i, src.c2);
  }
  const m = asMatrix(ctx, src);
  return horizontal ? new Matrix(m.rows.map((r) => [r[i]])) : new Matrix([m.rows[i]]);
}

function a1(row, col, absMode, a1Style, sheet) {
  const ar = absMode === 1 || absMode === 2, ac = absMode === 1 || absMode === 3;
  const pre = sheet ? `${quoteSheet(sheet)}!` : "";
  if (!a1Style) return `${pre}R${ar ? row : `[${row}]`}C${ac ? col : `[${col}]`}`;
  return `${pre}${ac ? "$" : ""}${indexToCol(col - 1)}${ar ? "$" : ""}${row}`;
}

export function lookupFunctions() {
  return [
    def("ADDRESS", { args: ["int", "int", "int", "bool", "text"], min: 2, max: 5 }, (ctx, row, col, abs, style, sheet) => {
      if (row < 1 || col < 1) return VAL_ERR("ADDRESS: row and column must be at least 1.");
      return a1(row, col, omitted(abs) ? 1 : abs, omitted(style) ? true : style, omitted(sheet) ? "" : sheet);
    }),
    def("CHOOSE", { min: 2, max: Infinity, lazy: true }, (ctx, th) => {
      const i = ctx.scalarOf(th[0]());
      if (isErr(i)) return i;
      const n = Math.trunc(typeof i === "number" ? i : Number(i));
      if (!(n >= 1 && n < th.length)) return NUM(`Function CHOOSE parameter 1 value is ${n}. Valid values are between 1 and ${th.length - 1} inclusive.`);
      return th[n]();
    }),
    def("ROW", { args: ["any"], min: 0, max: 1 }, (ctx, r) => {
      if (omitted(r)) return ctx.position().r + 1;
      if (!isRef(r)) return VAL_ERR("ROW expects a cell reference.");
      return r.h === 1 ? r.r1 + 1 : Matrix.of(r.h, 1, (i) => r.r1 + i + 1);
    }),
    def("COLUMN", { args: ["any"], min: 0, max: 1 }, (ctx, r) => {
      if (omitted(r)) return ctx.position().c + 1;
      if (!isRef(r)) return VAL_ERR("COLUMN expects a cell reference.");
      return r.w === 1 ? r.c1 + 1 : Matrix.of(1, r.w, (_, j) => r.c1 + j + 1);
    }),
    def("ROWS", { args: ["any"] }, (ctx, r) => (isRef(r) ? r.h : asMatrix(ctx, r).h)),
    def("COLUMNS", { args: ["any"] }, (ctx, r) => (isRef(r) ? r.w : asMatrix(ctx, r).w)),
    def("VLOOKUP", { args: ["scalar", "any", "int", "bool"], min: 3, max: 4 }, (ctx, key, range, idx, sorted) => {
      const m = asMatrix(ctx, range);
      if (idx < 1) return VAL_ERR("Function VLOOKUP parameter 3 value is out of range.");
      if (idx > m.w) return err(ERR.REF, "VLOOKUP evaluates to an out of bounds range.");
      const first = m.rows.map((r) => r[0]);
      const i = (omitted(sorted) ? true : sorted) ? approxIndex(first, key) : exactIndex(first, key);
      return i < 0 ? notFound("VLOOKUP", key) : m.get(i, idx - 1);
    }),
    def("HLOOKUP", { args: ["scalar", "any", "int", "bool"], min: 3, max: 4 }, (ctx, key, range, idx, sorted) => {
      const m = asMatrix(ctx, range);
      if (idx < 1) return VAL_ERR("Function HLOOKUP parameter 3 value is out of range.");
      if (idx > m.h) return err(ERR.REF, "HLOOKUP evaluates to an out of bounds range.");
      const first = m.rows[0];
      const i = (omitted(sorted) ? true : sorted) ? approxIndex(first, key) : exactIndex(first, key);
      return i < 0 ? notFound("HLOOKUP", key) : m.get(idx - 1, i);
    }),
    def("MATCH", { args: ["scalar", "any", "int"], min: 2, max: 3 }, (ctx, key, range, type) => {
      const v = vec(ctx, range);
      if (!v) return NA_ERR("MATCH range must be a single row or a single column.");
      const t = omitted(type) ? 1 : type;
      const i = t === 0 ? exactIndex(v.list, key) : t > 0 ? approxIndex(v.list, key) : approxIndex(v.list, key, true);
      return i < 0 ? notFound("MATCH", key) : i + 1;
    }),
    def("LOOKUP", { args: ["scalar", "any", "any"], min: 2, max: 3 }, (ctx, key, search, result) => {
      const m = asMatrix(ctx, search);
      let list, horizontal;
      if (m.h === 1 || m.w === 1) { list = m.h === 1 ? m.rows[0] : m.rows.map((r) => r[0]); horizontal = m.h === 1; }
      else { horizontal = m.w > m.h; list = horizontal ? m.rows[0] : m.rows.map((r) => r[0]); }
      const i = approxIndex(list, key);
      if (i < 0) return notFound("LOOKUP", key);
      if (omitted(result)) {
        if (m.h === 1 || m.w === 1) return list[i];
        return horizontal ? m.get(m.h - 1, i) : m.get(i, m.w - 1);
      }
      const r = vec(ctx, result);
      if (!r) return NA_ERR("LOOKUP result range must be a single row or column.");
      return i < r.list.length ? r.list[i] : err(ERR.REF);
    }),
    def("INDEX", { args: ["any", "int", "int"], min: 1, max: 3 }, (ctx, ref, row, col) => {
      const rr = omitted(row) ? 0 : row, cc = omitted(col) ? 0 : col;
      const h = isRef(ref) ? ref.h : asMatrix(ctx, ref).h, w = isRef(ref) ? ref.w : asMatrix(ctx, ref).w;
      // a single row or column takes one index for either
      let r = rr, c = cc;
      if (omitted(col) && h === 1 && w > 1) { c = rr; r = 1; }
      if (r < 0 || c < 0 || r > h || c > w) return err(ERR.NUM, "INDEX evaluates to an out of bounds range.");
      if (isRef(ref)) {
        const r1 = r === 0 ? ref.r1 : ref.r1 + r - 1, r2 = r === 0 ? ref.r2 : r1;
        const c1 = c === 0 ? ref.c1 : ref.c1 + c - 1, c2 = c === 0 ? ref.c2 : c1;
        return ctx.refAt(ref.tab, r1, c1, r2, c2);
      }
      const m = asMatrix(ctx, ref);
      if (r && c) return m.get(r - 1, c - 1);
      if (r) return new Matrix([m.rows[r - 1]]);
      if (c) return new Matrix(m.rows.map((x) => [x[c - 1]]));
      return m;
    }),
    def("OFFSET", { args: ["any", "int", "int", "int", "int"], min: 3, max: 5 }, (ctx, ref, dr, dc, hh, ww) => {
      if (!isRef(ref)) return VAL_ERR("OFFSET expects a cell reference.");
      const h = omitted(hh) ? ref.h : hh, w = omitted(ww) ? ref.w : ww;
      if (h < 1 || w < 1) return err(ERR.REF, "OFFSET height and width must be at least 1.");
      return ctx.refAt(ref.tab, ref.r1 + dr, ref.c1 + dc, ref.r1 + dr + h - 1, ref.c1 + dc + w - 1);
    }),
    def("INDIRECT", { args: ["text", "bool"], min: 1, max: 2 }, (ctx, text, a1Style) => {
      const style = omitted(a1Style) ? true : a1Style;
      const here = ctx.position();
      if (!style) {
        const m = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?$/i.exec(text.trim());
        if (!m) return err(ERR.REF, `Function INDIRECT parameter 1 value is '${text}'. It is not a valid cell/range reference.`);
        const tab = m[1] || m[2] ? ctx.tabIdByName((m[1] || m[2]).replace(/''/g, "'")) : here.tab;
        if (!tab) return err(ERR.REF, "Unresolved sheet name.");
        const part = (s, base) => (s === undefined ? base : s.startsWith("[") ? base + Number(s.slice(1, -1)) : Number(s) - 1);
        const r = part(m[3], here.r), c = part(m[4], here.c);
        return ctx.refAt(tab, r, c);
      }
      const r = readRef(text.trim());
      if (!r || r.len !== text.trim().length) return err(ERR.REF, `Function INDIRECT parameter 1 value is '${text}'. It is not a valid cell/range reference.`);
      const n = r.node;
      const tab = n.sheet ? ctx.tabIdByName(n.sheet) : here.tab;
      if (!tab) return err(ERR.REF, "Unresolved sheet name.");
      const size = ctx.tabSize(tab);
      const r1 = n.r1 ?? 0, r2 = n.r2 ?? size.rows - 1, c1 = n.c1 ?? 0, c2 = n.c2 ?? size.cols - 1;
      return ctx.refAt(tab, r1, c1, n.kind === "open" ? size.rows - 1 : r2, c2);
    }),
    def("XMATCH", { args: ["scalar", "any", "int", "int"], min: 2, max: 4 }, (ctx, key, range, mode, search) => {
      const v = vec(ctx, range);
      if (!v) return VAL_ERR("XMATCH range must be a single row or column.");
      const i = xfind(v.list, key, omitted(mode) ? 0 : mode, omitted(search) ? 1 : search);
      return isErr(i) ? i : i < 0 ? notFound("XMATCH", key) : i + 1;
    }),
    def("XLOOKUP", { args: ["scalar", "any", "any", "any", "int", "int"], min: 3, max: 6 }, (ctx, key, look, result, missing, mode, search) => {
      const v = vec(ctx, look);
      if (!v) return VAL_ERR("XLOOKUP lookup range must be a single row or column.");
      const rh = isRef(result) ? result.h : asMatrix(ctx, result).h, rw = isRef(result) ? result.w : asMatrix(ctx, result).w;
      if ((v.horizontal ? rw : rh) !== v.list.length) return VAL_ERR("XLOOKUP: the lookup and result ranges must be the same size.");
      const i = xfind(v.list, key, omitted(mode) ? 0 : mode, omitted(search) ? 1 : search);
      if (isErr(i)) return i;
      if (i < 0) return omitted(missing) ? notFound("XLOOKUP", key) : missing;
      return slice(ctx, result, i, v.horizontal);
    }),
    def("FORMULATEXT", { args: ["any"] }, (ctx, r) => {
      if (!isRef(r)) return NA_ERR("FORMULATEXT expects a cell reference.");
      const text = ctx.formulaTextAt?.(r.tab, r.r1, r.c1);
      return text ?? NA_ERR("The referenced cell has no formula.");
    }),
  ];
}

const NUM = (m) => err(ERR.NUM, m);

function xfind(list, key, mode, search) {
  const idx = list.map((_, i) => i);
  if (search === 2 || search === -2) {
    // binary search over sorted data
    const asc = search === 2;
    let lo = 0, hi = list.length - 1, found = -1, below = -1, above = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = compare(list[mid], key);
      if (c === 0) { found = mid; break; }
      if ((c < 0) === asc) { below = mid; lo = mid + 1; } else { above = mid; hi = mid - 1; }
    }
    if (found >= 0) return found;
    if (mode === -1) return asc ? below : above;
    if (mode === 1) return asc ? above : below;
    return -1;
  }
  if (search === -1) idx.reverse();
  else if (search !== 1) return VAL_ERR("XLOOKUP search mode must be 1, -1, 2 or -2.");
  if (mode === 2) { const test = criterion(key); for (const i of idx) if (typeof list[i] === "string" && test(list[i])) return i; return -1; }
  if (![0, -1, 1].includes(mode)) return VAL_ERR("XLOOKUP match mode must be 0, -1, 1 or 2.");
  let best = -1;
  for (const i of idx) {
    const v = list[i];
    if (isEmpty(v) || !sameKind(v, key)) continue;
    const c = compare(v, key);
    if (c === 0) return i;
    if (mode === -1 && c < 0 && (best < 0 || compare(v, list[best]) > 0)) best = i;
    if (mode === 1 && c > 0 && (best < 0 || compare(v, list[best]) < 0)) best = i;
  }
  return best;
}
