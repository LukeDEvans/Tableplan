// Printing and PDF (SPREADSHEET_DESIGN.md §7): a tab (or all tabs, or the selection)
// laid out on letter-size pages — portrait or landscape, at 100% or fitted to the page
// width, with or without gridlines — with cell formatting and conditional formatting,
// merges, charts in their places, and frozen rows repeated at the top of every page.
// On a laptop the browser's print dialog does the rest (Save as PDF); on the iPhone the
// native PdfExport plugin renders the same pages to a PDF for the share sheet, as the
// word processor does.

import { displayOf, geometry } from "./grid.js";
import { compileRules } from "./rules.js";
import { readGrid, chartData } from "./charts.js";
import { renderChart } from "./chart-svg.js";

const PAGE = { w: 816, h: 1056 }; // 8.5 × 11 in at 96 px/in
const MARGIN = 48; // 0.5 in
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const safeColor = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

// Splits sizes (px) into runs that fit `limit`: [[from, to], …] (inclusive indexes);
// a single line bigger than the limit gets a page to itself.
export function paginate(sizes, limit, from = 0, to = sizes.length - 1) {
  const out = [];
  let start = from, used = 0;
  for (let i = from; i <= to; i++) {
    const s = sizes[i] || 0;
    if (used + s > limit && i > start) { out.push([start, i - 1]); start = i; used = 0; }
    used += s;
  }
  if (to >= from) out.push([start, to]);
  return out;
}

// The used part of a tab: last row / column with anything in it (or a chart over it).
export function usedRange(model, tab, g, charts = []) {
  const rIx = new Map(g.rows.map((x, i) => [x, i])), cIx = new Map(g.cols.map((x, i) => [x, i]));
  let r2 = -1, c2 = -1;
  for (const k of model._cells(tab).keys()) { const [rid, cid] = k.split("."); const r = rIx.get(rid), c = cIx.get(cid); if (r !== undefined && c !== undefined) { if (r > r2) r2 = r; if (c > c2) c2 = c; } }
  for (const m of model.mergesOf(tab)) { r2 = Math.max(r2, m.r2); c2 = Math.max(c2, m.c2); }
  for (const ch of charts) { r2 = Math.max(r2, g.rowAt(ch.y + ch.h)); c2 = Math.max(c2, g.colAt(ch.x + ch.w)); }
  return r2 < 0 ? null : { r1: 0, c1: 0, r2, c2 };
}

// → [{ tab, html }] page boxes' inner HTML, plus the page size in px.
export function layoutPages(model, engine, { tabs, range = null, landscape = false, fit = "normal", gridlines = true, hits = () => null, theme = null }) {
  const pageW = landscape ? PAGE.h : PAGE.w, pageH = landscape ? PAGE.w : PAGE.h;
  const areaW = pageW - 2 * MARGIN, areaH = pageH - 2 * MARGIN;
  const pages = [];
  for (const tab of tabs) {
    const g = geometry(model, tab, 1);
    const cell = (t, r, c) => { const d = displayOf(model, engine, t, r, c); return { value: d.value, text: d.text }; };
    const rules = compileRules(model, tab, { cellInfo: (r, c) => cell(tab, r, c), hits });
    // charts in content coordinates
    const charts = model.chartsOf(tab).map((spec) => {
      const r = Math.max(0, g.rows.indexOf(spec.pos?.row)), c = Math.max(0, g.cols.indexOf(spec.pos?.col));
      return { spec, x: g.cx[c] + (spec.pos?.dx || 0), y: g.ry[r] + (spec.pos?.dy || 0), w: spec.pos?.w || 480, h: spec.pos?.h || 300 };
    });
    const box = range && tabs.length === 1 ? range : usedRange(model, tab, g, charts);
    if (!box) continue;
    const frozen = range ? 0 : Math.min(model.tabInfo(tab).frozenRows || 0, box.r2 + 1);
    const headH = frozen ? g.ry[frozen] - g.ry[0] : 0;
    // scale: fit the used columns to the page width
    const usedW = g.cx[box.c2 + 1] - g.cx[box.c1];
    const scale = fit === "width" ? Math.min(1, areaW / Math.max(1, usedW)) : 1;
    const colRuns = fit === "width" ? [[box.c1, box.c2]] : paginate(g.cw, areaW, box.c1, box.c2);
    const bodyFrom = Math.max(box.r1, frozen);
    const rowRuns = bodyFrom > box.r2 ? [[box.r1, box.r2]] : paginate(g.rh.map((h) => h * scale), areaH - headH * scale, bodyFrom, box.r2);
    const mergeAt = new Map();
    for (const m of model.mergesOf(tab)) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) mergeAt.set(`${r},${c}`, m);
    const chartTheme = theme || { surface: "#ffffff", ink: "#0b0b0b", muted: "#52514e", grid: "#e4e3df", dark: false };

    for (const [ra, rb] of rowRuns) for (const [ca, cb] of colRuns) {
      const x0 = g.cx[ca], y0 = g.ry[ra];
      const lines = [...(frozen && ra >= frozen ? Array.from({ length: frozen }, (_, i) => ({ r: i, head: true })) : []), ...Array.from({ length: rb - ra + 1 }, (_, i) => ({ r: ra + i, head: false }))];
      let html = "";
      let y = 0;
      for (const { r } of lines) {
        const h = g.rh[r];
        if (!h) continue;
        for (let c = ca; c <= cb; c++) {
          const w = g.cw[c];
          if (!w) continue;
          const m = mergeAt.get(`${r},${c}`);
          if (m && (m.r1 !== r || m.c1 !== c) && !(m.c1 < ca && c === ca && m.r1 === r)) continue; // inside a merge, drawn by its corner
          const d = displayOf(model, engine, tab, r, c, rules);
          const st = d.st || {};
          let cw = w, chh = h;
          if (m) { cw = g.cx[Math.min(m.c2, cb) + 1] - g.cx[Math.max(m.c1, ca)]; chh = g.ry[m.r2 + 1] - g.ry[m.r1]; }
          const x = g.cx[c] - x0;
          const css = [`left:${x}px`, `top:${y}px`, `width:${cw}px`, `height:${chh}px`];
          const fill = safeColor(st.fill);
          if (fill) css.push(`background:${fill}`);
          if (gridlines) css.push("box-shadow:inset -1px -1px 0 #d9d9d9");
          for (const [side, key] of [["top", "borderTop"], ["right", "borderRight"], ["bottom", "borderBottom"], ["left", "borderLeft"]]) {
            const b = st[key];
            if (b) css.push(`border-${side}:${{ thin: 1, medium: 2, thick: 3, double: 3 }[b.style] || 1}px ${b.style === "dashed" ? "dashed" : b.style === "dotted" ? "dotted" : b.style === "double" ? "double" : "solid"} ${safeColor(b.color) || "#000000"}`);
          }
          let text = "";
          if (d.text && !(d.check?.rule?.type === "checkbox" && d.check.valid)) {
            const right = c + 1 <= cb && !model.cellAt(tab, r, c + 1) && !m && d.align === "left" && st.wrap !== "wrap" && st.wrap !== "clip";
            const align = ["left", "center", "right"].includes(d.align) ? d.align : "left";
            const t = [`color:${safeColor(d.color) || "#000000"}`, `font-size:${(Math.min(400, Math.max(1, Number(st.size) || 10))) * 1.333}px`, `font-family:${st.font ? `'${String(st.font).replace(/['";]/g, "")}', ` : ""}Arial, sans-serif`, `text-align:${align}`, `justify-content:${{ left: "flex-start", center: "center", right: "flex-end" }[align]}`, `align-items:${{ top: "flex-start", middle: "center", bottom: "flex-end" }[st.valign] || "flex-end"}`];
            if (st.bold) t.push("font-weight:700");
            if (st.italic) t.push("font-style:italic");
            if (st.underline || st.strike) t.push(`text-decoration:${[st.underline && "underline", st.strike && "line-through"].filter(Boolean).join(" ")}`);
            t.push(st.wrap === "wrap" ? "white-space:pre-wrap;overflow-wrap:anywhere" : "white-space:pre");
            if (right) t.push("overflow:visible;width:max-content;max-width:none");
            text = `<span style="${t.join(";")}">${esc(d.text)}</span>`;
          } else if (d.check?.rule?.type === "checkbox" && d.check.valid) {
            text = `<span style="justify-content:center;align-items:center">${d.value === true || (typeof d.value === "string" && d.value) ? "☑" : "☐"}</span>`;
          }
          if (!text && !fill && !gridlines && !Object.keys(st).some((k) => k.startsWith("border"))) continue;
          html += `<div class="shp-c" style="${css.join(";")}">${text}</div>`;
        }
        y += h;
      }
      // charts over this page
      const pageTop = frozen && ra >= frozen ? y0 - headH : y0, pageLeft = x0;
      const pageRight = g.cx[cb + 1], pageBottom = g.ry[rb + 1];
      for (const ch of charts) {
        if (ch.x >= pageRight || ch.x + ch.w <= pageLeft || ch.y >= pageBottom || ch.y + ch.h <= y0) continue;
        if (ch.x < pageLeft || ch.y < y0) continue; // drawn on the page holding its top-left corner
        const svg = renderChart(chartData(readGrid(model, tab, ch.spec, cell) || [], ch.spec), ch.spec, { w: Math.round(ch.w), h: Math.round(ch.h), theme: chartTheme });
        const px = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
        html += `<div class="shp-chart" style="left:${px(ch.x - pageLeft)}px;top:${px(ch.y - pageTop)}px;width:${px(ch.w)}px;height:${px(ch.h)}px">${svg}</div>`;
      }
      pages.push({ tab, html, scale });
    }
  }
  return { pages, pageW, pageH, margin: MARGIN };
}

// Prints (laptop) or makes a PDF (iPhone) of the laid-out pages.
export async function printSheet(model, engine, opts, { name = "Spreadsheet", nativePdf = null, share = null } = {}) {
  const { pages, pageW, pageH, margin } = layoutPages(model, engine, opts);
  if (!pages.length) throw new Error("There's nothing to print on this tab yet.");
  const container = document.createElement("div");
  container.className = "shp-print";
  container.innerHTML = pages.map((p) => `<div class="shp-page" style="width:${pageW}px;height:${pageH}px"><div class="shp-area" style="left:${margin}px;top:${margin}px;width:${pageW - 2 * margin}px;height:${pageH - 2 * margin}px"><div class="shp-content" style="transform:scale(${p.scale});transform-origin:0 0">${p.html}</div></div></div>`).join("");
  const style = document.createElement("style");
  style.textContent = `@page { size: ${pageW}px ${pageH}px; margin: 0; }
    .shp-print { position: fixed; left: -100000px; top: 0; }
    .shp-page { position: relative; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
    .shp-area { position: absolute; overflow: hidden; }
    .shp-content { position: absolute; left: 0; top: 0; }
    .shp-c { position: absolute; box-sizing: border-box; overflow: hidden; }
    .shp-c > span { position: absolute; inset: 0 3px; display: flex; line-height: 1.25; }
    .shp-chart { position: absolute; }
    .shp-chart svg { display: block; width: 100%; height: 100%; stroke: none; }
    @media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } body > *:not(.shp-print) { display: none !important; } .shp-print { position: static; } }`;
  container.appendChild(style);
  document.body.appendChild(container);
  try {
    if (nativePdf) {
      const b64 = await nativePdf({ widthPt: (pageW * 72) / 96, heightPt: (pageH * 72) / 96, pages: pages.length });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await share?.(new Blob([bytes], { type: "application/pdf" }), `${name}.pdf`, "application/pdf");
      return pages.length;
    }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; window.removeEventListener("afterprint", finish); resolve(); };
      window.addEventListener("afterprint", finish);
      window.print();
      setTimeout(finish, 60_000);
    });
    return pages.length;
  } finally { container.remove(); }
}
