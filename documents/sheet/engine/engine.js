// The calculation engine (SPREADSHEET_DESIGN.md §3). Keeps every tab's row and column
// order, the cells' inputs and formulas, works out which formulas depend on which cells,
// and recalculates only what an edit touched. No DOM, no I/O: it runs on the main thread
// in tests and in a Web Worker in the app (worker.js).
//
// Rows and columns are known by identity (§2). Formulas arrive already "bound": their
// references name tab / row / column ids (model.js binds A1 text to ids), so inserting,
// deleting or sorting rows never rewrites a formula; the engine only re-reads the order.
//
//   const eng = createEngine({ functions });
//   eng.setTab(tabId, { name, rows: [rowId…], cols: [colId…] });
//   eng.setCell(tabId, rowId, colId, value | { formula: boundTree } | null);
//   const changed = eng.recalc();          // keys whose value may have changed
//   eng.valueAt(tabId, rowIndex, colIndex) / eng.value(tabId, rowId, colId)
//
// Bound ref node: { t: "ref", kind, sheet: tabId, r1, c1, r2, c2 (ids or null), …flags }
// or { t: "ref", bad: true } for a reference whose row, column or tab was deleted.

import { unbind } from "./binding.js";
import { print } from "./parser.js";
import { EMPTY, ERR, err, isErr, isEmpty, Matrix, isMatrix, toNumber, toText, toBool, compare, numberToText, serialFromMs } from "./values.js";

export const OMIT = Symbol("omitted argument");

// A reference at run time: a tab and a rectangle of positions (0-based, inclusive).
export class Ref {
  constructor(tab, r1, c1, r2, c2) { this.tab = tab; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  get h() { return this.r2 - this.r1 + 1; }
  get w() { return this.c2 - this.c1 + 1; }
  get single() { return this.r1 === this.r2 && this.c1 === this.c2; }
}
export const isRef = (v) => v instanceof Ref;

// A function value made by LAMBDA.
export class Lambda {
  constructor(params, body, scope) { this.params = params; this.body = body; this.scope = scope; }
}
export const isLambda = (v) => v instanceof Lambda;

const SCALAR_KINDS = new Set(["number", "int", "text", "bool", "scalar"]);
const VOLATILE = new Set(["NOW", "TODAY", "RAND", "RANDBETWEEN", "RANDARRAY", "INDIRECT", "OFFSET", "CELL", "INFO"]);
const MAX_DEPTH = 250; // levels of formula-calls-formula before deferring (each is several JS frames)
const DEFER = Symbol("defer");
const MAX_SPILL_CELLS = 2_000_000;

export function createEngine({ functions = new Map(), now = () => Date.now(), random = Math.random } = {}) {
  const tabs = new Map(); // tabId → { id, name, rows, cols, rowIx, colIx }
  const tabByName = new Map(); // lower-case name → tabId
  const consts = new Map(); // key → value (inputs that aren't formulas)
  const formulas = new Map(); // key → F
  const byTab = new Map(); // tabId → Set<F>
  const directDeps = new Map(); // key → Set<F>
  const rangeDeps = new Map(); // tabId → Set<entry { f, ref }>
  const names = new Map(); // UPPER name → bound ref node
  const nameUsers = new Map(); // UPPER name → Set<F>
  const spillOwner = new Map(); // key → F (cells covered by an array result, not its anchor)
  const blocked = new Set(); // F whose array result is blocked
  let pendingChanged = new Set(); // keys changed since the last recalc
  let pendingDirty = new Set(); // F to recalculate
  let settings = { iterative: false };

  const key = (tab, row, col) => `${tab}|${row}|${col}`;
  const splitKey = (k) => k.split("|");

  // ---- tabs and order -----------------------------------------------------------------------

  function setTab(id, { name = id, rows = [], cols = [] } = {}) {
    let t = tabs.get(id);
    const isNew = !t;
    if (!t) { t = { id, name, rows: [], cols: [], rowIx: new Map(), colIx: new Map() }; tabs.set(id, t); byTab.set(id, new Set()); rangeDeps.set(id, new Set()); }
    if (t.name !== name || isNew) {
      if (!isNew) tabByName.delete(t.name.toLowerCase());
      t.name = name;
      tabByName.set(name.toLowerCase(), id);
      // formulas that named this tab by text (INDIRECT) are volatile anyway
    }
    setOrder(id, rows, cols);
  }

  function setOrder(id, rows, cols) {
    const t = tabs.get(id);
    if (!t) return;
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const rowsChanged = !same(t.rows, rows), colsChanged = !same(t.cols, cols);
    if (!rowsChanged && !colsChanged) return;
    t.rows = rows.slice(); t.cols = cols.slice();
    t.rowIx = new Map(t.rows.map((r, i) => [r, i]));
    t.colIx = new Map(t.cols.map((c, i) => [c, i]));
    // Positions moved: anything positional on this tab, and every range into it, recalculates.
    for (const f of byTab.get(id)) { releaseSpill(f); pendingDirty.add(f); }
    for (const e of rangeDeps.get(id)) pendingDirty.add(e.f);
    for (const f of blocked) pendingDirty.add(f);
  }

  function removeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    for (const f of [...byTab.get(id)]) removeFormula(f);
    for (const k of [...consts.keys()]) if (k.startsWith(`${id}|`)) { consts.delete(k); pendingChanged.add(k); }
    for (const e of rangeDeps.get(id)) pendingDirty.add(e.f);
    tabs.delete(id); byTab.delete(id); rangeDeps.delete(id);
    tabByName.delete(t.name.toLowerCase());
    // formulas pointing at the tab by id now resolve to #REF!
    for (const f of formulas.values()) if (f.tabsUsed.has(id)) pendingDirty.add(f);
  }

  // ---- cells --------------------------------------------------------------------------------

  // value: a number, text, boolean, SheetError, null (empty), or { formula: boundTree }.
  function setCell(tab, row, col, value) {
    const k = key(tab, row, col);
    const old = formulas.get(k);
    if (old) removeFormula(old);
    consts.delete(k);
    if (value && typeof value === "object" && value.formula) {
      addFormula(k, tab, row, col, value.formula);
    } else if (!isEmpty(value)) {
      consts.set(k, value);
    }
    pendingChanged.add(k);
    // typing into (or clearing) a cell an array result covers or wants
    const owner = spillOwner.get(k);
    if (owner) pendingDirty.add(owner);
    for (const f of blocked) pendingDirty.add(f);
  }

  function addFormula(k, tab, row, col, tree) {
    const f = { key: k, tab, row, col, tree, dirty: true, value: EMPTY, evaluating: false, volatile: false, spill: null, deps: [], ranges: [], names: [], tabsUsed: new Set() };
    formulas.set(k, f);
    byTab.get(tab)?.add(f);
    indexDeps(f);
    pendingDirty.add(f);
  }

  function removeFormula(f) {
    releaseSpill(f);
    unindexDeps(f);
    formulas.delete(f.key);
    byTab.get(f.tab)?.delete(f);
    blocked.delete(f);
    pendingDirty.delete(f);
    pendingChanged.add(f.key);
  }

  function walk(tree, fn) {
    if (!tree || typeof tree !== "object") return;
    fn(tree);
    if (tree.t === "fn") tree.args.forEach((a) => walk(a, fn));
    else if (tree.t === "arr") tree.rows.forEach((r) => r.forEach((x) => walk(x, fn)));
    else if (tree.t === "un" || tree.t === "pct") walk(tree.a, fn);
    else if (tree.t === "bin") { walk(tree.a, fn); walk(tree.b, fn); }
  }

  function indexDeps(f) {
    walk(f.tree, (n) => {
      if (n.t === "fn" && VOLATILE.has(n.name)) f.volatile = true;
      if (n.t === "fn" && !functions.has(n.name) && n.name !== "LET" && n.name !== "LAMBDA") f.volatile = f.volatile || false;
      if (n.t === "name") {
        const u = n.v.toUpperCase();
        f.names.push(u);
        if (!nameUsers.has(u)) nameUsers.set(u, new Set());
        nameUsers.get(u).add(f);
        const target = names.get(u);
        if (target) addRefDep(f, target);
      }
      if (n.t === "ref" && !n.bad) addRefDep(f, n);
    });
  }
  function addRefDep(f, n) {
    const tab = n.sheet || f.tab;
    f.tabsUsed.add(tab);
    if (n.kind === "cell") {
      const k = key(tab, n.r1, n.c1);
      if (!directDeps.has(k)) directDeps.set(k, new Set());
      directDeps.get(k).add(f);
      f.deps.push(k);
    } else {
      const e = { f, tab, n };
      if (!rangeDeps.has(tab)) rangeDeps.set(tab, new Set());
      rangeDeps.get(tab).add(e);
      f.ranges.push(e);
    }
  }
  function unindexDeps(f) {
    for (const k of f.deps) directDeps.get(k)?.delete(f);
    for (const e of f.ranges) rangeDeps.get(e.tab)?.delete(e);
    for (const u of f.names) nameUsers.get(u)?.delete(f);
    f.deps = []; f.ranges = []; f.names = []; f.tabsUsed = new Set();
  }

  function setName(name, boundRef) {
    const u = name.toUpperCase();
    if (boundRef) names.set(u, boundRef); else names.delete(u);
    for (const f of [...(nameUsers.get(u) || [])]) { unindexDeps(f); indexDeps(f); pendingDirty.add(f); } // a copy: re-indexing adds to the set
  }

  // ---- resolving refs -------------------------------------------------------------------

  // Bound ref node → Ref (positions) or an error.
  function resolve(n, f) {
    if (n.bad) return err(ERR.REF, "Reference does not exist.");
    const tabId = n.sheet || f.tab;
    const t = tabs.get(tabId);
    if (!t) return err(ERR.REF, "Unresolved sheet name.");
    const ri = (id) => (id === null || id === undefined ? null : t.rowIx.get(id));
    const ci = (id) => (id === null || id === undefined ? null : t.colIx.get(id));
    let r1, r2, c1, c2;
    switch (n.kind) {
      case "cell": r1 = r2 = ri(n.r1); c1 = c2 = ci(n.c1); break;
      case "range": r1 = ri(n.r1); r2 = ri(n.r2); c1 = ci(n.c1); c2 = ci(n.c2); break;
      case "cols": r1 = 0; r2 = t.rows.length - 1; c1 = ci(n.c1); c2 = ci(n.c2); break;
      case "rows": r1 = ri(n.r1); r2 = ri(n.r2); c1 = 0; c2 = t.cols.length - 1; break;
      case "open": r1 = ri(n.r1); r2 = t.rows.length - 1; c1 = ci(n.c1); c2 = ci(n.c2); break;
      default: return err(ERR.REF);
    }
    if ([r1, r2, c1, c2].some((x) => x === undefined || x === null)) return err(ERR.REF, "Reference does not exist.");
    if (r1 > r2) [r1, r2] = [r2, r1];
    if (c1 > c2) [c1, c2] = [c2, c1];
    if (r2 < r1 || c2 < c1 || t.rows.length === 0 || t.cols.length === 0) return err(ERR.REF);
    return new Ref(tabId, r1, c1, r2, c2);
  }

  function refAt(tabId, r1, c1, r2 = r1, c2 = c1) {
    const t = tabs.get(tabId);
    if (!t || r1 < 0 || c1 < 0 || r2 >= t.rows.length || c2 >= t.cols.length || r1 > r2 || c1 > c2) return err(ERR.REF, "Reference out of the sheet's bounds.");
    return new Ref(tabId, r1, c1, r2, c2);
  }

  const grid = {
    tabIdByName: (name) => tabByName.get(String(name).toLowerCase()),
    tabName: (id) => tabs.get(id)?.name,
    rowId: (tab, i) => tabs.get(tab)?.rows[i],
    colId: (tab, i) => tabs.get(tab)?.cols[i],
    rowIndex: (tab, id) => tabs.get(tab)?.rowIx.get(id),
    colIndex: (tab, id) => tabs.get(tab)?.colIx.get(id),
  };

  // ---- reading values ---------------------------------------------------------------------

  let depth = 0;
  let deferAt = null; // the formula to compute first when a chain is too deep for one go
  let lastEntered = null;

  function cellValueAt(tabId, r, c) {
    const t = tabs.get(tabId);
    if (!t) return err(ERR.REF);
    const rowId = t.rows[r], colId = t.cols[c];
    if (rowId === undefined || colId === undefined) return EMPTY;
    const k = key(tabId, rowId, colId);
    const f = formulas.get(k);
    if (f) {
      compute(f);
      const v = f.value;
      return isMatrix(v) ? v.get(0, 0) : v;
    }
    if (consts.has(k)) return consts.get(k);
    const owner = spillOwner.get(k);
    if (owner) {
      compute(owner);
      const v = owner.value;
      if (!isMatrix(v)) return EMPTY;
      const or = t.rowIx.get(owner.row), oc = t.colIx.get(owner.col);
      const dr = r - or, dc = c - oc;
      return dr >= 0 && dc >= 0 && dr < v.h && dc < v.w ? v.get(dr, dc) : EMPTY;
    }
    return EMPTY;
  }

  // Ref → Matrix of its values (computing what's needed).
  function deref(ref) {
    if (ref.h * ref.w > 5_000_000) return err(ERR.VALUE, "Range too large.");
    const rows = new Array(ref.h);
    for (let r = 0; r < ref.h; r++) {
      const row = new Array(ref.w);
      for (let c = 0; c < ref.w; c++) row[c] = cellValueAt(ref.tab, ref.r1 + r, ref.c1 + c);
      rows[r] = row;
    }
    return new Matrix(rows);
  }

  // Iterate a Ref's non-empty cells cheaply (SUM(A:A) on a big tab): yields values.
  function* refValues(ref) {
    for (let r = ref.r1; r <= ref.r2; r++) for (let c = ref.c1; c <= ref.c2; c++) yield cellValueAt(ref.tab, r, c);
  }

  // ---- evaluation --------------------------------------------------------------------------

  function compute(f) {
    if (!f.dirty) return;
    if (f.evaluating) { throw CYCLE; }
    if (depth > MAX_DEPTH) { deferAt = f; throw DEFER; }
    lastEntered = f;
    f.evaluating = true;
    depth++;
    try {
      let v;
      try {
        v = evaluate(f.tree, f, null);
        v = finish(v, f);
      } catch (e) {
        if (e === CYCLE) v = err(ERR.REF, "Circular dependency detected. To resolve with iterative calculation, see File > Settings.");
        else throw e;
      }
      setResult(f, v);
      f.dirty = false;
    } finally {
      f.evaluating = false;
      depth--;
    }
  }
  const CYCLE = Symbol("cycle");

  // The formula's final value: a reference becomes its values; one cell becomes a scalar.
  function finish(v, f) {
    if (v === OMIT) return EMPTY;
    if (isRef(v)) {
      if (v.single) return cellValueAt(v.tab, v.r1, v.c1);
      v = deref(v);
    }
    if (isLambda(v)) return err(ERR.VALUE, "A function value can't be the result of a formula; call it with arguments.");
    if (isMatrix(v)) {
      if (v.h === 0 || v.w === 0) return err(ERR.REF, "No results.");
      v = v.map((x) => (x === OMIT ? EMPTY : isRef(x) || isMatrix(x) || isLambda(x) ? err(ERR.VALUE) : fixNum(x)));
      if (v.h === 1 && v.w === 1) return v.get(0, 0);
      return v;
    }
    return fixNum(v);
  }
  const fixNum = (x) => (typeof x === "number" && !Number.isFinite(x) ? err(ERR.NUM) : x);

  function releaseSpill(f) {
    if (!f.spill) return;
    for (const k of f.spill.keys) { if (spillOwner.get(k) === f) { spillOwner.delete(k); pendingChanged.add(k); } }
    f.spill = null;
  }

  function setResult(f, v) {
    const old = f.spill;
    if (isMatrix(v)) {
      const t = tabs.get(f.tab);
      const r0 = t.rowIx.get(f.row), c0 = t.colIx.get(f.col);
      const keys = [];
      let problem = "";
      if (v.h * v.w > MAX_SPILL_CELLS) problem = "Result too large.";
      else if (r0 + v.h > t.rows.length || c0 + v.w > t.cols.length) problem = "Result was not automatically expanded, please insert more rows or columns.";
      else {
        for (let dr = 0; dr < v.h && !problem; dr++) for (let dc = 0; dc < v.w; dc++) {
          if (!dr && !dc) continue;
          const k = key(f.tab, t.rows[r0 + dr], t.cols[c0 + dc]);
          const other = spillOwner.get(k);
          if (consts.has(k) || formulas.has(k) || (other && other !== f)) {
            const at = `${String.fromCharCode(65 + ((c0 + dc) % 26))}${r0 + dr + 1}`;
            problem = `Array result was not expanded because it would overwrite data in ${at}.`;
            break;
          }
          keys.push(k);
        }
      }
      if (problem) {
        releaseSpill(f);
        blocked.add(f);
        f.value = err(ERR.REF, problem);
        return;
      }
      blocked.delete(f);
      const newSet = new Set(keys);
      if (old) for (const k of old.keys) if (!newSet.has(k) && spillOwner.get(k) === f) { spillOwner.delete(k); pendingChanged.add(k); }
      for (const k of keys) { spillOwner.set(k, f); pendingChanged.add(k); }
      f.spill = { keys, h: v.h, w: v.w };
      f.value = v;
      return;
    }
    blocked.delete(f);
    releaseSpill(f);
    f.value = v;
  }

  // evaluate(node, f, scope, arr) → value | Ref | Matrix | Lambda | OMIT
  // arr: array mode. As Sheets, a range of several cells used where one value is
  // expected (=A1:A3*2, =ABS(A1:A3)) is #VALUE! unless inside ARRAYFORMULA or an
  // argument of a function that takes arrays (SUMPRODUCT, FILTER, SORT…).
  function evaluate(n, f, scope, arr = false) {
    switch (n.t) {
      case "num": return n.v;
      case "str": return n.v;
      case "bool": return n.v;
      case "err": return err(n.v);
      case "empty": return OMIT;
      case "ref": return resolve(n, f);
      case "name": {
        for (let s = scope; s; s = s.parent) if (s.vars.has(n.v.toUpperCase())) return s.vars.get(n.v.toUpperCase());
        const target = names.get(n.v.toUpperCase());
        if (target) return resolve(target, f);
        return err(ERR.NAME, `Unknown range name: '${n.v}'.`);
      }
      case "arr": {
        const rows = n.rows.map((row) => row.map((x) => scalarOf(evaluate(x, f, scope, arr))));
        // an array literal may hold arrays ({A1:A3, B1:B3}): join them side by side / stacked
        if (rows.some((r) => r.some(isMatrix))) return joinArrayLiteral(rows);
        return new Matrix(rows);
      }
      case "un": {
        const a = arrayGate(evaluate(n.a, f, scope, arr), arr);
        return lift1(a, (x) => { const v = toNumber(x); return isErr(v) ? v : n.op === "-" ? -v : v; });
      }
      case "pct": return lift1(arrayGate(evaluate(n.a, f, scope, arr), arr), (x) => { const v = toNumber(x); return isErr(v) ? v : v / 100; });
      case "bin": return binary(n.op, arrayGate(evaluate(n.a, f, scope, arr), arr), arrayGate(evaluate(n.b, f, scope, arr), arr));
      case "fn": return callFn(n, f, scope, arr);
      default: return err(ERR.ERROR, "Formula parse error.");
    }
  }

  // Outside array mode a reference to several cells can't be one value.
  function arrayGate(v, arr) {
    if (!arr && isRef(v) && !v.single) return err(ERR.VALUE, "An array value could not be found.");
    return v;
  }

  // A Ref becomes its value (one cell) or a Matrix; a Matrix stays; OMIT is empty.
  function scalarOf(v) {
    if (v === OMIT) return EMPTY;
    if (isRef(v)) return v.single ? cellValueAt(v.tab, v.r1, v.c1) : deref(v);
    if (isMatrix(v) && v.h === 1 && v.w === 1) return v.get(0, 0);
    return v;
  }

  function joinArrayLiteral(rows) {
    // each row: parts side by side (same height); rows stacked (same width)
    const blocks = rows.map((row) => {
      const ms = row.map((x) => (isMatrix(x) ? x : new Matrix([[x]])));
      const h = ms[0].h;
      if (ms.some((m) => m.h !== h)) return null;
      return new Matrix(Array.from({ length: h }, (_, r) => ms.flatMap((m) => m.rows[r])));
    });
    if (blocks.some((b) => !b)) return err(ERR.VALUE, "Function ARRAY_ROW parameter 2 has mismatched row size.");
    const w = blocks[0].w;
    if (blocks.some((b) => b.w !== w)) return err(ERR.VALUE, "Function ARRAY_COL parameter 2 has mismatched column size.");
    return new Matrix(blocks.flatMap((b) => b.rows));
  }

  // Elementwise over arrays, with broadcasting of single rows/columns (as dynamic arrays).
  function lift1(a, fn) {
    a = scalarOf(a);
    if (isMatrix(a)) return a.map((x) => (isErr(x) ? x : fn(x)));
    if (isErr(a)) return a;
    if (isLambda(a)) return err(ERR.VALUE);
    return fn(a);
  }
  function pick(m, r, c) {
    const rr = m.h === 1 ? 0 : r, cc = m.w === 1 ? 0 : c;
    return rr < m.h && cc < m.w ? m.get(rr, cc) : err(ERR.NA, "Array arguments are of different size.");
  }
  function lift2(a, b, fn) {
    a = scalarOf(a); b = scalarOf(b);
    if (isMatrix(a) || isMatrix(b)) {
      const h = Math.max(isMatrix(a) ? a.h : 1, isMatrix(b) ? b.h : 1);
      const w = Math.max(isMatrix(a) ? a.w : 1, isMatrix(b) ? b.w : 1);
      return Matrix.of(h, w, (r, c) => {
        const x = isMatrix(a) ? pick(a, r, c) : a, y = isMatrix(b) ? pick(b, r, c) : b;
        return fn(x, y);
      });
    }
    return fn(a, b);
  }

  function binary(op, a, b) {
    return lift2(a, b, (x, y) => {
      if (isLambda(x) || isLambda(y)) return err(ERR.VALUE);
      if (op === "&") {
        const s = toText(x); if (isErr(s)) return s;
        const t = toText(y); if (isErr(t)) return t;
        return s + t;
      }
      if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        const c = compare(x, y);
        switch (op) { case "=": return c === 0; case "<>": return c !== 0; case "<": return c < 0; case ">": return c > 0; case "<=": return c <= 0; default: return c >= 0; }
      }
      const p = toNumber(x); if (isErr(p)) return p;
      const q = toNumber(y); if (isErr(q)) return q;
      switch (op) {
        case "+": return p + q;
        case "-": return p - q;
        case "*": return p * q;
        case "/": return q === 0 ? err(ERR.DIV0, "Function DIVIDE parameter 2 cannot be zero.") : p / q;
        case "^": {
          if (p === 0 && q < 0) return err(ERR.DIV0, "Function POW parameter 1 cannot be zero when parameter 2 is negative.");
          let r = Math.pow(p, q);
          if (p < 0 && !Number.isInteger(q)) { const inv = 1 / q; r = Number.isInteger(Math.round(inv)) && Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0 ? -Math.pow(-p, q) : NaN; }
          return Number.isFinite(r) ? r : err(ERR.NUM, "Function POW caused a number overflow or invalid result.");
        }
        default: return err(ERR.ERROR);
      }
    });
  }

  // ---- functions ---------------------------------------------------------------------------

  function wrongArgs(name, min, max, got) {
    const exp = max === Infinity ? `at least ${min} arguments` : min === max ? `${min} arguments` : `between ${min} and ${max} arguments`;
    return err(ERR.NA, `Wrong number of arguments to ${name}. Expected ${exp}, but got ${got} arguments.`);
  }

  function makeCtx(f, scope) {
    return {
      engine: api, formula: f, scope,
      get now() { return now(); },
      today: () => Math.floor(serialFromMs(now() - new Date(now()).getTimezoneOffset() * 60000)),
      nowSerial: () => serialFromMs(now() - new Date(now()).getTimezoneOffset() * 60000),
      random,
      position: () => { const t = tabs.get(f.tab); return { tab: f.tab, r: t.rowIx.get(f.row), c: t.colIx.get(f.col) }; },
      deref, refValues, scalarOf, cellValueAt, refAt,
      tabSize: (id) => { const t = tabs.get(id); return t ? { rows: t.rows.length, cols: t.cols.length } : null; },
      tabName: (id) => tabs.get(id)?.name,
      tabIdByName: (name) => tabByName.get(String(name).toLowerCase()),
      callLambda: (lam, args) => callLambda(lam, args, f),
      evaluate: (node, sc = scope, arr = false) => evaluate(node, f, sc, arr),
      isFormulaAt: (tabId, r, c) => { const t = tabs.get(tabId); return !!t && formulas.has(key(tabId, t.rows[r], t.cols[c])); },
      formulaTextAt: (tabId, r, c) => {
        const t = tabs.get(tabId);
        const g = t && formulas.get(key(tabId, t.rows[r], t.cols[c]));
        return g ? print(unbind(g.tree, grid, g.tab)) : null;
      },
      formulaAt: (tabId, r, c) => { const t = tabs.get(tabId); return t ? formulas.get(key(tabId, t.rows[r], t.cols[c]))?.tree || null : null; },
    };
  }

  function callLambda(lam, args, f) {
    if (args.length !== lam.params.length) return err(ERR.NA, `Wrong number of arguments to LAMBDA. Expected ${lam.params.length} arguments, but got ${args.length} arguments.`);
    const vars = new Map(lam.params.map((p, i) => [p, args[i]]));
    return evaluate(lam.body, f, { vars, parent: lam.scope });
  }

  function callFn(n, f, scope, arr = false) {
    const name = n.name;
    if (name === "LET") {
      if (n.args.length < 3 || n.args.length % 2 === 0) return wrongArgs("LET", 3, Infinity, n.args.length);
      const vars = new Map();
      const sc = { vars, parent: scope };
      for (let i = 0; i < n.args.length - 1; i += 2) {
        const nm = n.args[i];
        if (nm.t !== "name") return err(ERR.VALUE, "LET names must be valid names.");
        vars.set(nm.v.toUpperCase(), evaluate(n.args[i + 1], f, sc, arr));
      }
      return evaluate(n.args[n.args.length - 1], f, sc, arr);
    }
    if (name === "LAMBDA") {
      if (!n.args.length) return wrongArgs("LAMBDA", 1, Infinity, 0);
      const params = n.args.slice(0, -1);
      if (params.some((p) => p.t !== "name")) return err(ERR.VALUE, "LAMBDA parameters must be valid names.");
      return new Lambda(params.map((p) => p.v.toUpperCase()), n.args[n.args.length - 1], scope);
    }
    // a LET/LAMBDA variable holding a function, called by name: MYFN(1,2)
    for (let s = scope; s; s = s.parent) {
      const v = s.vars.get(name);
      if (isLambda(v)) return callLambda(v, n.args.map((a) => evaluate(a, f, scope, arr)), f);
    }
    const def = functions.get(name);
    if (!def) return err(ERR.NAME, `Unknown function: '${name}'.`);
    const argc = n.args.length;
    const min = def.min ?? 0, max = def.max ?? Infinity;
    if (argc < min || argc > max) return wrongArgs(name, min, max, argc);
    const ctx = makeCtx(f, scope);
    if (def.lazy) return guarded(def, () => def.fn(ctx, n.args.map((a) => (forceArray) => evaluate(a, f, scope, arr || !!forceArray || !!def.arrayArgs)), n.args));
    const vals = n.args.map((a, i) => evaluate(a, f, scope, arr || kindOf(def, i) === "matrix"));
    return apply(def, vals, ctx, arr);
  }

  // An argument's kind: def.args by position; past them, def.repeat cycles (SUMIFS's
  // range/criterion pairs), else the last of def.args repeats.
  function kindOf(def, i) {
    const a = def.args || ["any"];
    if (i < a.length) return a[i];
    if (def.repeat) return def.repeat[(i - a.length) % def.repeat.length];
    return a[a.length - 1] ?? "any";
  }

  // Coerce arguments by kind and lift scalar functions over arrays.
  function apply(def, vals, ctx, arr = false) {
    const kindAt = (i) => kindOf(def, i);
    const prepared = new Array(vals.length);
    let h = 0, w = 0, lift = false;
    for (let i = 0; i < vals.length; i++) {
      const k = kindAt(i);
      let v = vals[i];
      if (SCALAR_KINDS.has(k)) {
        if (!arr && isRef(v) && !v.single && !def.noLift) return err(ERR.VALUE, `Function ${def.name} parameter ${i + 1} expects a single value, but a range was given (use ARRAYFORMULA).`);
        if (v !== OMIT) v = scalarOf(v);
        if (isMatrix(v) && !(def.noLift)) { lift = true; h = Math.max(h, v.h); w = Math.max(w, v.w); }
      } else if (k === "matrix") {
        if (v === OMIT) v = OMIT;
        else if (isRef(v)) v = deref(v);
        else if (!isMatrix(v) && !isLambda(v)) v = new Matrix([[v]]);
      }
      prepared[i] = v;
    }
    if (lift) {
      return Matrix.of(h, w, (r, c) => {
        const args = prepared.map((v, i) => (SCALAR_KINDS.has(kindAt(i)) && isMatrix(v) ? pick(v, r, c) : v));
        const out = callScalar(def, args, kindAt, ctx);
        return isMatrix(out) ? out.get(0, 0) : isRef(out) ? scalarOf(out) : out;
      });
    }
    return callScalar(def, prepared, kindAt, ctx);
  }

  function callScalar(def, args, kindAt, ctx) {
    for (let i = 0; i < args.length; i++) {
      const k = kindAt(i);
      let v = args[i];
      if (v === OMIT) continue;
      if (!SCALAR_KINDS.has(k)) continue;
      if (isMatrix(v)) v = v.get(0, 0);
      if (isLambda(v)) return err(ERR.VALUE);
      if (k === "scalar") { if (isErr(v) && !def.acceptErrors) return v; args[i] = v; continue; }
      if (isErr(v)) { if (def.acceptErrors) { args[i] = v; continue; } return v; }
      if (k === "number") v = toNumber(v);
      else if (k === "int") { v = toNumber(v); if (!isErr(v)) v = Math.trunc(v); }
      else if (k === "text") v = toText(v);
      else if (k === "bool") v = toBool(v);
      if (isErr(v)) return withFnName(v, def.name, i);
      args[i] = v;
    }
    return guarded(def, () => def.fn(ctx, ...args));
  }
  // A function's own failure becomes its error value; the engine's signals pass through.
  function guarded(def, run) {
    try {
      return run();
    } catch (e) {
      if (e === DEFER || e === CYCLE || e instanceof RangeError) throw e;
      if (e && e.sheetError) return e.sheetError;
      if (typeof process !== "undefined" && process.env?.SHEET_DEBUG) console.error(def.name, e);
      return err(ERR.ERROR, `Internal error in ${def.name}.`);
    }
  }
  function withFnName(e, name, i) {
    if (e.code === ERR.VALUE && e.message.startsWith("Function expects")) return err(ERR.VALUE, `Function ${name} parameter ${i + 1} expects ${e.message.includes("boolean") ? "boolean" : "number"} values. ${e.message.replace(/^Function expects \w+ values\. /, "")}`);
    return e;
  }

  // ---- recalculation -----------------------------------------------------------------------

  function dependentsOf(k) {
    const out = [];
    for (const f of directDeps.get(k) || []) out.push(f);
    const [tabId, rowId, colId] = splitKey(k);
    const entries = rangeDeps.get(tabId);
    if (entries && entries.size) {
      const t = tabs.get(tabId);
      const r = t?.rowIx.get(rowId), c = t?.colIx.get(colId);
      if (r !== undefined && c !== undefined) {
        for (const e of entries) {
          const ref = resolve(e.n, e.f);
          if (isRef(ref) && r >= ref.r1 && r <= ref.r2 && c >= ref.c1 && c <= ref.c2) out.push(e.f);
        }
      }
    }
    return out;
  }

  // Marks every formula that reads (directly or not) the changed cells or dirty formulas.
  function propagate(changedKeys, seeds) {
    const queue = [...seeds];
    const seen = new Set(queue);
    for (const k of changedKeys) for (const f of dependentsOf(k)) if (!seen.has(f)) { seen.add(f); queue.push(f); }
    while (queue.length) {
      const f = queue.pop();
      f.dirty = true;
      for (const g of dependentsOf(f.key)) if (!seen.has(g)) { seen.add(g); queue.push(g); }
      if (f.spill) for (const k of f.spill.keys) for (const g of dependentsOf(k)) if (!seen.has(g)) { seen.add(g); queue.push(g); }
    }
    return seen;
  }

  function order(fs) {
    // row-major within each tab, so chains running down a column compute shallowly
    return [...fs].sort((a, b) => {
      if (a.tab !== b.tab) return a.tab < b.tab ? -1 : 1;
      const t = tabs.get(a.tab);
      return (t.rowIx.get(a.row) - t.rowIx.get(b.row)) || (t.colIx.get(a.col) - t.colIx.get(b.col));
    });
  }

  // Recalculates what changed. Returns the keys whose value may have changed.
  function recalc() {
    const changedOut = new Set();
    for (const f of formulas.values()) if (f.volatile) pendingDirty.add(f);
    for (let round = 0; round < 50; round++) {
      const changed = pendingChanged; pendingChanged = new Set();
      const seeds = pendingDirty; pendingDirty = new Set();
      if (!changed.size && !seeds.size) break;
      for (const k of changed) changedOut.add(k);
      const dirty = propagate(changed, seeds);
      for (const f of dirty) changedOut.add(f.key);
      // Each formula is computed with a stack of work: when a chain is too deep for one
      // go, the formula where it stopped goes on top and is finished first.
      const todo = order([...dirty].filter((f) => formulas.get(f.key) === f)).reverse();
      let guard = 0;
      while (todo.length) {
        const f = todo[todo.length - 1];
        if (!f.dirty || formulas.get(f.key) !== f) { todo.pop(); continue; }
        depth = 0; deferAt = null;
        try { compute(f); todo.pop(); }
        catch (e) {
          if (e !== DEFER && !(e instanceof RangeError)) throw e;
          const next = e === DEFER ? deferAt : lastEntered;
          if (!next || next === f || ++guard > 1_000_000) { f.value = err(ERR.ERROR, "Calculation too deep."); f.dirty = false; todo.pop(); continue; }
          todo.push(next);
        }
      }
    }
    for (const k of pendingChanged) changedOut.add(k);
    pendingChanged = new Set();
    return changedOut;
  }

  // ---- reading results ---------------------------------------------------------------------

  function value(tabId, rowId, colId) {
    const t = tabs.get(tabId);
    if (!t) return EMPTY;
    const r = t.rowIx.get(rowId), c = t.colIx.get(colId);
    if (r === undefined || c === undefined) return EMPTY;
    return valueAt(tabId, r, c);
  }
  function valueAt(tabId, r, c) {
    if (pendingChanged.size || pendingDirty.size) recalc(); // never read a stale value
    depth = 0;
    try { return cellValueAt(tabId, r, c); } catch (e) { if (e === DEFER || e instanceof RangeError) { recalc(); depth = 0; return cellValueAt(tabId, r, c); } throw e; }
  }

  // Is this cell's value part of an array result (and which anchor)?
  function spillAnchorOf(tabId, rowId, colId) {
    const f = spillOwner.get(key(tabId, rowId, colId));
    return f ? { row: f.row, col: f.col } : null;
  }
  function formulaInfo(tabId, rowId, colId) {
    const f = formulas.get(key(tabId, rowId, colId));
    if (!f) return null;
    return { volatile: f.volatile, spill: f.spill ? { h: f.spill.h, w: f.spill.w } : null, blocked: blocked.has(f), error: isErr(f.value) ? f.value : null };
  }

  const api = {
    grid, setTab, setOrder, removeTab, setCell, setName, recalc, value, valueAt, spillAnchorOf, formulaInfo,
    tabs: () => [...tabs.values()].map((t) => ({ id: t.id, name: t.name, rows: t.rows.length, cols: t.cols.length })),
    tab: (id) => tabs.get(id),
    setSettings: (s) => { settings = { ...settings, ...s }; },
    get settings() { return settings; },
    // for tests and the dependency tracer
    _formulaCount: () => formulas.size,
  };
  return api;
}

export { EMPTY, toText, numberToText };
