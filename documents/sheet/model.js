// A spreadsheet's shared data (SPREADSHEET_DESIGN.md §2): one Y.Doc per spreadsheet.
// Only what people type is here (inputs, formulas, formats, settings); every device
// calculates the values itself (engine/), so no two devices fight over a result.
//
// Y.Doc layout:
//   "meta"          Map    format, locale, calc settings
//   "tabs"          Array  tab ids, in order
//   "tab:<id>"      Map    name, color, hidden, frozenRows, frozenCols, gridlines
//   "rows:<id>"     Array  row ids, in order (stable identities; a row is "the 7th id")
//   "cols:<id>"     Array  column ids, in order
//   "cells:<id>"    Map    "<rowId>.<colId>" → { v?, e?, f?, s?, n? }
//                          v: value typed (number | text | boolean); e: an error literal;
//                          f: a formula, stored by identity ({ f, refs }, engine/binding.js);
//                          s: style id; n: note
//   "rowmeta:<id>"  Map    rowId → { h?, hidden? }
//   "colmeta:<id>"  Map    colId → { w?, hidden? }
//   "merges:<id>"   Map    mergeId → { r1, c1, r2, c2 } (ids of the corners)
//   "rules:<id>"    Map    ruleId → a conditional format or data validation rule (rules.js)
//   "filters:<id>"  Map    "filter" → the tab's filter { top, bottom, left, right } (ids),
//                          "view:<vid>" → a filter view { name, top, bottom, left, right },
//                          "crit:<owner>:<colId>" → that column's criteria (filters.js);
//                          owner is "filter" or a view id. Per column, so two people
//                          filtering different columns don't overwrite each other.
//   "styles"        Map    style id → style (content-addressed: the same style has the same id)
//   "names"         Map    UPPER name → { tab, kind, r1, c1, r2, c2 } (a bound reference)
//
// Concurrent sorts of the same tab can leave a row id twice in its list (each sort
// deletes and re-inserts the order); the first occurrence wins and tidy() removes the
// rest, which any device may do (deleting the same items is idempotent).

import * as Y from "yjs";
import { parseTyped, isErr, err } from "./engine/values.js";
import { parse, ParseError, colToIndex } from "./engine/parser.js";
import { bind, toStored, fromStored, unbind, shift, formulaText } from "./engine/binding.js";
import { print } from "./engine/parser.js";

export const SHEET_MIME = "application/vnd.live.sheet";
export const DEFAULT_ROWS = 1000;
export const DEFAULT_COLS = 26;
export const WARN_CELLS = 200_000;
export const MAX_CELLS = 1_000_000;
export const MAX_TEXT = 50_000;
export const LOCAL = "local";

const newId = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 9);
};
const cellKey = (rowId, colId) => `${rowId}.${colId}`;

// Stable hash for content-addressed styles (FNV-1a, 32-bit, base 36).
function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
function canonical(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== false && obj[k] !== "").sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

// Style properties a cell may carry (anything else is dropped when stored).
const STYLE_KEYS = {
  font: "string", size: "number", bold: "boolean", italic: "boolean", underline: "boolean", strike: "boolean",
  color: "color", fill: "color", halign: ["left", "center", "right"], valign: ["top", "middle", "bottom"],
  wrap: ["overflow", "wrap", "clip"], rotate: "number", format: "string",
  borderTop: "border", borderRight: "border", borderBottom: "border", borderLeft: "border",
};
const COLOR_RE = /^#[0-9a-f]{6}$/i;
export function cleanStyle(st) {
  const out = {};
  if (!st || typeof st !== "object") return out;
  for (const [k, kind] of Object.entries(STYLE_KEYS)) {
    const v = st[k];
    if (v === undefined || v === null || v === false || v === "") continue;
    if (kind === "string" && typeof v === "string" && v.length <= 200) out[k] = v;
    else if (kind === "number" && Number.isFinite(v)) out[k] = Math.max(-360, Math.min(400, v));
    else if (kind === "boolean" && v === true) out[k] = true;
    else if (kind === "color" && typeof v === "string" && COLOR_RE.test(v)) out[k] = v.toLowerCase();
    else if (Array.isArray(kind) && kind.includes(v)) out[k] = v;
    else if (kind === "border" && typeof v === "object" && ["thin", "medium", "thick", "dashed", "dotted", "double"].includes(v.style) && (!v.color || COLOR_RE.test(v.color))) out[k] = { style: v.style, color: (v.color || "#000000").toLowerCase() };
  }
  return out;
}

export function createSheetModel(ydoc) {
  const meta = ydoc.getMap("meta");
  const tabsArr = ydoc.getArray("tabs");
  const styles = ydoc.getMap("styles");
  const names = ydoc.getMap("names");
  const tabMap = (id) => ydoc.getMap(`tab:${id}`);
  const rowsArr = (id) => ydoc.getArray(`rows:${id}`);
  const colsArr = (id) => ydoc.getArray(`cols:${id}`);
  const cells = (id) => ydoc.getMap(`cells:${id}`);
  const rowMeta = (id) => ydoc.getMap(`rowmeta:${id}`);
  const colMeta = (id) => ydoc.getMap(`colmeta:${id}`);
  const merges = (id) => ydoc.getMap(`merges:${id}`);
  const filtersMap = (id) => ydoc.getMap(`filters:${id}`);
  const rulesMap = (id) => ydoc.getMap(`rules:${id}`);

  const tx = (fn, origin = LOCAL) => { let out; ydoc.transact(() => { out = fn(); }, origin); return out; };
  const uniq = (arr) => { const seen = new Set(); const out = []; for (const x of arr) if (typeof x === "string" && !seen.has(x)) { seen.add(x); out.push(x); } return out; };

  // ---- reading -----------------------------------------------------------------------------

  const tabIds = () => uniq(tabsArr.toArray()).filter((id) => tabMap(id).has("name"));
  const rowIds = (tab) => uniq(rowsArr(tab).toArray());
  const colIds = (tab) => uniq(colsArr(tab).toArray());

  // Position lookups are cached per tab and rebuilt when the order changes.
  const ixCache = new Map();
  function ix(tab) {
    let c = ixCache.get(tab);
    if (!c) {
      const rows = rowIds(tab), cols = colIds(tab);
      c = { rows, cols, rowIx: new Map(rows.map((r, i) => [r, i])), colIx: new Map(cols.map((x, i) => [x, i])) };
      ixCache.set(tab, c);
    }
    return c;
  }
  ydoc.on("afterTransaction", (t) => {
    for (const type of t.changed.keys()) {
      const name = type._item ? null : [...ydoc.share.entries()].find(([, v]) => v === type)?.[0];
      if (name && (name.startsWith("rows:") || name.startsWith("cols:"))) ixCache.delete(name.slice(5));
    }
  });

  function tabInfo(id) {
    const m = tabMap(id);
    return {
      id, name: String(m.get("name") || "Sheet"), color: m.get("color") || null, hidden: !!m.get("hidden"),
      frozenRows: Math.max(0, Math.min(100, m.get("frozenRows") | 0)), frozenCols: Math.max(0, Math.min(50, m.get("frozenCols") | 0)),
      gridlines: m.get("gridlines") !== false,
    };
  }

  const grid = {
    tabIdByName: (name) => tabIds().find((id) => tabInfo(id).name.toLowerCase() === String(name).toLowerCase()),
    tabName: (id) => (tabMap(id).has("name") ? tabInfo(id).name : undefined),
    rowId: (tab, i) => ix(tab).rows[i],
    colId: (tab, i) => ix(tab).cols[i],
    rowIndex: (tab, id) => ix(tab).rowIx.get(id),
    colIndex: (tab, id) => ix(tab).colIx.get(id),
  };

  function cell(tab, rowId, colId) { return cells(tab).get(cellKey(rowId, colId)) || null; }
  function cellAt(tab, r, c) { const { rows, cols } = ix(tab); return rows[r] && cols[c] ? cell(tab, rows[r], cols[c]) : null; }

  // What a person sees in the edit box for a cell: its formula as A1 text, or its input.
  function inputText(tab, r, c) {
    const x = cellAt(tab, r, c);
    if (!x) return "";
    if (x.f) { if (x.f.src) return x.f.src; try { return formulaText(x.f, grid, tab); } catch { return "=#ERROR!"; } }
    if (x.e) return x.e;
    if (x.v === undefined || x.v === null) return "";
    if (typeof x.v === "boolean") return x.v ? "TRUE" : "FALSE";
    if (typeof x.v === "string" && (x.v.startsWith("=") || parseTyped(x.v).value !== x.v)) return `'${x.v}`;
    return String(x.v);
  }

  // The engine's input for a stored cell.
  function engineInput(x) {
    if (!x) return null;
    if (x.f) { try { return { formula: fromStored(x.f) }; } catch { return err("#ERROR!", "Formula parse error."); } }
    if (x.e) return err(x.e);
    return x.v === undefined ? null : x.v;
  }

  const style = (id) => (id ? styles.get(id) || null : null);

  // ---- writing ---------------------------------------------------------------------------

  function putStyle(st) {
    const clean = cleanStyle(st);
    if (!Object.keys(clean).length) return null;
    const id = hashText(canonical(clean));
    if (!styles.has(id)) styles.set(id, clean);
    return id;
  }

  function writeCell(tab, rowId, colId, next) {
    const k = cellKey(rowId, colId);
    const clean = {};
    for (const key of ["v", "e", "f", "s", "n"]) if (next[key] !== undefined && next[key] !== null && next[key] !== "") clean[key] = next[key];
    if (!Object.keys(clean).length) { if (cells(tab).has(k)) cells(tab).delete(k); return; }
    cells(tab).set(k, clean);
  }

  // Typing into a cell: a formula, a value, or nothing. Returns { ok, error? }.
  function setInput(tab, r, c, text, { keepFormat = false } = {}) {
    const { rows, cols } = ix(tab);
    const rowId = rows[r], colId = cols[c];
    if (!rowId || !colId) return { ok: false, error: "Outside the sheet." };
    const prev = cell(tab, rowId, colId) || {};
    const s = String(text ?? "");
    if (s.length > MAX_TEXT) return { ok: false, error: "Text is too long for one cell (50,000 characters)." };
    const next = { s: prev.s, n: prev.n };
    if (s.startsWith("=") && s.length > 1) {
      let tree;
      try { tree = parse(s); } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        // Sheets keeps what was typed and shows #ERROR!
        next.f = { f: "=#ERROR!", refs: [], src: s.slice(0, MAX_TEXT) };
        tx(() => writeCell(tab, rowId, colId, next));
        return { ok: true, error: e.message };
      }
      next.f = toStored(bind(tree, grid, tab));
    } else {
      const { value, format } = parseTyped(s);
      if (isErr(value)) next.e = value.code;
      else if (value !== null) next.v = value;
      if (format && !keepFormat && !(style(prev.s) || {}).format) next.s = putStyle({ ...(style(prev.s) || {}), format: AUTO_FORMATS[format] });
    }
    tx(() => writeCell(tab, rowId, colId, next));
    return { ok: true };
  }

  function clearRange(tab, r1, c1, r2, c2, { formats = false } = {}) {
    const { rows, cols } = ix(tab);
    tx(() => {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const rid = rows[r], cid = cols[c];
        if (!rid || !cid) continue;
        const x = cell(tab, rid, cid);
        if (!x) continue;
        writeCell(tab, rid, cid, formats ? {} : { s: x.s, n: x.n });
      }
    });
  }

  function setStyle(tab, r1, c1, r2, c2, patch) {
    const { rows, cols } = ix(tab);
    tx(() => {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const rid = rows[r], cid = cols[c];
        if (!rid || !cid) continue;
        const x = cell(tab, rid, cid) || {};
        const merged = { ...(style(x.s) || {}), ...patch };
        for (const k of Object.keys(patch)) if (patch[k] === null) delete merged[k];
        writeCell(tab, rid, cid, { ...x, s: putStyle(merged) });
      }
    });
  }

  function setNote(tab, r, c, note) {
    const { rows, cols } = ix(tab);
    const rid = rows[r], cid = cols[c];
    if (!rid || !cid) return;
    tx(() => writeCell(tab, rid, cid, { ...(cell(tab, rid, cid) || {}), n: String(note || "").slice(0, 5000) || undefined }));
  }

  // ---- tabs ------------------------------------------------------------------------------

  function uniqueTabName(base) {
    const taken = new Set(tabIds().map((id) => tabInfo(id).name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  }

  function addTab({ name, rows = DEFAULT_ROWS, cols = DEFAULT_COLS, at } = {}) {
    const id = newId();
    const nm = uniqueTabName(cleanTabName(name) || `Sheet${tabIds().length + 1}`);
    tx(() => {
      const m = tabMap(id);
      m.set("name", nm);
      rowsArr(id).push(Array.from({ length: rows }, newId));
      colsArr(id).push(Array.from({ length: cols }, newId));
      const list = tabsArr.toArray();
      tabsArr.insert(at === undefined ? list.length : Math.max(0, Math.min(list.length, at)), [id]);
    });
    return id;
  }

  function renameTab(id, name) {
    const nm = cleanTabName(name);
    if (!nm) return { ok: false, error: "A tab needs a name." };
    const clash = tabIds().find((t) => t !== id && tabInfo(t).name.toLowerCase() === nm.toLowerCase());
    if (clash) return { ok: false, error: `There's already a tab called "${nm}".` };
    tx(() => tabMap(id).set("name", nm));
    return { ok: true };
  }

  function setTabProps(id, props) {
    tx(() => {
      const m = tabMap(id);
      if ("color" in props) props.color && COLOR_RE.test(props.color) ? m.set("color", props.color) : m.delete("color");
      if ("hidden" in props) m.set("hidden", !!props.hidden);
      if ("frozenRows" in props) m.set("frozenRows", Math.max(0, Math.min(100, props.frozenRows | 0)));
      if ("frozenCols" in props) m.set("frozenCols", Math.max(0, Math.min(50, props.frozenCols | 0)));
      if ("gridlines" in props) m.set("gridlines", !!props.gridlines);
    });
  }

  function removeTab(id) {
    if (tabIds().length <= 1) return { ok: false, error: "A spreadsheet needs at least one tab." };
    tx(() => {
      const list = tabsArr.toArray();
      for (let i = list.length - 1; i >= 0; i--) if (list[i] === id) tabsArr.delete(i, 1);
      tabMap(id).delete("name"); // the tab's data stays in the doc (undo, versions) but it's gone
    });
    return { ok: true };
  }

  function moveTab(id, to) {
    tx(() => {
      const list = tabsArr.toArray();
      const from = list.indexOf(id);
      if (from < 0) return;
      tabsArr.delete(from, 1);
      tabsArr.insert(Math.max(0, Math.min(tabsArr.length, to)), [id]);
    });
  }

  // ---- rows and columns ------------------------------------------------------------------

  // Inserting into the order list: positions are counted on the de-duplicated order,
  // so map them back to the raw array's index first.
  function rawIndex(arr, uniqIndex) {
    const raw = arr.toArray();
    const seen = new Set();
    let u = 0;
    for (let i = 0; i < raw.length; i++) {
      if (seen.has(raw[i])) continue;
      seen.add(raw[i]);
      if (u === uniqIndex) return i;
      u++;
    }
    return raw.length;
  }

  function insertLines(kind, tab, at, count) {
    const arr = kind === "rows" ? rowsArr(tab) : colsArr(tab);
    const n = Math.max(1, Math.min(5000, count | 0));
    const total = kind === "rows" ? rowIds(tab).length : colIds(tab).length;
    if (kind === "cols" && total + n > 18_278) return { ok: false, error: "Too many columns." };
    if (kind === "rows" && total + n > 1_000_000) return { ok: false, error: "Too many rows." };
    tx(() => arr.insert(rawIndex(arr, Math.max(0, Math.min(total, at))), Array.from({ length: n }, newId)));
    return { ok: true };
  }

  function deleteLines(kind, tab, at, count) {
    const arr = kind === "rows" ? rowsArr(tab) : colsArr(tab);
    const ids = kind === "rows" ? rowIds(tab) : colIds(tab);
    const n = Math.max(1, count | 0);
    if (ids.length - n < 1) return { ok: false, error: kind === "rows" ? "A tab needs at least one row." : "A tab needs at least one column." };
    const gone = new Set(ids.slice(at, at + n));
    tx(() => {
      const raw = arr.toArray();
      for (let i = raw.length - 1; i >= 0; i--) if (gone.has(raw[i])) arr.delete(i, 1);
      // the cells of deleted lines go too (a formula pointing at them becomes #REF!)
      const cm = cells(tab);
      for (const k of [...cm.keys()]) {
        const [rid, cid] = k.split(".");
        if (gone.has(kind === "rows" ? rid : cid)) cm.delete(k);
      }
      const meta = kind === "rows" ? rowMeta(tab) : colMeta(tab);
      for (const id of gone) meta.delete(id);
    });
    return { ok: true };
  }

  function setLineMeta(kind, tab, from, to, patch) {
    const ids = kind === "rows" ? rowIds(tab) : colIds(tab);
    const meta = kind === "rows" ? rowMeta(tab) : colMeta(tab);
    tx(() => {
      for (let i = from; i <= to && i < ids.length; i++) {
        const cur = { ...(meta.get(ids[i]) || {}) };
        if ("size" in patch) { if (patch.size === null) delete cur[kind === "rows" ? "h" : "w"]; else cur[kind === "rows" ? "h" : "w"] = Math.max(2, Math.min(2000, Math.round(patch.size))); }
        if ("hidden" in patch) { if (patch.hidden) cur.hidden = true; else delete cur.hidden; }
        Object.keys(cur).length ? meta.set(ids[i], cur) : meta.delete(ids[i]);
      }
    });
  }
  const lineMeta = (kind, tab, id) => (kind === "rows" ? rowMeta(tab) : colMeta(tab)).get(id) || {};

  // Sort whole rows r1..r2 (positions) of a tab by keys [{ col, asc }], using the values
  // getValue(r, c) gives (the engine's). One change: the rows' order.
  function sortRows(tab, r1, r2, keys, getValue, compareFn) {
    const ids = rowIds(tab);
    const slice = ids.slice(r1, r2 + 1).map((id, i) => ({ id, r: r1 + i }));
    slice.sort((a, b) => {
      for (const k of keys) {
        const c = compareFn(getValue(a.r, k.col), getValue(b.r, k.col));
        if (c) return k.asc === false ? -c : c;
      }
      return a.r - b.r;
    });
    const order = [...ids.slice(0, r1), ...slice.map((x) => x.id), ...ids.slice(r2 + 1)];
    tx(() => { const arr = rowsArr(tab); arr.delete(0, arr.length); arr.insert(0, order); });
  }

  // Duplicate ids left by concurrent sorts: keep the first, delete the rest.
  function tidy() {
    const fix = (arr) => {
      const raw = arr.toArray();
      const seen = new Set();
      const dupes = [];
      raw.forEach((x, i) => { if (seen.has(x)) dupes.push(i); seen.add(x); });
      for (let i = dupes.length - 1; i >= 0; i--) arr.delete(dupes[i], 1);
      return dupes.length;
    };
    let n = 0;
    ydoc.transact(() => {
      n += fix(tabsArr);
      for (const t of tabIds()) { n += fix(rowsArr(t)); n += fix(colsArr(t)); }
    }, "tidy");
    return n;
  }

  // ---- merges ---------------------------------------------------------------------------

  function mergeRange(tab, r1, c1, r2, c2) {
    if (r1 === r2 && c1 === c2) return;
    const { rows, cols } = ix(tab);
    tx(() => {
      const m = merges(tab);
      // a new merge replaces any it overlaps
      for (const [id, g] of m.entries()) {
        const b = mergeBox(tab, g);
        if (b && !(b.r2 < r1 || b.r1 > r2 || b.c2 < c1 || b.c1 > c2)) m.delete(id);
      }
      m.set(newId(), { r1: rows[r1], c1: cols[c1], r2: rows[r2], c2: cols[c2] });
      // only the top-left cell keeps its content, as Sheets
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) { const x = cell(tab, rows[r], cols[c]); if (x) writeCell(tab, rows[r], cols[c], { s: x.s }); }
    });
  }
  function unmerge(tab, r, c) {
    tx(() => { for (const [id, g] of merges(tab).entries()) { const b = mergeBox(tab, g); if (b && r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2) merges(tab).delete(id); } });
  }
  function mergeBox(tab, g) {
    const { rowIx, colIx } = ix(tab);
    const r1 = rowIx.get(g.r1), r2 = rowIx.get(g.r2), c1 = colIx.get(g.c1), c2 = colIx.get(g.c2);
    if ([r1, r2, c1, c2].some((x) => x === undefined)) return null;
    return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
  }
  const mergesOf = (tab) => [...merges(tab).values()].map((g) => mergeBox(tab, g)).filter(Boolean);

  // ---- named ranges -----------------------------------------------------------------------

  function setName(name, a1, homeTab) {
    const nm = String(name || "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,250}$/.test(nm) || /^[A-Za-z]{1,3}\d+$/.test(nm) || /^(TRUE|FALSE)$/i.test(nm)) return { ok: false, error: "Names start with a letter and use letters, numbers and underscores, and can't look like a cell (A1)." };
    if (a1 === null) { tx(() => names.delete(nm.toUpperCase())); return { ok: true }; }
    let tree;
    try { tree = parse(`=${a1}`); } catch { return { ok: false, error: "That isn't a range." }; }
    if (tree.t !== "ref") return { ok: false, error: "That isn't a range." };
    const bound = bind(tree, grid, homeTab);
    if (bound.bad) return { ok: false, error: "That range isn't in this spreadsheet." };
    tx(() => names.set(nm.toUpperCase(), { ...bound, sheet: bound.sheet || homeTab, label: nm }));
    return { ok: true };
  }
  const nameList = () => [...names.entries()].map(([k, v]) => ({ key: k, name: v.label || k, ref: v }));

  // ---- copy / paste ------------------------------------------------------------------------

  // A block of cells as a clipboard payload (inputs with relative formulas as A1 text).
  function copyBlock(tab, r1, c1, r2, c2) {
    const out = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) {
        const x = cellAt(tab, r, c);
        let formula = null;
        if (x?.f) { try { formula = print(unbind(fromStored(x.f), grid, tab)); } catch { formula = null; } }
        row.push({ v: x?.v ?? null, e: x?.e ?? null, formula, style: style(x?.s), note: x?.n || null });
      }
      out.push(row);
    }
    return { from: { tab, r: r1, c: c1 }, cells: out };
  }

  // Pastes a block at (r, c); formulas shift by the distance moved (relative parts).
  // what: "all" | "values" | "formats". values: getValue(r, c) for "values" pastes.
  function pasteBlock(tab, r, c, block, { what = "all", values = null } = {}) {
    const { rows, cols } = ix(tab);
    const dr = r - block.from.r, dc = c - block.from.c;
    const h = block.cells.length, w = block.cells[0]?.length || 0;
    if (r + h > rows.length || c + w > cols.length) return { ok: false, error: "There isn't room to paste here; add rows or columns first." };
    tx(() => {
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
        const src = block.cells[i][j];
        const rid = rows[r + i], cid = cols[c + j];
        const prev = cell(tab, rid, cid) || {};
        const next = { n: prev.n, s: what === "values" ? prev.s : putStyle(src.style || {}) };
        if (what !== "formats") {
          if (what === "values" && values) {
            const v = values(i, j);
            if (isErr(v)) next.e = v.code; else if (v !== null && v !== undefined) next.v = v;
          } else if (src.formula) {
            try { next.f = toStored(bind(shift(parse(src.formula), dr, dc, { rows: rows.length, cols: cols.length }), grid, tab)); }
            catch { next.f = { f: "=#REF!", refs: [] }; }
          } else if (src.e) next.e = src.e;
          else if (src.v !== null && src.v !== undefined) next.v = src.v;
        } else { next.v = prev.v; next.e = prev.e; next.f = prev.f; }
        writeCell(tab, rid, cid, next);
      }
    });
    return { ok: true };
  }

  // ---- whole workbook --------------------------------------------------------------------

  function init({ tabName = "Sheet1", rows = DEFAULT_ROWS, cols = DEFAULT_COLS } = {}) {
    if (tabIds().length) return;
    tx(() => { meta.set("format", 1); meta.set("locale", "en_US"); }, "init");
    addTab({ name: tabName, rows, cols });
  }

  function filledCells() {
    let n = 0;
    for (const t of tabIds()) n += cells(t).size;
    return n;
  }

  // Plain text for search (tab names and cell text, capped).
  function searchText(limit = 200_000, valueOf = null) {
    let out = "";
    for (const t of tabIds()) {
      out += tabInfo(t).name + "\n";
      const { rows, cols } = ix(t);
      for (const [k, x] of cells(t).entries()) {
        let s = "";
        if (x.f && valueOf) { const [rid, cid] = k.split("."); const v = valueOf(t, rows.indexOf(rid), cols.indexOf(cid)); s = typeof v === "string" ? v : ""; }
        else if (typeof x.v === "string") s = x.v;
        else if (typeof x.v === "number") s = String(x.v);
        if (s) out += s + " ";
        if (out.length > limit) return out.slice(0, limit);
      }
      out += "\n";
    }
    return out;
  }

  // ---- filters and filter views (filters.js) --------------------------------------------------

  const specKey = (owner) => (owner === "filter" ? "filter" : `view:${owner}`);
  function filterOf(tab, owner = "filter") {
    const m = filtersMap(tab);
    const base = m.get(specKey(owner));
    if (!base) return null;
    const criteria = {};
    const p = `crit:${owner}:`;
    for (const [k, v] of m.entries()) if (k.startsWith(p) && v) criteria[k.slice(p.length)] = v;
    return { owner, ...base, criteria };
  }
  function setFilter(tab, owner, { top, bottom = null, left, right, name }) {
    tx(() => {
      const m = filtersMap(tab);
      const prev = m.get(specKey(owner)) || {};
      const next = { top, bottom: bottom || null, left, right };
      if (owner !== "filter") next.name = String(name ?? prev.name ?? "Filter view").slice(0, 100);
      m.set(specKey(owner), next);
    });
  }
  function setCriteria(tab, owner, colId, crit) {
    tx(() => {
      const m = filtersMap(tab), k = `crit:${owner}:${colId}`;
      const clean = crit && cleanCriteria(crit);
      if (clean) m.set(k, clean); else m.delete(k);
    });
  }
  function removeFilter(tab, owner = "filter") {
    tx(() => {
      const m = filtersMap(tab);
      m.delete(specKey(owner));
      const p = `crit:${owner}:`;
      for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
    });
  }
  function filterViews(tab) {
    const out = [];
    for (const [k, v] of filtersMap(tab).entries()) if (k.startsWith("view:") && v) out.push({ id: k.slice(5), name: v.name || "Filter view" });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  // A new filter view, starting from the given spec (or the tab's filter, as Sheets does).
  function newFilterView(tab, from, name) {
    const id = newId();
    tx(() => {
      setFilter(tab, id, { ...from, name: name || `Filter ${filterViews(tab).length + 1}` });
      for (const [colId, crit] of Object.entries(from.criteria || {})) setCriteria(tab, id, colId, crit);
    });
    return id;
  }

  // ---- rules on cells (rules.js) -----------------------------------------------------------

  function rulesOf(tab) {
    const out = [];
    for (const [id, r] of rulesMap(tab).entries()) if (r && (r.kind === "format" || r.kind === "valid")) out.push({ ...r, id });
    return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  }
  // Adds (id omitted) or replaces a rule; returns its id. A new formatting rule goes last.
  function setRule(tab, id, rule) {
    const rid = id || newId();
    tx(() => {
      const m = rulesMap(tab);
      const next = { ...rule };
      delete next.id;
      if (next.kind === "format" && next.order === undefined) next.order = Math.max(0, ...rulesOf(tab).filter((r) => r.kind === "format").map((r) => (r.order ?? 0) + 1));
      m.set(rid, JSON.parse(JSON.stringify(next)));
    });
    return rid;
  }
  function removeRule(tab, id) { tx(() => rulesMap(tab).delete(id)); }
  // Move a formatting rule up (-1) or down (+1) in priority.
  function moveRule(tab, id, dir) {
    const list = rulesOf(tab).filter((r) => r.kind === "format");
    const i = list.findIndex((r) => r.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    tx(() => list.forEach((r, k) => { if (r.order !== k) { const { id: rid, ...rest } = r; rulesMap(tab).set(rid, { ...rest, order: k }); } }));
  }

  return {
    ydoc, grid, LOCAL,
    rulesOf, setRule, removeRule, moveRule,
    filterOf, setFilter, setCriteria, removeFilter, filterViews, newFilterView,
    init, tidy, filledCells, searchText,
    tabIds, tabInfo, addTab, renameTab, setTabProps, removeTab, moveTab,
    rowIds, colIds, size: (tab) => ({ rows: ix(tab).rows.length, cols: ix(tab).cols.length }),
    insertRows: (tab, at, n = 1) => insertLines("rows", tab, at, n), deleteRows: (tab, at, n = 1) => deleteLines("rows", tab, at, n),
    insertCols: (tab, at, n = 1) => insertLines("cols", tab, at, n), deleteCols: (tab, at, n = 1) => deleteLines("cols", tab, at, n),
    setRowMeta: (tab, a, b, p) => setLineMeta("rows", tab, a, b, p), setColMeta: (tab, a, b, p) => setLineMeta("cols", tab, a, b, p),
    rowMeta: (tab, id) => lineMeta("rows", tab, id), colMeta: (tab, id) => lineMeta("cols", tab, id),
    cell, cellAt, inputText, engineInput, style, putStyle, setInput, clearRange, setStyle, setNote,
    sortRows, mergeRange, unmerge, mergesOf,
    setName, nameList, names: () => names,
    copyBlock, pasteBlock,
    // for the engine bridge
    _cells: cells, _tabs: tabsArr, _rows: rowsArr, _cols: colsArr, _tabMap: tabMap,
  };
}

// Number formats chosen by typing (US locale).
export const AUTO_FORMATS = { percent: "0.00%", currency: '"$"#,##0.00', date: "m/d/yyyy", time: "h:mm:ss AM/PM", datetime: "m/d/yyyy h:mm:ss" };

// Criteria as stored: only known fields, bounded sizes.
export function cleanCriteria(c) {
  const out = {};
  if (Array.isArray(c.hide) && c.hide.length) out.hide = [...new Set(c.hide.map((x) => String(x).slice(0, 500)))].slice(0, 10000);
  if (c.cond?.op && typeof c.cond.op === "string") {
    out.cond = { op: c.cond.op.slice(0, 20) };
    if (c.cond.a !== undefined && c.cond.a !== null) out.cond.a = String(c.cond.a).slice(0, 500);
    if (c.cond.b !== undefined && c.cond.b !== null) out.cond.b = String(c.cond.b).slice(0, 500);
  }
  const col = {};
  if (COLOR_RE.test(c.color?.fill || "")) col.fill = c.color.fill;
  if (COLOR_RE.test(c.color?.text || "")) col.text = c.color.text;
  if (col.fill || col.text) out.color = col;
  return Object.keys(out).length ? out : null;
}

export function cleanTabName(name) {
  return String(name ?? "").replace(/[\u0000-\u001f[\]*?/\\:]/g, "").trim().slice(0, 100);
}

export { colToIndex };
