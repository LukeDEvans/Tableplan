// Shared rules for the function catalog (SPREADSHEET_DESIGN.md §3): how functions like
// SUM read their arguments, how SUMIF-style criteria match, and the def() helper.

import { ERR, err, isErr, isEmpty, isMatrix, Matrix, toNumber, toText, toBool, compare, textToNumber, textToDateSerial } from "../values.js";
import { isRef, OMIT } from "../engine.js";

// def(name, { args, min, max, lazy, acceptErrors, noLift }, fn)
//   args: kinds per position, the last one repeats: "number" | "int" | "text" | "bool"
//     | "scalar" (any single value) | "any" (as given: Ref, Matrix, value) | "matrix"
//   Scalar kinds are lifted over arrays (one result per element) unless noLift.
export function def(name, opts, fn) {
  return { name, min: opts.min ?? (opts.args ? opts.args.length : 0), max: opts.max ?? (opts.args ? opts.args.length : 0), ...opts, fn };
}

export const fail = (code, message) => { const e = new Error(message || code); e.sheetError = err(code, message); throw e; };
export const num = (v) => { const n = toNumber(v); if (isErr(n)) throw Object.assign(new Error("e"), { sheetError: n }); return n; };
export const txt = (v) => { const s = toText(v); if (isErr(s)) throw Object.assign(new Error("e"), { sheetError: s }); return s; };
export const omitted = (v) => v === OMIT || v === undefined;
export const orDefault = (v, d) => (v === OMIT || v === undefined ? d : v);

// Every value an argument holds, with where it came from (refs and arrays vs typed directly).
export function* eachValue(ctx, arg) {
  if (arg === OMIT || arg === undefined) return;
  if (isRef(arg)) { for (const v of ctx.refValues(arg)) yield { v, direct: false }; return; }
  if (isMatrix(arg)) { for (const v of arg.values()) yield { v, direct: false }; return; }
  yield { v: arg, direct: true };
}

// Numbers for SUM, AVERAGE, MIN… (Sheets): in ranges and arrays, only numbers count (text,
// booleans and empties are skipped); typed directly, text numbers and booleans count and
// other text is an error. Errors anywhere stop with that error.
export function numbersOf(ctx, args, { a = false } = {}) {
  const out = [];
  for (const arg of args) {
    for (const { v, direct } of eachValue(ctx, arg)) {
      if (isErr(v)) throw Object.assign(new Error("e"), { sheetError: v });
      if (typeof v === "number") out.push(v);
      else if (direct) {
        if (isEmpty(v)) continue;
        const n = toNumber(v);
        if (isErr(n)) throw Object.assign(new Error("e"), { sheetError: n });
        out.push(n);
      } else if (a) {
        // the "A" functions (AVERAGEA…) count text as 0 and booleans as 1/0 in ranges
        if (typeof v === "boolean") out.push(v ? 1 : 0);
        else if (typeof v === "string") out.push(0);
      }
    }
  }
  return out;
}

// A Ref, Matrix or value as a Matrix.
export function asMatrix(ctx, v) {
  if (isRef(v)) return ctx.deref(v);
  if (isMatrix(v)) return v;
  return new Matrix([[v === OMIT ? null : v]]);
}

// Flat list of a range's values, row by row.
export const flatValues = (ctx, v) => asMatrix(ctx, v).flat();

// ---- criteria (SUMIF, COUNTIF, AVERAGEIF, …IFS, DCOUNT…) ---------------------------------------

function wildcardRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length && "*?~".includes(pattern[i + 1])) { re += "\\" + pattern[++i]; continue; }
    if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "?") re += "[\\s\\S]";
    else re += ch.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

// A criterion → a test on a cell's value.
export function criterion(c) {
  if (isErr(c)) return (v) => isErr(v) && v.code === c.code;
  if (typeof c === "number") return (v) => (typeof v === "number" && v === c) || (typeof v === "string" && textToNumber(v) === c);
  if (typeof c === "boolean") return (v) => v === c;
  if (isEmpty(c)) return (v) => isEmpty(v) || v === "";
  const s = String(c);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s);
  const op = m[1] || "";
  const rest = m[2];
  let target = rest;
  const n = rest.trim() === "" ? null : textToNumber(rest);
  const d = n === null ? textToDateSerial(rest) : null;
  const numTarget = n !== null ? n : d;
  const up = rest.toUpperCase();
  const boolTarget = up === "TRUE" ? true : up === "FALSE" ? false : null;
  if (op === "" || op === "=") {
    if (rest === "") return op === "=" ? (v) => isEmpty(v) : (v) => isEmpty(v) || v === "";
    if (numTarget !== null) return (v) => (typeof v === "number" && v === numTarget) || (typeof v === "string" && textToNumber(v) === numTarget);
    if (boolTarget !== null) return (v) => v === boolTarget;
    const re = /[*?~]/.test(rest) ? wildcardRegex(rest) : null;
    return (v) => typeof v === "string" && (re ? re.test(v) : v.toLowerCase() === target.toLowerCase());
  }
  if (op === "<>") {
    if (rest === "") return (v) => !isEmpty(v); // "" from a formula counts, as Sheets
    if (numTarget !== null) return (v) => !isEmpty(v) && !(typeof v === "number" && v === numTarget); // Sheets: empties don't count
    if (boolTarget !== null) return (v) => v !== boolTarget;
    const re = /[*?~]/.test(rest) ? wildcardRegex(rest) : null;
    return (v) => !(typeof v === "string" && (re ? re.test(v) : v.toLowerCase() === target.toLowerCase()));
  }
  // < > <= >=: numbers compare with numbers, text with text
  const cmp = (x) => { const r = numTarget !== null ? (typeof x === "number" ? compare(x, numTarget) : null) : typeof x === "string" ? compare(x, rest) : null; return r; };
  return (v) => {
    const r = cmp(v);
    if (r === null) return false;
    return op === "<" ? r < 0 : op === ">" ? r > 0 : op === "<=" ? r <= 0 : r >= 0;
  };
}

// Lines up criteria ranges for …IFS: returns the matching cell indices (row-major).
export function matchIndices(ctx, pairs, size) {
  let idx = null;
  for (const [range, crit] of pairs) {
    const vals = flatValues(ctx, range);
    if (size !== undefined && vals.length !== size) throw Object.assign(new Error("e"), { sheetError: err(ERR.VALUE, "Array arguments to the function are of different size.") });
    const test = criterion(isMatrix(crit) ? crit.get(0, 0) : crit);
    const next = [];
    const from = idx || vals.map((_, i) => i);
    for (const i of from) if (test(vals[i])) next.push(i);
    idx = next;
    size = vals.length;
  }
  return idx || [];
}

// ---- misc ------------------------------------------------------------------------------------

export function roundHalfAway(x, digits = 0) {
  const p = Math.pow(10, digits);
  const y = Math.abs(x) * p;
  // tidy binary noise (2.675*100 = 267.49999…) before rounding, as Sheets appears to
  const fixed = Number(y.toPrecision(15));
  const r = Math.round(fixed);
  const out = (fixed - Math.floor(fixed) === 0.5 ? Math.floor(fixed) + 1 : r) / p;
  return x < 0 ? -out : out;
}

export const NUM_ERR = (msg) => err(ERR.NUM, msg);
export const VAL_ERR = (msg) => err(ERR.VALUE, msg);
export const NA_ERR = (msg) => err(ERR.NA, msg);
export const DIV_ERR = (msg) => err(ERR.DIV0, msg);
export { ERR, err, isErr, isEmpty, isMatrix, Matrix, isRef, OMIT, toNumber, toText, toBool, compare };
