// Logic and information functions (SPREADSHEET_DESIGN.md §3, pass A).

import { def, eachValue, omitted, ERR, err, isErr, isEmpty, isMatrix, Matrix, isRef, OMIT, toBool, compare } from "./helpers.js";
import { ERROR_TYPE } from "../values.js";

// Lazy functions get thunks; a thunk's value may be a Ref, Matrix or value.
const val = (ctx, th) => { const v = ctx.scalarOf(th()); return v === OMIT ? null : v; };

const at = (v, r, c) => (isMatrix(v) ? v.get(v.h === 1 ? 0 : r, v.w === 1 ? 0 : c) ?? err(ERR.NA) : v);

function boolsOf(ctx, args, name) {
  const out = [];
  for (const a of args) for (const { v, direct } of eachValue(ctx, a)) {
    if (isErr(v)) throw Object.assign(new Error("e"), { sheetError: v });
    if (isEmpty(v)) continue;
    if (typeof v === "string" && !direct) continue; // text in ranges is skipped
    const b = toBool(v);
    if (isErr(b)) throw Object.assign(new Error("e"), { sheetError: err(ERR.VALUE, `Function ${name} parameter expects boolean values. But '${v}' is a text and cannot be coerced to a boolean.`) });
    out.push(b);
  }
  return out;
}

export function logicFunctions() {
  return [
    def("TRUE", { args: [] }, () => true),
    def("FALSE", { args: [] }, () => false),
    def("NOT", { args: ["bool"] }, (ctx, b) => !b),
    def("AND", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => { const bs = boolsOf(ctx, args, "AND"); return bs.length ? bs.every(Boolean) : err(ERR.VALUE, "AND has no valid input data."); }),
    def("OR", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => { const bs = boolsOf(ctx, args, "OR"); return bs.length ? bs.some(Boolean) : err(ERR.VALUE, "OR has no valid input data."); }),
    def("XOR", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => { const bs = boolsOf(ctx, args, "XOR"); return bs.length ? bs.filter(Boolean).length % 2 === 1 : err(ERR.VALUE, "XOR has no valid input data."); }),
    def("IF", { min: 2, max: 3, lazy: true }, (ctx, th) => {
      const cond = val(ctx, th[0]);
      if (isMatrix(cond)) {
        const yes = val(ctx, th[1]) ?? 0, no = th.length > 2 ? val(ctx, th[2]) ?? 0 : false;
        return cond.map((c, r, k) => { if (isErr(c)) return c; const b = toBool(c); if (isErr(b)) return b; return b ? at(yes, r, k) : at(no, r, k); });
      }
      if (isErr(cond)) return cond;
      const b = toBool(cond);
      if (isErr(b)) return b;
      const branch = b ? th[1] : th[2];
      if (!branch) return false;
      const v = branch(); // IF(cond, A1:A3) returns the range itself (it can spill or feed SUM)
      return v === OMIT ? null : v; // an omitted branch is empty, as Sheets
    }),
    def("IFS", { min: 2, max: Infinity, lazy: true }, (ctx, th) => {
      if (th.length % 2) return err(ERR.NA, "IFS expects an even number of arguments.");
      for (let i = 0; i < th.length; i += 2) {
        const c = val(ctx, th[i]);
        if (isErr(c)) return c;
        const b = toBool(c);
        if (isErr(b)) return b;
        if (b) return th[i + 1]();
      }
      return err(ERR.NA, "No match.");
    }),
    def("IFERROR", { min: 1, max: 2, lazy: true }, (ctx, th) => {
      const v = ctx.scalarOf(th[0]());
      const alt = () => { if (!th[1]) return null; const a = th[1](); return a === OMIT ? 0 : a; };
      if (isMatrix(v)) { const a = th[1] ? ctx.scalarOf(alt()) : null; return v.map((x, r, c) => (isErr(x) ? at(a, r, c) : x)); }
      return isErr(v) ? alt() : th[0]();
    }),
    def("IFNA", { min: 2, max: 2, lazy: true }, (ctx, th) => {
      const v = ctx.scalarOf(th[0]());
      if (isMatrix(v)) { const a = val(ctx, th[1]); return v.map((x, r, c) => (isErr(x) && x.code === ERR.NA ? at(a, r, c) : x)); }
      if (isErr(v) && v.code === ERR.NA) return th[1]();
      return th[0]();
    }),
    def("SWITCH", { min: 3, max: Infinity, lazy: true }, (ctx, th) => {
      const subject = val(ctx, th[0]);
      if (isErr(subject)) return subject;
      let i = 1;
      for (; i + 1 < th.length; i += 2) {
        const c = val(ctx, th[i]);
        if (isErr(c)) return c;
        if (compare(subject, c) === 0 && typeof subject === typeof c) return th[i + 1]();
      }
      return i < th.length ? th[i]() : err(ERR.NA, "No match.");
    }),
    // ---- information ----
    def("ISBLANK", { args: ["any"] }, (ctx, v) => { v = ctx.scalarOf(v); return isMatrix(v) ? v.map((x) => isEmpty(x)) : isEmpty(v) || v === OMIT; }),
    def("ISERR", { args: ["scalar"], acceptErrors: true }, (ctx, v) => isErr(v) && v.code !== ERR.NA),
    def("ISERROR", { args: ["scalar"], acceptErrors: true }, (ctx, v) => isErr(v)),
    def("ISNA", { args: ["scalar"], acceptErrors: true }, (ctx, v) => isErr(v) && v.code === ERR.NA),
    def("ISNUMBER", { args: ["scalar"], acceptErrors: true }, (ctx, v) => typeof v === "number"),
    def("ISTEXT", { args: ["scalar"], acceptErrors: true }, (ctx, v) => typeof v === "string"),
    def("ISNONTEXT", { args: ["scalar"], acceptErrors: true }, (ctx, v) => typeof v !== "string"),
    def("ISLOGICAL", { args: ["scalar"], acceptErrors: true }, (ctx, v) => typeof v === "boolean"),
    def("ISREF", { lazy: true, min: 1, max: 1 }, (ctx, th) => isRef(th[0]())),
    def("ISFORMULA", { args: ["any"] }, (ctx, r) => (isRef(r) ? ctx.isFormulaAt(r.tab, r.r1, r.c1) : err(ERR.NA, "ISFORMULA expects a cell reference."))),
    def("ISEMAIL", { args: ["scalar"], acceptErrors: true }, (ctx, v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v)),
    def("ISURL", { args: ["scalar"], acceptErrors: true }, (ctx, v) => typeof v === "string" && /^(https?:\/\/|ftp:\/\/)?([\w-]+\.)+[A-Za-z]{2,}(\/\S*)?$/i.test(v.trim())),
    def("ISDATE", { args: ["scalar"], acceptErrors: true }, (ctx, v) => false), // Sheets: true only for date-formatted values; formats aren't seen by the engine
    def("N", { args: ["scalar"] }, (ctx, v) => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0)),
    def("NA", { args: [] }, () => err(ERR.NA, "")),
    def("TYPE", { args: ["any"] }, (ctx, v) => {
      if (isRef(v) && !v.single) return 16; // Sheets: a range here is an error (#VALUE!)
      v = ctx.scalarOf(v);
      if (isMatrix(v)) return 64;
      if (typeof v === "number" || isEmpty(v)) return 1;
      if (typeof v === "string") return 2;
      if (typeof v === "boolean") return 4;
      if (isErr(v)) return 16;
      return 1;
    }),
    def("ERROR.TYPE", { args: ["scalar"], acceptErrors: true }, (ctx, v) => (isErr(v) ? ERROR_TYPE[v.code] || err(ERR.NA) : err(ERR.NA, "ERROR.TYPE of a value that isn't an error."))),
  ];
}

export { Matrix };
