// Excel (.xlsx) out (SPREADSHEET_DESIGN.md §7): our own writer, zipped with fflate.
// Values (with each formula's last answer cached so Excel and Google show it before
// recalculating), formulas (newer functions get Excel's _xlfn. prefix; an array result
// becomes an array formula over its block; a pivot goes out as its values), number
// formats, fonts, fills, borders, alignment, merges, column widths, row heights, hidden
// rows and columns, frozen panes, tab colours, hidden tabs, named ranges and dropdown
// validation. Not written yet: conditional formats, charts, comments and notes.
//
//   toXlsx(model, engine) → Uint8Array

import { zipSync, strToU8 } from "fflate";
import { indexToCol, refToA1 } from "./engine/parser.js";
import { unbind, formulaText } from "./engine/binding.js";
import { isErr } from "./engine/values.js";
import { DEF_W, DEF_H } from "./grid.js";

const xmlEsc = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const a1 = (r, c) => `${indexToCol(c)}${r + 1}`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// Functions Excel added after 2007: in a file they're written with _xlfn.
const XLFN = new Set(["AGGREGATE", "ARRAYTOTEXT", "BASE", "BETA.DIST", "BETA.INV", "BINOM.DIST", "BINOM.DIST.RANGE", "BINOM.INV", "BITAND", "BITLSHIFT", "BITOR", "BITRSHIFT", "BITXOR", "BYCOL", "BYROW", "CEILING.MATH", "CEILING.PRECISE", "CHISQ.DIST", "CHISQ.DIST.RT", "CHISQ.INV", "CHISQ.INV.RT", "CHISQ.TEST", "CHOOSECOLS", "CHOOSEROWS", "COMBINA", "CONCAT", "CONFIDENCE.NORM", "CONFIDENCE.T", "COT", "COTH", "COVARIANCE.P", "COVARIANCE.S", "CSC", "CSCH", "DAYS", "DECIMAL", "DROP", "ERF.PRECISE", "ERFC.PRECISE", "EXPAND", "EXPON.DIST", "F.DIST", "F.DIST.RT", "F.INV", "F.INV.RT", "F.TEST", "FILTER", "FLOOR.MATH", "FLOOR.PRECISE", "FORMULATEXT", "GAMMA", "GAMMA.DIST", "GAMMA.INV", "GAMMALN.PRECISE", "GAUSS", "HSTACK", "IFNA", "IFS", "IMAGE", "ISFORMULA", "ISOWEEKNUM", "LAMBDA", "LET", "LOGNORM.DIST", "LOGNORM.INV", "MAKEARRAY", "MAP", "MAXIFS", "MINIFS", "MODE.MULT", "MODE.SNGL", "NEGBINOM.DIST", "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "NUMBERVALUE", "PDURATION", "PERCENTILE.EXC", "PERCENTILE.INC", "PERCENTRANK.EXC", "PERCENTRANK.INC", "PERMUTATIONA", "PHI", "POISSON.DIST", "QUARTILE.EXC", "QUARTILE.INC", "RANDARRAY", "RANK.AVG", "RANK.EQ", "REDUCE", "RRI", "SCAN", "SEC", "SECH", "SEQUENCE", "SHEET", "SHEETS", "SKEW.P", "SORT", "SORTBY", "STDEV.P", "STDEV.S", "SWITCH", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV", "T.INV.2T", "T.TEST", "TAKE", "TEXTAFTER", "TEXTBEFORE", "TEXTJOIN", "TEXTSPLIT", "TOCOL", "TOROW", "UNICHAR", "UNICODE", "UNIQUE", "VALUETOTEXT", "VAR.P", "VAR.S", "VSTACK", "WEIBULL.DIST", "WRAPCOLS", "WRAPROWS", "XLOOKUP", "XMATCH", "XOR", "Z.TEST"]);

// Excel's formula text: no "=", newer functions prefixed (outside quoted text).
export function excelFormula(text) {
  let s = String(text || "").replace(/^=/, "");
  let out = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') { const j = s.indexOf('"', i + 1); let k = j; while (k >= 0 && s[k + 1] === '"') k = s.indexOf('"', k + 2); const end = k < 0 ? s.length : k + 1; out += s.slice(i, end); i = end; continue; }
    if (ch === "'") { const j = s.indexOf("'", i + 1); const end = j < 0 ? s.length : j + 1; out += s.slice(i, end); i = end; continue; }
    const m = /^[A-Za-z_][A-Za-z0-9_.]*(?=\()/.exec(s.slice(i));
    if (m && (i === 0 || !/[A-Za-z0-9_.$]/.test(s[i - 1]))) { const up = m[0].toUpperCase(); out += XLFN.has(up) ? `_xlfn.${up}` : m[0]; i += m[0].length; continue; }
    out += ch; i++;
  }
  return out;
}

const BORDER = { thin: "thin", medium: "medium", thick: "thick", dashed: "dashed", dotted: "dotted", double: "double" };
const rgb = (hex) => `FF${String(hex).replace("#", "").toUpperCase()}`;
const BUILTIN_FMT = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "0.00E+00": 11, "m/d/yyyy": 14, "h:mm": 20, "h:mm:ss": 21, "@": 49 };

function stylesXml(styles) {
  const fonts = [{ font: "Arial", size: 10 }], fills = [null, null], borders = [{}], numFmts = new Map(), xfs = [];
  const idOf = (list, item) => { const k = JSON.stringify(item); let i = list.findIndex((x) => JSON.stringify(x) === k); if (i < 0) { list.push(item); i = list.length - 1; } return i; };
  for (const st of styles) {
    const font = { font: st.font || "Arial", size: st.size || 10, bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike, color: st.color || null };
    const fontId = idOf(fonts, font.bold || font.italic || font.underline || font.strike || font.color || font.font !== "Arial" || font.size !== 10 ? font : fonts[0]);
    const fillId = st.fill ? idOf(fills, st.fill) : 0;
    const b = { top: st.borderTop, right: st.borderRight, bottom: st.borderBottom, left: st.borderLeft };
    const borderId = b.top || b.right || b.bottom || b.left ? idOf(borders, b) : 0;
    let fmtId = 0;
    if (st.format) { if (BUILTIN_FMT[st.format] !== undefined) fmtId = BUILTIN_FMT[st.format]; else { if (!numFmts.has(st.format)) numFmts.set(st.format, 164 + numFmts.size); fmtId = numFmts.get(st.format); } }
    xfs.push({ fontId, fillId, borderId, fmtId, st });
  }
  const fontXml = (f) => `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}${f.strike ? "<strike/>" : ""}${f.underline ? "<u/>" : ""}<sz val="${f.size || 10}"/>${f.color ? `<color rgb="${rgb(f.color)}"/>` : ""}<name val="${xmlEsc(f.font || "Arial")}"/></font>`;
  const fillXml = (f, i) => (i === 0 ? '<fill><patternFill patternType="none"/></fill>' : i === 1 ? '<fill><patternFill patternType="gray125"/></fill>' : `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(f)}"/><bgColor indexed="64"/></patternFill></fill>`);
  const side = (name, s) => (s ? `<${name} style="${BORDER[s.style] || "thin"}"><color rgb="${rgb(s.color || "#000000")}"/></${name}>` : `<${name}/>`);
  const borderXml = (b) => `<border>${side("left", b.left)}${side("right", b.right)}${side("top", b.top)}${side("bottom", b.bottom)}<diagonal/></border>`;
  const H = { left: "left", center: "center", right: "right" }, V = { top: "top", middle: "center", bottom: "bottom" };
  const xfXml = (x) => {
    const al = x.st.halign || x.st.valign || x.st.wrap === "wrap" || x.st.rotate;
    return `<xf numFmtId="${x.fmtId}" fontId="${x.fontId}" fillId="${x.fillId}" borderId="${x.borderId}" xfId="0"${x.fmtId ? ' applyNumberFormat="1"' : ""}${x.fontId ? ' applyFont="1"' : ""}${x.fillId ? ' applyFill="1"' : ""}${x.borderId ? ' applyBorder="1"' : ""}${al ? ' applyAlignment="1"' : ""}>${al ? `<alignment${x.st.halign ? ` horizontal="${H[x.st.halign]}"` : ""}${x.st.valign ? ` vertical="${V[x.st.valign]}"` : ""}${x.st.wrap === "wrap" ? ' wrapText="1"' : ""}${x.st.rotate ? ` textRotation="${x.st.rotate < 0 ? 90 - x.st.rotate : x.st.rotate}"` : ""}/>` : ""}</xf>`;
  };
  return HEAD + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + (numFmts.size ? `<numFmts count="${numFmts.size}">${[...numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEsc(code)}"/>`).join("")}</numFmts>` : "")
    + `<fonts count="${fonts.length}">${fonts.map(fontXml).join("")}</fonts>`
    + `<fills count="${fills.length}">${fills.map(fillXml).join("")}</fills>`
    + `<borders count="${borders.length}">${borders.map(borderXml).join("")}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${xfs.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xfs.map(xfXml).join("")}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

export function toXlsx(model, engine) {
  const tabs = model.tabIds();
  const strings = [], stringIx = new Map();
  const sst = (s) => { s = String(s).slice(0, 32767); if (!stringIx.has(s)) { stringIx.set(s, strings.length); strings.push(s); } return stringIx.get(s); };
  const styleList = [], styleIx = new Map(); // our style id → xf index (1-based; 0 is default)
  const xfOf = (sid) => {
    if (!sid) return 0;
    if (styleIx.has(sid)) return styleIx.get(sid);
    const st = model.style(sid);
    if (!st || !Object.keys(st).length) { styleIx.set(sid, 0); return 0; }
    styleList.push(st); styleIx.set(sid, styleList.length);
    return styleList.length;
  };
  const files = {};
  const sheetEntries = [];
  const definedNames = [];

  // Excel's tab names: at most 31 characters, none of []:*?/\, unique ignoring case. Formulas
  // and named ranges are written with these names, so references between tabs still meet.
  const xlNames = new Map(), used = new Set();
  for (const tab of tabs) {
    const base = (String(model.tabInfo(tab).name || "Sheet").replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim() || "Sheet").slice(0, 31).trim();
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) { const sfx = ` (${n++})`; name = base.slice(0, 31 - sfx.length).trim() + sfx; }
    used.add(name.toLowerCase());
    xlNames.set(tab, name);
  }
  const xgrid = Object.create(model.grid);
  xgrid.tabName = (t) => (xlNames.has(t) ? xlNames.get(t) : model.grid.tabName(t));
  const xlText = (tab, r, c, f) => { if (f.src) return model.inputText(tab, r, c); try { return formulaText(f, xgrid, tab); } catch { return model.inputText(tab, r, c); } };

  tabs.forEach((tab, ti) => {
    const info = model.tabInfo(tab);
    const rows = model.rowIds(tab), cols = model.colIds(tab);
    const rIx = new Map(rows.map((x, i) => [x, i])), cIx = new Map(cols.map((x, i) => [x, i]));
    const out = new Map(); // r → Map(c → xml)
    let maxR = 0, maxC = 0;
    const put = (r, c, xml) => { if (!out.has(r)) out.set(r, new Map()); out.get(r).set(c, xml); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); };
    const valueXml = (ref, v, s, f) => {
      const sAttr = s ? ` s="${s}"` : "";
      if (v === null || v === undefined || v === "") return f ? `<c r="${ref}"${sAttr}>${f}</c>` : s ? `<c r="${ref}"${sAttr}/>` : null;
      if (isErr(v)) return `<c r="${ref}"${sAttr} t="e">${f || ""}<v>${xmlEsc(v.code)}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}"${sAttr} t="b">${f || ""}<v>${v ? 1 : 0}</v></c>`;
      if (typeof v === "number") return `<c r="${ref}"${sAttr}>${f || ""}<v>${Number.isFinite(v) ? v : 0}</v></c>`;
      return f ? `<c r="${ref}"${sAttr} t="str">${f}<v>${xmlEsc(v)}</v></c>` : `<c r="${ref}"${sAttr} t="s"><v>${sst(v)}</v></c>`;
    };
    const spillCells = new Set();
    for (const [k, cell] of model._cells(tab).entries()) {
      const [rid, cid] = k.split(".");
      const r = rIx.get(rid), c = cIx.get(cid);
      if (r === undefined || c === undefined || !cell) continue;
      const s = xfOf(cell.s);
      const v = engine.valueAt(tab, r, c);
      let f = "";
      if (cell.f) {
        const text = xlText(tab, r, c, cell.f);
        const pivot = /^=PIVOT\.TABLE\(/i.test(text);
        const fi = engine.formulaInfo?.(tab, rid, cid);
        const spill = fi?.spill && !fi.blocked ? fi.spill : null;
        if (!pivot) f = spill && (spill.h > 1 || spill.w > 1) ? `<f t="array" ref="${a1(r, c)}:${a1(r + spill.h - 1, c + spill.w - 1)}">${xmlEsc(excelFormula(text))}</f>` : `<f>${xmlEsc(excelFormula(text))}</f>`;
        if (spill) for (let i = 0; i < spill.h; i++) for (let j = 0; j < spill.w; j++) if (i || j) spillCells.add(`${r + i},${c + j}`);
      }
      const xml = valueXml(a1(r, c), v, s, f);
      if (xml) put(r, c, xml);
    }
    // the rest of each array result, as cached values
    for (const key of spillCells) {
      const [r, c] = key.split(",").map(Number);
      if (r >= rows.length || c >= cols.length) continue;
      const existing = out.get(r)?.get(c);
      const cell = model.cellAt(tab, r, c);
      const xml = valueXml(a1(r, c), engine.valueAt(tab, r, c), cell ? xfOf(cell.s) : 0, "");
      if (xml && !existing) put(r, c, xml);
    }

    // rows (with heights / hidden) and columns (widths / hidden)
    const rowAttrs = new Map();
    rows.forEach((id, r) => { const m = model.rowMeta(tab, id); if (m && (m.h || m.hidden)) { rowAttrs.set(r, `${m.h ? ` ht="${Math.round(m.h * 0.75 * 100) / 100}" customHeight="1"` : ""}${m.hidden ? ' hidden="1"' : ""}`); maxR = Math.max(maxR, r); } });
    const colXml = [];
    cols.forEach((id, c) => { const m = model.colMeta(tab, id); if (m && (m.w || m.hidden)) colXml.push(`<col min="${c + 1}" max="${c + 1}" width="${Math.max(0, Math.round(((m.w || DEF_W) - 5) / 7 * 100) / 100)}"${m.w ? ' customWidth="1"' : ""}${m.hidden ? ' hidden="1"' : ""}/>`); });
    let sheetData = "";
    const rowNums = [...new Set([...out.keys(), ...rowAttrs.keys()])].sort((x, y) => x - y);
    for (const r of rowNums) {
      const cells = out.get(r);
      const body = cells ? [...cells.entries()].sort((x, y) => x[0] - y[0]).map(([, xml]) => xml).join("") : "";
      sheetData += `<row r="${r + 1}"${rowAttrs.get(r) || ""}>${body}</row>`;
    }
    const merges = model.mergesOf(tab);
    const fr = info.frozenRows || 0, fc = info.frozenCols || 0;
    const pane = fr || fc ? `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${a1(fr, fc)}" activePane="${fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight"}" state="frozen"/>` : "";
    // dropdowns (list rules) as Excel data validation
    const dv = [];
    for (const rule of model.rulesOf(tab)) {
      if (rule.kind !== "valid" || rule.type !== "list" || !(rule.items || []).length) continue;
      const list = rule.items.join(",");
      if (list.length > 250) continue; // Excel's limit for a typed list
      const sq = (rule.ranges || []).map((rg) => { const b = boundsOf(rg, rows, cols); return b ? `${a1(b.r1, b.c1)}:${a1(b.r2, b.c2)}` : null; }).filter(Boolean).join(" ");
      if (sq) dv.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="${rule.reject ? 1 : 0}" errorStyle="${rule.reject ? "stop" : "warning"}" sqref="${sq}"><formula1>"${xmlEsc(list.replace(/"/g, '""'))}"</formula1></dataValidation>`);
    }
    files[`xl/worksheets/sheet${ti + 1}.xml`] = strToU8(HEAD + `<worksheet ${NS}>`
      + (info.color ? `<sheetPr><tabColor rgb="${rgb(info.color)}"/></sheetPr>` : "")
      + `<dimension ref="A1:${a1(maxR, maxC)}"/>`
      + `<sheetViews><sheetView workbookViewId="0"${info.gridlines === false ? ' showGridLines="0"' : ""}${ti === 0 ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="${DEF_H * 0.75}" defaultColWidth="${Math.round(((DEF_W - 5) / 7) * 100) / 100}"/>`
      + (colXml.length ? `<cols>${colXml.join("")}</cols>` : "")
      + `<sheetData>${sheetData}</sheetData>`
      + (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${a1(m.r1, m.c1)}:${a1(m.r2, m.c2)}"/>`).join("")}</mergeCells>` : "")
      + (dv.length ? `<dataValidations count="${dv.length}">${dv.join("")}</dataValidations>` : "")
      + `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`);
    sheetEntries.push({ name: xlNames.get(tab), hidden: !!info.hidden, n: ti + 1 });
  });

  // named ranges
  for (const { name, ref } of model.nameList()) {
    const tab = ref?.sheet;
    if (!tab || !tabs.includes(tab)) continue;
    let n;
    try { n = unbind(ref, model.grid, tab); } catch { continue; }
    if (!n || n.t !== "ref" || n.bad) continue;
    const abs = { ...n, sheet: null, ar1: true, ac1: true, ar2: true, ac2: true };
    definedNames.push(`<definedName name="${xmlEsc(name)}">'${xmlEsc(xlNames.get(tab).replace(/'/g, "''"))}'!${xmlEsc(refToA1(abs))}</definedName>`);
  }

  files["xl/workbook.xml"] = strToU8(HEAD + `<workbook ${NS}><bookViews><workbookView/></bookViews><sheets>${sheetEntries.map((s) => `<sheet name="${xmlEsc(s.name)}" sheetId="${s.n}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${s.n}"/>`).join("")}</sheets>${definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  const n = sheetEntries.length;
  files["xl/_rels/workbook.xml.rels"] = strToU8(HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((s) => `<Relationship Id="rId${s.n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.n}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(stylesXml(styleList));
  files["xl/sharedStrings.xml"] = strToU8(HEAD + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ""}>${xmlEsc(s)}</t></si>`).join("")}</sst>`);
  files["_rels/.rels"] = strToU8(HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["[Content_Types].xml"] = strToU8(HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetEntries.map((s) => `<Override PartName="/xl/worksheets/sheet${s.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  return zipSync(files, { level: 6 });
}

function boundsOf(rg, rows, cols) {
  const pos = (list, id, d) => (id === null || id === undefined ? d : list.indexOf(id));
  const r1 = pos(rows, rg.top, 0), r2 = pos(rows, rg.bottom, rows.length - 1), c1 = pos(cols, rg.left, 0), c2 = pos(cols, rg.right, cols.length - 1);
  return [r1, r2, c1, c2].some((x) => x < 0) ? null : { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
}
