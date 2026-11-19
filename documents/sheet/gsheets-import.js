// Google Sheets in (SPREADSHEET_DESIGN.md §7): turns what the Sheets API answers (read by
// netlify/functions/gdocs.js with the read-only Drive scope) into the workbook shape that
// xlsx-import.js writes into a model, so both imports share one writer. Pure.
//
//   gsheetToWorkbook(meta, rowsByTab, { hasComments }) → workbook
//     meta       spreadsheets.get with properties, named ranges, each tab's properties, merges,
//                conditional formats, basic filter and charts (no grid data)
//     rowsByTab  { [tab title]: [GridData…] } the blocks of rows fetched for each tab
//
// Values and formulas (as typed in Google; the formula language is the same), number
// formats, fonts, colours (theme colours too), borders, alignment, wrapping, rotation,
// merges, sizes, hidden rows and columns, frozen rows and columns, tab colours, hidden tabs,
// gridlines, named ranges, notes (as comments), data validation (lists, ranges, checkboxes,
// numbers, text, dates, custom formulas), conditional formats (conditions, custom formulas,
// colour scales), the filter's range, simple charts, and pivot tables as their values. What
// isn't brought over is listed in `notes`.

const ERRORS = { ERROR: "#ERROR!", NULL_VALUE: "#NULL!", DIVIDE_BY_ZERO: "#DIV/0!", VALUE: "#VALUE!", REF: "#REF!", NAME: "#NAME?", NUM: "#NUM!", N_A: "#N/A", LOADING: "#N/A" };
const FORMAT_BY_TYPE = { NUMBER: "#,##0.00", PERCENT: "0.00%", CURRENCY: "$#,##0.00", DATE: "m/d/yyyy", TIME: "h:mm:ss am/pm", DATE_TIME: "m/d/yyyy h:mm:ss", SCIENTIFIC: "0.00E+00", TEXT: "@" };
const BORDER = { DOTTED: "dotted", DASHED: "dashed", SOLID: "thin", SOLID_MEDIUM: "medium", SOLID_THICK: "thick", DOUBLE: "double" };
const H = { LEFT: "left", CENTER: "center", RIGHT: "right" }, V = { TOP: "top", MIDDLE: "middle" };
const WRAP = { WRAP: "wrap", LEGACY_WRAP: "wrap", CLIP: "clip" };
const NUM_OPS = { NUMBER_GREATER: "gt", NUMBER_GREATER_THAN_EQ: "gte", NUMBER_LESS: "lt", NUMBER_LESS_THAN_EQ: "lte", NUMBER_EQ: "eq", NUMBER_NOT_EQ: "ne", NUMBER_BETWEEN: "between", NUMBER_NOT_BETWEEN: "notBetween" };
const TEXT_FORMAT_OPS = { TEXT_CONTAINS: "contains", TEXT_NOT_CONTAINS: "notContains", TEXT_STARTS_WITH: "starts", TEXT_ENDS_WITH: "ends", TEXT_EQ: "textIs", BLANK: "empty", NOT_BLANK: "notEmpty", DATE_EQ: "dateIs", DATE_BEFORE: "dateBefore", DATE_AFTER: "dateAfter" };
const TEXT_VALID_OPS = { TEXT_CONTAINS: "contains", TEXT_NOT_CONTAINS: "notContains", TEXT_EQ: "textIs", TEXT_IS_EMAIL: "email", TEXT_IS_URL: "url" };
const DATE_VALID_OPS = { DATE_IS_VALID: "valid", DATE_EQ: "dateIs", DATE_BEFORE: "dateBefore", DATE_AFTER: "dateAfter", DATE_BETWEEN: "between", DATE_NOT_BETWEEN: "notBetween" };
const RELATIVE = { TODAY: "today", TOMORROW: "tomorrow", YESTERDAY: "yesterday" };
const CHART = { COLUMN: "column", BAR: "bar", LINE: "line", AREA: "area", SCATTER: "scatter", COMBO: "combo" };
const LEGEND = { BOTTOM_LEGEND: "bottom", TOP_LEGEND: "top", RIGHT_LEGEND: "right", LEFT_LEGEND: "right", NO_LEGEND: "none" };
const POINT = { MIN: "min", MAX: "max", NUMBER: "num", PERCENT: "pct", PERCENTILE: "percentile" };

const hex2 = (x) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 255).toString(16).padStart(2, "0");
const rgbHex = (c) => (c && typeof c === "object" ? `#${hex2(c.red)}${hex2(c.green)}${hex2(c.blue)}` : null);

function themeOf(meta) {
  const t = {};
  for (const x of meta?.properties?.spreadsheetTheme?.themeColors || []) { const h = rgbHex(x.color?.rgbColor); if (h && x.colorType) t[x.colorType] = h; }
  return t;
}
const colorOf = (style, theme) => (style?.rgbColor ? rgbHex(style.rgbColor) : style?.themeColor ? theme[style.themeColor] || null : null);

// A cell's userEnteredFormat as our style.
export function styleOf(f, theme, defaults = {}) {
  const st = {};
  if (!f) return st;
  const nf = f.numberFormat;
  if (nf && (nf.pattern || FORMAT_BY_TYPE[nf.type])) { const p = nf.pattern || FORMAT_BY_TYPE[nf.type]; if (p && p !== "General") st.format = p; }
  const fill = colorOf(f.backgroundColorStyle, theme);
  if (fill && fill !== "#ffffff") st.fill = fill;
  const tf = f.textFormat || {};
  if (tf.fontFamily && tf.fontFamily !== (defaults.font || "Arial")) st.font = tf.fontFamily;
  if (tf.fontSize && tf.fontSize !== (defaults.size || 10)) st.size = tf.fontSize;
  if (tf.bold) st.bold = true;
  if (tf.italic) st.italic = true;
  if (tf.underline) st.underline = true;
  if (tf.strikethrough) st.strike = true;
  const color = colorOf(tf.foregroundColorStyle, theme);
  if (color && color !== "#000000") st.color = color;
  if (H[f.horizontalAlignment]) st.halign = H[f.horizontalAlignment];
  if (V[f.verticalAlignment]) st.valign = V[f.verticalAlignment];
  if (WRAP[f.wrapStrategy]) st.wrap = WRAP[f.wrapStrategy];
  const angle = Number(f.textRotation?.angle);
  if (angle) st.rotate = Math.max(-90, Math.min(90, angle));
  for (const [side, key] of [["top", "borderTop"], ["right", "borderRight"], ["bottom", "borderBottom"], ["left", "borderLeft"]]) {
    const b = f.borders?.[side];
    if (b && BORDER[b.style]) st[key] = { style: BORDER[b.style], color: colorOf(b.colorStyle, theme) || "#000000" };
  }
  return st;
}

// A value as the workbook carries it: number, boolean, text, or { error }.
function valueOf(v) {
  if (!v) return null;
  if (v.numberValue !== undefined) return Number(v.numberValue);
  if (v.boolValue !== undefined) return Boolean(v.boolValue);
  if (v.stringValue !== undefined) return String(v.stringValue);
  if (v.errorValue) return { error: ERRORS[v.errorValue.type] || "#ERROR!" };
  return null;
}

// A GridRange as rows and columns (end inclusive; open ends reach far, the writer clamps).
const FAR = 1e7;
function boundsOf(g) {
  if (!g) return null;
  const r1 = g.startRowIndex ?? 0, c1 = g.startColumnIndex ?? 0;
  const r2 = g.endRowIndex !== undefined ? g.endRowIndex - 1 : FAR, c2 = g.endColumnIndex !== undefined ? g.endColumnIndex - 1 : FAR;
  return r2 >= r1 && c2 >= c1 ? { r1, c1, r2, c2 } : null;
}

// Cells that share a rule → rectangles: runs down each column, then side-by-side runs joined.
export function rectsOf(cells) {
  const byCol = new Map();
  for (const { r, c } of cells) { if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(r); }
  const runs = [];
  for (const [c, rs] of [...byCol].sort((a, b) => a[0] - b[0])) {
    rs.sort((a, b) => a - b);
    let s = rs[0], p = rs[0];
    for (const r of rs.slice(1)) { if (r === p + 1) { p = r; continue; } runs.push({ r1: s, r2: p, c1: c, c2: c }); s = p = r; }
    runs.push({ r1: s, r2: p, c1: c, c2: c });
  }
  const out = [];
  for (const run of runs) {
    const prev = out.find((o) => o.r1 === run.r1 && o.r2 === run.r2 && o.c2 === run.c1 - 1);
    if (prev) prev.c2 = run.c2; else out.push(run);
  }
  return out;
}

const condValue = (v) => (v?.relativeDate ? RELATIVE[v.relativeDate] ?? null : v?.userEnteredValue ?? "");

function validationOf(dv, notes) {
  const c = dv.condition || {};
  const vals = c.values || [];
  const base = { reject: Boolean(dv.strict), ...(dv.inputMessage ? { help: dv.inputMessage } : {}) };
  if (c.type === "ONE_OF_LIST") return { ...base, type: "list", items: vals.map((v) => String(v.userEnteredValue ?? "")).filter((x) => x !== ""), display: dv.showCustomUi === false ? "plain" : "chip" };
  if (c.type === "ONE_OF_RANGE") return { ...base, type: "range", source: String(vals[0]?.userEnteredValue || ""), display: dv.showCustomUi === false ? "plain" : "chip" };
  if (c.type === "BOOLEAN") return { ...base, type: "checkbox", ...(vals[0] ? { checked: vals[0].userEnteredValue } : {}), ...(vals[1] ? { unchecked: vals[1].userEnteredValue } : {}) };
  if (NUM_OPS[c.type]) return { ...base, type: "number", op: NUM_OPS[c.type], a: condValue(vals[0]), b: vals[1] ? condValue(vals[1]) : undefined };
  if (TEXT_VALID_OPS[c.type]) return { ...base, type: "text", op: TEXT_VALID_OPS[c.type], a: vals[0] ? condValue(vals[0]) : undefined };
  if (DATE_VALID_OPS[c.type]) {
    const a = vals[0] ? condValue(vals[0]) : undefined, b = vals[1] ? condValue(vals[1]) : undefined;
    if (a === null || b === null) { notes.add("Some date validation (relative dates like “past week”) wasn't brought over."); return null; }
    return { ...base, type: "date", op: DATE_VALID_OPS[c.type], a, b };
  }
  if (c.type === "CUSTOM_FORMULA" && vals[0]?.userEnteredValue) return { ...base, type: "formula", f: vals[0].userEnteredValue };
  notes.add("Some data validation wasn't brought over.");
  return null;
}

function formatRuleOf(cf, theme, notes) {
  const ranges = (cf.ranges || []).map(boundsOf).filter(Boolean);
  if (!ranges.length) return null;
  if (cf.gradientRule) {
    const g = cf.gradientRule;
    const pt = (p, dflt) => (p ? { type: POINT[p.type] || "num", ...(p.value !== undefined ? { v: p.value } : {}), color: colorOf(p.colorStyle, theme) || dflt } : null);
    const min = pt(g.minpoint, "#ffffff"), max = pt(g.maxpoint, "#57bb8a"), mid = pt(g.midpoint, "#ffd666");
    if (!min || !max) return null;
    return { ranges, scale: { min, max, ...(mid ? { mid } : {}) } };
  }
  const br = cf.booleanRule;
  if (!br) return null;
  const c = br.condition || {}, vals = c.values || [];
  const tf = br.format?.textFormat || {};
  const style = {};
  const fill = colorOf(br.format?.backgroundColorStyle, theme);
  if (fill) style.fill = fill;
  const color = colorOf(tf.foregroundColorStyle, theme);
  if (color) style.color = color;
  for (const [k, ours] of [["bold", "bold"], ["italic", "italic"], ["underline", "underline"], ["strikethrough", "strike"]]) if (tf[k]) style[ours] = true;
  let cond = null;
  if (c.type === "CUSTOM_FORMULA" && vals[0]?.userEnteredValue) cond = { op: "formula", f: vals[0].userEnteredValue };
  else if (NUM_OPS[c.type]) cond = { op: NUM_OPS[c.type], a: condValue(vals[0]), ...(vals[1] ? { b: condValue(vals[1]) } : {}) };
  else if (TEXT_FORMAT_OPS[c.type]) {
    const a = vals[0] ? condValue(vals[0]) : undefined;
    if (a === null) { notes.add("Some conditional formatting with relative dates wasn't brought over."); return null; }
    cond = { op: TEXT_FORMAT_OPS[c.type], ...(a !== undefined ? { a } : {}) };
  }
  if (!cond) { notes.add("Some conditional formatting wasn't brought over."); return null; }
  return { ranges, cond, style };
}

// A chart over one block of this tab's columns → our chart; null (with a note) otherwise.
function chartOf(ch, sheetId, notes) {
  const spec = ch.spec || {};
  const pos = ch.position?.overlayPosition;
  if (!pos) { notes.add("Charts on a tab of their own weren't brought over."); return null; }
  let type, stacked = "none", smooth = false, donut = false, sources = [], headers;
  if (spec.pieChart) {
    type = "pie";
    donut = Number(spec.pieChart.pieHole) > 0;
    sources = [...(spec.pieChart.domain?.sourceRange?.sources || []), ...(spec.pieChart.series?.sourceRange?.sources || [])];
  } else if (spec.basicChart && CHART[spec.basicChart.chartType]) {
    const b = spec.basicChart;
    type = CHART[b.chartType];
    stacked = b.stackedType === "STACKED" ? "stacked" : b.stackedType === "PERCENT_STACKED" ? "percent" : "none";
    smooth = b.lineSmoothing === true && type === "line";
    for (const d of b.domains || []) sources.push(...(d.domain?.sourceRange?.sources || []));
    for (const s of b.series || []) sources.push(...(s.series?.sourceRange?.sources || []));
    if (b.headerCount !== undefined) headers = b.headerCount > 0;
  } else { notes.add("Some charts (histograms, maps, gauges and the like) weren't brought over."); return null; }
  if (!sources.length || sources.some((s) => (s.sheetId ?? 0) !== sheetId)) { notes.add("Charts over another tab's data weren't brought over."); return null; }
  const bs = sources.map(boundsOf).filter(Boolean);
  const r1 = Math.min(...bs.map((b) => b.r1)), r2 = Math.max(...bs.map((b) => b.r2)), c1 = Math.min(...bs.map((b) => b.c1)), c2 = Math.max(...bs.map((b) => b.c2));
  const covered = new Set();
  for (const b of bs) for (let c = b.c1; c <= Math.min(b.c2, c1 + 200); c++) covered.add(c);
  for (let c = c1; c <= Math.min(c2, c1 + 200); c++) if (!covered.has(c)) { notes.add("Charts over columns that aren't side by side weren't brought over."); return null; }
  if (r2 >= FAR) { notes.add("Charts over whole columns weren't brought over."); return null; }
  const out = { type, stacked, smooth, donut, range: { r1, r2, c1, c2 }, pos: { r: pos.anchorCell?.rowIndex ?? 0, c: pos.anchorCell?.columnIndex ?? 0, dx: pos.offsetXPixels || 0, dy: pos.offsetYPixels || 0, w: pos.widthPixels || 600, h: pos.heightPixels || 371 } };
  if (headers !== undefined) out.headers = headers;
  if (spec.title) out.title = String(spec.title).slice(0, 200);
  if (spec.subtitle) out.subtitle = String(spec.subtitle).slice(0, 200);
  const legend = spec.basicChart?.legendPosition || spec.pieChart?.legendPosition;
  if (LEGEND[legend]) out.legend = LEGEND[legend];
  for (const a of spec.basicChart?.axis || []) {
    if (!a.title) continue;
    const valueAxis = type === "bar" ? a.position === "BOTTOM_AXIS" : a.position === "LEFT_AXIS";
    if (valueAxis) out.yTitle = String(a.title).slice(0, 200); else if (a.position === "BOTTOM_AXIS" || a.position === "LEFT_AXIS") out.xTitle = String(a.title).slice(0, 200);
  }
  return out;
}

// The pivot tables' output: from each anchor, the touching cells that have a value but
// nothing typed in them (a spill from a formula never touches the anchor, so is left alone).
function pivotCells(grid, anchors) {
  const out = new Map();
  for (const [r0, c0] of anchors) {
    const stack = [[r0, c0]];
    while (stack.length && out.size < 200000) {
      const [r, c] = stack.pop();
      const k = `${r},${c}`;
      if (out.has(k)) continue;
      const cell = grid.get(k);
      if (!cell || cell.userEnteredValue || !cell.effectiveValue) continue;
      out.set(k, { r, c, value: valueOf(cell.effectiveValue) });
      stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
    }
  }
  return [...out.values()];
}

export function gsheetToWorkbook(meta, rowsByTab = {}, { hasComments = false } = {}) {
  const notes = new Set();
  const theme = themeOf(meta);
  const df = meta?.properties?.defaultFormat?.textFormat || {};
  const defaults = { font: df.fontFamily || "Arial", size: df.fontSize || 10 };
  const sheets = [];
  const idToName = new Map();
  for (const s of meta?.sheets || []) idToName.set(s.properties?.sheetId ?? 0, s.properties?.title);
  for (const s of meta?.sheets || []) {
    const p = s.properties || {};
    if (p.sheetType && p.sheetType !== "GRID") { notes.add(`The tab "${p.title}" isn't a grid (a chart or connected-data tab) and was left out.`); continue; }
    const gp = p.gridProperties || {};
    const sheet = {
      name: String(p.title || `Sheet${sheets.length + 1}`), hidden: Boolean(p.hidden), cells: [], rows: [], cols: [], merges: [],
      frozen: { rows: gp.frozenRowCount || 0, cols: gp.frozenColumnCount || 0 }, color: colorOf(p.tabColorStyle, theme), gridlines: !gp.hideGridlines,
      validation: [], formats: [], charts: [],
    };
    const grid = new Map();
    const anchors = [];
    const validations = new Map(); // JSON → { rule, cells }
    let colsDone = false;
    for (const block of rowsByTab[p.title] || []) {
      if (!block) continue;
      const r0 = block.startRow || 0, c0 = block.startColumn || 0;
      (block.rowData || []).forEach((row, i) => {
        const r = r0 + i;
        (row.values || []).forEach((cell, j) => {
          const c = c0 + j;
          if (!cell || !Object.keys(cell).length) return;
          grid.set(`${r},${c}`, cell);
          if (cell.pivotTable) anchors.push([r, c]);
          const ue = cell.userEnteredValue;
          const out = { r, c, value: null };
          if (ue?.formulaValue) { out.formula = ue.formulaValue; out.value = valueOf(cell.effectiveValue); }
          else if (ue) out.value = valueOf(ue);
          const style = styleOf(cell.userEnteredFormat, theme, defaults);
          if (Object.keys(style).length) out.style = style;
          if (cell.note) out.note = cell.note;
          if (ue || out.style || out.note) sheet.cells.push(out);
          if (cell.dataValidation) {
            const key = JSON.stringify(cell.dataValidation);
            if (!validations.has(key)) validations.set(key, { dv: cell.dataValidation, cells: [] });
            validations.get(key).cells.push({ r, c });
          }
        });
      });
      (block.rowMetadata || []).forEach((m, i) => {
        const h = m.pixelSize && Math.abs(m.pixelSize - 21) > 1 ? m.pixelSize : 0;
        if (h || m.hiddenByUser) sheet.rows.push({ r: r0 + i, ...(h ? { h } : {}), ...(m.hiddenByUser ? { hidden: true } : {}) });
      });
      if (!colsDone && block.columnMetadata) {
        colsDone = true;
        block.columnMetadata.forEach((m, j) => {
          const w = m.pixelSize && Math.abs(m.pixelSize - 100) > 1 ? m.pixelSize : 0;
          if (w || m.hiddenByUser) sheet.cols.push({ c: c0 + j, ...(w ? { w } : {}), ...(m.hiddenByUser ? { hidden: true } : {}) });
        });
      }
    }
    if (anchors.length) {
      const taken = new Set(sheet.cells.filter((x) => x.formula || x.value !== null).map((x) => `${x.r},${x.c}`));
      for (const x of pivotCells(grid, anchors)) {
        if (taken.has(`${x.r},${x.c}`) || x.value === null) continue;
        const prev = sheet.cells.find((y) => y.r === x.r && y.c === x.c);
        if (prev) prev.value = x.value; else sheet.cells.push(x);
      }
      notes.add("Pivot tables came over as their values.");
    }
    for (const m of s.merges || []) { const b = boundsOf(m); if (b && b.r2 < FAR && b.c2 < FAR) sheet.merges.push(b); }
    for (const { dv, cells } of validations.values()) {
      const rule = validationOf(dv, notes);
      if (rule) sheet.validation.push({ ...rule, ranges: rectsOf(cells).slice(0, 500) });
    }
    for (const cf of s.conditionalFormats || []) { const f = formatRuleOf(cf, theme, notes); if (f) sheet.formats.push(f); }
    const bf = s.basicFilter;
    if (bf?.range) {
      const b = boundsOf(bf.range);
      if (b) sheet.filter = { ...b, r2: b.r2 >= FAR ? null : b.r2 };
      if ((bf.filterSpecs || bf.criteria) && Object.keys(bf.filterSpecs || bf.criteria || {}).length) notes.add("Filters came over without their conditions; set them again from the filter buttons.");
    }
    if (s.filterViews?.length) notes.add("Filter views weren't brought over.");
    for (const ch of s.charts || []) { const c = chartOf(ch, p.sheetId ?? 0, notes); if (c) sheet.charts.push(c); }
    if (s.slicers?.length || s.bandedRanges?.length) notes.add("Alternating colours and slicers weren't brought over.");
    sheets.push(sheet);
  }
  const names = [];
  for (const n of meta?.namedRanges || []) {
    const b = boundsOf(n.range), title = idToName.get(n.range?.sheetId ?? 0);
    if (!b || !title || !n.name) continue;
    const col = (i) => { let s = ""; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
    const quoted = `'${String(title).replace(/'/g, "''")}'`;
    const ref = b.r2 >= FAR && b.c2 >= FAR ? null : b.r2 >= FAR ? `${col(b.c1)}:${col(b.c2)}` : b.c2 >= FAR ? `${b.r1 + 1}:${b.r2 + 1}` : `${col(b.c1)}${b.r1 + 1}:${col(b.c2)}${b.r2 + 1}`;
    if (ref) names.push({ name: n.name, ref: `${quoted}!${ref}` });
  }
  if (hasComments) notes.add("Comments weren't brought over; notes were.");
  return { sheets, names, notes: [...notes] };
}
