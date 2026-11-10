// Filters and filter views (SPREADSHEET_DESIGN.md §5 "Filters & sorting"). Pure: which
// rows a filter hides, the value list for a column, and the conditions Sheets offers.
// The data lives in model.js ("filters:<tab>"); ui.js draws and edits it.
//
// A filter (the tab's own, shared by everyone) or a filter view (named, only changes
// what the person using it sees) is:
//   { top: rowId (the header row), bottom: rowId | null (null = through the last filled row),
//     left: colId, right: colId, criteria: { colId: crit } }
//   crit: { hide?: [text…] (shown text of values to hide; "" is blanks),
//           cond?: { op, a?, b? }, color?: { fill?: "#rrggbb", text?: "#rrggbb" } }
//
// cellInfo(r, c) → { text, value, fill, color } as shown (ui.js passes displayOf).

import { textToNumber, textToDateSerial, isErr } from "./engine/values.js";

export const CONDITIONS = [
  { op: "empty", label: "Is empty", n: 0 },
  { op: "notEmpty", label: "Is not empty", n: 0 },
  { sep: true },
  { op: "contains", label: "Text contains", n: 1 },
  { op: "notContains", label: "Text does not contain", n: 1 },
  { op: "starts", label: "Text starts with", n: 1 },
  { op: "ends", label: "Text ends with", n: 1 },
  { op: "textIs", label: "Text is exactly", n: 1 },
  { sep: true },
  { op: "dateIs", label: "Date is", n: 1, date: true },
  { op: "dateBefore", label: "Date is before", n: 1, date: true },
  { op: "dateAfter", label: "Date is after", n: 1, date: true },
  { sep: true },
  { op: "gt", label: "Greater than", n: 1 },
  { op: "gte", label: "Greater than or equal to", n: 1 },
  { op: "lt", label: "Less than", n: 1 },
  { op: "lte", label: "Less than or equal to", n: 1 },
  { op: "eq", label: "Is equal to", n: 1 },
  { op: "ne", label: "Is not equal to", n: 1 },
  { op: "between", label: "Is between", n: 2 },
  { op: "notBetween", label: "Is not between", n: 2 },
];
export const conditionOf = (op) => CONDITIONS.find((c) => c.op === op) || null;

const DAY = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
// "today" / "tomorrow" / "yesterday" or a typed date → a serial day
export function dateArg(text, now = Date.now()) {
  const t = String(text ?? "").trim().toLowerCase();
  const today = Math.floor((now - new Date(now).getTimezoneOffset() * 60000 - EPOCH) / DAY);
  if (t === "today") return today;
  if (t === "tomorrow") return today + 1;
  if (t === "yesterday") return today - 1;
  const d = textToDateSerial(String(text ?? "").trim());
  if (d !== null && d !== undefined) return Math.floor(d);
  const n = textToNumber(String(text ?? "").trim());
  return typeof n === "number" ? Math.floor(n) : null;
}

const num = (s) => { if (s === null || s === undefined || s === "") return null; const n = typeof s === "number" ? s : textToNumber(String(s).trim()); return typeof n === "number" && Number.isFinite(n) ? n : null; };
const lower = (s) => String(s ?? "").toLowerCase();

// Does a shown cell pass one condition?
export function passesCondition(cond, { text, value }, now) {
  if (!cond?.op) return true;
  const empty = value === null || value === undefined || value === "";
  const t = lower(text), a = cond.a ?? "", b = cond.b ?? "";
  switch (cond.op) {
    case "empty": return empty;
    case "notEmpty": return !empty;
    case "contains": return t.includes(lower(a));
    case "notContains": return !t.includes(lower(a));
    case "starts": return t.startsWith(lower(a));
    case "ends": return t.endsWith(lower(a));
    case "textIs": return t === lower(a);
    case "dateIs": case "dateBefore": case "dateAfter": {
      if (typeof value !== "number") return false;
      const d = dateArg(a, now);
      if (d === null) return true; // nothing usable typed yet: don't hide everything
      const v = Math.floor(value);
      return cond.op === "dateIs" ? v === d : cond.op === "dateBefore" ? v < d : v > d;
    }
    case "eq": case "ne": {
      const n = num(a);
      const same = n !== null && typeof value === "number" ? value === n : t === lower(a);
      return cond.op === "eq" ? same : !same;
    }
    case "gt": case "gte": case "lt": case "lte": {
      const n = num(a);
      if (n === null) return true;
      if (typeof value !== "number") return false;
      return cond.op === "gt" ? value > n : cond.op === "gte" ? value >= n : cond.op === "lt" ? value < n : value <= n;
    }
    case "between": case "notBetween": {
      const x = num(a), y = num(b);
      if (x === null || y === null) return true;
      const lo = Math.min(x, y), hi = Math.max(x, y);
      const inside = typeof value === "number" && value >= lo && value <= hi;
      return cond.op === "between" ? inside : !inside;
    }
    default: return true;
  }
}

// A cell's shown text as the value list names it ("" for blanks; errors by their code).
export const listText = (info) => (isErr(info.value) ? info.value.code : String(info.text ?? ""));

export function passesCriteria(crit, info, now) {
  if (!crit) return true;
  if (crit.hide?.length && crit.hide.includes(listText(info))) return false;
  if (crit.cond && !passesCondition(crit.cond, info, now)) return false;
  if (crit.color?.fill && lower(info.fill) !== lower(crit.color.fill)) return false;
  if (crit.color?.text && lower(info.color) !== lower(crit.color.text)) return false;
  return true;
}
export const hasCriteria = (crit) => Boolean(crit && (crit.hide?.length || crit.cond?.op || crit.color?.fill || crit.color?.text));

// The filter's rows and columns as indexes now: { r1 (header), r2, c1, c2 } or null
// when its header row or edge columns were deleted.
export function filterBounds(model, tab, spec) {
  if (!spec) return null;
  const rows = model.rowIds(tab), cols = model.colIds(tab);
  const r1 = rows.indexOf(spec.top);
  let c1 = cols.indexOf(spec.left), c2 = cols.indexOf(spec.right);
  if (r1 < 0 || c1 < 0 || c2 < 0) return null;
  if (c1 > c2) [c1, c2] = [c2, c1];
  let r2;
  if (spec.bottom) {
    r2 = rows.indexOf(spec.bottom);
    if (r2 < 0) r2 = lastFilledRow(model, tab, c1, c2, rows, cols);
  } else r2 = lastFilledRow(model, tab, c1, c2, rows, cols);
  return { r1, r2: Math.max(r1, r2), c1, c2 };
}
function lastFilledRow(model, tab, c1, c2, rows, cols) {
  const rowIx = new Map(rows.map((id, i) => [id, i]));
  const colIx = new Map(cols.map((id, i) => [id, i]));
  let last = 0;
  for (const k of model._cells(tab).keys()) {
    const [rid, cid] = k.split(".");
    const c = colIx.get(cid), r = rowIx.get(rid);
    if (c === undefined || r === undefined || c < c1 || c > c2) continue;
    if (r > last) last = r;
  }
  return last;
}

// The rows (indexes) the filter hides. skipCol: leave that column's own criteria out
// (the value list shows what the other columns let through).
export function hiddenRows(model, tab, spec, cellInfo, { skipCol = null, now = Date.now() } = {}) {
  const out = new Set();
  const b = filterBounds(model, tab, spec);
  if (!b) return out;
  const cols = model.colIds(tab);
  const active = [];
  for (let c = b.c1; c <= b.c2; c++) {
    const crit = spec.criteria?.[cols[c]];
    if (c !== skipCol && hasCriteria(crit)) active.push([c, crit]);
  }
  if (!active.length) return out;
  for (let r = b.r1 + 1; r <= b.r2; r++) {
    for (const [c, crit] of active) {
      if (!passesCriteria(crit, cellInfo(r, c), now)) { out.add(r); break; }
    }
  }
  return out;
}

// The value list for column c: what each row shows, how many times, and whether it's
// ticked (not hidden by this column), counting only rows the other columns let through.
export function valueList(model, tab, spec, c, cellInfo, { now = Date.now() } = {}) {
  const b = filterBounds(model, tab, spec);
  if (!b) return [];
  const others = hiddenRows(model, tab, spec, cellInfo, { skipCol: c, now });
  const crit = spec.criteria?.[model.colIds(tab)[c]];
  const hide = new Set(crit?.hide || []);
  const counts = new Map(), sample = new Map();
  for (let r = b.r1 + 1; r <= b.r2; r++) {
    if (others.has(r)) continue;
    const info = cellInfo(r, c);
    const t = listText(info);
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!sample.has(t)) sample.set(t, info.value);
  }
  // values hidden here stay listed (unticked) even when no row shows them now
  for (const t of hide) if (!counts.has(t)) counts.set(t, 0);
  const list = [...counts].map(([text, count]) => ({ text, count, shown: !hide.has(text), value: sample.get(text) ?? null }));
  // blanks last, numbers by value, the rest A→Z
  list.sort((x, y) => {
    if ((x.text === "") !== (y.text === "")) return x.text === "" ? 1 : -1;
    const xn = typeof x.value === "number", yn = typeof y.value === "number";
    if (xn && yn) return x.value - y.value;
    if (xn !== yn) return xn ? -1 : 1;
    return x.text.localeCompare(y.text, undefined, { numeric: true, sensitivity: "base" });
  });
  return list;
}

// The data region around a cell (Sheets' "create a filter" with one cell selected):
// grows while the next row/column has something in it.
export function regionAround(filled, r, c, maxR, maxC) {
  let r1 = r, r2 = r, c1 = c, c2 = c;
  const rowHas = (rr, a, b2) => { for (let x = a; x <= b2; x++) if (filled(rr, x)) return true; return false; };
  const colHas = (cc, a, b2) => { for (let y = a; y <= b2; y++) if (filled(y, cc)) return true; return false; };
  for (let grew = true; grew;) {
    grew = false;
    if (r1 > 0 && rowHas(r1 - 1, Math.max(0, c1 - 1), Math.min(maxC, c2 + 1))) { r1--; grew = true; }
    if (r2 < maxR && rowHas(r2 + 1, Math.max(0, c1 - 1), Math.min(maxC, c2 + 1))) { r2++; grew = true; }
    if (c1 > 0 && colHas(c1 - 1, Math.max(0, r1 - 1), Math.min(maxR, r2 + 1))) { c1--; grew = true; }
    if (c2 < maxC && colHas(c2 + 1, Math.max(0, r1 - 1), Math.min(maxR, r2 + 1))) { c2++; grew = true; }
  }
  return { r1, r2, c1, c2 };
}
