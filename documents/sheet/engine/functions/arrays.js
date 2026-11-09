// Array functions (SPREADSHEET_DESIGN.md §3, pass B): results that spill into the
// cells around them.

import { def, asMatrix, omitted, VAL_ERR, NA_ERR, ERR, err, isErr, isEmpty, isMatrix, Matrix, isRef, compare, toBool, OMIT } from "./helpers.js";
import { isLambda } from "../engine.js";

const keyOf = (v) => (isEmpty(v) ? "e:" : typeof v === "number" ? `n:${v}` : typeof v === "string" ? `s:${v}` : typeof v === "boolean" ? `b:${v}` : isErr(v) ? `x:${v.code}` : `?:${v}`);
const transpose = (m) => Matrix.of(m.w, m.h, (r, c) => m.get(c, r));
const truthy = (v) => { if (isErr(v)) return v; const b = toBool(v); return isErr(b) ? false : b; };

// Sort order for SORT (as Sheets): numbers, then text, then booleans, empties last.
function sortCompare(a, b) {
  const ea = isEmpty(a) || a === "", eb = isEmpty(b) || b === "";
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (isErr(a) || isErr(b)) return isErr(a) === isErr(b) ? 0 : isErr(a) ? 1 : -1;
  return compare(a, b);
}

function lambdaArg(v, name) {
  if (!isLambda(v)) throw Object.assign(new Error("e"), { sheetError: err(ERR.VALUE, `Argument must be a LAMBDA for ${name}.`) });
  return v;
}

export function arrayFunctions() {
  return [
    def("ARRAYFORMULA", { min: 1, max: 1, lazy: true, arrayArgs: true }, (ctx, th) => ctx.scalarOf(th[0](true))),
    def("TRANSPOSE", { args: ["matrix"] }, (ctx, m) => transpose(m)),
    def("SEQUENCE", { args: ["int", "int", "number", "number"], min: 1, max: 4 }, (ctx, rows, cols, start, step) => {
      const c = omitted(cols) ? 1 : cols, s = omitted(start) ? 1 : start, st = omitted(step) ? 1 : step;
      if (rows < 1 || c < 1) return VAL_ERR("SEQUENCE rows and columns must be at least 1.");
      if (rows * c > 2_000_000) return VAL_ERR("SEQUENCE result too large.");
      return Matrix.of(rows, c, (r, k) => s + (r * c + k) * st);
    }),
    def("UNIQUE", { args: ["matrix", "bool", "bool"], min: 1, max: 3 }, (ctx, m, byCol, once) => {
      const cols = !omitted(byCol) && byCol;
      const src = cols ? transpose(m) : m;
      const counts = new Map(), order = [];
      for (const row of src.rows) {
        const k = row.map(keyOf).join("\u0001");
        if (!counts.has(k)) { counts.set(k, { n: 0, row }); order.push(k); }
        counts.get(k).n++;
      }
      const rows = order.filter((k) => !(!omitted(once) && once) || counts.get(k).n === 1).map((k) => counts.get(k).row);
      if (!rows.length) return NA_ERR("No unique values found.");
      const out = new Matrix(rows);
      return cols ? transpose(out) : out;
    }),
    def("SORT", { args: ["matrix", "any", "any"], min: 1, max: Infinity }, (ctx, m, ...spec) => {
      const keys = [];
      if (!spec.length || omitted(spec[0])) keys.push({ col: m.rows.map((r) => r[0]), asc: spec.length > 1 && !omitted(spec[1]) ? truthy(ctx.scalarOf(spec[1])) : true });
      else for (let i = 0; i < spec.length; i += 2) {
        const sc = spec[i];
        let col;
        const sv = ctx.scalarOf(sc);
        if (typeof sv === "number") { if (sv < 1 || sv > m.w) return VAL_ERR(`SORT has invalid sort column ${sv}.`); col = m.rows.map((r) => r[sv - 1]); }
        else { const cm = asMatrix(ctx, sc); if (cm.h !== m.h || cm.w !== 1) return VAL_ERR("SORT has mismatched range sizes."); col = cm.rows.map((r) => r[0]); }
        const asc = i + 1 < spec.length && !omitted(spec[i + 1]) ? truthy(ctx.scalarOf(spec[i + 1])) : true;
        if (isErr(asc)) return asc;
        keys.push({ col, asc });
      }
      const idx = m.rows.map((_, i) => i);
      idx.sort((a, b) => {
        for (const k of keys) { const c = sortCompare(k.col[a], k.col[b]); if (c) { const blank = isEmpty(k.col[a]) || isEmpty(k.col[b]) || k.col[a] === "" || k.col[b] === ""; return blank ? c : k.asc ? c : -c; } }
        return a - b;
      });
      return new Matrix(idx.map((i) => m.rows[i]));
    }),
    def("SORTN", { args: ["matrix", "int", "int", "any", "any"], min: 1, max: Infinity }, (ctx, m, n, tieMode, ...spec) => {
      const count = omitted(n) ? 1 : n;
      const sortFn = ctx.engine && null;
      void sortFn;
      const keys = [];
      for (let i = 0; i < spec.length; i += 2) {
        const sv = ctx.scalarOf(spec[i]);
        const col = typeof sv === "number" ? m.rows.map((r) => r[sv - 1]) : asMatrix(ctx, spec[i]).rows.map((r) => r[0]);
        const asc = i + 1 < spec.length ? truthy(ctx.scalarOf(spec[i + 1])) : true;
        keys.push({ col, asc });
      }
      if (!keys.length) keys.push({ col: m.rows.map((r) => r[0]), asc: true });
      const idx = m.rows.map((_, i) => i).sort((a, b) => { for (const k of keys) { const c = sortCompare(k.col[a], k.col[b]); if (c) return k.asc ? c : -c; } return a - b; });
      const tm = omitted(tieMode) ? 0 : tieMode;
      let take = idx.slice(0, count);
      if (tm === 1 && count > 0) { const last = idx[count - 1]; const same = (i) => keys.every((k) => sortCompare(k.col[i], k.col[last]) === 0); take = idx.filter((i, j) => j < count || same(i)); }
      if (tm === 2 || tm === 3) {
        const seen = new Set(); take = [];
        for (const i of idx) { const k = m.rows[i].map(keyOf).join("\u0001"); if (seen.has(k) && tm === 2) continue; if (!seen.has(k) && seen.size >= count) break; seen.add(k); take.push(i); }
      }
      if (!take.length) return NA_ERR("SORTN returned no rows.");
      return new Matrix(take.map((i) => m.rows[i]));
    }),
    def("FILTER", { args: ["matrix", "matrix"], min: 2, max: Infinity }, (ctx, m, ...conds) => {
      const byRow = conds[0].w === 1 && conds[0].h === m.h;
      const byCol = !byRow && conds[0].h === 1 && conds[0].w === m.w;
      if (!byRow && !byCol) return VAL_ERR("FILTER has mismatched range sizes.");
      for (const c of conds) if (byRow ? c.h !== m.h || c.w !== 1 : c.w !== m.w || c.h !== 1) return VAL_ERR("FILTER has mismatched range sizes.");
      const keep = [];
      const n = byRow ? m.h : m.w;
      for (let i = 0; i < n; i++) {
        let ok = true;
        for (const c of conds) { const v = byRow ? c.get(i, 0) : c.get(0, i); if (isErr(v)) return v; if (!truthy(v)) { ok = false; break; } }
        if (ok) keep.push(i);
      }
      if (!keep.length) return NA_ERR("No matches are found in FILTER evaluation.");
      return byRow ? new Matrix(keep.map((i) => m.rows[i])) : new Matrix(m.rows.map((r) => keep.map((i) => r[i])));
    }),
    def("FLATTEN", { args: ["matrix"], min: 1, max: Infinity }, (ctx, ...ms) => new Matrix(ms.flatMap((m) => m.flat()).map((v) => [v]))),
    def("TOCOL", { args: ["matrix", "int", "bool"], min: 1, max: 3 }, (ctx, m, ignore, byCol) => {
      const src = !omitted(byCol) && byCol ? transpose(m) : m;
      const ig = omitted(ignore) ? 0 : ignore;
      const vals = src.flat().filter((v) => !((ig === 1 || ig === 3) && isEmpty(v)) && !((ig === 2 || ig === 3) && isErr(v)));
      return vals.length ? new Matrix(vals.map((v) => [v])) : err(ERR.REF, "No values.");
    }),
    def("TOROW", { args: ["matrix", "int", "bool"], min: 1, max: 3 }, (ctx, m, ignore, byCol) => {
      const src = !omitted(byCol) && byCol ? transpose(m) : m;
      const ig = omitted(ignore) ? 0 : ignore;
      const vals = src.flat().filter((v) => !((ig === 1 || ig === 3) && isEmpty(v)) && !((ig === 2 || ig === 3) && isErr(v)));
      return vals.length ? new Matrix([vals]) : err(ERR.REF, "No values.");
    }),
    def("HSTACK", { args: ["matrix"], min: 1, max: Infinity }, (ctx, ...ms) => {
      const h = Math.max(...ms.map((m) => m.h));
      return new Matrix(Array.from({ length: h }, (_, r) => ms.flatMap((m) => (r < m.h ? m.rows[r] : Array(m.w).fill(err(ERR.NA))))));
    }),
    def("VSTACK", { args: ["matrix"], min: 1, max: Infinity }, (ctx, ...ms) => {
      const w = Math.max(...ms.map((m) => m.w));
      return new Matrix(ms.flatMap((m) => m.rows.map((row) => [...row, ...Array(w - row.length).fill(err(ERR.NA))])));
    }),
    def("CHOOSECOLS", { args: ["matrix", "int"], min: 2, max: Infinity, noLift: true }, (ctx, m, ...cols) => {
      const ix = cols.map((c) => (c < 0 ? m.w + c : c - 1));
      if (ix.some((i) => i < 0 || i >= m.w)) return VAL_ERR("CHOOSECOLS column out of range.");
      return new Matrix(m.rows.map((r) => ix.map((i) => r[i])));
    }),
    def("CHOOSEROWS", { args: ["matrix", "int"], min: 2, max: Infinity, noLift: true }, (ctx, m, ...rows) => {
      const ix = rows.map((r) => (r < 0 ? m.h + r : r - 1));
      if (ix.some((i) => i < 0 || i >= m.h)) return VAL_ERR("CHOOSEROWS row out of range.");
      return new Matrix(ix.map((i) => m.rows[i]));
    }),
    def("WRAPROWS", { args: ["matrix", "int", "scalar"], min: 2, max: 3, noLift: true }, (ctx, m, n, pad) => {
      const v = m.flat(); if (n < 1) return VAL_ERR("WRAPROWS count must be at least 1.");
      const p = omitted(pad) ? err(ERR.NA) : pad;
      return Matrix.of(Math.ceil(v.length / n), n, (r, c) => (r * n + c < v.length ? v[r * n + c] : p));
    }),
    def("WRAPCOLS", { args: ["matrix", "int", "scalar"], min: 2, max: 3, noLift: true }, (ctx, m, n, pad) => {
      const v = m.flat(); if (n < 1) return VAL_ERR("WRAPCOLS count must be at least 1.");
      const p = omitted(pad) ? err(ERR.NA) : pad;
      return Matrix.of(n, Math.ceil(v.length / n), (r, c) => (c * n + r < v.length ? v[c * n + r] : p));
    }),
    def("ARRAY_CONSTRAIN", { args: ["matrix", "int", "int"], noLift: true }, (ctx, m, h, w) => new Matrix(m.rows.slice(0, Math.max(1, h)).map((r) => r.slice(0, Math.max(1, w))))),
    def("MMULT", { args: ["matrix", "matrix"] }, (ctx, a, b) => {
      if (a.w !== b.h) return VAL_ERR("MMULT has incompatible matrix sizes.");
      for (const v of [...a.values(), ...b.values()]) if (typeof v !== "number") return VAL_ERR("MMULT expects numbers.");
      return Matrix.of(a.h, b.w, (r, c) => { let s = 0; for (let k = 0; k < a.w; k++) s += a.get(r, k) * b.get(k, c); return s; });
    }),
    def("RANDARRAY", { args: ["int", "int"], min: 0, max: 2 }, (ctx, h, w) => Matrix.of(omitted(h) ? 1 : h, omitted(w) ? 1 : w, () => ctx.random())),
    // ---- LAMBDA helpers ----
    def("MAP", { args: ["matrix"], min: 2, max: Infinity, noLift: true }, (ctx, ...args) => {
      const fn = lambdaArg(args.pop(), "MAP");
      const ms = args;
      const h = ms[0].h, w = ms[0].w;
      if (ms.some((m) => m.h !== h || m.w !== w)) return VAL_ERR("MAP arrays must be the same size.");
      return Matrix.of(h, w, (r, c) => { const v = ctx.scalarOf(ctx.callLambda(fn, ms.map((m) => m.get(r, c)))); return isMatrix(v) ? v.get(0, 0) : v; });
    }),
    def("REDUCE", { args: ["scalar", "matrix", "any"], noLift: true }, (ctx, init, m, fn) => {
      lambdaArg(fn, "REDUCE");
      let acc = init === OMIT ? 0 : init;
      for (const v of m.values()) acc = ctx.scalarOf(ctx.callLambda(fn, [acc, v]));
      return acc;
    }),
    def("SCAN", { args: ["scalar", "matrix", "any"], noLift: true }, (ctx, init, m, fn) => {
      lambdaArg(fn, "SCAN");
      let acc = init === OMIT ? 0 : init;
      return m.map((v) => { acc = ctx.scalarOf(ctx.callLambda(fn, [acc, v])); return isMatrix(acc) ? acc.get(0, 0) : acc; });
    }),
    def("BYROW", { args: ["matrix", "any"], noLift: true }, (ctx, m, fn) => {
      lambdaArg(fn, "BYROW");
      return new Matrix(m.rows.map((row) => { const v = ctx.scalarOf(ctx.callLambda(fn, [new Matrix([row])])); return [isMatrix(v) ? err(ERR.VALUE, "BYROW must return one value per row.") : v]; }));
    }),
    def("BYCOL", { args: ["matrix", "any"], noLift: true }, (ctx, m, fn) => {
      lambdaArg(fn, "BYCOL");
      const t = transpose(m);
      return new Matrix([t.rows.map((col) => { const v = ctx.scalarOf(ctx.callLambda(fn, [new Matrix(col.map((x) => [x]))])); return isMatrix(v) ? err(ERR.VALUE, "BYCOL must return one value per column.") : v; })]);
    }),
    def("MAKEARRAY", { args: ["int", "int", "any"], noLift: true }, (ctx, h, w, fn) => {
      lambdaArg(fn, "MAKEARRAY");
      if (h < 1 || w < 1) return VAL_ERR("MAKEARRAY size must be at least 1.");
      return Matrix.of(h, w, (r, c) => { const v = ctx.scalarOf(ctx.callLambda(fn, [r + 1, c + 1])); return isMatrix(v) ? v.get(0, 0) : v; });
    }),
  ];
}

export { isRef };
