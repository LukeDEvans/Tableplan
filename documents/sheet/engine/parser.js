// The formula language (SPREADSHEET_DESIGN.md §3): text → tree, and tree → text.
//
// Grammar (Google Sheets, US locale): numbers, "strings" ("" inside is a quote),
// TRUE/FALSE, error literals, references (A1, $A$1, A1:B2, A:A, 1:1, A2:A open-ended,
// 'Tab name'!A1, Tab!A1:B2), named ranges, functions NAME(args), array literals
// {1,2;3,4} (comma = next column, semicolon = next row), operators
//   comparison  =  <>  <  >  <=  >=        (lowest)
//   concatenate &
//   add         +  -
//   multiply    *  /
//   power       ^                          (right-associative, as Sheets: 2^3^2 = 512)
//   percent     postfix %
//   negation    prefix - and +             (highest: -2^2 is 4, as Sheets)
// Omitted arguments (IF(A1,,2)) are { t: "empty" }.
//
// Stored formulas (§2) refer to rows and columns by identity, not position. They are
// written as text in which each reference is a placeholder "<n>" standing
// for refs[n]; parse(text, { refs }) puts refs[n] back in place. The model layer
// (model.js) does the binding between positions and identities.
//
// Tree nodes:
//   { t: "num", v } { t: "str", v } { t: "bool", v } { t: "err", v } { t: "empty" }
//   { t: "ref", sheet, r1, c1, r2, c2, ar1, ac1, ar2, ac2, kind }
//       kind: "cell" | "range" | "cols" (A:B) | "rows" (1:2) | "open" (A2:A, rows to the end)
//       positions are 0-based; a / ar / ac flags mark $ (absolute) parts
//   { t: "bound", i }  a stored placeholder (refs[i]), before the model resolves it
//   { t: "name", v }
//   { t: "fn", name, args }
//   { t: "un", op, a } { t: "pct", a } { t: "bin", op, a, b }
//   { t: "arr", rows: [[node]] }

export class ParseError extends Error {
  constructor(message, at) { super(message); this.at = at; }
}

export const MAX_ROWS = 10_000_000;
export const MAX_COLS = 18_278; // ZZZ

export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i) {
  let s = "";
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

const ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#ERROR!"];
const PH_OPEN = "", PH_CLOSE = "";

// ---- references -------------------------------------------------------------------------

const SHEET_Q = /^'((?:[^']|'')+)'!/;
const SHEET_U = /^([A-Za-z_][A-Za-z0-9_.]*)!/;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,8})/;
const COL = /^(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9])/;
const ROW = /^(\$?)(\d{1,8})(?![0-9])/;
const AFTER_OK = (s) => !/^[A-Za-z0-9_.(!]/.test(s);

function cellOf(m) {
  const c = colToIndex(m[2]), r = Number(m[4]) - 1;
  if (c < 0 || c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
  return { c, r, ac: m[1] === "$", ar: m[3] === "$" };
}

// Tries to read a reference at the start of s. Returns { node, len } or null.
export function readRef(s) {
  let sheet = null, at = 0, m;
  if ((m = SHEET_Q.exec(s))) { sheet = m[1].replace(/''/g, "'"); at = m[0].length; }
  else if ((m = SHEET_U.exec(s))) { sheet = m[1]; at = m[0].length; }
  const rest = s.slice(at);
  // cell, or cell:cell, or cell:col (open-ended)
  if ((m = CELL.exec(rest))) {
    const a = cellOf(m);
    let len = m[0].length;
    if (a) {
      const after = rest.slice(len);
      if (after[0] === ":") {
        const tail = after.slice(1);
        let m2;
        if ((m2 = CELL.exec(tail)) && AFTER_OK(tail.slice(m2[0].length))) {
          const b = cellOf(m2);
          if (b) {
            const node = rangeNode(sheet, a, b);
            return { node, len: at + len + 1 + m2[0].length };
          }
        }
        if ((m2 = COL.exec(tail)) && AFTER_OK(tail.slice(m2[0].length))) {
          const c2 = colToIndex(m2[2]);
          if (c2 < MAX_COLS) {
            const c1 = Math.min(a.c, c2), c2b = Math.max(a.c, c2);
            return { node: { t: "ref", sheet, kind: "open", r1: a.r, c1, r2: null, c2: c2b, ar1: a.ar, ac1: a.c <= c2 ? a.ac : m2[1] === "$", ar2: false, ac2: a.c <= c2 ? m2[1] === "$" : a.ac }, len: at + len + 1 + m2[0].length };
          }
        }
      }
      if (AFTER_OK(after)) return { node: { t: "ref", sheet, kind: "cell", r1: a.r, c1: a.c, r2: a.r, c2: a.c, ar1: a.ar, ac1: a.ac, ar2: a.ar, ac2: a.ac }, len: at + len };
    }
  }
  // col:col
  if ((m = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/.exec(rest)) && AFTER_OK(rest.slice(m[0].length))) {
    const x = colToIndex(m[2]), y = colToIndex(m[4]);
    if (x < MAX_COLS && y < MAX_COLS) {
      const lo = Math.min(x, y), hi = Math.max(x, y);
      return { node: { t: "ref", sheet, kind: "cols", r1: null, c1: lo, r2: null, c2: hi, ar1: false, ac1: (x <= y ? m[1] : m[3]) === "$", ar2: false, ac2: (x <= y ? m[3] : m[1]) === "$" }, len: at + m[0].length };
    }
  }
  // row:row
  if ((m = /^(\$?)(\d{1,8}):(\$?)(\d{1,8})/.exec(rest)) && AFTER_OK(rest.slice(m[0].length))) {
    const x = Number(m[2]) - 1, y = Number(m[4]) - 1;
    if (x >= 0 && y >= 0 && x < MAX_ROWS && y < MAX_ROWS) {
      const lo = Math.min(x, y), hi = Math.max(x, y);
      return { node: { t: "ref", sheet, kind: "rows", r1: lo, c1: null, r2: hi, c2: null, ar1: (x <= y ? m[1] : m[3]) === "$", ac1: false, ar2: (x <= y ? m[3] : m[1]) === "$", ac2: false }, len: at + m[0].length };
    }
  }
  return null;
}

function rangeNode(sheet, a, b) {
  const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r), c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c);
  return {
    t: "ref", sheet, kind: "range", r1, c1, r2, c2,
    ar1: a.r <= b.r ? a.ar : b.ar, ar2: a.r <= b.r ? b.ar : a.ar,
    ac1: a.c <= b.c ? a.ac : b.ac, ac2: a.c <= b.c ? b.ac : a.ac,
  };
}

// ---- tokens -----------------------------------------------------------------------------

const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_\\][A-Za-z0-9_.]*/;

function tokenize(src, refs) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    const rest = src.slice(i);
    if (ch === PH_OPEN) {
      const end = src.indexOf(PH_CLOSE, i);
      const n = Number(src.slice(i + 1, end));
      if (end < 0 || !Number.isInteger(n) || !refs || !refs[n]) throw new ParseError("Bad stored reference", i);
      out.push({ k: "ref", v: { t: "bound", i: n }, at: i });
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1, s = "";
      for (;;) {
        if (j >= src.length) throw new ParseError("Missing closing quote", i);
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      out.push({ k: "str", v: s, at: i });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const e = ERRORS.find((x) => rest.toUpperCase().startsWith(x));
      if (!e) throw new ParseError("Unknown error literal", i);
      out.push({ k: "err", v: e, at: i });
      i += e.length;
      continue;
    }
    // a reference (with or without a tab name) wins over a number or a name
    if (/[A-Za-z$'0-9_]/.test(ch)) {
      const r = readRef(rest);
      if (r) { out.push({ k: "ref", v: r.node, at: i }); i += r.len; continue; }
    }
    let m;
    if ((m = NUMBER.exec(rest))) { out.push({ k: "num", v: Number(m[0]), at: i }); i += m[0].length; continue; }
    if ((m = IDENT.exec(rest))) {
      const name = m[0];
      const after = src.slice(i + name.length).replace(/^\s+/, "");
      if (after[0] === "(") out.push({ k: "fn", v: name.toUpperCase(), at: i });
      else if (/^(TRUE|FALSE)$/i.test(name)) out.push({ k: "bool", v: name.toUpperCase() === "TRUE", at: i });
      else out.push({ k: "name", v: name, at: i });
      i += name.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { out.push({ k: "op", v: two, at: i }); i += 2; continue; }
    if ("+-*/^&=<>%".includes(ch)) { out.push({ k: "op", v: ch, at: i }); i++; continue; }
    if ("(),;{}".includes(ch)) { out.push({ k: ch, at: i }); i++; continue; }
    throw new ParseError(`Unexpected "${ch}"`, i);
  }
  out.push({ k: "end", at: src.length });
  return out;
}

// ---- parser -----------------------------------------------------------------------------

const MAX_DEPTH = 200;

// parse("=SUM(A1:B2)*2") or parse("SUM(A1:B2)*2"). opts.refs: stored placeholders.
export function parse(text, opts = {}) {
  let src = String(text);
  if (src.startsWith("=")) src = src.slice(1);
  if (src.length > 50_000) throw new ParseError("Formula too long", 0);
  const toks = tokenize(src, opts.refs);
  let p = 0, depth = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v) => peek().k === "op" && peek().v === v;
  const expect = (k) => { if (peek().k !== k) throw new ParseError(`Expected "${k}"`, peek().at); return next(); };

  function compareExpr() {
    let a = concat();
    while (peek().k === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().v)) { const op = next().v; a = { t: "bin", op, a, b: concat() }; }
    return a;
  }
  function concat() {
    let a = additive();
    while (isOp("&")) { next(); a = { t: "bin", op: "&", a, b: additive() }; }
    return a;
  }
  function additive() {
    let a = multiplicative();
    while (isOp("+") || isOp("-")) { const op = next().v; a = { t: "bin", op, a, b: multiplicative() }; }
    return a;
  }
  function multiplicative() {
    let a = power();
    while (isOp("*") || isOp("/")) { const op = next().v; a = { t: "bin", op, a, b: power() }; }
    return a;
  }
  function power() {
    const a = percent();
    if (isOp("^")) { next(); return { t: "bin", op: "^", a, b: power() }; } // right-associative, as Sheets: 2^3^2 = 512
    return a;
  }
  function percent() {
    let a = unary();
    if (isOp("%")) { next(); a = { t: "pct", a }; if (isOp("%")) throw new ParseError("Unexpected \"%\"", peek().at); }
    return a;
  }
  function unary() {
    if (isOp("-") || isOp("+")) { const op = next().v; return { t: "un", op, a: unary() }; }
    return primary();
  }
  function args() {
    const list = [];
    expect("(");
    if (peek().k === ")") { next(); return list; }
    for (;;) {
      if (peek().k === "," || peek().k === ")") list.push({ t: "empty" });
      else list.push(expr());
      if (peek().k === ",") { next(); if (peek().k === ")") { list.push({ t: "empty" }); } continue; }
      expect(")");
      return list;
    }
  }
  function arrayLiteral() {
    const rows = [[]];
    if (peek().k === "}") throw new ParseError("Empty array", peek().at);
    for (;;) {
      rows[rows.length - 1].push(expr());
      if (peek().k === ",") { next(); continue; }
      if (peek().k === ";") { next(); rows.push([]); continue; }
      expect("}");
      break;
    }
    if (rows.some((r) => r.length !== rows[0].length)) throw new ParseError("Array rows must be the same length", peek().at);
    return { t: "arr", rows };
  }
  function primary() {
    const tk = next();
    switch (tk.k) {
      case "num": return { t: "num", v: tk.v };
      case "str": return { t: "str", v: tk.v };
      case "bool": return { t: "bool", v: tk.v };
      case "err": return { t: "err", v: tk.v };
      case "ref": return tk.v;
      case "name": return { t: "name", v: tk.v };
      case "fn": {
        if (++depth > MAX_DEPTH) throw new ParseError("Formula nested too deeply", tk.at);
        const node = { t: "fn", name: tk.v, args: args() };
        depth--;
        return node;
      }
      case "(": {
        if (++depth > MAX_DEPTH) throw new ParseError("Formula nested too deeply", tk.at);
        const e = expr();
        expect(")");
        depth--;
        return e;
      }
      case "{": return arrayLiteral();
      case "end": throw new ParseError("Formula ends too soon", tk.at);
      default: throw new ParseError(`Unexpected "${tk.v ?? tk.k}"`, tk.at);
    }
  }
  function expr() { return compareExpr(); }

  if (peek().k === "end") throw new ParseError("Empty formula", 0);
  const tree = expr();
  if (peek().k !== "end") throw new ParseError(`Unexpected "${peek().v ?? peek().k}"`, peek().at);
  return tree;
}

// ---- tree → text ----------------------------------------------------------------------

const PREC = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function quoteSheet(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !readRef(name + "!")?.node && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(TRUE|FALSE)$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// A1 text of a positional ref node.
export function refToA1(n) {
  const sheet = n.sheet ? `${quoteSheet(n.sheet)}!` : "";
  const col = (c, abs) => `${abs ? "$" : ""}${indexToCol(c)}`;
  const row = (r, abs) => `${abs ? "$" : ""}${r + 1}`;
  switch (n.kind) {
    case "cell": return `${sheet}${col(n.c1, n.ac1)}${row(n.r1, n.ar1)}`;
    case "range": return `${sheet}${col(n.c1, n.ac1)}${row(n.r1, n.ar1)}:${col(n.c2, n.ac2)}${row(n.r2, n.ar2)}`;
    case "cols": return `${sheet}${col(n.c1, n.ac1)}:${col(n.c2, n.ac2)}`;
    case "rows": return `${sheet}${row(n.r1, n.ar1)}:${row(n.r2, n.ar2)}`;
    case "open": return `${sheet}${col(n.c1, n.ac1)}${row(n.r1, n.ar1)}:${col(n.c2, n.ac2)}`;
    default: return "#REF!";
  }
}

const numText = (v) => {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-9)) {
    const [m, e] = v.toExponential().split("e");
    return `${m}E${e[0] === "-" ? "-" : "+"}${e.replace(/^[+-]/, "")}`;
  }
  return String(v);
};

// print(tree, { ref(node) → text }) → "=…". ref defaults to refToA1 for positional refs.
export function print(tree, { ref = refToA1, leadingEquals = true } = {}) {
  const go = (n, parentPrec = 0, right = false) => {
    switch (n.t) {
      case "num": return numText(n.v);
      case "str": return `"${n.v.replace(/"/g, '""')}"`;
      case "bool": return n.v ? "TRUE" : "FALSE";
      case "err": return n.v;
      case "empty": return "";
      case "ref": case "bound": return ref(n);
      case "name": return n.v;
      case "fn": return `${n.name}(${n.args.map((a) => go(a)).join(",")})`;
      case "arr": return `{${n.rows.map((r) => r.map((x) => go(x)).join(",")).join(";")}}`;
      case "un": return `${n.op}${go(n.a, 7)}`;
      case "pct": return `${go(n.a, 6)}%`;
      case "bin": {
        const pr = PREC[n.op];
        const rightAssoc = n.op === "^";
        const s = `${go(n.a, pr, rightAssoc)}${n.op}${go(n.b, pr, !rightAssoc)}`;
        return pr < parentPrec || (pr === parentPrec && right) ? `(${s})` : s;
      }
      default: return "";
    }
  };
  return (leadingEquals ? "=" : "") + go(tree);
}

// Every ref / bound node in a tree (in order).
export function refsIn(tree, out = []) {
  if (!tree || typeof tree !== "object") return out;
  if (tree.t === "ref" || tree.t === "bound") out.push(tree);
  else if (tree.t === "fn") tree.args.forEach((a) => refsIn(a, out));
  else if (tree.t === "arr") tree.rows.forEach((r) => r.forEach((x) => refsIn(x, out)));
  else if (tree.t === "un" || tree.t === "pct") refsIn(tree.a, out);
  else if (tree.t === "bin") { refsIn(tree.a, out); refsIn(tree.b, out); }
  return out;
}

export const PLACEHOLDER = (i) => `${PH_OPEN}${i}${PH_CLOSE}`;
