// Rules on cells (SPREADSHEET_DESIGN.md §5): conditional formatting and data validation.
// Pure: what a rule looks like, whether a cell matches, the colour a scale gives, whether
// a value is valid, and a per-draw index so the grid can ask quickly. Storage is
// model.js ("rules:<tab>"); custom formulas are evaluated in the worker (engine/host.js)
// and arrive as the set of cells where the formula is TRUE.
//
// Ranges are by id: { top, bottom, left, right } (row / column ids; top or left null =
// from the first, bottom or right null = to the last), so rules follow inserts and sorts.
//
// A formatting rule:   { kind: "format", order, ranges, type: "single", cond: { op, a?, b?, f? },
//                        style: { bold?, italic?, underline?, strike?, color?, fill? } }
//                   or { kind: "format", order, ranges, type: "scale",
//                        min: { type: "min"|"num"|"pct"|"percentile", v?, color },
//                        mid?: { type: "none"|"num"|"pct"|"percentile", v?, color }, max: { … } }
// A validation rule:   { kind: "valid", ranges, type, reject?, help?, … } with type
//   "list"     items: [text…], display?: "chip" | "arrow" | "plain", colors?: { text: "#hex" }
//   "range"    source: { tab, top, bottom, left, right }, display?
//   "checkbox" checked?: text, unchecked?: text (default TRUE / FALSE)
//   "number"   op: between|notBetween|gt|gte|lt|lte|eq|ne, a, b?
//   "text"     op: contains|notContains|textIs|email|url, a?
//   "date"     op: valid|dateIs|dateBefore|dateAfter|between|notBetween, a?, b?
//   "formula"  f (stored, relative to the first range's top-left cell)

import { passesCondition, dateArg } from "./filters.js";
import { textToNumber, isErr } from "./engine/values.js";
import { readRef, indexToCol } from "./engine/parser.js";

const pickStyle = (st) => { const out = {}; for (const k of FORMAT_STYLE_KEYS) if (st?.[k] !== undefined && st[k] !== null) out[k] = st[k]; return out; };

export const FORMAT_STYLE_KEYS = ["bold", "italic", "underline", "strike", "color", "fill"];
export const NUMBER_OPS = [["between", "is between"], ["notBetween", "is not between"], ["gt", "greater than"], ["gte", "greater than or equal to"], ["lt", "less than"], ["lte", "less than or equal to"], ["eq", "is equal to"], ["ne", "is not equal to"]];
export const TEXT_OPS = [["contains", "contains"], ["notContains", "does not contain"], ["textIs", "is exactly"], ["email", "is a valid email"], ["url", "is a valid URL"]];
export const DATE_OPS = [["valid", "is a valid date"], ["dateIs", "is"], ["dateBefore", "is before"], ["dateAfter", "is after"], ["between", "is between"], ["notBetween", "is not between"]];

// ---- ranges --------------------------------------------------------------------------------

export function rangeBounds(model, tab, rg, rows = model.rowIds(tab), cols = model.colIds(tab)) {
  if (!rg || !rows.length || !cols.length) return null;
  const pos = (list, id, dflt) => (id === null || id === undefined ? dflt : list.indexOf(id));
  const r1 = pos(rows, rg.top, 0), r2 = pos(rows, rg.bottom, rows.length - 1);
  const c1 = pos(cols, rg.left, 0), c2 = pos(cols, rg.right, cols.length - 1);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return null;
  return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
}
// "B2:D20", "C:C", "A2:A" or "4:4" on this tab → a range by ids; null if it doesn't read.
export function rangeFromA1(model, tab, text) {
  const t = String(text || "").trim().replace(/^.*!/, "");
  const ref = readRef(t);
  if (!ref || ref.len !== t.length) return null;
  const n = ref.node, rows = model.rowIds(tab), cols = model.colIds(tab);
  const rid = (i) => (i === null || i === undefined ? null : rows[i] ?? undefined);
  const cid = (i) => (i === null || i === undefined ? null : cols[i] ?? undefined);
  let out;
  switch (n.kind) {
    case "cell": out = { top: rid(n.r1), bottom: rid(n.r1), left: cid(n.c1), right: cid(n.c1) }; break;
    case "range": out = { top: rid(Math.min(n.r1, n.r2)), bottom: rid(Math.max(n.r1, n.r2)), left: cid(Math.min(n.c1, n.c2)), right: cid(Math.max(n.c1, n.c2)) }; break;
    case "cols": out = { top: null, bottom: null, left: cid(Math.min(n.c1, n.c2)), right: cid(Math.max(n.c1, n.c2)) }; break;
    case "rows": out = { top: rid(Math.min(n.r1, n.r2)), bottom: rid(Math.max(n.r1, n.r2)), left: null, right: null }; break;
    case "open": out = { top: rid(n.r1), bottom: null, left: cid(Math.min(n.c1, n.c2)), right: cid(Math.max(n.c1, n.c2)) }; break;
    default: return null;
  }
  return Object.values(out).some((x) => x === undefined) ? null : out;
}
export function rangeToA1(model, tab, rg) {
  const rows = model.rowIds(tab), cols = model.colIds(tab);
  const r = (id) => rows.indexOf(id), c = (id) => cols.indexOf(id);
  if (rg.top === null && rg.bottom === null) return `${indexToCol(c(rg.left))}:${indexToCol(c(rg.right))}`;
  if (rg.left === null && rg.right === null) return `${r(rg.top) + 1}:${r(rg.bottom) + 1}`;
  const b = rangeBounds(model, tab, rg, rows, cols);
  if (!b) return "#REF!";
  const a = `${indexToCol(b.c1)}${b.r1 + 1}`;
  if (rg.bottom === null) return `${a}:${indexToCol(b.c2)}`;
  return b.r1 === b.r2 && b.c1 === b.c2 ? a : `${a}:${indexToCol(b.c2)}${b.r2 + 1}`;
}

export const inBounds = (b, r, c) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;

// ---- colours -------------------------------------------------------------------------------

const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb) => `#${rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
export function mix(a, b, t) {
  const x = hex(a), y = hex(b);
  if (!x || !y) return a || b || null;
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * Math.max(0, Math.min(1, p));
  const lo = Math.floor(k), hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}
// A scale point's number, given the range's numbers sorted ascending.
export function scalePoint(pt, sorted) {
  if (!pt || pt.type === "none") return null;
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const v = Number(pt.v);
  switch (pt.type) {
    case "min": return lo ?? null;
    case "max": return hi ?? null;
    case "num": return Number.isFinite(v) ? v : null;
    case "pct": return lo === undefined || !Number.isFinite(v) ? null : lo + ((hi - lo) * v) / 100;
    case "percentile": return Number.isFinite(v) ? percentile(sorted, v / 100) : null;
    default: return null;
  }
}
export function scaleColor(rule, value, sorted) {
  if (typeof value !== "number" || !sorted.length) return null;
  const pts = [[scalePoint(rule.min, sorted), rule.min?.color], ...(rule.mid && rule.mid.type !== "none" ? [[scalePoint(rule.mid, sorted), rule.mid.color]] : []), [scalePoint(rule.max, sorted), rule.max?.color]].filter(([v, c]) => v !== null && c);
  if (!pts.length) return null;
  if (value <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [v0, c0] = pts[i - 1], [v1, c1] = pts[i];
    if (value <= v1) return v1 === v0 ? c1 : mix(c0, c1, (value - v0) / (v1 - v0));
  }
  return pts[pts.length - 1][1];
}

// ---- validation ------------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
const num = (s) => { if (s === null || s === undefined || s === "") return null; const n = typeof s === "number" ? s : textToNumber(String(s).trim()); return typeof n === "number" ? n : null; };
const cmpNum = (op, v, a, b) => {
  if (a === null) return true;
  switch (op) {
    case "between": return b === null || (v >= Math.min(a, b) && v <= Math.max(a, b));
    case "notBetween": return b === null || v < Math.min(a, b) || v > Math.max(a, b);
    case "gt": return v > a; case "gte": return v >= a; case "lt": return v < a; case "lte": return v <= a;
    case "eq": return v === a; case "ne": return v !== a;
    default: return true;
  }
};

// The values a checkbox stands for.
export const checkboxValues = (rule) => {
  const parse = (x, dflt) => (x === undefined || x === null || x === "" ? dflt : (num(x) ?? (String(x).toUpperCase() === "TRUE" ? true : String(x).toUpperCase() === "FALSE" ? false : String(x))));
  return { on: parse(rule.checked, true), off: parse(rule.unchecked, false) };
};
const sameValue = (a, b) => (typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b);

// Is a value valid under the rule? (Blank cells always are, as in Sheets.)
// info: { value, text }; options: the list's items (for "list" and "range");
// formulaHit: whether the custom formula is TRUE at this cell.
export function isValid(rule, info, { options = null, formulaHit = null, now = Date.now() } = {}) {
  const v = info.value;
  if (v === null || v === undefined || v === "") return true;
  switch (rule.type) {
    case "list": case "range": {
      const items = options || rule.items || [];
      const t = String(info.text ?? v);
      return items.some((x) => String(x) === t);
    }
    case "checkbox": { const { on, off } = checkboxValues(rule); return sameValue(v, on) || sameValue(v, off); }
    case "number": return typeof v === "number" && cmpNum(rule.op, v, num(rule.a), num(rule.b));
    case "text": {
      const t = String(info.text ?? v);
      if (rule.op === "email") return EMAIL.test(t);
      if (rule.op === "url") return URL_RE.test(t);
      return passesCondition({ op: rule.op, a: rule.a }, { value: v, text: t }, now);
    }
    case "date": {
      if (typeof v !== "number") return false;
      const d = Math.floor(v);
      if (rule.op === "valid" || !rule.op) return true;
      if (rule.op === "between" || rule.op === "notBetween") return cmpNum(rule.op, d, dateArg(rule.a, now), dateArg(rule.b, now));
      return passesCondition({ op: rule.op, a: rule.a }, { value: v, text: "" }, now);
    }
    case "formula": return formulaHit === null ? true : formulaHit;
    default: return true;
  }
}

// The text a person sees when a value is refused or flagged.
export function describeRule(rule) {
  const label = (list, op) => list.find(([k]) => k === op)?.[1] || op;
  switch (rule.type) {
    case "list": return `Enter one of: ${(rule.items || []).slice(0, 8).join(", ")}${(rule.items || []).length > 8 ? "…" : ""}`;
    case "range": return "Enter a value from the list";
    case "checkbox": return "This cell is a checkbox";
    case "number": return `Enter a number that ${label(NUMBER_OPS, rule.op)} ${rule.a ?? ""}${rule.b !== undefined && /between/i.test(rule.op) ? ` and ${rule.b}` : ""}`.trim();
    case "text": return rule.op === "email" || rule.op === "url" ? `Enter text that ${label(TEXT_OPS, rule.op)}` : `Enter text that ${label(TEXT_OPS, rule.op)} "${rule.a ?? ""}"`;
    case "date": return rule.op === "valid" ? "Enter a valid date" : `Enter a date that ${label(DATE_OPS, rule.op)} ${rule.a ?? ""}${/between/i.test(rule.op) ? ` and ${rule.b ?? ""}` : ""}`.trim();
    case "formula": return "Enter a value that meets the rule";
    default: return "Invalid value";
  }
}

// ---- the per-draw index -------------------------------------------------------------------

// compileRules(model, tab, { cellInfo(r, c), hits(ruleId) → Set("rowId.colId") | null,
//   optionsOf(rule) → [text…] }) → { formatAt(r, c, info), validationAt(r, c), options(rule) }
export function compileRules(model, tab, { cellInfo, hits = () => null, optionsOf = () => [], now = Date.now() } = {}) {
  const rows = model.rowIds(tab), cols = model.colIds(tab);
  const all = model.rulesOf(tab);
  const formats = [], valids = [];
  for (const rule of all) {
    const bounds = (rule.ranges || []).map((rg) => rangeBounds(model, tab, rg, rows, cols)).filter(Boolean);
    if (!bounds.length) continue;
    const c = { rule, bounds };
    if (rule.kind === "format") {
      if (rule.type === "scale") {
        const nums = [];
        for (const b of bounds) for (let r = b.r1; r <= b.r2; r++) for (let cc = b.c1; cc <= b.c2; cc++) { const v = cellInfo(r, cc).value; if (typeof v === "number") nums.push(v); }
        c.sorted = nums.sort((x, y) => x - y);
      }
      formats.push(c);
    } else if (rule.kind === "valid") {
      if (rule.type === "list" || rule.type === "range") c.options = rule.type === "list" ? (rule.items || []).map(String) : optionsOf(rule);
      valids.push(c);
    }
  }
  formats.sort((a, b) => (a.rule.order ?? 0) - (b.rule.order ?? 0));
  const hit = (rule, r, c) => { const set = hits(rule.id); return set ? set.has(`${rows[r]}.${cols[c]}`) : null; };

  // Sheets: rules are tried top to bottom and the first that matches a cell is the one shown.
  function formatAt(r, c, info) {
    for (const f of formats) {
      if (!f.bounds.some((b) => inBounds(b, r, c))) continue;
      const rule = f.rule;
      if (rule.type === "scale") { const fill = scaleColor(rule, info.value, f.sorted); if (fill) return { fill }; continue; }
      const yes = rule.cond?.op === "formula" ? hit(rule, r, c) : rule.cond?.op && !isErr(info.value) && passesCondition(rule.cond, info, now);
      if (yes) return pickStyle(rule.style);
    }
    return null;
  }
  // The last validation rule covering a cell is the one that counts (as Sheets: a new rule replaces).
  function validationAt(r, c) {
    for (let i = valids.length - 1; i >= 0; i--) if (valids[i].bounds.some((b) => inBounds(b, r, c))) return valids[i];
    return null;
  }
  function check(r, c, info) {
    const v = validationAt(r, c);
    if (!v) return { rule: null, valid: true };
    return { rule: v.rule, valid: isValid(v.rule, info, { options: v.options, formulaHit: v.rule.type === "formula" ? hit(v.rule, r, c) : null, now }), options: v.options };
  }
  return { formatAt, validationAt, check, empty: !formats.length && !valids.length };
}
