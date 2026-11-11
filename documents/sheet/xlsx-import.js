// Excel (.xlsx) in (SPREADSHEET_DESIGN.md §7): our own reader — fflate unzips, the
// sheet XML is read with fast-xml-parser — into a spreadsheet model. Values, formulas
// (shared formulas expanded; Excel's _xlfn./_xlws. prefixes dropped; a formula we can't
// read is kept as its last value and listed), number formats, fonts, fills (including
// theme colours), borders, alignment, merges, column widths, row heights, hidden rows,
// columns and tabs, frozen panes, tab colours, gridlines, named ranges, dropdown and
// number validation, and simple conditional formats (cell value, text contains, custom
// formula, colour scales). What isn't brought over is returned in `notes`.
//
//   readXlsx(bytes) → workbook (plain data, for tests)
//   xlsxIntoModel(model, bytes) → { notes, tabs }   (into an empty model, or as new tabs of an open one)

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { parse, print, colToIndex } from "./engine/parser.js";
import { shift, storedFromText } from "./engine/binding.js";
import { addCellThread } from "./history.js";
import { DEF_W, DEF_H } from "./grid.js";

const ARRAYS = new Set(["sheet", "row", "c", "si", "r", "xf", "font", "fill", "border", "numFmt", "mergeCell", "col", "definedName", "Relationship", "dataValidation", "conditionalFormatting", "cfRule", "cfvo", "color", "dxf", "rPh"]);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, isArray: (name) => ARRAYS.has(name), parseTagValue: false, parseAttributeValue: false, trimValues: false });

const BUILTIN = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yyyy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@" };
// Excel's default theme, if the file has none
const THEME = ["#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];
const INDEXED = ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#800000", "#008000", "#000080", "#808000", "#800080", "#008080", "#C0C0C0", "#808080"];

const text = (n) => {
  if (n === undefined || n === null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(text).join("");
  if (n["#text"] !== undefined) return String(n["#text"]);
  return "";
};
const richText = (si) => (si.t !== undefined ? text(si.t) : (si.r || []).map((r) => text(r.t)).join(""));
const cellRef = (ref) => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref || ""); return m ? { r: Number(m[2]) - 1, c: colToIndex(m[1]) } : null; };
// "A2:B", "A:A", "B3" → bounds; an open bottom is r2 null.
const openRangeRef = (ref) => {
  const m = /^\$?([A-Z]+)\$?(\d+)?(?::\$?([A-Z]+)\$?(\d+)?)?$/i.exec(String(ref || "").trim());
  if (!m) return null;
  const c1 = colToIndex(m[1].toUpperCase()), c2 = m[3] ? colToIndex(m[3].toUpperCase()) : c1;
  const r1 = m[2] ? Number(m[2]) - 1 : 0, r2 = m[3] ? (m[4] ? Number(m[4]) - 1 : null) : m[2] ? r1 : null;
  return { r1: r2 === null ? r1 : Math.min(r1, r2), r2: r2 === null ? null : Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
};
const rangeRef = (ref) => { const [a, b] = String(ref || "").split(":"); const p = cellRef(a), q = b ? cellRef(b) : p; return p && q ? { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) } : null; };

function tint(hex, t) {
  if (!t) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (t < 0 ? v * (1 + t) : v + (255 - v) * t));
  return `#${ch.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}
function colorOf(c, theme) {
  if (!c) return null;
  if (c["@rgb"]) { const v = c["@rgb"].slice(-6); return /^[0-9a-f]{6}$/i.test(v) ? tint(`#${v}`, Number(c["@tint"]) || 0).toLowerCase() : null; }
  if (c["@theme"] !== undefined) { const v = theme[Number(c["@theme"])]; return v ? tint(v, Number(c["@tint"]) || 0).toLowerCase() : null; }
  if (c["@indexed"] !== undefined) { const v = INDEXED[Number(c["@indexed"])]; return v ? v.toLowerCase() : null; }
  return null;
}
const first = (x) => (Array.isArray(x) ? x[0] : x);
const BORDER = { thin: "thin", hair: "thin", medium: "medium", mediumDashed: "dashed", dashDot: "dashed", mediumDashDot: "dashed", slantDashDot: "dashed", dashDotDot: "dotted", mediumDashDotDot: "dashed", thick: "thick", dashed: "dashed", dotted: "dotted", double: "double" };

// Formula text in our terms: "=" in front, Excel's future-function prefixes dropped.
export const fromExcelFormula = (f) => `=${String(f).replace(/_xlfn\.|_xlws\.|_xlpm\./gi, "").replace(/@(?=[A-Za-z_])/g, "")}`;

export function readXlsx(bytes) {
  let files;
  try { files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch { throw new Error("That isn't an Excel (.xlsx) file."); }
  const xml = (path) => { const f = files[path]; return f ? parser.parse(strFromU8(f)) : null; };
  const wb = xml("xl/workbook.xml")?.workbook;
  if (!wb) throw new Error("That isn't an Excel (.xlsx) file.");
  const rels = new Map((xml("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship || []).map((r) => [r["@Id"], r["@Target"]]));
  const resolve = (t) => (t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`);
  const notes = new Set();

  // theme colours
  const theme = [...THEME];
  const th = xml("xl/theme/theme1.xml");
  const scheme = th?.theme?.themeElements?.clrScheme;
  if (scheme) {
    const pick = (k) => { const e = scheme[k]; return e?.srgbClr?.["@val"] ? `#${e.srgbClr["@val"]}` : e?.sysClr?.["@lastClr"] ? `#${e.sysClr["@lastClr"]}` : null; };
    const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
    order.forEach((k, i) => { const v = pick(k); if (v) theme[i] = v; });
  }
  // shared strings
  const sst = (xml("xl/sharedStrings.xml")?.sst?.si || []).map(richText);
  // styles → our style objects per xf index
  const ss = xml("xl/styles.xml")?.styleSheet || {};
  const numFmts = new Map((ss.numFmts?.numFmt || []).map((n) => [Number(n["@numFmtId"]), n["@formatCode"]]));
  const fonts = (ss.fonts?.font || []).map((f) => ({
    font: f.name?.["@val"], size: f.sz ? Number(f.sz["@val"]) : undefined, bold: f.b !== undefined && f.b?.["@val"] !== "0", italic: f.i !== undefined && f.i?.["@val"] !== "0",
    underline: f.u !== undefined && f.u?.["@val"] !== "none", strike: f.strike !== undefined && f.strike?.["@val"] !== "0", color: colorOf(first(f.color), theme),
  }));
  const fills = (ss.fills?.fill || []).map((f) => { const p = f.patternFill; return p && p["@patternType"] === "solid" ? colorOf(first(p.fgColor), theme) : null; });
  const side = (b) => (b && b["@style"] && BORDER[b["@style"]] ? { style: BORDER[b["@style"]], color: colorOf(first(b.color), theme) || "#000000" } : null);
  const borders = (ss.borders?.border || []).map((b) => ({ borderLeft: side(b.left), borderRight: side(b.right), borderTop: side(b.top), borderBottom: side(b.bottom) }));
  const H = { left: "left", center: "center", centerContinuous: "center", right: "right" }, V = { top: "top", center: "middle", bottom: "bottom" };
  const xfStyles = (ss.cellXfs?.xf || []).map((x) => {
    const st = {};
    const f = fonts[Number(x["@fontId"]) || 0];
    if (f && Number(x["@fontId"])) { if (f.font && f.font !== "Calibri" && f.font !== "Arial") st.font = f.font; if (f.size && f.size !== 11 && f.size !== 10) st.size = f.size; for (const k of ["bold", "italic", "underline", "strike"]) if (f[k]) st[k] = true; if (f.color && f.color !== "#000000") st.color = f.color; }
    const fill = fills[Number(x["@fillId"]) || 0];
    if (fill && Number(x["@fillId"]) > 1) st.fill = fill;
    const b = borders[Number(x["@borderId"]) || 0];
    if (b && Number(x["@borderId"])) for (const k of Object.keys(b)) if (b[k]) st[k] = b[k];
    const fmtId = Number(x["@numFmtId"]) || 0;
    if (fmtId) { const code = numFmts.get(fmtId) ?? BUILTIN[fmtId]; if (code && code !== "General") st.format = code; }
    const al = x.alignment;
    if (al) { if (H[al["@horizontal"]]) st.halign = H[al["@horizontal"]]; if (V[al["@vertical"]] && al["@vertical"] !== "bottom") st.valign = V[al["@vertical"]]; if (al["@wrapText"] === "1" || al["@wrapText"] === "true") st.wrap = "wrap"; const rot = Number(al["@textRotation"]) || 0; if (rot && rot !== 255) st.rotate = rot > 90 ? 90 - rot : rot; }
    return st;
  });
  const dxfs = (ss.dxfs?.dxf || []).map((d) => {
    const st = {};
    const f = d.font;
    if (f) { if (f.b !== undefined) st.bold = true; if (f.i !== undefined) st.italic = true; if (f.u !== undefined) st.underline = true; if (f.strike !== undefined) st.strike = true; const c = colorOf(first(f.color), theme); if (c) st.color = c; }
    const p = d.fill?.patternFill;
    if (p) { const c = colorOf(first(p.bgColor), theme) || colorOf(first(p.fgColor), theme); if (c) st.fill = c; }
    return st;
  });

  const sheets = [];
  for (const s of wb.sheets?.sheet || []) {
    const path = rels.get(s["@id"]);
    const doc = path ? xml(resolve(path))?.worksheet : null;
    if (!doc) { notes.add(`The tab "${s["@name"]}" isn't a worksheet (a chart sheet?) and was left out.`); continue; }
    const sheet = { name: String(s["@name"] || `Sheet${sheets.length + 1}`), hidden: s["@state"] === "hidden" || s["@state"] === "veryHidden", cells: [], cols: [], rows: [], merges: [], frozen: { rows: 0, cols: 0 }, color: null, gridlines: true, validation: [], formats: [] };
    sheet.color = colorOf(doc.sheetPr?.tabColor, theme);
    const view = first(doc.sheetViews?.sheetView);
    if (view) {
      if (view["@showGridLines"] === "0" || view["@showGridLines"] === "false") sheet.gridlines = false;
      const pane = view.pane;
      if (pane && (pane["@state"] === "frozen" || pane["@state"] === "frozenSplit")) sheet.frozen = { rows: Number(pane["@ySplit"]) || 0, cols: Number(pane["@xSplit"]) || 0 };
    }
    const defW = Number(doc.sheetFormatPr?.["@defaultColWidth"]) || 0;
    for (const col of doc.cols?.col || []) {
      const w = Number(col["@width"]);
      for (let c = Number(col["@min"]) - 1; c <= Math.min(Number(col["@max"]) - 1, 16383); c++) {
        let px = col["@customWidth"] === "1" || (w && Math.abs(w - (defW || 8.43)) > 0.01) ? Math.round(w * 7 + 5) : 0;
        if (Math.abs(px - DEF_W) <= 1) px = 0; // Google writes every column's width, even the default one
        if (px || col["@hidden"] === "1") sheet.cols.push({ c, w: px || undefined, hidden: col["@hidden"] === "1" });
        if (Number(col["@max"]) - Number(col["@min"]) > 300) break; // a style over whole columns: don't list 16k of them
      }
    }
    // shared formulas: si → { r, c, text }; array formulas' blocks (their other cells
    // are the formula's own answers, filled again by our engine)
    const shared = new Map();
    const arrays = [];
    for (const row of doc.sheetData?.row || []) {
      const r = Number(row["@r"]) - 1;
      const ht = Number(row["@ht"]);
      // Google marks every row's height as custom, even the default one: keep only real changes
      const hpx = row["@customHeight"] === "1" && ht ? Math.round(ht / 0.75) : 0;
      const h = hpx && Math.abs(hpx - DEF_H) > 1 ? hpx : undefined;
      if (h || row["@hidden"] === "1") sheet.rows.push({ r, h, hidden: row["@hidden"] === "1" });
      let nextC = 0;
      for (const c of row.c || []) {
        const pos = cellRef(c["@r"]) || { r, c: nextC };
        nextC = pos.c + 1;
        const t = c["@t"];
        const raw = c.v !== undefined ? text(c.v) : undefined;
        let value = null;
        if (t === "s") value = sst[Number(raw)] ?? "";
        else if (t === "inlineStr") value = richText(c.is || {});
        else if (t === "str") value = raw ?? "";
        else if (t === "b") value = raw === "1" || raw === "true";
        else if (t === "e") value = { error: raw };
        else if (raw !== undefined && raw !== "") value = Number(raw);
        let formula = null;
        const f = c.f;
        if (f !== undefined) {
          const fText = text(f);
          const ft = typeof f === "object" ? f["@t"] : undefined;
          if (ft === "shared") {
            const si = f["@si"];
            if (fText) { shared.set(si, { r: pos.r, c: pos.c, text: fText }); formula = fText; }
            else if (shared.has(si)) {
              const m = shared.get(si);
              try { formula = print(shift(parse(fromExcelFormula(m.text)), pos.r - m.r, pos.c - m.c), { leadingEquals: false }); } catch { formula = null; }
            }
          } else if (fText) formula = fText;
          if (ft === "array" && f["@ref"]) { const b = rangeRef(f["@ref"]); if (b && (b.r2 > b.r1 || b.c2 > b.c1)) arrays.push(b); }
        }
        const style = Number(c["@s"]) || 0;
        if (value === null && formula === null && !style) continue;
        sheet.cells.push({ r: pos.r, c: pos.c, value, formula: formula === null ? null : fromExcelFormula(formula), style: xfStyles[style] || null });
      }
    }
    if (arrays.length) {
      const inBlock = (x) => arrays.some((b) => x.r >= b.r1 && x.r <= b.r2 && x.c >= b.c1 && x.c <= b.c2 && !(x.r === b.r1 && x.c === b.c1));
      const kept = [];
      for (const x of sheet.cells) {
        if (x.formula || !inBlock(x)) kept.push(x);
        else if (x.style && Object.keys(x.style).length) kept.push({ ...x, value: null }); // keep its look, not its value
      }
      sheet.cells = kept;
    }
    for (const m of doc.mergeCells?.mergeCell || []) { const b = rangeRef(m["@ref"]); if (b) sheet.merges.push(b); }
    for (const v of doc.dataValidations?.dataValidation || []) {
      const ranges = String(v["@sqref"] || "").split(/\s+/).map(rangeRef).filter(Boolean);
      const f1 = text(v.formula1), f2 = text(v.formula2);
      const type = v["@type"];
      const reject = (v["@errorStyle"] || "stop") === "stop" && v["@showErrorMessage"] === "1";
      if (type === "list" && /^".*"$/.test(f1)) sheet.validation.push({ type: "list", ranges, items: f1.slice(1, -1).replace(/""/g, '"').split(",").map((x) => x.trim()).filter(Boolean), reject });
      else if (type === "list") sheet.validation.push({ type: "range", ranges, source: f1, reject });
      else if (type === "whole" || type === "decimal") { const ops = { between: "between", notBetween: "notBetween", greaterThan: "gt", greaterThanOrEqual: "gte", lessThan: "lt", lessThanOrEqual: "lte", equal: "eq", notEqual: "ne" }; sheet.validation.push({ type: "number", op: ops[v["@operator"] || "between"] || "between", a: f1, b: f2 || undefined, ranges, reject }); }
      else if (type === "custom") sheet.validation.push({ type: "formula", f: f1, ranges, reject });
      else notes.add(`Some data validation (${type}) wasn't brought over.`);
    }
    for (const cf of doc.conditionalFormatting || []) {
      const ranges = String(cf["@sqref"] || "").split(/\s+/).map(rangeRef).filter(Boolean);
      for (const rule of cf.cfRule || []) {
        const prio = Number(rule["@priority"]) || 0;
        const style = dxfs[Number(rule["@dxfId"])] || {};
        const fs = (Array.isArray(rule.formula) ? rule.formula : rule.formula !== undefined ? [rule.formula] : []).map(text);
        const ops = { greaterThan: "gt", greaterThanOrEqual: "gte", lessThan: "lt", lessThanOrEqual: "lte", equal: "eq", notEqual: "ne", between: "between", notBetween: "notBetween" };
        const lit = (s) => (/^".*"$/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s);
        if (rule["@type"] === "cellIs" && ops[rule["@operator"]]) sheet.formats.push({ prio, ranges, cond: { op: ops[rule["@operator"]], a: lit(fs[0] ?? ""), b: fs[1] !== undefined ? lit(fs[1]) : undefined }, style });
        else if (rule["@type"] === "containsText" && rule["@text"] !== undefined) sheet.formats.push({ prio, ranges, cond: { op: rule["@operator"] === "notContains" ? "notContains" : rule["@operator"] === "beginsWith" ? "starts" : rule["@operator"] === "endsWith" ? "ends" : "contains", a: rule["@text"] }, style });
        else if (rule["@type"] === "expression" && fs[0]) sheet.formats.push({ prio, ranges, cond: { op: "formula", f: fs[0] }, style });
        else if (rule["@type"] === "colorScale" && rule.colorScale) {
          const cfvo = rule.colorScale.cfvo || [], colors = (rule.colorScale.color || []).map((c) => colorOf(c, theme));
          const pt = (v, color) => ({ type: { min: "min", max: "max", num: "num", percent: "pct", percentile: "percentile" }[v["@type"]] || "num", v: v["@val"], color: color || "#ffffff" });
          const pts = cfvo.map((v, i) => pt(v, colors[i]));
          sheet.formats.push({ prio, ranges, scale: pts.length === 3 ? { min: pts[0], mid: pts[1], max: pts[2] } : { min: pts[0], max: pts[pts.length - 1] } });
        } else notes.add("Some conditional formatting wasn't brought over.");
      }
    }
    if (doc.drawing) notes.add("Charts and pictures weren't brought over yet.");
    if (doc.legacyDrawing) notes.add("Comments and notes weren't brought over yet.");
    sheets.push(sheet);
  }
  const names = (wb.definedNames?.definedName || []).filter((d) => !String(d["@name"] || "").startsWith("_xlnm") && d["@hidden"] !== "1").map((d) => ({ name: String(d["@name"]), ref: text(d), local: d["@localSheetId"] }));
  if (files["xl/pivotTables/pivotTable1.xml"] || Object.keys(files).some((k) => k.startsWith("xl/pivotTables/"))) notes.add("Pivot tables came over as their values.");
  return { sheets, names, notes: [...notes] };
}

// Fills an empty model from .xlsx bytes. → { notes: [text…], tabs }
export function xlsxIntoModel(model, bytes) {
  const wb = readXlsx(bytes);
  if (!wb.sheets.length) throw new Error("That file has no worksheets.");
  return workbookIntoModel(model, wb);
}

// Writes a workbook (readXlsx's shape, also what gsheets-import.js makes) into a model:
// into an empty one, or as new tabs of an open one. → { notes, tabs }
//   sheet: { name, cells: [{ r, c, formula?, value, style?, note? }], rows: [{ r, h?, hidden? }],
//            cols: [{ c, w?, hidden? }], merges, frozen: { rows, cols }, color?, gridlines,
//            hidden?, validation: [...], formats: [...], charts?: [...] }
export function workbookIntoModel(model, wb) {
  const notes = [...(wb.notes || [])];
  let unreadable = 0;
  let importedTabs = [];
  model.ydoc.transact(() => {
    const tabs = importedTabs;
    wb.sheets.forEach((s, i) => {
      const maxR = Math.max(0, ...s.cells.map((x) => x.r), ...s.rows.map((x) => x.r), ...s.merges.map((m) => m.r2));
      const maxC = Math.max(0, ...s.cells.map((x) => x.c), ...s.cols.map((x) => x.c), ...s.merges.map((m) => m.c2));
      const rows = Math.max(1000, maxR + 51), cols = Math.max(26, maxC + 2);
      let tab;
      if (i === 0 && !model.tabIds().length) { model.init({ tabName: s.name, rows, cols }); tab = model.tabIds()[0]; }
      else tab = model.addTab({ name: s.name, rows, cols });
      tabs.push(tab);
    });
    const tabNamed = (name) => (name === undefined || name === null ? null : tabs.find((t) => model.tabInfo(t).name.toLowerCase() === String(name).toLowerCase()) || model.tabIds().find((t) => model.tabInfo(t).name.toLowerCase() === String(name).toLowerCase()) || null);
    let threadN = 0;
    // values and formulas after every tab exists, so cross-tab references bind
    wb.sheets.forEach((s, i) => {
      const tab = tabs[i];
      for (const x of s.cells) {
        let input = null;
        if (x.formula) {
          const res = model.setInput(tab, x.r, x.c, x.formula);
          if (res?.error || res?.ok === false) { unreadable++; input = valueText(x.value); if (input !== null) model.setInput(tab, x.r, x.c, input); }
        } else if (x.value !== null && x.value !== undefined) model.setInput(tab, x.r, x.c, valueText(x.value));
        if (x.style && Object.keys(x.style).length) model.setStyle(tab, x.r, x.c, x.r, x.c, x.style);
      }
      const rowIds = model.rowIds(tab), colIds = model.colIds(tab);
      for (const x of s.cells) {
        if (!x.note || x.r >= rowIds.length || x.c >= colIds.length) continue;
        const id = `imp-${Date.now().toString(36)}-${(threadN++).toString(36)}`;
        addCellThread(model.ydoc, { id, tab, row: rowIds[x.r], col: colIds[x.c], quote: "", text: String(x.note).slice(0, 5000), user: { id: "import", name: x.noteBy || "Note" } });
      }
      for (const r of s.rows) if (r.r < rowIds.length) model.setRowMeta(tab, r.r, r.r, { ...(r.h ? { size: Math.max(8, Math.min(800, r.h)) } : {}), ...(r.hidden ? { hidden: true } : {}) });
      for (const c of s.cols) if (c.c < colIds.length) model.setColMeta(tab, c.c, c.c, { ...(c.w ? { size: Math.max(10, Math.min(1000, c.w)) } : {}), ...(c.hidden ? { hidden: true } : {}) });
      for (const m of s.merges) model.mergeRange(tab, m.r1, m.c1, m.r2, m.c2);
      const props = {};
      if (s.frozen.rows) props.frozenRows = Math.min(s.frozen.rows, 50);
      if (s.frozen.cols) props.frozenCols = Math.min(s.frozen.cols, 20);
      if (s.color) props.color = s.color;
      if (!s.gridlines) props.gridlines = false;
      if (s.hidden && wb.sheets.length > 1) props.hidden = true;
      if (Object.keys(props).length) model.setTabProps(tab, props);
      const rg = (b) => ({ top: rowIds[b.r1], bottom: rowIds[Math.min(b.r2, rowIds.length - 1)], left: colIds[b.c1], right: colIds[Math.min(b.c2, colIds.length - 1)] });
      const bindF = (f) => { try { return storedFromText(String(f).startsWith("=") ? f : `=${f}`, model.grid, tab); } catch { return null; } };
      for (const v of s.validation) {
        const ranges = v.ranges.map(rg).filter((x) => x.top && x.left);
        if (!ranges.length) continue;
        const base = { kind: "valid", ranges, reject: Boolean(v.reject), ...(v.help ? { help: String(v.help).slice(0, 500) } : {}) };
        if (v.type === "list") model.setRule(tab, null, { ...base, type: "list", items: v.items, display: v.display || "chip" });
        else if (v.type === "number") model.setRule(tab, null, { ...base, type: "number", op: v.op, a: v.a, b: v.b });
        else if (v.type === "text" || v.type === "date") model.setRule(tab, null, { ...base, type: v.type, op: v.op, a: v.a, b: v.b });
        else if (v.type === "checkbox") model.setRule(tab, null, { ...base, type: "checkbox", ...(v.checked !== undefined ? { checked: String(v.checked) } : {}), ...(v.unchecked !== undefined ? { unchecked: String(v.unchecked) } : {}) });
        else if (v.type === "range") {
          if (typeof v.source === "string") { const t = v.source.replace(/^=/, ""), bang = t.lastIndexOf("!"); const b = openRangeRef(t.slice(bang + 1)); v.source = b ? { ...b, sheet: bang > 0 ? t.slice(0, bang).replace(/^'(.*)'$/, "$1").replace(/''/g, "'") : null } : null; }
          if (!v.source) { notes.push("A dropdown from a range couldn't be read."); continue; }
          const st = v.source.sheet ? tabNamed(v.source.sheet) : tab;
          if (!st) { notes.push("A dropdown from a range on a missing tab wasn't brought over."); continue; }
          const sr = model.rowIds(st), sc = model.colIds(st);
          const b = v.source;
          const source = { tab: st, top: b.r1 === null ? null : sr[Math.min(b.r1, sr.length - 1)], bottom: b.r2 === null ? null : sr[Math.min(b.r2, sr.length - 1)], left: sc[Math.min(b.c1, sc.length - 1)], right: sc[Math.min(b.c2, sc.length - 1)] };
          model.setRule(tab, null, { ...base, type: "range", source, display: v.display || "chip" });
        } else if (v.type === "formula") {
          const f = bindF(v.f);
          if (f) model.setRule(tab, null, { ...base, type: "formula", f }); else notes.push("A custom-formula validation rule couldn't be read.");
        } else notes.push("Some data validation wasn't brought over.");
      }
      for (const f of [...s.formats].sort((a, b) => (a.prio ?? 0) - (b.prio ?? 0))) {
        const ranges = f.ranges.map(rg).filter((x) => x.top && x.left);
        if (!ranges.length) continue;
        if (f.scale) model.setRule(tab, null, { kind: "format", type: "scale", ranges, ...f.scale });
        else if (f.cond.op === "formula") {
          const fx = bindF(f.cond.f);
          if (fx) model.setRule(tab, null, { kind: "format", type: "single", ranges, cond: { op: "formula", f: fx }, style: f.style });
          else notes.push("A conditional format with a custom formula couldn't be read.");
        } else model.setRule(tab, null, { kind: "format", type: "single", ranges, cond: f.cond, style: f.style });
      }
      if (s.filter && s.filter.r1 < rowIds.length && s.filter.c1 < colIds.length) model.setFilter(tab, "filter", { ...rg({ ...s.filter, r2: s.filter.r2 ?? s.filter.r1 }), bottom: s.filter.r2 === null || s.filter.r2 === undefined ? null : rowIds[Math.min(s.filter.r2, rowIds.length - 1)] });
      for (const ch of s.charts || []) {
        const b = ch.range;
        if (!b || b.r1 >= rowIds.length || b.c1 >= colIds.length) continue;
        const { range: _r, pos, ...rest } = ch;
        const at = { row: rowIds[Math.min(pos?.r ?? 0, rowIds.length - 1)], col: colIds[Math.min(pos?.c ?? 0, colIds.length - 1)], dx: Math.max(0, pos?.dx || 0), dy: Math.max(0, pos?.dy || 0), w: Math.max(160, Math.min(1600, pos?.w || 480)), h: Math.max(120, Math.min(1200, pos?.h || 300)) };
        model.setChart(tab, null, { ...rest, range: rg(b), pos: at });
      }
    });
    for (const n of wb.names) {
      const home = n.local !== undefined ? tabs[Number(n.local)] : tabs[0];
      const res = model.setName(n.name, n.ref.replace(/^=/, ""), home);
      if (!res.ok) notes.push(`The named range "${n.name}" wasn't brought over.`);
    }
  }, "import");
  if (unreadable) notes.push(`${unreadable} formula${unreadable === 1 ? "" : "s"} couldn't be read and came over as ${unreadable === 1 ? "its value" : "their values"}.`);
  return { notes: [...new Set(notes)], tabs: importedTabs };
}

// A value as typed input that comes back as the same value.
function valueText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object" && v.error) return v.error;
  return `'${v}`; // text stays text, even "007" or "=x"
}
