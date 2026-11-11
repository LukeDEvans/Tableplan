// Drawing the grid (SPREADSHEET_DESIGN.md §4): a canvas sized to the visible area,
// drawn from the scroll position, as Sheets does; only what's on screen is drawn.
// Geometry (row heights, column widths, frozen panes) lives here; the view (ui.js)
// owns selection and editing and calls draw().

import { formatValue } from "./engine/number-format.js";
import { isErr } from "./engine/values.js";
import { indexToCol } from "./engine/parser.js";
import { resultFormatHint } from "./engine/functions/index.js";
import { checkboxValues } from "./rules.js";

const checkboxOn = (rule, v) => { const { on } = checkboxValues(rule); return typeof on === "string" && typeof v === "string" ? on.toLowerCase() === v.toLowerCase() : on === v; };

export const DEF_W = 100;
export const DEF_H = 21;
export const HEAD_W = 46;
export const HEAD_H = 24;

// Sizes of a tab's rows/columns with prefix sums for fast position lookups.
// filtered: row indexes a filter hides (filters.js), drawn like hidden rows.
export function geometry(model, tab, zoom = 1, filtered = null) {
  const rows = model.rowIds(tab), cols = model.colIds(tab);
  const rh = new Float64Array(rows.length), cw = new Float64Array(cols.length);
  rows.forEach((id, i) => { const m = model.rowMeta(tab, id); rh[i] = m.hidden || filtered?.has(i) ? 0 : (m.h || DEF_H) * zoom; });
  cols.forEach((id, i) => { const m = model.colMeta(tab, id); cw[i] = m.hidden ? 0 : (m.w || DEF_W) * zoom; });
  const ry = new Float64Array(rows.length + 1), cx = new Float64Array(cols.length + 1);
  for (let i = 0; i < rows.length; i++) ry[i + 1] = ry[i] + rh[i];
  for (let i = 0; i < cols.length; i++) cx[i + 1] = cx[i] + cw[i];
  const info = model.tabInfo(tab);
  const fr = Math.min(info.frozenRows, rows.length), fc = Math.min(info.frozenCols, cols.length);
  const find = (pre, v) => { let lo = 0, hi = pre.length - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pre[mid] <= v) lo = mid; else hi = mid - 1; } return lo; };
  return {
    rows, cols, rh, cw, ry, cx, fr, fc, zoom,
    headW: HEAD_W * Math.max(1, zoom), headH: HEAD_H * Math.max(1, zoom),
    width: cx[cols.length], height: ry[rows.length],
    frozenW: cx[fc], frozenH: ry[fr],
    rowAt: (y) => find(ry, y), colAt: (x) => find(cx, x),
  };
}

function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

// The text, colour and alignment a cell shows. rules: the tab's compiled rules on cells
// (rules.js compileRules) — a matching format rule's style goes over the cell's own,
// and check says which validation rule covers the cell and whether the value passes.
export function displayOf(model, engine, tab, r, c, rules = null) {
  const cell = model.cellAt(tab, r, c);
  const v = engine.valueAt(tab, r, c);
  let st = model.style(cell?.s) || {};
  let fmt = st.format;
  if (!fmt && cell?.f) {
    const hint = resultFormatHint(model.engineInput(cell)?.formula);
    if (hint === "date") fmt = "m/d/yyyy"; else if (hint === "datetime") fmt = "m/d/yyyy h:mm:ss"; else if (hint === "time") fmt = "h:mm:ss AM/PM";
  }
  const out = formatValue(v, fmt || "General");
  const kind = isErr(v) ? "error" : typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : "text";
  let color = out.color || st.color || null;
  let check = null;
  if (rules && !rules.empty) {
    const info = { value: v, text: out.text };
    const patch = rules.formatAt(r, c, info);
    if (patch) { st = { ...st, ...patch }; if (patch.color) color = patch.color; }
    check = rules.check(r, c, info);
    if (!check.rule) check = null;
  }
  const align = st.halign || (kind === "number" ? "right" : kind === "bool" || kind === "error" ? "center" : "left");
  return { text: out.text, color, align, kind, st, value: v, cell, check };
}

// Draws the visible part of a tab.
// view: { scrollX, scrollY, w, h, sel: { r1,c1,r2,c2, r, c }, peers: [...], editing, dpr, spillOf }
export function drawGrid(canvas, model, engine, tab, g, view) {
  const dpr = view.dpr || 1;
  const W = view.w, H = view.h;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = `${W}px`; canvas.style.height = `${H}px`; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const host = canvas.parentElement || document.body;
  const C = {
    bg: cssVar(host, "--sheet-bg", "#fff"), ink: cssVar(host, "--sheet-ink", "#202124"), line: cssVar(host, "--sheet-line", "#e2e3e3"),
    head: cssVar(host, "--sheet-head", "#f8f9fa"), headInk: cssVar(host, "--sheet-head-ink", "#5f6368"), headSel: cssVar(host, "--sheet-head-sel", "#d3e3fd"),
    accent: cssVar(host, "--sheet-accent", "#1a73e8"), selFill: cssVar(host, "--sheet-sel-fill", "rgba(26,115,232,0.10)"), freeze: cssVar(host, "--sheet-freeze", "#c0c4c8"),
    error: cssVar(host, "--sheet-error", "#d93025"),
    changed: cssVar(host, "--sheet-changed", "rgba(237,161,0,0.28)"), comment: cssVar(host, "--sheet-comment", "#eda100"),
  };
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const showGrid = model.tabInfo(tab).gridlines;
  const ox = g.headW, oy = g.headH; // where cells start on the canvas
  const sx = view.scrollX, sy = view.scrollY;
  const merges = model.mergesOf(tab);
  const mergeAt = new Map();
  for (const m of merges) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) mergeAt.set(`${r},${c}`, m);

  // panes: [rowsFrom, rowsTo, yOffset] × [colsFrom, colsTo, xOffset]
  const firstRow = g.rowAt(g.frozenH + sy), firstCol = g.colAt(g.frozenW + sx);
  const rowPanes = [[0, g.fr, 0, oy], [Math.max(g.fr, firstRow), g.rows.length, sy, oy]];
  const colPanes = [[0, g.fc, 0, ox], [Math.max(g.fc, firstCol), g.cols.length, sx, ox]];
  const xOf = (c, pane) => pane[3] + g.cx[c] - pane[2];
  const yOf = (r, pane) => pane[3] + g.ry[r] - pane[2];
  const rowPaneOf = (r) => (r < g.fr ? rowPanes[0] : rowPanes[1]);
  const colPaneOf = (c) => (c < g.fc ? colPanes[0] : colPanes[1]);

  const shown = new Map();
  const dOf = (r, c) => { const k = `${r},${c}`; let d = shown.get(k); if (!d) { d = displayOf(model, engine, tab, r, c, view.rules || null); shown.set(k, d); } return d; };

  const drawPane = (rp, cp) => {
    const clipX = cp === colPanes[0] ? ox : ox + g.frozenW, clipY = rp === rowPanes[0] ? oy : oy + g.frozenH;
    const clipW = cp === colPanes[0] ? g.frozenW : W - clipX, clipH = rp === rowPanes[0] ? g.frozenH : H - clipY;
    if (clipW <= 0 || clipH <= 0) return;
    const rows = []; for (let r = rp[0]; r < rp[1]; r++) { const y = yOf(r, rp); if (y > H) break; if (y + g.rh[r] >= clipY && g.rh[r] > 0) rows.push(r); }
    const cols = []; for (let c = cp[0]; c < cp[1]; c++) { const x = xOf(c, cp); if (x > W) break; if (x + g.cw[c] >= clipX && g.cw[c] > 0) cols.push(c); }
    if (!rows.length || !cols.length) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(clipX, clipY, clipW, clipH); ctx.clip();
    // fills
    for (const r of rows) for (const c of cols) {
      const st = view.rules && !view.rules.empty ? dOf(r, c).st : model.style(model.cellAt(tab, r, c)?.s);
      if (st?.fill) { ctx.fillStyle = st.fill; ctx.fillRect(xOf(c, cp), yOf(r, rp), g.cw[c], g.rh[r]); }
      // a version preview: cells that differ from now
      if (view.changed?.has(`${g.rows[r]}.${g.cols[c]}`)) { ctx.fillStyle = C.changed; ctx.fillRect(xOf(c, cp), yOf(r, rp), g.cw[c], g.rh[r]); }
    }
    // a mark in the corner of a cell with a comment
    if (view.corners?.size) for (const r of rows) for (const c of cols) {
      if (!view.corners.has(`${g.rows[r]}.${g.cols[c]}`) || !g.cw[c] || !g.rh[r]) continue;
      const x = xOf(c, cp) + g.cw[c], y = yOf(r, rp), s2 = Math.min(8, g.rh[r] / 2);
      ctx.fillStyle = C.comment; ctx.beginPath(); ctx.moveTo(x - s2, y); ctx.lineTo(x, y); ctx.lineTo(x, y + s2); ctx.closePath(); ctx.fill();
    }
    // grid lines
    if (showGrid) {
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
      for (const r of rows) { const y = Math.round(yOf(r, rp) + g.rh[r]) - 0.5; ctx.moveTo(clipX, y); ctx.lineTo(clipX + clipW, y); }
      for (const c of cols) { const x = Math.round(xOf(c, cp) + g.cw[c]) - 0.5; ctx.moveTo(x, clipY); ctx.lineTo(x, clipY + clipH); }
      ctx.stroke();
    }
    // merged areas cover the lines inside them
    for (const m of merges) {
      if (m.r2 < rows[0] || m.r1 > rows[rows.length - 1] || m.c2 < cols[0] || m.c1 > cols[cols.length - 1]) continue;
      const x = xOf(m.c1, cp), y = yOf(m.r1, rp), w = g.cx[m.c2 + 1] - g.cx[m.c1], h = g.ry[m.r2 + 1] - g.ry[m.r1];
      const st = model.style(model.cellAt(tab, m.r1, m.c1)?.s);
      ctx.fillStyle = st?.fill || C.bg; ctx.fillRect(x, y, w - 1, h - 1);
    }
    // text
    const pad = 3 * g.zoom;
    for (const r of rows) {
      let skipUntil = -1;
      for (const c of cols) {
        if (c <= skipUntil) continue;
        const m = mergeAt.get(`${r},${c}`);
        if (m && (m.r1 !== r || m.c1 !== c)) continue;
        const d = dOf(r, c);
        let x = xOf(c, cp), y = yOf(r, rp), w = g.cw[c], h = g.rh[r];
        if (m) { w = g.cx[m.c2 + 1] - g.cx[m.c1]; h = g.ry[m.r2 + 1] - g.ry[m.r1]; }
        // data validation: checkboxes, dropdowns, and a red corner on a value that doesn't pass
        let padL = 0, arrowW = 0;
        if (d.check) {
          const ru = d.check.rule;
          if (!d.check.valid) { ctx.fillStyle = C.error; ctx.beginPath(); ctx.moveTo(x + w - 7, y + 1); ctx.lineTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + 7); ctx.closePath(); ctx.fill(); }
          if (ru.type === "checkbox" && d.check.valid) {
            const on = d.value !== null && d.value !== undefined && d.value !== "" && checkboxOn(ru, d.value);
            const b = Math.round(12 * g.zoom), bx = Math.round(x + (w - b) / 2) + 0.5, by = Math.round(y + (h - b) / 2) + 0.5;
            ctx.lineWidth = 1.5;
            if (on) { ctx.fillStyle = C.accent; ctx.fillRect(bx, by, b, b); ctx.strokeStyle = C.bg; ctx.beginPath(); ctx.moveTo(bx + b * 0.22, by + b * 0.52); ctx.lineTo(bx + b * 0.42, by + b * 0.72); ctx.lineTo(bx + b * 0.8, by + b * 0.28); ctx.stroke(); }
            else { ctx.strokeStyle = C.headInk; ctx.strokeRect(bx, by, b, b); }
            continue;
          }
          if ((ru.type === "list" || ru.type === "range") && ru.display !== "plain") {
            arrowW = 14 * g.zoom;
            ctx.fillStyle = C.headInk;
            const ax = x + w - arrowW / 2 - 2, ay = y + h / 2;
            ctx.beginPath(); ctx.moveTo(ax - 3.5 * g.zoom, ay - 1.5 * g.zoom); ctx.lineTo(ax + 3.5 * g.zoom, ay - 1.5 * g.zoom); ctx.lineTo(ax, ay + 2.5 * g.zoom); ctx.closePath(); ctx.fill();
            if (ru.display !== "arrow" && d.text) {
              const size0 = (d.st.size || 10) * 1.333 * g.zoom;
              ctx.font = `400 ${size0.toFixed(1)}px Arial, sans-serif`;
              const cw0 = Math.min(w - arrowW - 6, ctx.measureText(d.text).width + 14 * g.zoom), ch0 = Math.min(h - 4, size0 + 6 * g.zoom);
              ctx.fillStyle = (ru.colors && ru.colors[d.text]) || C.selFill;
              roundRect(ctx, x + 3, y + (h - ch0) / 2, Math.max(0, cw0), ch0, ch0 / 2); ctx.fill();
              padL = 4 * g.zoom;
            }
          }
        }
        if (!d.text) continue;
        const st = d.st;
        const size = (st.size || 10) * 1.333 * g.zoom;
        ctx.font = `${st.italic ? "italic " : ""}${st.bold ? "700 " : "400 "}${size.toFixed(1)}px ${st.font ? `"${st.font}", ` : ""}Arial, sans-serif`;
        ctx.fillStyle = d.kind === "error" ? C.error : d.color || C.ink;
        const wrap = st.wrap === "wrap";
        // overflow: left-aligned text runs into empty neighbours on the right
        let clipW = w;
        if (!wrap && st.wrap !== "clip" && d.align === "left" && d.kind === "text" && !m) {
          const tw = ctx.measureText(d.text).width + pad * 2;
          let cc = c;
          while (clipW < tw && cc + 1 < g.cols.length && !model.cellAt(tab, r, cc + 1) && !engine.spillAnchorOf?.(tab, g.rows[r], g.cols[cc + 1]) && !mergeAt.has(`${r},${cc + 1}`)) { cc++; clipW += g.cw[cc]; }
          skipUntil = cc;
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, clipW - arrowW, h); ctx.clip();
        const lines = wrap ? wrapText(ctx, d.text, w - pad * 2) : [d.text];
        const lh = size * 1.25;
        const valign = st.valign || "bottom";
        const block = lines.length * lh;
        let ty = valign === "top" ? y + pad : valign === "middle" ? y + (h - block) / 2 : y + h - block - pad / 2;
        ctx.textBaseline = "top";
        for (const line of lines) {
          const tw = ctx.measureText(line).width;
          const tx = d.align === "right" ? x + w - pad - arrowW - tw : d.align === "center" ? x + (w - tw) / 2 : x + pad + padL;
          ctx.fillText(line, tx, ty);
          if (st.underline || st.strike) {
            ctx.fillRect(tx, st.strike ? ty + size * 0.55 : ty + size * 1.02, tw, Math.max(1, size / 14));
          }
          ty += lh;
        }
        ctx.restore();
      }
    }
    // borders
    for (const r of rows) for (const c of cols) {
      const st = model.style(model.cellAt(tab, r, c)?.s);
      if (!st) continue;
      const x = xOf(c, cp), y = yOf(r, rp), w = g.cw[c], h = g.rh[r];
      for (const [k, x1, y1, x2, y2] of [["borderTop", x, y, x + w, y], ["borderBottom", x, y + h, x + w, y + h], ["borderLeft", x, y, x, y + h], ["borderRight", x + w, y, x + w, y + h]]) {
        const b = st[k];
        if (!b) continue;
        ctx.strokeStyle = b.color; ctx.lineWidth = b.style === "thick" ? 3 : b.style === "medium" ? 2 : 1;
        ctx.setLineDash(b.style === "dashed" ? [4, 3] : b.style === "dotted" ? [1, 2] : []);
        ctx.beginPath(); ctx.moveTo(x1, y1 - 0.5); ctx.lineTo(x2, y2 - 0.5); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  };
  for (const rp of rowPanes) for (const cp of colPanes) drawPane(rp, cp);

  // selection
  const sel = view.sel;
  const rectOf = (r1, c1, r2, c2) => {
    const rp1 = rowPaneOf(r1), cp1 = colPaneOf(c1);
    const x = xOf(c1, cp1), y = yOf(r1, rp1);
    const x2 = xOf(c2, colPaneOf(c2)) + g.cw[c2], y2 = yOf(r2, rowPaneOf(r2)) + g.rh[r2];
    return { x, y, w: x2 - x, h: y2 - y };
  };
  if (sel) {
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, W - ox, H - oy); ctx.clip();
    const R = rectOf(sel.r1, sel.c1, sel.r2, sel.c2);
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) { ctx.fillStyle = C.selFill; ctx.fillRect(R.x, R.y, R.w, R.h); }
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
    let ar = sel.r, ac = sel.c;
    const am = mergeAt.get(`${ar},${ac}`);
    const A = am ? rectOf(am.r1, am.c1, am.r2, am.c2) : rectOf(ar, ac, ar, ac);
    ctx.lineWidth = 2; ctx.strokeRect(A.x + 1, A.y + 1, A.w - 2, A.h - 2);
    if (!view.editing) { ctx.fillStyle = C.accent; ctx.fillRect(R.x + R.w - 4, R.y + R.h - 4, 7, 7); ctx.fillStyle = C.bg; ctx.fillRect(R.x + R.w - 4, R.y + R.h - 4, 7, 1); }
    // other people's cells, in their colour with their name
    for (const p of view.peers || []) {
      if (p.tab !== tab || p.r === undefined || p.r >= g.rows.length || p.c >= g.cols.length) continue;
      const P = rectOf(p.r, p.c, p.r, p.c);
      ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.strokeRect(P.x + 1, P.y + 1, P.w - 2, P.h - 2);
      ctx.font = "600 10px Arial, sans-serif"; const tw = ctx.measureText(p.name).width + 8;
      ctx.fillStyle = p.color; ctx.fillRect(P.x + P.w - tw, P.y - 14, tw, 14);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(p.name, P.x + P.w - tw + 4, P.y - 7);
    }
    ctx.restore();
  }

  // headers
  ctx.fillStyle = C.head; ctx.fillRect(0, 0, W, oy); ctx.fillRect(0, 0, ox, H);
  ctx.font = `${(11 * g.zoom).toFixed(1)}px Arial, sans-serif`; ctx.textBaseline = "middle";
  for (const cp of colPanes) {
    ctx.save(); ctx.beginPath(); ctx.rect(cp === colPanes[0] ? ox : ox + g.frozenW, 0, W, oy); ctx.clip();
    for (let c = cp[0]; c < cp[1]; c++) {
      const x = xOf(c, cp); if (x > W) break; if (x + g.cw[c] < ox || !g.cw[c]) continue;
      const on = sel && c >= sel.c1 && c <= sel.c2;
      if (on) { ctx.fillStyle = C.headSel; ctx.fillRect(x, 0, g.cw[c], oy); }
      ctx.fillStyle = on ? C.ink : C.headInk; const t = indexToCol(c); const tw = ctx.measureText(t).width; ctx.fillText(t, x + (g.cw[c] - tw) / 2, oy / 2);
      ctx.fillStyle = C.line; ctx.fillRect(Math.round(x + g.cw[c]) - 1, 0, 1, oy);
    }
    ctx.restore();
  }
  for (const rp of rowPanes) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, rp === rowPanes[0] ? oy : oy + g.frozenH, ox, H); ctx.clip();
    for (let r = rp[0]; r < rp[1]; r++) {
      const y = yOf(r, rp); if (y > H) break; if (y + g.rh[r] < oy || !g.rh[r]) continue;
      const on = sel && r >= sel.r1 && r <= sel.r2;
      if (on) { ctx.fillStyle = C.headSel; ctx.fillRect(0, y, ox, g.rh[r]); }
      ctx.fillStyle = on ? C.ink : C.headInk; const t = String(r + 1); const tw = ctx.measureText(t).width; ctx.fillText(t, (ox - tw) / 2, y + g.rh[r] / 2);
      ctx.fillStyle = C.line; ctx.fillRect(0, Math.round(y + g.rh[r]) - 1, ox, 1);
    }
    ctx.restore();
  }
  ctx.fillStyle = C.line; ctx.fillRect(0, oy - 1, W, 1); ctx.fillRect(ox - 1, 0, 1, H);
  ctx.fillStyle = C.head; ctx.fillRect(0, 0, ox - 1, oy - 1);
  // a filter: a button on each header cell (filled when that column filters), and a
  // band down the edges of the range so it's clear what the filter covers
  if (view.filter) {
    const F = view.filter;
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, W - ox, H - oy); ctx.clip();
    if (g.rh[F.r] > 0) for (let c = F.c1; c <= F.c2; c++) {
      if (!g.cw[c]) continue;
      const R = rectOf(F.r, c, F.r, c);
      if (R.x > W || R.x + R.w < ox) continue;
      const s2 = Math.min(16 * g.zoom, R.h - 4), bx = R.x + R.w - s2 - 3, by = R.y + (R.h - s2) / 2;
      const on = F.active.has(c);
      ctx.fillStyle = on ? C.accent : C.head; ctx.fillRect(bx, by, s2, s2);
      ctx.strokeStyle = on ? C.accent : C.line; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, s2 - 1, s2 - 1);
      // a funnel
      ctx.fillStyle = on ? C.bg : C.headInk;
      const m = s2 / 2, cx0 = bx + m, cy0 = by + m;
      ctx.beginPath(); ctx.moveTo(cx0 - m * 0.55, cy0 - m * 0.45); ctx.lineTo(cx0 + m * 0.55, cy0 - m * 0.45); ctx.lineTo(cx0 + m * 0.12, cy0 + m * 0.05); ctx.lineTo(cx0 + m * 0.12, cy0 + m * 0.5); ctx.lineTo(cx0 - m * 0.12, cy0 + m * 0.35); ctx.lineTo(cx0 - m * 0.12, cy0 + m * 0.05); ctx.closePath(); ctx.fill();
    }
    const B = rectOf(F.r, F.c1, F.r2, F.c2);
    ctx.strokeStyle = view.filter.view ? C.headInk : C.accent; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1);
    ctx.restore();
  }
  // frozen dividers
  ctx.fillStyle = C.freeze;
  if (g.fr) ctx.fillRect(0, oy + g.frozenH - 2, W, 3);
  if (g.fc) ctx.fillRect(ox + g.frozenW - 2, 0, 3, H);
  return { rectOf };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function wrapText(ctx, text, width) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next).width > width) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

// A1 label of a range.
export function a1Of(r1, c1, r2 = r1, c2 = c1) {
  const a = `${indexToCol(c1)}${r1 + 1}`;
  return r1 === r2 && c1 === c2 ? a : `${a}:${indexToCol(c2)}${r2 + 1}`;
}
