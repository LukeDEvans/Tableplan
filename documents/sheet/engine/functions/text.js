// Text functions (SPREADSHEET_DESIGN.md §3, passes A and B).

import { def, eachValue, omitted, asMatrix, roundHalfAway, VAL_ERR, NA_ERR, ERR, err, isErr, isEmpty, isMatrix, Matrix, toText, toNumber } from "./helpers.js";
import { formatValue } from "../number-format.js";
import { textToNumber, textToDateSerial, numberToText } from "../values.js";

const S = ["text"];
const chars = (s) => [...s]; // by code point

function regexFrom(pattern, name) {
  try { return new RegExp(pattern.replace(/\(\?i\)/g, ""), /\(\?i\)/.test(pattern) ? "iu" : "u"); }
  catch { throw Object.assign(new Error("e"), { sheetError: err(ERR.REF, `Function ${name} parameter 2 value "${pattern}" is not a valid regular expression.`) }); }
}

function fixedText(n, decimals, noCommas) {
  const d = Math.trunc(decimals);
  let r = d >= 0 ? roundHalfAway(n, d) : roundHalfAway(n / Math.pow(10, -d), 0) * Math.pow(10, -d);
  const parts = Math.abs(r).toFixed(Math.max(0, d)).split(".");
  if (!noCommas) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (r < 0 ? "-" : "") + parts.join(".");
}

export function textFunctions() {
  return [
    def("CHAR", { args: ["int"] }, (ctx, n) => (n < 1 || n > 1114111 ? VAL_ERR("CHAR: value out of range.") : String.fromCodePoint(n))),
    def("UNICHAR", { args: ["int"] }, (ctx, n) => (n < 1 || n > 1114111 ? VAL_ERR("UNICHAR: value out of range.") : String.fromCodePoint(n))),
    def("CODE", { args: S }, (ctx, s) => (s === "" ? VAL_ERR("CODE of an empty text.") : s.codePointAt(0))),
    def("UNICODE", { args: S }, (ctx, s) => (s === "" ? VAL_ERR("UNICODE of an empty text.") : s.codePointAt(0))),
    def("CLEAN", { args: S }, (ctx, s) => s.replace(/[\x00-\x1f]/g, "")),
    def("CONCATENATE", { args: ["any"], min: 1, max: Infinity }, (ctx, ...args) => {
      let out = "";
      for (const a of args) for (const { v } of eachValue(ctx, a)) { if (isErr(v)) return v; out += toText(v); }
      return out;
    }),
    def("CONCAT", { args: ["scalar", "scalar"] }, (ctx, a, b) => toText(a) + toText(b)),
    def("DOLLAR", { args: ["number", "int"], min: 1, max: 2 }, (ctx, n, d) => {
      const dd = omitted(d) ? 2 : d;
      const s = fixedText(Math.abs(n), dd, false);
      return n < 0 ? `-$${s}` : `$${s}`;
    }),
    def("EXACT", { args: ["text", "text"] }, (ctx, a, b) => a === b),
    ...["FIND", "FINDB"].map((nm) => def(nm, { args: ["text", "text", "int"], min: 2, max: 3 }, (ctx, needle, hay, start) => {
      const st = omitted(start) ? 1 : start;
      if (st < 1 || st > hay.length + 1) return VAL_ERR(`Function ${nm} parameter 3 value ${st} is out of range.`);
      const i = hay.indexOf(needle, st - 1);
      return i < 0 ? VAL_ERR(`In ${nm} evaluation, cannot find '${needle}' within '${hay}'.`) : i + 1;
    })),
    def("FIXED", { args: ["number", "int", "bool"], min: 1, max: 3 }, (ctx, n, d, noCommas) => fixedText(n, omitted(d) ? 2 : d, !omitted(noCommas) && noCommas)),
    ...["LEFT", "LEFTB"].map((nm) => def(nm, { args: ["text", "int"], min: 1, max: 2 }, (ctx, s, n) => { const k = omitted(n) ? 1 : n; return k < 0 ? VAL_ERR(`Function ${nm} parameter 2 value is negative.`) : chars(s).slice(0, k).join(""); })),
    ...["RIGHT", "RIGHTB"].map((nm) => def(nm, { args: ["text", "int"], min: 1, max: 2 }, (ctx, s, n) => { const k = omitted(n) ? 1 : n; if (k < 0) return VAL_ERR(`Function ${nm} parameter 2 value is negative.`); const c = chars(s); return k === 0 ? "" : c.slice(Math.max(0, c.length - k)).join(""); })),
    ...["MID", "MIDB"].map((nm) => def(nm, { args: ["text", "int", "int"] }, (ctx, s, start, n) => { if (start < 1) return VAL_ERR(`Function ${nm} parameter 2 value is out of range.`); if (n < 0) return VAL_ERR(`Function ${nm} parameter 3 value is negative.`); return chars(s).slice(start - 1, start - 1 + n).join(""); })),
    ...["LEN", "LENB"].map((nm) => def(nm, { args: S }, (ctx, s) => chars(s).length)),
    def("LOWER", { args: S }, (ctx, s) => s.toLowerCase()),
    def("UPPER", { args: S }, (ctx, s) => s.toUpperCase()),
    def("PROPER", { args: S }, (ctx, s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())),
    ...["REPLACE", "REPLACEB"].map((nm) => def(nm, { args: ["text", "int", "int", "text"] }, (ctx, s, start, n, rep) => { if (start < 1 || n < 0) return VAL_ERR(`Function ${nm} parameter is out of range.`); const c = chars(s); return c.slice(0, start - 1).join("") + rep + c.slice(start - 1 + n).join(""); })),
    def("REPT", { args: ["text", "int"] }, (ctx, s, n) => (n < 0 ? VAL_ERR("Function REPT parameter 2 value is negative.") : s.length * n > 32000 ? VAL_ERR("REPT result too long.") : s.repeat(n))),
    ...["SEARCH", "SEARCHB"].map((nm) => def(nm, { args: ["text", "text", "int"], min: 2, max: 3 }, (ctx, needle, hay, start) => {
      const st = omitted(start) ? 1 : start;
      if (st < 1 || st > hay.length + 1) return VAL_ERR(`Function ${nm} parameter 3 value ${st} is out of range.`);
      if (/[*?~]/.test(needle)) {
        let re = "";
        for (let i = 0; i < needle.length; i++) { const c = needle[i]; if (c === "~" && i + 1 < needle.length) { re += needle[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; } re += c === "*" ? "[\\s\\S]*?" : c === "?" ? "[\\s\\S]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
        const m = new RegExp(re, "i").exec(hay.slice(st - 1));
        return m ? m.index + st : VAL_ERR(`In ${nm} evaluation, cannot find '${needle}' within '${hay}'.`);
      }
      const i = hay.toLowerCase().indexOf(needle.toLowerCase(), st - 1);
      return i < 0 ? VAL_ERR(`In ${nm} evaluation, cannot find '${needle}' within '${hay}'.`) : i + 1;
    })),
    def("SUBSTITUTE", { args: ["text", "text", "text", "int"], min: 3, max: 4 }, (ctx, s, from, to, nth) => {
      if (from === "") return s;
      if (omitted(nth)) return s.split(from).join(to);
      if (nth < 1) return VAL_ERR("Function SUBSTITUTE parameter 4 value is out of range.");
      let i = -1;
      for (let k = 0; k < nth; k++) { i = s.indexOf(from, i + 1); if (i < 0) return s; }
      return s.slice(0, i) + to + s.slice(i + from.length);
    }),
    def("T", { args: ["scalar"] }, (ctx, v) => (typeof v === "string" ? v : "")),
    def("TEXT", { args: ["scalar", "text"] }, (ctx, v, fmt) => {
      let x = v;
      if (typeof x === "string") { const n = textToNumber(x); const d = n === null ? textToDateSerial(x) : null; x = n ?? d ?? x; }
      if (isEmpty(x)) x = 0;
      return formatValue(x, fmt).text;
    }),
    def("TEXTJOIN", { args: ["text", "bool", "any"], min: 3, max: Infinity, noLift: true }, (ctx, delim, ignoreEmpty, ...args) => {
      const parts = [];
      for (const a of args) for (const { v } of eachValue(ctx, a)) {
        if (isErr(v)) return v;
        const s = toText(v);
        if (ignoreEmpty && s === "") continue;
        parts.push(s);
      }
      const out = parts.join(delim);
      return out.length > 50000 ? VAL_ERR("TEXTJOIN result too long.") : out;
    }),
    def("JOIN", { args: ["text", "any"], min: 2, max: Infinity, noLift: true }, (ctx, delim, ...args) => {
      const parts = [];
      for (const a of args) for (const { v } of eachValue(ctx, a)) { if (isErr(v)) return v; parts.push(toText(v)); }
      return parts.join(delim);
    }),
    def("TRIM", { args: S }, (ctx, s) => s.replace(/ +/g, " ").trim()),
    def("VALUE", { args: ["scalar"] }, (ctx, v) => {
      if (typeof v === "number") return v;
      if (isEmpty(v)) return 0;
      if (typeof v === "boolean") return VAL_ERR("VALUE parameter 'TRUE' cannot be parsed to number.");
      const n = textToNumber(v) ?? textToDateSerial(v);
      return n === null ? VAL_ERR(`VALUE parameter '${v}' cannot be parsed to number.`) : n;
    }),
    def("SPLIT", { args: ["text", "text", "bool", "bool"], min: 2, max: 4, noLift: true }, (ctx, s, delim, byEach, removeEmpty) => {
      const each = omitted(byEach) ? true : byEach;
      const rm = omitted(removeEmpty) ? true : removeEmpty;
      if (delim === "") return VAL_ERR("SPLIT delimiter must not be empty.");
      let parts;
      if (each) { const set = new Set(chars(delim)); parts = []; let cur = ""; for (const c of chars(s)) { if (set.has(c)) { parts.push(cur); cur = ""; } else cur += c; } parts.push(cur); }
      else parts = s.split(delim);
      if (rm) parts = parts.filter((p) => p !== "");
      if (!parts.length) return VAL_ERR("SPLIT produced no values.");
      return new Matrix([parts.map((p) => { const n = textToNumber(p); return n !== null && /^\s*-?[\d.,]+\s*$/.test(p) ? n : p; })]);
    }),
    def("REGEXMATCH", { args: ["text", "text"] }, (ctx, s, p) => regexFrom(p, "REGEXMATCH").test(s)),
    def("REGEXEXTRACT", { args: ["text", "text"] }, (ctx, s, p) => {
      const m = regexFrom(p, "REGEXEXTRACT").exec(s);
      if (!m) return NA_ERR(`Function REGEXEXTRACT parameter 2 value "${p}" does not match text of Function REGEXEXTRACT parameter 1 value "${s}".`);
      if (m.length <= 1) return m[0];
      if (m.length === 2) return m[1] ?? "";
      return new Matrix([m.slice(1).map((x) => x ?? "")]);
    }),
    def("REGEXREPLACE", { args: ["text", "text", "text"] }, (ctx, s, p, rep) => {
      const re = regexFrom(p, "REGEXREPLACE");
      return s.replace(new RegExp(re.source, re.flags + "g"), rep.replace(/\$(\d)/g, "$$$1"));
    }),
    def("ASC", { args: S }, (ctx, s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ")),
    def("TO_TEXT", { args: ["scalar"] }, (ctx, v) => toText(v)),
    def("TO_PURE_NUMBER", { args: ["scalar"] }, (ctx, v) => toNumber(v)),
    def("TO_PERCENT", { args: ["number"] }, (ctx, n) => n),
    def("TO_DOLLARS", { args: ["number"] }, (ctx, n) => n),
    def("TO_DATE", { args: ["number"] }, (ctx, n) => n),
    def("NUMBERVALUE", { args: ["text", "text", "text"], min: 1, max: 3 }, (ctx, s, dec, grp) => {
      const d = omitted(dec) ? "." : dec[0], g = omitted(grp) ? "," : grp[0];
      let t = s.replace(/\s/g, "").split(g).join("");
      if (d !== ".") t = t.replace(d, ".");
      const n = textToNumber(t);
      return n === null ? VAL_ERR(`NUMBERVALUE cannot parse '${s}'.`) : n;
    }),
  ];
}

export { asMatrix, isMatrix, numberToText };
