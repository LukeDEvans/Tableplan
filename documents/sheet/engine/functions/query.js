// QUERY (SPREADSHEET_DESIGN.md §3, pass B): Google's query language over a range.
//   select … where … group by … pivot … order by … limit … offset … label … format … options …
// Columns are named by the range's sheet columns (A, B…) or, for computed arrays,
// Col1, Col2…. A column's type is the most common type among its data cells; cells of
// another type count as empty, as Sheets.

import { def, asMatrix, omitted, VAL_ERR, ERR, err, isErr, isEmpty, isMatrix, Matrix, isRef, compare } from "./helpers.js";
import { indexToCol } from "../parser.js";
import { ymdFromSerial, timeFromSerial, serialFromYMD, numberToText } from "../values.js";

class QErr extends Error {}
const fail = (m) => { throw new QErr(m); };

// ---- tokens ---------------------------------------------------------------------------
const KEYWORDS = new Set(["select", "where", "group", "by", "pivot", "order", "limit", "offset", "label", "format", "options", "and", "or", "not", "is", "null", "asc", "desc", "contains", "starts", "ends", "with", "matches", "like", "true", "false", "date", "datetime", "timeofday", "timestamp"]);
function tokenize(q) {
  const out = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" || ch === '"') { const j = q.indexOf(ch, i + 1); if (j < 0) fail("Unterminated string"); out.push({ k: "str", v: q.slice(i + 1, j) }); i = j + 1; continue; }
    if (ch === "`") { const j = q.indexOf("`", i + 1); if (j < 0) fail("Unterminated column name"); out.push({ k: "id", v: q.slice(i + 1, j) }); i = j + 1; continue; }
    let m;
    if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(q.slice(i)))) { out.push({ k: "num", v: Number(m[0]) }); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(q.slice(i)))) { const w = m[0]; out.push(KEYWORDS.has(w.toLowerCase()) ? { k: "kw", v: w.toLowerCase() } : { k: "id", v: w }); i += w.length; continue; }
    const two = q.slice(i, i + 2);
    if (["<=", ">=", "!=", "<>"].includes(two)) { out.push({ k: "op", v: two === "<>" ? "!=" : two }); i += 2; continue; }
    if ("=<>+-*/(),".includes(ch)) { out.push({ k: "op", v: ch }); i++; continue; }
    fail(`Unexpected "${ch}"`);
  }
  out.push({ k: "end" });
  return out;
}

// ---- parser -----------------------------------------------------------------------------
function parseQuery(q) {
  const t = tokenize(q);
  let p = 0;
  const peek = () => t[p], next = () => t[p++];
  const isKw = (v) => peek().k === "kw" && peek().v === v;
  const isOp = (v) => peek().k === "op" && peek().v === v;
  const expectKw = (v) => { if (!isKw(v)) fail(`Expected "${v}"`); next(); };
  const out = { select: null, where: null, group: [], pivot: [], order: [], limit: null, offset: 0, labels: new Map(), options: {} };

  function primary() {
    const tk = next();
    if (tk.k === "num") return { t: "lit", v: tk.v };
    if (tk.k === "str") return { t: "lit", v: tk.v };
    if (tk.k === "kw" && (tk.v === "true" || tk.v === "false")) return { t: "lit", v: tk.v === "true" };
    if (tk.k === "kw" && (tk.v === "date" || tk.v === "datetime" || tk.v === "timestamp")) {
      const s = next(); if (s.k !== "str") fail("Expected a date string");
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s.v);
      if (!m) fail(`Invalid date "${s.v}"`);
      return { t: "lit", v: serialFromYMD(+m[1], +m[2], +m[3]) + ((+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) / 86400, date: true };
    }
    if (tk.k === "op" && tk.v === "(") { const e = expr(); if (!isOp(")")) fail('Expected ")"'); next(); return e; }
    if (tk.k === "op" && tk.v === "-") return { t: "neg", a: primary() };
    if (tk.k === "id") {
      if (isOp("(")) {
        next();
        const args = [];
        if (!isOp(")")) for (;;) { args.push(expr()); if (isOp(",")) { next(); continue; } break; }
        if (!isOp(")")) fail('Expected ")"');
        next();
        return { t: "fn", name: tk.v.toLowerCase(), args };
      }
      return { t: "col", id: tk.v };
    }
    fail(`Unexpected "${tk.v ?? tk.k}"`);
  }
  function mul() { let a = primary(); while (isOp("*") || isOp("/")) { const op = next().v; a = { t: "bin", op, a, b: primary() }; } return a; }
  function add() { let a = mul(); while (isOp("+") || isOp("-")) { const op = next().v; a = { t: "bin", op, a, b: mul() }; } return a; }
  const expr = add;
  function cmp() {
    const a = add();
    if (peek().k === "op" && ["=", "!=", "<", ">", "<=", ">="].includes(peek().v)) { const op = next().v; return { t: "cmp", op, a, b: add() }; }
    if (isKw("is")) { next(); const neg = isKw("not") ? (next(), true) : false; expectKw("null"); return { t: "isnull", a, neg }; }
    if (isKw("contains")) { next(); return { t: "str", op: "contains", a, b: add() }; }
    if (isKw("starts")) { next(); expectKw("with"); return { t: "str", op: "starts", a, b: add() }; }
    if (isKw("ends")) { next(); expectKw("with"); return { t: "str", op: "ends", a, b: add() }; }
    if (isKw("matches")) { next(); return { t: "str", op: "matches", a, b: add() }; }
    if (isKw("like")) { next(); return { t: "str", op: "like", a, b: add() }; }
    return a;
  }
  function notExpr() { if (isKw("not")) { next(); return { t: "not", a: notExpr() }; } if (isOp("(")) { const save = p; try { next(); const e = orExpr(); if (isOp(")")) { next(); return e; } } catch (e) { if (!(e instanceof QErr)) throw e; } p = save; } return cmp(); }
  function andExpr() { let a = notExpr(); while (isKw("and")) { next(); a = { t: "and", a, b: notExpr() }; } return a; }
  function orExpr() { let a = andExpr(); while (isKw("or")) { next(); a = { t: "or", a, b: andExpr() }; } return a; }
  const list = () => { const l = [expr()]; while (isOp(",")) { next(); l.push(expr()); } return l; };

  while (peek().k !== "end") {
    if (isKw("select")) { next(); if (isOp("*")) { next(); out.select = "*"; } else out.select = list(); }
    else if (isKw("where")) { next(); out.where = orExpr(); }
    else if (isKw("group")) { next(); expectKw("by"); out.group = list(); }
    else if (isKw("pivot")) { next(); out.pivot = list(); }
    else if (isKw("order")) { next(); expectKw("by"); for (;;) { const e = expr(); let desc = false; if (isKw("asc")) next(); else if (isKw("desc")) { next(); desc = true; } out.order.push({ e, desc }); if (isOp(",")) { next(); continue; } break; } }
    else if (isKw("limit")) { next(); const n = next(); if (n.k !== "num") fail("LIMIT needs a number"); out.limit = n.v; }
    else if (isKw("offset")) { next(); const n = next(); if (n.k !== "num") fail("OFFSET needs a number"); out.offset = n.v; }
    else if (isKw("label")) { next(); for (;;) { const e = expr(); const s = next(); if (s.k !== "str") fail("LABEL needs a string"); out.labels.set(key(e), s.v); if (isOp(",")) { next(); continue; } break; } }
    else if (isKw("format")) { next(); for (;;) { expr(); const s = next(); if (s.k !== "str") fail("FORMAT needs a string"); if (isOp(",")) { next(); continue; } break; } }
    else if (isKw("options")) { next(); while (peek().k === "id") next(); }
    else fail(`Unexpected "${peek().v ?? peek().k}"`);
  }
  return out;
}

const AGG = new Set(["sum", "avg", "count", "max", "min"]);
function key(e) {
  switch (e.t) {
    case "col": return e.id;
    case "lit": return typeof e.v === "string" ? `'${e.v}'` : String(e.v);
    case "fn": return `${e.name}(${e.args.map(key).join(", ")})`;
    case "bin": return `${key(e.a)}${e.op}${key(e.b)}`;
    case "neg": return `-${key(e.a)}`;
    default: return "?";
  }
}
const hasAgg = (e) => e && (e.t === "fn" ? AGG.has(e.name) || e.args.some(hasAgg) : e.t === "bin" ? hasAgg(e.a) || hasAgg(e.b) : e.t === "neg" ? hasAgg(e.a) : false);

// ---- evaluation ------------------------------------------------------------------------
const typeOf = (v) => (typeof v === "number" ? "number" : typeof v === "string" ? "string" : typeof v === "boolean" ? "boolean" : null);

function scalarFn(name, args) {
  const a = args[0];
  const d = () => (typeof a === "number" ? ymdFromSerial(a) : null);
  switch (name) {
    case "year": return a === null ? null : d().y;
    case "month": return a === null ? null : d().m - 1; // 0-based, as Google's query language
    case "day": return a === null ? null : d().d;
    case "quarter": return a === null ? null : Math.floor((d().m - 1) / 3) + 1;
    case "dayofweek": return a === null ? null : d().wd + 1;
    case "hour": return a === null ? null : timeFromSerial(a).h;
    case "minute": return a === null ? null : timeFromSerial(a).mi;
    case "second": return a === null ? null : timeFromSerial(a).s;
    case "millisecond": return a === null ? null : 0;
    case "todate": return a === null ? null : Math.floor(a);
    case "upper": return a === null ? null : String(a).toUpperCase();
    case "lower": return a === null ? null : String(a).toLowerCase();
    case "datediff": return a === null || args[1] === null ? null : Math.floor(a) - Math.floor(args[1]);
    case "now": return null;
    default: fail(`Unknown function ${name}`);
  }
}

export function runQuery(data, query, headers, colNames) {
  const q = parseQuery(String(query || "select *"));
  const nCols = data.w;
  // header rows
  let h = headers;
  if (h === -1) {
    // Sheets guesses: one header row when the first row is text over columns whose data isn't all text
    const first = data.rows[0] || [];
    const allText = first.every((v) => typeof v === "string" || isEmpty(v));
    const restTypes = data.rows.slice(1).flat().map(typeOf).filter(Boolean);
    h = data.h > 1 && allText && first.some((v) => typeof v === "string") && restTypes.some((x) => x !== "string") ? 1 : 0;
  }
  h = Math.max(0, Math.min(data.h, h));
  const headText = Array.from({ length: nCols }, (_, c) => data.rows.slice(0, h).map((r) => (isEmpty(r[c]) ? "" : String(r[c]))).filter(Boolean).join(" "));
  const body = data.rows.slice(h);
  // column types by majority
  const types = Array.from({ length: nCols }, (_, c) => {
    const n = { number: 0, string: 0, boolean: 0 };
    for (const r of body) { const t = typeOf(r[c]); if (t) n[t]++; }
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(n).sort((a, b) => b[1] - a[1])[0][0] : "string";
  });
  const rows = body.map((r) => r.map((v, c) => (isErr(v) ? null : typeOf(v) === types[c] ? v : null)));
  const colIndex = (id) => { const i = colNames.findIndex((n) => n.toLowerCase() === id.toLowerCase()); if (i < 0) fail(`NO_COLUMN: ${id}`); return i; };

  function ev(e, row, group) {
    switch (e.t) {
      case "lit": return e.v;
      case "col": return row ? row[colIndex(e.id)] : null;
      case "neg": { const v = ev(e.a, row, group); return v === null ? null : -v; }
      case "bin": {
        const a = ev(e.a, row, group), b = ev(e.b, row, group);
        if (a === null || b === null) return null;
        if (typeof a !== "number" || typeof b !== "number") fail("Arithmetic needs numbers");
        return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : b === 0 ? null : a / b;
      }
      case "fn": {
        if (AGG.has(e.name)) {
          if (!group) fail(`${e.name} needs GROUP BY or only aggregates in SELECT`);
          const vals = group.map((r) => ev(e.args[0], r, null)).filter((v) => v !== null);
          if (e.name === "count") return vals.length;
          if (!vals.length) return null;
          if (e.name === "sum") return vals.reduce((x, y) => x + y, 0);
          if (e.name === "avg") return vals.reduce((x, y) => x + y, 0) / vals.length;
          return vals.reduce((x, y) => (compare(y, x) * (e.name === "max" ? 1 : -1) > 0 ? y : x));
        }
        return scalarFn(e.name, e.args.map((a) => ev(a, row, group)));
      }
      case "cmp": {
        const a = ev(e.a, row, group), b = ev(e.b, row, group);
        if (a === null || b === null) return false;
        const c = compare(a, b);
        return e.op === "=" ? c === 0 && typeof a === typeof b : e.op === "!=" ? !(c === 0 && typeof a === typeof b) : e.op === "<" ? c < 0 : e.op === ">" ? c > 0 : e.op === "<=" ? c <= 0 : c >= 0;
      }
      case "isnull": { const v = ev(e.a, row, group); return e.neg ? v !== null : v === null; }
      case "str": {
        const a = ev(e.a, row, group), b = ev(e.b, row, group);
        if (typeof a !== "string" || typeof b !== "string") return false;
        if (e.op === "contains") return a.includes(b);
        if (e.op === "starts") return a.startsWith(b);
        if (e.op === "ends") return a.endsWith(b);
        if (e.op === "matches") { try { return new RegExp(`^(?:${b})$`).test(a); } catch { fail(`Bad regular expression ${b}`); } }
        const re = new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, "[\\s\\S]*").replace(/_/g, "[\\s\\S]")}$`);
        return re.test(a);
      }
      case "not": return !ev(e.a, row, group);
      case "and": return Boolean(ev(e.a, row, group)) && Boolean(ev(e.b, row, group));
      case "or": return Boolean(ev(e.a, row, group)) || Boolean(ev(e.b, row, group));
      default: fail("Bad expression");
    }
  }
  const label = (e) => {
    const k = key(e);
    if (q.labels.has(k)) return q.labels.get(k);
    if (e.t === "col") return headText[colIndex(e.id)] || "";
    if (e.t === "fn" && AGG.has(e.name) && e.args[0]?.t === "col") return `${e.name} ${headText[colIndex(e.args[0].id)] || e.args[0].id}`;
    // Sheets names a column by its header inside other expressions too: "month(Start)"
    if (e.t === "fn" && e.args.every((a) => a.t === "col")) return `${e.name}(${e.args.map((a) => headText[colIndex(a.id)] || a.id).join(", ")})`;
    return k;
  };

  let filtered = q.where ? rows.filter((r) => ev(q.where, r, null)) : rows;
  const select = q.select === "*" || !q.select ? colNames.map((id) => ({ t: "col", id })) : q.select;
  const aggregate = q.group.length || q.pivot.length || select.some(hasAgg);
  let outRows, outHead;

  if (!aggregate) {
    outRows = filtered;
    if (q.order.length) {
      const keyed = outRows.map((r, i) => ({ r, i, k: q.order.map((o) => ev(o.e, r, null)) }));
      keyed.sort((x, y) => { for (let j = 0; j < q.order.length; j++) { const a = x.k[j], b = y.k[j]; if (a === null || b === null) { if (a !== b) return (a === null ? -1 : 1) * (q.order[j].desc ? -1 : 1); continue; } const c = compare(a, b); if (c) return q.order[j].desc ? -c : c; } return x.i - y.i; });
      outRows = keyed.map((x) => x.r);
    }
    outRows = outRows.slice(q.offset, q.limit === null ? undefined : q.offset + q.limit);
    outRows = outRows.map((r) => select.map((e) => ev(e, r, null)));
    outHead = select.map(label);
  } else {
    for (const e of select) if (!hasAgg(e) && !q.group.some((g) => key(g) === key(e))) fail(`ADD_COL_TO_GROUP_BY_OR_AGG: ${key(e)}`);
    const groups = new Map();
    for (const r of filtered) {
      const gk = q.group.map((g) => ev(g, r, null));
      const k = JSON.stringify(gk);
      if (!groups.has(k)) groups.set(k, { gk, rows: [] });
      groups.get(k).rows.push(r);
    }
    if (!q.group.length && !groups.size) groups.set("[]", { gk: [], rows: [] });
    let list = [...groups.values()];
    // groups are ordered by their keys, as Sheets
    list.sort((a, b) => { for (let j = 0; j < a.gk.length; j++) { const x = a.gk[j], y = b.gk[j]; if (x === null || y === null) { if (x !== y) return x === null ? -1 : 1; continue; } const c = compare(x, y); if (c) return c; } return 0; });
    if (q.pivot.length) {
      const pvals = [...new Set(filtered.map((r) => JSON.stringify(q.pivot.map((p) => ev(p, r, null)))))].map((s) => JSON.parse(s)).sort((a, b) => { for (let j = 0; j < a.length; j++) { const c = compare(a[j] ?? "", b[j] ?? ""); if (c) return c; } return 0; });
      const aggs = select.filter(hasAgg), keys = select.filter((e) => !hasAgg(e));
      outHead = [...keys.map(label), ...pvals.flatMap((pv) => aggs.map((a) => (aggs.length > 1 ? `${pv.join(", ")} ${label(a)}` : pv.map((x) => (x === null ? "" : typeof x === "number" ? numberToText(x) : String(x))).join(", "))))];
      outRows = list.map((g) => [...keys.map((e) => ev(e, g.rows[0], g.rows)), ...pvals.flatMap((pv) => { const sub = g.rows.filter((r) => JSON.stringify(q.pivot.map((p) => ev(p, r, null))) === JSON.stringify(pv)); return aggs.map((a) => (sub.length ? ev(a, sub[0], sub) : null)); })]);
    } else {
      outHead = select.map(label);
      let withKeys = list.map((g) => ({ g, row: select.map((e) => ev(e, g.rows[0] || null, g.rows)) }));
      if (q.order.length) {
        withKeys = withKeys.map((x, i) => ({ ...x, i, k: q.order.map((o) => ev(o.e, x.g.rows[0] || null, x.g.rows)) }));
        withKeys.sort((x, y) => { for (let j = 0; j < q.order.length; j++) { const a = x.k[j], b = y.k[j]; if (a === null || b === null) { if (a !== b) return (a === null ? -1 : 1) * (q.order[j].desc ? -1 : 1); continue; } const c = compare(a, b); if (c) return q.order[j].desc ? -c : c; } return x.i - y.i; });
      }
      outRows = withKeys.map((x) => x.row);
    }
    outRows = outRows.slice(q.offset, q.limit === null ? undefined : q.offset + q.limit);
  }
  const showHead = h > 0 || aggregate || q.labels.size > 0;
  const result = showHead ? [outHead.map((x) => x || ""), ...outRows] : outRows;
  if (!result.length || !result[0].length) return null;
  return new Matrix(result.map((r) => r.map((v) => (v === undefined ? null : v))));
}

export function queryFunctions() {
  return [
    def("QUERY", { args: ["any", "text", "number"], min: 1, max: 3, noLift: true }, (ctx, range, query, headers) => {
      const data = asMatrix(ctx, range);
      const names = isRef(range) ? Array.from({ length: data.w }, (_, i) => indexToCol(range.c1 + i)) : Array.from({ length: data.w }, (_, i) => `Col${i + 1}`);
      try {
        const out = runQuery(data, omitted(query) ? "select *" : query, omitted(headers) ? -1 : Math.trunc(headers), names);
        return out || err(ERR.NA, "Query completed with an empty output.");
      } catch (e) {
        if (e instanceof QErr) return VAL_ERR(`Unable to parse query string for Function QUERY parameter 2: ${e.message}`);
        throw e;
      }
    }),
  ];
}

export { isMatrix };
