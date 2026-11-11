// Charts and tables linked to spreadsheets (SLIDES_DESIGN.md §6). A linked item keeps
// where it came from (`src`: the spreadsheet file, the tab and the chart or range, all
// by id, so it follows rows that move) and a copy of what it showed (`cache`). The copy
// draws at once, offline, and for anyone who can't open the spreadsheet; when the
// presentation opens, each link is worked out again from the spreadsheet with its own
// formula engine and the copy updated if it changed.
//
// A Safe presentation can link to Safe spreadsheets; an everyday one only to everyday
// spreadsheets (the Document page only offers those). Pasting from a Safe deck into an everyday
// one asks first and drops the link (ui.js crossPaste; Luke, 2026-11-10).

import { createSheetModel } from "../sheet/model.js";
import { connectEngine } from "../sheet/bridge.js";
import { createEngine } from "../sheet/engine/engine.js";
import { functionCatalog } from "../sheet/engine/functions/index.js";
import { displayOf } from "../sheet/grid.js";
import { readGrid, chartData } from "../sheet/charts.js";
import { rangeBounds, rangeFromA1, rangeToA1 } from "../sheet/rules.js";
import { docFromContent } from "../editor/doc-model.js";

export const MAX_TABLE_ROWS = 30, MAX_TABLE_COLS = 12;
const SPEC_KEYS = { type: "s", stacked: "s", smooth: "b", donut: "b", headers: "b", labels: "b", byRow: "b", title: "s", subtitle: "s", xTitle: "s", yTitle: "s", legend: "s", yMin: "n", yMax: "n", dataLabels: "b" };
const CHART_TYPES = new Set(["column", "bar", "line", "area", "pie", "scatter", "combo"]);

// A chart spec and its data as stored on a slide, checked (a shared presentation can't
// put anything else into the drawing).
export function cleanChartCache(c) {
  if (!c || typeof c !== "object") return null;
  const spec = {};
  for (const [k, t] of Object.entries(SPEC_KEYS)) {
    const v = c.spec?.[k];
    if (t === "s" && typeof v === "string") spec[k] = v.slice(0, 200);
    if (t === "b" && typeof v === "boolean") spec[k] = v;
    if (t === "n" && Number.isFinite(v)) spec[k] = v;
  }
  if (!CHART_TYPES.has(spec.type)) spec.type = "column";
  if (c.spec?.colors && typeof c.spec.colors === "object") {
    spec.colors = {};
    for (const [k, v] of Object.entries(c.spec.colors).slice(0, 30)) if (/^\d{1,2}$/.test(k) && /^#[0-9a-f]{6}$/i.test(v)) spec.colors[k] = v;
  }
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const d = c.data || {};
  const cats = Array.isArray(d.categories) ? d.categories.slice(0, 5000).map((x) => String(x ?? "").slice(0, 200)) : [];
  const series = Array.isArray(d.series) ? d.series.slice(0, 40).map((s) => ({ name: String(s?.name ?? "").slice(0, 200), values: Array.isArray(s?.values) ? s.values.slice(0, 5000).map(num) : [] })) : [];
  const data = { categories: cats, series };
  if (Array.isArray(d.xNumbers)) data.xNumbers = d.xNumbers.slice(0, 5000).map(num);
  return { spec, data };
}

// Opens a spreadsheet to read from: its shared data and a formula engine on the page.
export async function openSheetReader(store) {
  const bytes = await store.loadContent();
  if (!bytes) throw new Error("That spreadsheet is empty.");
  const model = createSheetModel(docFromContent(bytes));
  const engine = createEngine({ functions: functionCatalog() });
  const stop = connectEngine(model, engine);
  const cell = (tab, r, c) => { const d = displayOf(model, engine, tab, r, c); return { value: d.value, text: d.text }; };
  return {
    model, engine, cell,
    tabs: () => model.tabIds().map((id) => ({ id, name: model.tabInfo(id).name })),
    charts: (tab) => model.chartsOf(tab).map((ch) => ({ id: ch.id, title: ch.title || "", type: ch.type })),
    rangeFromA1: (tab, text) => rangeFromA1(model, tab, text),
    rangeToA1: (tab, rg) => rangeToA1(model, tab, rg),
    close: () => { try { stop?.(); } catch { /* gone */ } },
  };
}

// What a link shows now. src: { file, tab, chart } or { file, tab, range }.
// → { kind: "chart", cache } | { kind: "table", rows } | { error }
export function computeLink(reader, src) {
  const { model } = reader;
  if (!model.tabIds().includes(src.tab)) return { error: "The tab it came from was removed." };
  if (src.chart) {
    const ch = model.chartsOf(src.tab).find((x) => x.id === src.chart);
    if (!ch) return { error: "The chart it came from was removed." };
    const data = chartData(readGrid(model, src.tab, ch, reader.cell) || [], ch);
    return { kind: "chart", cache: cleanChartCache({ spec: ch, data }) };
  }
  if (src.range) {
    const b = rangeBounds(model, src.tab, src.range);
    if (!b) return { error: "The cells it came from were removed." };
    const rows = [];
    for (let r = b.r1; r <= Math.min(b.r2, b.r1 + MAX_TABLE_ROWS - 1); r++) {
      const row = [];
      for (let c = b.c1; c <= Math.min(b.c2, b.c1 + MAX_TABLE_COLS - 1); c++) {
        const d = displayOf(model, reader.engine, src.tab, r, c);
        const st = model.style(model.cellAt(src.tab, r, c)?.s) || {};
        const cell = { text: String(d.text ?? "").slice(0, 2000) };
        if (st.bold) cell.bold = true;
        if (st.italic) cell.italic = true;
        if (/^#[0-9a-f]{6}$/i.test(st.fill || "")) cell.fill = st.fill;
        const color = d.color || st.color;
        if (/^#[0-9a-f]{6}$/i.test(color || "")) cell.color = color;
        const align = st.align || (d.kind === "number" ? "right" : null);
        if (["left", "center", "right"].includes(align)) cell.align = align;
        row.push(cell);
      }
      rows.push(row);
    }
    return { kind: "table", rows };
  }
  return { error: "Not a linked item." };
}

export const cleanSrc = (s) => {
  if (!s || typeof s !== "object") return null;
  const id = (v) => (typeof v === "string" && v.length <= 80 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null);
  const out = { file: id(s.file), tab: id(s.tab) };
  if (!out.file || !out.tab) return null;
  out.name = typeof s.name === "string" ? s.name.slice(0, 200) : "";
  if (s.chart) { out.chart = id(s.chart); if (!out.chart) return null; }
  else if (s.range && typeof s.range === "object") {
    const r = {};
    for (const k of ["top", "bottom", "left", "right"]) r[k] = s.range[k] === null ? null : id(s.range[k]);
    if (Object.values(r).some((v) => v === undefined)) return null;
    out.range = r;
    out.a1 = typeof s.a1 === "string" ? s.a1.slice(0, 40) : "";
  } else return null;
  return out;
};

// Refreshes every linked item in a presentation. sheets.open(fileId) → a store.
// → { updated, failed } (counts). Each spreadsheet is opened once.
export async function refreshLinks(model, sheets, { onlySlide = null } = {}) {
  const jobs = [];
  for (const sid of onlySlide ? [onlySlide] : model.slideIds()) for (const it of model.items(sid)) {
    const src = cleanSrc(it.src);
    if (src) jobs.push({ sid, it, src });
  }
  if (!jobs.length || !sheets?.open) return { updated: 0, failed: 0 };
  const readers = new Map();
  let updated = 0, failed = 0;
  try {
    for (const j of jobs) {
      let reader = readers.get(j.src.file);
      if (reader === undefined) {
        try { reader = await openSheetReader(await sheets.open(j.src.file)); } catch { reader = null; }
        readers.set(j.src.file, reader);
      }
      if (!reader) { failed++; continue; }
      const res = computeLink(reader, j.src);
      if (res.error) { failed++; continue; }
      if (res.kind === "chart" && j.it.t === "chart") {
        if (JSON.stringify(res.cache) !== JSON.stringify(cleanChartCache(j.it.cache))) { model.updateItems(j.sid, [j.it.id], { cache: res.cache }); updated++; }
      } else if (res.kind === "table" && j.it.t === "table") {
        if (model.setTableText(j.sid, j.it.id, res.rows)) updated++;
      }
    }
  } finally { for (const r of readers.values()) r?.close(); }
  return { updated, failed };
}
