// Charts on screen (SPREADSHEET_DESIGN.md §5): charts float over the grid, follow their
// data live, and can be moved, resized, edited (a side panel; a bottom sheet on the
// phone), downloaded as PNG or SVG and deleted. Data is read by charts.js, drawn by
// chart-svg.js, stored in model.js ("charts:<tab>").
//
//   const cx = createChartUI({ root, model, engine, st, schedule, toast, isPhone, openMenu, share, fileName, regionAround });
//   cx.update(g, { data })   place every chart of the tab (and redraw them when data changed)
//   cx.insert()              a chart for the selection          cx.deselect()
//   cx.close() / cx.destroy()

import { readGrid, chartData, guessChart, guessLayout, CHART_TYPES, typeKey, fromTypeKey } from "./charts.js";
import { renderChart, seriesColor } from "./chart-svg.js";
import { rangeFromA1, rangeToA1, rangeBounds } from "./rules.js";
import { displayOf } from "./grid.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const safeColor = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const MIN_W = 160, MIN_H = 120;

export function createChartUI({ root, model, engine, st, schedule, toast = () => {}, isPhone = () => false, openMenu, share, fileName = () => "Chart", regionAround, scroller }) {
  const body = root.querySelector(".sh-body");
  const layer = document.createElement("div");
  layer.className = "sh-charts";
  body.appendChild(layer);
  // the grid scrolls under a chart too: the wheel passes through to it
  layer.addEventListener("wheel", (e) => { if (!scroller) return; e.preventDefault(); scroller.scrollBy(e.deltaX, e.deltaY); }, { passive: false });
  const tip = document.createElement("div");
  tip.className = "sh-chart-tip";
  tip.hidden = true;
  layer.appendChild(tip);

  let selected = null; // chart id
  let g = null;
  const els = new Map(); // id → { el, key }
  let panel = null, editingId = null;

  // ---- redraw when charts change ----------------------------------------------------------------
  const types = new WeakMap();
  const isChartType = (type) => {
    if (types.has(type)) return types.get(type);
    let yes = false;
    for (const [n, t] of model.ydoc.share) if (t === type) { yes = n.startsWith("charts:"); break; }
    types.set(type, yes);
    return yes;
  };
  const onTx = (tr) => { for (const type of tr.changed.keys()) if (isChartType(type)) { schedule(); if (panel) renderPanel(); return; } };
  model.ydoc.on("afterTransaction", onTx);

  // ---- theme: the sheet's own colours, resolved ----------------------------------------------------
  const probe = document.createElement("span");
  probe.style.display = "none";
  root.appendChild(probe);
  const resolve = (v, fallback) => { probe.style.color = ""; probe.style.color = v || fallback; const c = getComputedStyle(probe).color; const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}` : fallback; };
  function theme() {
    const cs = getComputedStyle(root);
    const surface = resolve(cs.getPropertyValue("--sheet-bg").trim(), "#ffffff");
    const ink = resolve(cs.getPropertyValue("--sheet-ink").trim(), "#202124");
    const muted = resolve(cs.getPropertyValue("--muted").trim() || cs.getPropertyValue("--sheet-head-ink").trim(), "#5f6368");
    const grid = resolve(cs.getPropertyValue("--sheet-line").trim(), "#e2e3e3");
    const n = parseInt(surface.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return { surface, ink, muted, grid, dark: lum < 0.5 };
  }

  // ---- data -------------------------------------------------------------------------------------
  const cell = (tab, r, c) => { const d = displayOf(model, engine, tab, r, c); return { value: d.value, text: d.text }; };
  const dataOf = (spec) => chartData(readGrid(model, st.tab, spec, cell) || [], spec);

  // ---- placing ------------------------------------------------------------------------------------
  // charts live in the grid's content coordinates (anchor cell + offset) and scroll with it
  function contentBox(spec) {
    const rows = g.rows, cols = g.cols;
    let r = rows.indexOf(spec.pos?.row), c = cols.indexOf(spec.pos?.col);
    if (r < 0) r = 0; if (c < 0) c = 0;
    return { x: g.cx[c] + (spec.pos?.dx || 0), y: g.ry[r] + (spec.pos?.dy || 0), w: Math.max(MIN_W, spec.pos?.w || 480), h: Math.max(MIN_H, spec.pos?.h || 300) };
  }
  const toScreen = (b) => ({ x: g.headW + b.x - st.scrollX, y: g.headH + b.y - st.scrollY });
  function posFromContent(x, y, w, h) {
    const c = g.colAt(Math.max(0, x)), r = g.rowAt(Math.max(0, y));
    return { row: g.rows[r], col: g.cols[c], dx: Math.round(Math.max(0, x) - g.cx[c]), dy: Math.round(Math.max(0, y) - g.ry[r]), w: Math.round(w), h: Math.round(h) };
  }

  function update(geom, { data = true } = {}) {
    g = geom;
    layer.style.clipPath = `inset(${g.headH}px 0 0 ${g.headW}px)`;
    const charts = model.chartsOf(st.tab);
    const live = new Set(charts.map((c) => c.id));
    for (const [id, x] of els) if (!live.has(id)) { x.el.remove(); els.delete(id); if (selected === id) selected = null; tip.hidden = true; }
    if (editingId && !live.has(editingId)) closePanel();
    const th = data ? theme() : null;
    for (const spec of charts) {
      let x = els.get(spec.id);
      if (!x) { x = { el: makeEl(spec.id), key: "" }; els.set(spec.id, x); }
      const b = drag?.id === spec.id ? drag.box : contentBox(spec);
      const sp = toScreen(b);
      Object.assign(x.el.style, { left: `${sp.x}px`, top: `${sp.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      x.el.classList.toggle("is-selected", selected === spec.id);
      x.el.classList.toggle("is-locked", st.viewing);
      // redraw the picture when its data, spec, size or theme changed
      if (data || x.key === "") {
        const t = th || theme();
        const key = JSON.stringify([spec, Math.round(b.w), Math.round(b.h), t]);
        const d = dataOf(spec);
        const dkey = key + JSON.stringify(d);
        if (dkey !== x.key) { x.el.querySelector(".sh-chart-svg").innerHTML = renderChart(d, spec, { w: Math.round(b.w), h: Math.round(b.h), theme: t }); x.key = dkey; }
      }
    }
  }

  function makeEl(id) {
    const el = document.createElement("div");
    el.className = "sh-chart";
    el.tabIndex = 0;
    el.dataset.chart = id;
    el.setAttribute("role", "figure");
    el.innerHTML = `<div class="sh-chart-svg"></div><button type="button" class="sh-chart-more" data-cx="menu" aria-label="Chart menu">⋮</button><span class="sh-chart-size" data-cx="size" aria-hidden="true"></span>`;
    layer.appendChild(el);
    el.addEventListener("pointerdown", (e) => onDown(e, id, el));
    el.addEventListener("dblclick", () => { if (!st.viewing) openEditor(id); });
    el.addEventListener("pointermove", (e) => onHover(e, el));
    el.addEventListener("pointerleave", () => { tip.hidden = true; el.querySelector(".is-hot")?.classList.remove("is-hot"); });
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && !st.viewing) { e.preventDefault(); model.removeChart(st.tab, id); }
      if (e.key === "Escape") deselect();
    });
    return el;
  }

  // ---- tooltips ---------------------------------------------------------------------------------
  function onHover(e, el) {
    if (drag) return;
    const t = e.target.closest?.("[data-tip]");
    el.querySelector(".is-hot")?.classList.remove("is-hot");
    if (!t) { tip.hidden = true; return; }
    t.classList.add("is-hot");
    tip.textContent = t.getAttribute("data-tip");
    tip.hidden = false;
    const lb = layer.getBoundingClientRect();
    const x = e.clientX - lb.left + 12, y = e.clientY - lb.top + 12;
    tip.style.left = `${Math.min(x, lb.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.min(y, lb.height - tip.offsetHeight - 4)}px`;
  }

  // ---- select, move, resize -------------------------------------------------------------------
  let drag = null;
  function select(id) { selected = id; schedule({ geom: false }); }
  function deselect() { if (selected) { selected = null; schedule({ geom: false }); } }
  function onDown(e, id, el) {
    e.stopPropagation();
    const act = e.target.closest("[data-cx]")?.dataset.cx;
    if (act === "menu") { e.preventDefault(); select(id); const r = e.target.getBoundingClientRect(); openMenu(menuItems(id), { x: r.left, y: r.bottom + 2 }); return; }
    // a finger on a chart that isn't chosen scrolls the grid; a tap (no move) chooses it
    if (e.pointerType === "touch" && (selected !== id || st.viewing) && act !== "size") { panGrid(e, id, el); return; }
    select(id);
    el.focus({ preventScroll: true });
    if (st.viewing || e.button > 0) return;
    const spec = model.chartsOf(st.tab).find((c) => c.id === id);
    if (!spec || !g) return;
    drag = { id, kind: act === "size" ? "size" : "move", x0: e.clientX, y0: e.clientY, start: contentBox(spec), box: contentBox(spec), moved: false };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const s0 = drag.start;
      drag.box = drag.kind === "move" ? { ...s0, x: Math.max(0, s0.x + dx), y: Math.max(0, s0.y + dy) } : { ...s0, w: Math.max(MIN_W, s0.w + dx), h: Math.max(MIN_H, s0.h + dy) };
      tip.hidden = true;
      schedule({ geom: false });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const d = drag; drag = null;
      if (d?.moved) {
        const cur = model.chartsOf(st.tab).find((c) => c.id === id);
        if (cur) model.setChart(st.tab, id, { ...cur, pos: posFromContent(d.box.x, d.box.y, d.box.w, d.box.h) });
      }
      schedule({ geom: false });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function panGrid(e, id, el) {
    const x0 = e.clientX, y0 = e.clientY, sx = scroller?.scrollLeft || 0, sy = scroller?.scrollTop || 0;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.abs(dx) + Math.abs(dy) > 6) moved = true; if (moved && scroller) { scroller.scrollLeft = sx - dx; scroller.scrollTop = sy - dy; } };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); if (!moved) { select(id); el.focus({ preventScroll: true }); } };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }

  function menuItems(id) {
    const items = [];
    if (!st.viewing) items.push({ label: "Edit chart", run: () => openEditor(id) });
    items.push({ label: "Download as PNG", run: () => download(id, "png") }, { label: "Download as SVG", run: () => download(id, "svg") });
    if (!st.viewing) items.push({ sep: true }, { label: "Delete chart", run: () => { model.removeChart(st.tab, id); } });
    return items;
  }

  async function download(id, kind) {
    const spec = model.chartsOf(st.tab).find((c) => c.id === id);
    if (!spec) return;
    const b = contentBox(spec);
    const svg = renderChart(dataOf(spec), spec, { w: Math.round(b.w), h: Math.round(b.h), theme: { surface: "#ffffff", ink: "#0b0b0b", muted: "#52514e", grid: "#e4e3df", dark: false } });
    const name = `${fileName()} - ${spec.title || "chart"}`;
    if (kind === "svg") { await share?.(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`, "image/svg+xml"); return; }
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement("canvas");
      c.width = Math.round(b.w * 2); c.height = Math.round(b.h * 2);
      const ctx = c.getContext("2d");
      ctx.scale(2, 2); ctx.drawImage(img, 0, 0, b.w, b.h);
      const png = await new Promise((res) => c.toBlob(res, "image/png"));
      await share?.(png, `${name}.png`, "image/png");
    } catch { toast("The chart couldn't be saved as a picture."); } finally { URL.revokeObjectURL(url); }
  }

  // ---- inserting ----------------------------------------------------------------------------------
  function insert() {
    if (st.viewing) return null;
    const s = st.sel, rows = model.rowIds(st.tab), cols = model.colIds(st.tab);
    const filled = (r, c) => { const v = engine.valueAt(st.tab, r, c); return v !== null && v !== undefined && v !== ""; };
    const box = s.r1 === s.r2 && s.c1 === s.c2 ? regionAround(filled, s.r, s.c, rows.length - 1, cols.length - 1) : { r1: s.r1, r2: Math.min(s.r2, rows.length - 1), c1: s.c1, c2: Math.min(s.c2, cols.length - 1) };
    const range = { top: rows[box.r1], bottom: rows[box.r2], left: cols[box.c1], right: cols[box.c2] };
    const grid = readGrid(model, st.tab, { range }, cell) || [];
    const guess = guessChart(grid);
    const w = isPhone() ? Math.min(340, (g?.width || 400) - 20) : 480, h = isPhone() ? 240 : 300;
    const at = Math.min(cols.length - 1, box.c2 + 2);
    const spec = { ...guess, range, pos: { row: rows[box.r1], col: cols[at], dx: 0, dy: 0, w, h } };
    if (isPhone()) spec.pos = { row: rows[Math.min(rows.length - 1, box.r2 + 2)], col: cols[box.c1], dx: 0, dy: 0, w, h };
    const id = model.setChart(st.tab, null, spec);
    selected = id;
    if (!isPhone()) openEditor(id);
    schedule();
    return id;
  }

  // ---- the editor panel -----------------------------------------------------------------------------
  function closePanel() { panel?.remove(); panel = null; editingId = null; root.classList.remove("has-side-panel"); }
  function openEditor(id) {
    closePanel();
    editingId = id;
    panel = document.createElement("aside");
    panel.className = `sh-rules sh-chart-editor${isPhone() ? " is-sheet" : ""}`;
    panel.setAttribute("aria-label", "Chart editor");
    root.appendChild(panel);
    root.classList.add("has-side-panel");
    if (!isPhone()) { panel.style.top = `${body.offsetTop}px`; panel.style.bottom = `${Math.max(0, root.clientHeight - body.offsetTop - body.offsetHeight)}px`; }
    panel.addEventListener("change", onPanelChange);
    panel.addEventListener("click", (e) => {
      const a = e.target.closest("[data-ce]")?.dataset.ce;
      if (a === "close") closePanel();
      if (a === "delete") { model.removeChart(st.tab, id); closePanel(); }
    });
    renderPanel();
  }
  function renderPanel() {
    if (!panel) return;
    const spec = model.chartsOf(st.tab).find((c) => c.id === editingId);
    if (!spec) { closePanel(); return; }
    if (panel.contains(document.activeElement) && document.activeElement.matches("input[type=text]")) return; // don't redraw under someone typing
    const d = dataOf(spec);
    const t = theme();
    const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
    const check = (k, label, on) => `<label class="sh-ce-check"><input type="checkbox" class="live-toggle" data-ce-bool="${k}" ${on ? "checked" : ""}> ${esc(label)}</label>`;
    const axes = !["pie"].includes(spec.type);
    const names = spec.type === "pie" ? d.categories.slice(0, 12) : d.series.map((s) => s.name);
    panel.innerHTML = `
      <div class="sh-rx-head"><strong>Chart editor</strong><button type="button" class="sh-icon" data-ce="close" aria-label="Close">✕</button></div>
      <div class="sh-rx-edit">
        <label class="sh-rx-field">Chart type<select data-ce-type>${opt(CHART_TYPES, typeKey(spec))}</select></label>
        <label class="sh-rx-field">Data range<input type="text" data-ce-range value="${esc(rangeToA1(model, st.tab, spec.range))}" spellcheck="false"></label>
        ${check("headers", "Use the first row as headers", spec.headers ?? guessHeaders(spec))}
        ${spec.type === "scatter" ? "" : check("labels", "Use the first column as labels", spec.labels ?? guessLabels(spec))}
        ${check("byRow", "Switch rows and columns", !!spec.byRow)}
        <label class="sh-rx-field">Title<input type="text" data-ce-text="title" value="${esc(spec.title || "")}" maxlength="200"></label>
        <label class="sh-rx-field">Subtitle<input type="text" data-ce-text="subtitle" value="${esc(spec.subtitle || "")}" maxlength="200"></label>
        ${axes ? `<label class="sh-rx-field">Horizontal axis title<input type="text" data-ce-text="xTitle" value="${esc(spec.xTitle || "")}" maxlength="100"></label>
        <label class="sh-rx-field">Vertical axis title<input type="text" data-ce-text="yTitle" value="${esc(spec.yTitle || "")}" maxlength="100"></label>
        <div class="sh-ce-pair"><label class="sh-rx-field">Min<input type="text" inputmode="decimal" data-ce-text="yMin" value="${esc(spec.yMin ?? "")}" placeholder="Auto"></label><label class="sh-rx-field">Max<input type="text" inputmode="decimal" data-ce-text="yMax" value="${esc(spec.yMax ?? "")}" placeholder="Auto"></label></div>` : ""}
        <label class="sh-rx-field">Legend<select data-ce-legend>${opt([["auto", "Auto"], ["top", "Top"], ["bottom", "Bottom"], ["right", "Right"], ["none", "None"]], spec.legend || "auto")}</select></label>
        ${spec.type === "pie" ? "" : check("dataLabels", "Data labels", !!spec.dataLabels)}
        <div class="sh-rx-sub">${spec.type === "pie" ? "Slice colours" : "Series colours"}</div>
        <div class="sh-ce-series">${names.map((n, i) => `<label><input type="color" data-ce-color="${i}" value="${seriesColor(i, spec, t.dark)}"> <span>${esc(n)}</span></label>`).join("") || `<p class="sh-rx-empty">No series yet.</p>`}</div>
        ${spec.type === "combo" ? `<p class="sh-rx-note">The last series is drawn as a line over the columns, on the same axis.</p>` : ""}
      </div>
      <div class="sh-rx-foot"><button type="button" class="sh-btn" data-ce="delete">Delete chart</button><button type="button" class="sh-btn is-primary" data-ce="close">Done</button></div>`;
  }
  const guessHeaders = (spec) => guessLayout(readGrid(model, st.tab, spec, cell) || []).headers;
  const guessLabels = (spec) => guessLayout(readGrid(model, st.tab, spec, cell) || []).labels;

  function onPanelChange(e) {
    const t = e.target;
    const spec = model.chartsOf(st.tab).find((c) => c.id === editingId);
    if (!spec) return;
    const next = { ...spec };
    if (t.matches("[data-ce-type]")) Object.assign(next, fromTypeKey(t.value));
    else if (t.matches("[data-ce-range]")) {
      const rg = rangeFromA1(model, st.tab, t.value);
      if (!rg || !rangeBounds(model, st.tab, rg)) { toast("Enter a range like A1:D12."); t.value = rangeToA1(model, st.tab, spec.range); return; }
      next.range = rg;
    } else if (t.matches("[data-ce-bool]")) next[t.dataset.ceBool] = t.checked;
    else if (t.matches("[data-ce-text]")) {
      const k = t.dataset.ceText, v = t.value.trim();
      if (k === "yMin" || k === "yMax") { if (v === "") delete next[k]; else if (Number.isFinite(Number(v))) next[k] = Number(v); else { toast("Enter a number, or leave it empty for Auto."); return; } }
      else if (v) next[k] = v; else delete next[k];
    } else if (t.matches("[data-ce-legend]")) next.legend = t.value;
    else if (t.matches("[data-ce-color]")) next.colors = { ...(spec.colors || {}), [t.dataset.ceColor]: safeColor(t.value) || undefined };
    else return;
    model.setChart(st.tab, editingId, next);
    schedule();
  }

  return {
    update, insert, deselect,
    get selected() { return selected; },
    openEditor, close: closePanel,
    destroy() { closePanel(); model.ydoc.off("afterTransaction", onTx); layer.remove(); probe.remove(); },
  };
}
