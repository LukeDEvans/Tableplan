// The spreadsheet screen (SPREADSHEET_DESIGN.md §4, §5, §10): opens over the Document
// page. Laptop: menu bar, toolbar, formula bar with name box, the grid, tabs along the
// bottom. iPhone: opens to view; the pencil (bottom right) edits; while editing, the
// formula bar sits above the keyboard with a key row on the right; tap cells to put
// references into a formula.
//
// openSheetEditor({ store, file, me, deps, host?, onClose?, startEditing? }) → { close() }

import "./sheet.css";
import * as Y from "yjs";
import { createDocSession } from "../editor/session.js";
import { createDocCache } from "../editor/cache.js";
import { IC } from "../editor/icons.js";
import { createSheetModel, LOCAL, WARN_CELLS, MAX_CELLS } from "./model.js";
import { connectEngine } from "./bridge.js";
import { createWorkerEngine } from "./worker-client.js";
import { functionCatalog } from "./engine/functions/index.js";
import { compare, isErr } from "./engine/values.js";
import { FORMATS } from "./engine/number-format.js";
import { readRef, indexToCol } from "./engine/parser.js";
import { geometry, drawGrid, displayOf, a1Of, DEF_W, DEF_H } from "./grid.js";
import { toCsv, parseCsv } from "./csv.js";
import { createFilterUI } from "./filter-ui.js";
import { createRulesUI } from "./rules-ui.js";
import { createChartUI } from "./chart-ui.js";
import { regionAround } from "./filters.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : null);
const isPhone = () => window.matchMedia("(max-width: 700px), (pointer: coarse) and (max-width: 900px)").matches;
const COLORS = ["#000000", "#434343", "#666666", "#999999", "#cccccc", "#ffffff", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6fa8dc", "#8e7cc3", "#c27ba0", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3d85c6", "#674ea7", "#a64d79", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9", "#ead1dc"];
const FONTS = ["Arial", "Roboto", "Times New Roman", "Georgia", "Verdana", "Courier New", "Trebuchet MS", "Comic Sans MS", "Inter", "Lato", "Merriweather", "Montserrat", "Open Sans", "Roboto Mono"];
const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36];
const NUMBER_FORMATS = [
  ["Automatic", null], ["Plain text", FORMATS.text], ["Number", FORMATS.number], ["Percent", FORMATS.percent], ["Scientific", FORMATS.scientific],
  ["Accounting", FORMATS.accounting], ["Financial", FORMATS.financial], ["Currency", FORMATS.currency], ["Currency rounded", FORMATS.currencyRounded],
  ["Date", FORMATS.date], ["Time", FORMATS.time], ["Date time", FORMATS.datetime], ["Duration", FORMATS.duration],
];
const ICS = {
  bold: '<b>B</b>', italic: '<i>I</i>', strike: '<s>S</s>', underline: '<u>U</u>',
  currency: '$', percent: '%', decLess: '.0<small>←</small>', decMore: '.00<small>→</small>', fx: '<i>fx</i>',
  merge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14M20 5v14M8 12h8M13 9l3 3-3 3M11 9l-3 3 3 3"/></svg>',
  wrap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5"/></svg>',
  borders: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><path d="M12 4v16M4 12h16" stroke-dasharray="2 2"/></svg>',
  fill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 13l6-8 6 8-6 6z"/><path d="M19 15s2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 2-3.5 2-3.5"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/></svg>',
  sum: 'Σ', tabs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

export async function openSheetEditor({ store, file, me, deps = {}, host = document.body, onClose = null, startEditing = false }) {
  const root = document.createElement("div");
  root.className = "sh-root";
  root.innerHTML = `
    <header class="sh-top">
      <button type="button" class="sh-icon sh-back" data-act="close" aria-label="Back to Document">${IC.back}</button>
      <div class="sh-title"><input type="text" data-no-clear aria-label="Spreadsheet name" maxlength="200" value="${esc(file.name)}"><span class="sh-status" role="status">Opening…</span></div>
      <div class="sh-people" data-people></div>
      <button type="button" class="sh-icon" data-act="find" title="Find and replace" aria-label="Find and replace">${IC.find}</button>
      <button type="button" class="sh-icon" data-act="phone-menu" title="More" aria-label="More">${IC.more}</button>
    </header>
    <nav class="sh-menubar" data-menubar>${["File", "Edit", "View", "Insert", "Format", "Data"].map((m) => `<button type="button" data-menu="${m.toLowerCase()}">${m}</button>`).join("")}</nav>
    <div class="sh-toolbar" data-toolbar role="toolbar" aria-label="Formatting"></div>
    <div class="sh-fbar" data-fbar>
      <input class="sh-namebox" data-namebox data-no-clear aria-label="Name box (cell or range)" spellcheck="false">
      <span class="sh-fx">${ICS.fx}</span>
      <textarea class="sh-formula" data-formula rows="1" aria-label="Formula or value" spellcheck="false"></textarea>
    </div>
    <div class="sh-find" data-find hidden>
      <input type="search" data-find-q placeholder="Find" aria-label="Find">
      <input type="text" data-find-r placeholder="Replace with" aria-label="Replace with">
      <label><input type="checkbox" data-find-case> Match case</label>
      <label><input type="checkbox" data-find-formulas> In formulas</label>
      <span class="sh-count" data-find-count></span>
      <button type="button" class="sh-btn" data-act="find-next">Find</button>
      <button type="button" class="sh-btn" data-act="replace-one">Replace</button>
      <button type="button" class="sh-btn" data-act="replace-all">Replace all</button>
      <button type="button" class="sh-icon" data-act="find-close" aria-label="Close find">${IC.close}</button>
    </div>
    <div class="sh-body">
      <div class="sh-scroll" data-scroll tabindex="0" aria-label="Spreadsheet grid"><div class="sh-sizer" data-sizer></div></div>
      <canvas class="sh-canvas" data-canvas aria-hidden="true"></canvas>
      <textarea class="sh-cell-edit" data-celledit rows="1" spellcheck="false" hidden aria-label="Cell"></textarea>
      <div class="sh-suggest" data-suggest hidden role="listbox"></div>
      <button type="button" class="sh-fab" data-act="start-edit" aria-label="Edit" hidden>${IC.pencil}</button>
    </div>
    <div class="sh-keys" data-keys hidden>
      <button type="button" class="sh-icon" data-act="undo" aria-label="Undo">${IC.undo}</button>
      <button type="button" class="sh-icon" data-act="sheet-format" aria-label="Format">${IC.letterA}</button>
      <span class="sh-spacer"></span>
      ${["=", "(", ")", ":", ",", "$"].map((k) => `<button type="button" class="sh-key" data-key="${k}">${k}</button>`).join("")}
      <button type="button" class="sh-key" data-act="functions" aria-label="Functions">Σ</button>
      <button type="button" class="sh-icon sh-ok" data-act="commit" aria-label="Enter">${IC.check}</button>
    </div>
    <footer class="sh-tabs" data-tabs></footer>
    <div class="sh-sheetpanel" data-sheetpanel hidden></div>`;
  host.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const statusEl = $(".sh-status");
  const toast = (m) => deps.toast?.(m);

  let raf = 0, geomDirty = true; // drawing state (schedule() can run before the grid exists)
  const session = createDocSession({
    store, me,
    liveOpen: deps.liveOpen || null,
    cache: createDocCache(`${file.scope}/${file.id}`, store.cacheSeal || {}),
    getText: () => ({ text: model ? model.searchText(200_000, (t, r, c) => engine.valueAt(t, r, c)) : "", pages: 1 }),
    onRemoteChange: () => schedule(),
  });
  let model = null, engine = null, g = null;
  try { await session.ready; } catch (e) {
    session.close().catch(() => {});
    statusEl.textContent = e?.message || "This spreadsheet couldn't be opened.";
    statusEl.classList.add("is-error");
    $("[data-act=close]").addEventListener("click", () => { root.remove(); onClose?.({}); });
    return { close: () => root.remove() };
  }

  model = createSheetModel(session.ydoc);
  if (!model.tabIds().length) model.init();
  model.tidy();
  // formulas are computed in a Web Worker; answers come back through onChange
  engine = createWorkerEngine({ onChange: () => schedule() });
  const stopBridge = connectEngine(model, engine);

  // ---- undo (only my edits) -----------------------------------------------------------------
  const undoScope = () => {
    const types = [session.ydoc.getArray("tabs"), session.ydoc.getMap("styles"), session.ydoc.getMap("names")];
    for (const t of model.tabIds()) for (const p of ["tab", "rows", "cols", "cells", "rowmeta", "colmeta", "merges", "filters", "rules", "charts"]) types.push(p === "rows" || p === "cols" ? session.ydoc.getArray(`${p}:${t}`) : session.ydoc.getMap(`${p}:${t}`));
    return types;
  };
  const undo = new Y.UndoManager(undoScope(), { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 });
  const refreshUndoScope = () => undo.addToScope(undoScope());

  // ---- view state ---------------------------------------------------------------------------
  const st = {
    tab: model.tabIds().find((t) => !model.tabInfo(t).hidden) || model.tabIds()[0],
    sel: { r: 0, c: 0, r1: 0, c1: 0, r2: 0, c2: 0 }, anchor: { r: 0, c: 0 },
    editing: false, editFrom: null, viewing: isPhone() && !startEditing, zoom: 1,
    scrollX: 0, scrollY: 0, clip: null, formulaPick: null,
  };
  g = geometry(model, st.tab, st.zoom);
  const scroller = $("[data-scroll]"), sizer = $("[data-sizer]"), canvas = $("[data-canvas]");
  const formulaEl = $("[data-formula]"), nameBox = $("[data-namebox]"), cellEdit = $("[data-celledit]");
  const sizeOK = () => model.filledCells() <= MAX_CELLS;
  const fx = createFilterUI({ root, model, engine, st, schedule: (o) => schedule(o), cellRect: (r, c) => cellRect(r, c), scroller, toast, isPhone });
  let filterHead = null;
  const rx = createRulesUI({ root, model, engine, st, schedule: (o) => schedule(o), toast, isPhone, colors: COLORS, cellRect: (r, c) => cellRect(r, c), scroller, openMenu: (items, at) => openMenu(items, at) });
  let rulesC = null;
  const cx = createChartUI({ root, model, engine, st, schedule: (o) => schedule(o), toast, isPhone, openMenu: (items, at) => openMenu(items, at), share: deps.share, fileName: () => nameInput?.value || file.name, regionAround, scroller });

  // ---- drawing --------------------------------------------------------------------------------
  function schedule({ geom = true } = {}) {
    if (geom) geomDirty = true;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (g) draw(); });
  }
  function draw() {
    if (!model.tabIds().includes(st.tab)) st.tab = model.tabIds()[0];
    const fresh = geomDirty; // values or layout changed: charts redraw their pictures too
    if (geomDirty) { g = geometry(model, st.tab, st.zoom, fx.hidden()); filterHead = fx.head(); rulesC = rx.compiled(); geomDirty = false; }
    clampSel();
    sizer.style.width = `${g.width + g.headW + 60}px`;
    sizer.style.height = `${g.height + g.headH + 60}px`;
    const w = scroller.clientWidth, h = scroller.clientHeight;
    const peers = peerCells();
    drawGrid(canvas, model, engine, st.tab, g, { scrollX: st.scrollX, scrollY: st.scrollY, w, h, sel: st.sel, peers, editing: st.editing, dpr: window.devicePixelRatio || 1, filter: filterHead, rules: rulesC });
    cx.update(g, { data: fresh });
    drawTabs();
    syncToolbar();
    if (!st.editing) showFormulaBar();
    placeCellEditor();
    rx.hint();
    $("[data-act=start-edit]").hidden = !st.viewing;
    root.classList.toggle("is-viewing", st.viewing);
  }
  scroller.addEventListener("scroll", () => { st.scrollX = scroller.scrollLeft; st.scrollY = scroller.scrollTop; schedule({ geom: false }); }, { passive: true });
  const ro = new ResizeObserver(() => schedule({ geom: false }));
  ro.observe(scroller);

  function clampSel() {
    const R = g.rows.length - 1, C = g.cols.length - 1;
    const s = st.sel;
    for (const k of ["r", "r1", "r2"]) s[k] = Math.max(0, Math.min(R, s[k]));
    for (const k of ["c", "c1", "c2"]) s[k] = Math.max(0, Math.min(C, s[k]));
  }

  // ---- status, people ---------------------------------------------------------------------
  const unsub = session.subscribe((s) => {
    const label = s.status === "saving" ? "Saving…" : s.status === "unsaved" ? "Unsaved changes" : s.status === "offline" ? "Offline — saved on this device" : s.status === "error" ? (s.error || "Couldn't save") : s.status === "saved" ? "Saved" : "Opening…";
    statusEl.textContent = label;
    statusEl.classList.toggle("is-error", s.status === "error");
    const ppl = $("[data-people]");
    const seen = new Set();
    ppl.innerHTML = s.peers.filter((p) => (seen.has(p.id) ? false : seen.add(p.id))).map((p) => `<span class="sh-person" style="background:${safeColor(p.color) || "#888"}" title="${esc(p.name || "Someone")} is here">${esc(String(p.name || "?").trim()[0] || "?").toUpperCase()}</span>`).join("");
  });
  // where I am, for the other person; where they are, for me
  const awareness = session.awareness;
  const sendCursor = () => awareness.setLocalStateField("sheet", { tab: st.tab, r: g.rows[st.sel.r], c: g.cols[st.sel.c] });
  awareness.on("change", () => schedule({ geom: false }));
  function peerCells() {
    const out = [];
    for (const [cid, s] of awareness.getStates()) {
      if (cid === session.ydoc.clientID || !s.sheet || !s.user) continue;
      const r = g.rows.indexOf(s.sheet.r), c = g.cols.indexOf(s.sheet.c);
      if (r < 0 || c < 0) continue;
      out.push({ tab: s.sheet.tab, r, c, color: safeColor(s.user.color) || "#888", name: String(s.user.name || "Someone").slice(0, 20) });
    }
    return out;
  }

  // ---- formula bar ----------------------------------------------------------------------------
  function showFormulaBar() {
    const { r, c, r1, c1, r2, c2 } = st.sel;
    if (document.activeElement !== nameBox) nameBox.value = a1Of(r1, c1, r2, c2) === a1Of(r, c) ? a1Of(r, c) : a1Of(r1, c1, r2, c2);
    if (document.activeElement !== formulaEl) formulaEl.value = model.inputText(st.tab, r, c);
  }
  nameBox.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const txt = nameBox.value.trim();
    const named = model.nameList().find((n) => n.name.toLowerCase() === txt.toLowerCase());
    const target = named ? named.ref : null;
    let r1, c1, r2, c2, tab = st.tab;
    if (target) {
      tab = target.sheet || st.tab;
      const gg = geometry(model, tab);
      r1 = target.r1 ? gg.rows.indexOf(target.r1) : 0; r2 = target.r2 ? gg.rows.indexOf(target.r2) : gg.rows.length - 1;
      c1 = target.c1 ? gg.cols.indexOf(target.c1) : 0; c2 = target.c2 ? gg.cols.indexOf(target.c2) : gg.cols.length - 1;
    } else {
      const ref = readRef(txt);
      if (!ref || ref.len !== txt.length) { toast("Type a cell like B12, a range like A1:C9, or a named range."); return; }
      const n = ref.node;
      if (n.sheet) { const t = model.grid.tabIdByName(n.sheet); if (!t) { toast(`There's no tab called "${n.sheet}".`); return; } tab = t; }
      r1 = n.r1 ?? 0; c1 = n.c1 ?? 0; r2 = n.r2 ?? (n.kind === "open" || n.kind === "cols" ? 1e9 : r1); c2 = n.c2 ?? 1e9;
    }
    if (tab !== st.tab) switchTab(tab);
    select(r1, c1, Math.min(r2, g.rows.length - 1), Math.min(c2, g.cols.length - 1));
    scroller.focus();
  });
  formulaEl.addEventListener("focus", () => { if (st.viewing) return; beginEdit(null, { inBar: true }); });
  formulaEl.addEventListener("input", () => { if (st.editing) { cellEdit.value = formulaEl.value; suggest(formulaEl); } });
  formulaEl.addEventListener("keydown", (e) => editKeys(e, formulaEl));

  // ---- selecting ---------------------------------------------------------------------------
  function select(r1, c1, r2 = r1, c2 = c1, active = null) {
    const a = active || { r: r1, c: c1 };
    st.sel = { r: a.r, c: a.c, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
    expandForMerges();
    sendCursor();
    scrollIntoView(a.r, a.c);
    schedule({ geom: false });
  }
  function expandForMerges() {
    const s = st.sel;
    for (let i = 0; i < 4; i++) for (const m of model.mergesOf(st.tab)) {
      if (m.r2 < s.r1 || m.r1 > s.r2 || m.c2 < s.c1 || m.c1 > s.c2) continue;
      s.r1 = Math.min(s.r1, m.r1); s.c1 = Math.min(s.c1, m.c1); s.r2 = Math.max(s.r2, m.r2); s.c2 = Math.max(s.c2, m.c2);
    }
  }
  function scrollIntoView(r, c) {
    const vw = scroller.clientWidth - g.headW - g.frozenW, vh = scroller.clientHeight - g.headH - g.frozenH;
    if (r >= g.fr) {
      const top = g.ry[r] - g.frozenH, bot = g.ry[r + 1] - g.frozenH;
      if (top < st.scrollY) scroller.scrollTop = top;
      else if (bot > st.scrollY + vh) scroller.scrollTop = bot - vh;
    }
    if (c >= g.fc) {
      const left = g.cx[c] - g.frozenW, right = g.cx[c + 1] - g.frozenW;
      if (left < st.scrollX) scroller.scrollLeft = left;
      else if (right > st.scrollX + vw) scroller.scrollLeft = right - vw;
    }
    st.scrollX = scroller.scrollLeft; st.scrollY = scroller.scrollTop;
  }

  // canvas point → cell (or header)
  function hit(clientX, clientY) {
    const rect = scroller.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const inRowHead = x < g.headW, inColHead = y < g.headH;
    const gx = x - g.headW, gy = y - g.headH;
    const cx = gx < g.frozenW ? gx : gx + st.scrollX;
    const cy = gy < g.frozenH ? gy : gy + st.scrollY;
    const c = Math.max(0, Math.min(g.cols.length - 1, g.colAt(Math.max(0, cx))));
    const r = Math.max(0, Math.min(g.rows.length - 1, g.rowAt(Math.max(0, cy))));
    // near a header edge: resize
    let edgeCol = -1, edgeRow = -1;
    if (inColHead && !inRowHead) { for (const k of [c, c - 1]) if (k >= 0 && Math.abs(cx - g.cx[k + 1]) <= 4) edgeCol = k; }
    if (inRowHead && !inColHead) { for (const k of [r, r - 1]) if (k >= 0 && Math.abs(cy - g.ry[k + 1]) <= 3) edgeRow = k; }
    return { r, c, inRowHead, inColHead, edgeCol, edgeRow, x, y };
  }

  let drag = null;
  let lastTap = { t: 0, r: -1, c: -1 };
  scroller.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const h = hit(e.clientX, e.clientY);
    closePop();
    cx.deselect();
    // putting a reference into the formula being typed
    if (st.editing && isFormulaText(currentEditText()) && !h.inColHead && !h.inRowHead && canInsertRef()) {
      e.preventDefault();
      st.formulaPick = { r: h.r, c: h.c, r2: h.r, c2: h.c, start: refInsertStart() };
      insertPickedRef();
      drag = { kind: "pick", r0: h.r, c0: h.c };
      scroller.setPointerCapture(e.pointerId);
      return;
    }
    if (st.editing) commitEdit();
    const fcol = fx.buttonAt(h);
    if (fcol >= 0) { e.preventDefault(); select(h.r, fcol); if (isPhone()) rx.close(); fx.openPanel(fcol); return; }
    // a checkbox or dropdown arrow: a mouse click acts at once; a finger acts on a tap
    // (pointerup without moving), so landing on one to scroll doesn't tick it
    tapRule = null;
    if (!e.shiftKey && !st.viewing && !h.inRowHead && !h.inColHead && rx.wants(h)) {
      if (e.pointerType === "touch") tapRule = { h, x: e.clientX, y: e.clientY };
      else { e.preventDefault(); rx.pointer(h); select(h.r, h.c); return; }
    }
    if (h.edgeCol >= 0) { drag = { kind: "colsize", i: h.edgeCol, start: e.clientX, size: g.cw[h.edgeCol] / st.zoom }; scroller.setPointerCapture(e.pointerId); return; }
    if (h.edgeRow >= 0) { drag = { kind: "rowsize", i: h.edgeRow, start: e.clientY, size: g.rh[h.edgeRow] / st.zoom }; scroller.setPointerCapture(e.pointerId); return; }
    if (h.inColHead && h.inRowHead) { select(0, 0, g.rows.length - 1, g.cols.length - 1, { r: 0, c: 0 }); return; }
    if (h.inColHead) { const c0 = e.shiftKey ? st.anchor.c : h.c; select(0, Math.min(c0, h.c), g.rows.length - 1, Math.max(c0, h.c), { r: st.sel.r, c: c0 }); drag = { kind: "cols", c0 }; st.anchor = { r: 0, c: c0 }; scroller.setPointerCapture(e.pointerId); return; }
    if (h.inRowHead) { const r0 = e.shiftKey ? st.anchor.r : h.r; select(Math.min(r0, h.r), 0, Math.max(r0, h.r), g.cols.length - 1, { r: r0, c: st.sel.c }); drag = { kind: "rows", r0 }; st.anchor = { r: r0, c: 0 }; scroller.setPointerCapture(e.pointerId); return; }
    // the fill handle
    const s = st.sel;
    const R = cellRect(s.r2, s.c2);
    if (!st.viewing && Math.abs(h.x - (R.x + R.w)) <= 7 && Math.abs(h.y - (R.y + R.h)) <= 7) { drag = { kind: "fill", from: { ...s }, to: { ...s } }; scroller.setPointerCapture(e.pointerId); return; }
    if (e.shiftKey) { select(st.anchor.r, st.anchor.c, h.r, h.c, st.anchor); return; }
    // a second tap on the same cell edits it (phone and laptop double-click)
    const now = Date.now();
    const again = lastTap.r === h.r && lastTap.c === h.c && now - lastTap.t < 450;
    lastTap = { t: now, r: h.r, c: h.c };
    st.anchor = { r: h.r, c: h.c };
    select(h.r, h.c);
    if (again && !st.viewing) { beginEdit(null); return; }
    if (e.pointerType !== "touch") { drag = { kind: "cells" }; scroller.setPointerCapture(e.pointerId); }
    scroller.focus({ preventScroll: true });
  });
  // A press that started (or continues) an edit keeps the keyboard in the editor: without
  // this, the mouse press's own focus change moves it to the grid and typing is lost
  // (a double-click to edit, or clicking cells into a formula).
  scroller.addEventListener("mousedown", (e) => { if (st.editing) e.preventDefault(); });
  scroller.addEventListener("pointermove", (e) => {
    const h = hit(e.clientX, e.clientY);
    scroller.style.cursor = h.edgeCol >= 0 ? "col-resize" : h.edgeRow >= 0 ? "row-resize" : "";
    if (!drag) return;
    if (drag.kind === "cells") select(st.anchor.r, st.anchor.c, h.r, h.c, st.anchor);
    else if (drag.kind === "cols") select(0, Math.min(drag.c0, h.c), g.rows.length - 1, Math.max(drag.c0, h.c), { r: st.sel.r, c: drag.c0 });
    else if (drag.kind === "rows") select(Math.min(drag.r0, h.r), 0, Math.max(drag.r0, h.r), g.cols.length - 1, { r: drag.r0, c: st.sel.c });
    else if (drag.kind === "pick") { st.formulaPick = { ...st.formulaPick, r: Math.min(drag.r0, h.r), c: Math.min(drag.c0, h.c), r2: Math.max(drag.r0, h.r), c2: Math.max(drag.c0, h.c) }; insertPickedRef(); }
    else if (drag.kind === "colsize") { const w = Math.max(8, drag.size + (e.clientX - drag.start) / st.zoom); drag.now = w; g.cw[drag.i] = w * st.zoom; for (let i = drag.i; i < g.cols.length; i++) g.cx[i + 1] = g.cx[i] + g.cw[i]; schedule({ geom: false }); }
    else if (drag.kind === "rowsize") { const hh = Math.max(8, drag.size + (e.clientY - drag.start) / st.zoom); drag.now = hh; g.rh[drag.i] = hh * st.zoom; for (let i = drag.i; i < g.rows.length; i++) g.ry[i + 1] = g.ry[i] + g.rh[i]; schedule({ geom: false }); }
    else if (drag.kind === "fill") {
      const f = drag.from;
      const down = h.r > f.r2 ? h.r - f.r2 : 0, up = h.r < f.r1 ? f.r1 - h.r : 0, right = h.c > f.c2 ? h.c - f.c2 : 0, left = h.c < f.c1 ? f.c1 - h.c : 0;
      drag.to = Math.max(down, up) >= Math.max(right, left)
        ? { r1: Math.min(f.r1, h.r), r2: Math.max(f.r2, h.r), c1: f.c1, c2: f.c2 }
        : { r1: f.r1, r2: f.r2, c1: Math.min(f.c1, h.c), c2: Math.max(f.c2, h.c) };
      st.sel = { ...st.sel, ...drag.to };
      schedule({ geom: false });
    }
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "colsize" && d.now) { const sel = st.sel; const many = sel.c1 <= d.i && d.i <= sel.c2 && sel.r1 === 0 && sel.r2 === g.rows.length - 1; model.setColMeta(st.tab, many ? sel.c1 : d.i, many ? sel.c2 : d.i, { size: d.now }); }
    if (d.kind === "rowsize" && d.now) { const sel = st.sel; const many = sel.r1 <= d.i && d.i <= sel.r2 && sel.c1 === 0 && sel.c2 === g.cols.length - 1; model.setRowMeta(st.tab, many ? sel.r1 : d.i, many ? sel.r2 : d.i, { size: d.now }); }
    if (d.kind === "fill") fillSeries(d.from, d.to);
    if (d.kind === "pick") st.formulaPick = null;
    schedule();
  };
  let tapRule = null;
  scroller.addEventListener("pointerup", (e) => {
    const t = tapRule; tapRule = null;
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8 && !st.viewing) rx.pointer(t.h);
  });
  scroller.addEventListener("pointerup", endDrag);
  scroller.addEventListener("pointercancel", endDrag);
  scroller.addEventListener("dblclick", (e) => {
    const h = hit(e.clientX, e.clientY);
    if (h.edgeCol >= 0) autoFitCols(h.edgeCol);
  });
  scroller.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const h = hit(e.clientX, e.clientY);
    const inside = h.r >= st.sel.r1 && h.r <= st.sel.r2 && h.c >= st.sel.c1 && h.c <= st.sel.c2;
    if (!inside) select(h.r, h.c);
    openMenu(contextItems(h), { x: e.clientX, y: e.clientY });
  });
  // long press on the phone opens the same menu
  let pressTimer = 0;
  scroller.addEventListener("touchstart", (e) => { const t = e.touches[0]; clearTimeout(pressTimer); pressTimer = setTimeout(() => { const h = hit(t.clientX, t.clientY); openMenu(contextItems(h), { x: t.clientX, y: t.clientY }); }, 550); }, { passive: true });
  for (const ev of ["touchmove", "touchend", "touchcancel"]) scroller.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true });

  function cellRect(r, c) {
    const x = g.headW + (c < g.fc ? g.cx[c] : g.cx[c] - st.scrollX);
    const y = g.headH + (r < g.fr ? g.ry[r] : g.ry[r] - st.scrollY);
    return { x, y, w: g.cw[c], h: g.rh[r] };
  }

  // ---- keyboard -----------------------------------------------------------------------------
  scroller.addEventListener("keydown", (e) => {
    if (st.editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (lk === "y") { e.preventDefault(); doRedo(); return; }
      if (lk === "b" && !st.viewing) { e.preventDefault(); toggleStyle("bold"); return; }
      if (lk === "i" && !st.viewing) { e.preventDefault(); toggleStyle("italic"); return; }
      if (lk === "u" && !st.viewing) { e.preventDefault(); toggleStyle("underline"); return; }
      if (lk === "a") { e.preventDefault(); select(0, 0, g.rows.length - 1, g.cols.length - 1, { r: 0, c: 0 }); return; }
      if (lk === "f") { e.preventDefault(); openFind(); return; }
      if (lk === "s") { e.preventDefault(); session.save(); return; }
    }
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) { e.preventDefault(); move(...moves[k], { extend: e.shiftKey, jump: mod }); return; }
    if (!st.viewing && rx.key(e)) return;
    if (k === "Enter") { e.preventDefault(); if (e.shiftKey) move(-1, 0); else if (st.viewing) move(1, 0); else beginEdit(null); return; }
    if (k === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === "PageDown" || k === "PageUp") { e.preventDefault(); move((k === "PageDown" ? 1 : -1) * Math.max(1, Math.floor(scroller.clientHeight / (DEF_H * st.zoom)) - 1), 0, { extend: e.shiftKey }); return; }
    if (k === "Home") { e.preventDefault(); select(mod ? 0 : st.sel.r, 0); return; }
    if (k === "End" && mod) { e.preventDefault(); const last = lastUsed(); select(last.r, last.c); return; }
    if (st.viewing) return;
    if (k === "F2") { e.preventDefault(); beginEdit(null); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); const s = st.sel; model.clearRange(st.tab, s.r1, s.c1, s.r2, s.c2); return; }
    if (k === "Escape") { st.clip = null; schedule({ geom: false }); return; }
    if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); beginEdit(k); }
  });
  function move(dr, dc, { extend = false, jump = false } = {}) {
    const s = st.sel;
    let r = extend ? (s.r === s.r1 && dr ? s.r2 : s.r === s.r2 && dr ? s.r1 : s.r) : s.r;
    let c = extend ? (s.c === s.c1 && dc ? s.c2 : s.c === s.c2 && dc ? s.c1 : s.c) : s.c;
    if (extend) { r = dr ? (s.r === s.r1 ? s.r2 : s.r1) : s.r; c = dc ? (s.c === s.c1 ? s.c2 : s.c1) : s.c; }
    if (jump) [r, c] = dataEdge(r, c, dr, dc);
    else { r += dr; c += dc; }
    // skip hidden lines
    while (r >= 0 && r < g.rows.length && g.rh[r] === 0) r += dr || 1;
    while (c >= 0 && c < g.cols.length && g.cw[c] === 0) c += dc || 1;
    r = Math.max(0, Math.min(g.rows.length - 1, r)); c = Math.max(0, Math.min(g.cols.length - 1, c));
    if (extend) select(s.r, s.c, r, c, { r: s.r, c: s.c });
    else { st.anchor = { r, c }; select(r, c); }
    // a merged cell moves as one
  }
  const filled = (r, c) => { const v = engine.valueAt(st.tab, r, c); return v !== null && v !== undefined && v !== ""; };
  function dataEdge(r, c, dr, dc) {
    const inBounds = (a, b) => a >= 0 && b >= 0 && a < g.rows.length && b < g.cols.length;
    const here = filled(r, c), next = inBounds(r + dr, c + dc) && filled(r + dr, c + dc);
    if (here && next) { while (inBounds(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; } return [r, c]; }
    r += dr; c += dc;
    while (inBounds(r, c) && !filled(r, c)) { if (!inBounds(r + dr, c + dc)) break; r += dr; c += dc; }
    return [r, c];
  }
  function lastUsed() {
    let r = 0, c = 0;
    for (const id of model.tabIds()) if (id === st.tab) for (const k of model._cells(id).keys()) { const [rid, cid] = k.split("."); r = Math.max(r, g.rows.indexOf(rid)); c = Math.max(c, g.cols.indexOf(cid)); }
    return { r, c };
  }

  // ---- editing a cell ----------------------------------------------------------------------
  function beginEdit(firstChar, { inBar = false } = {}) {
    if (st.viewing || st.editing) return;
    const { r, c } = st.sel;
    st.editing = true;
    st.editFrom = { tab: st.tab, r, c, rowId: g.rows[r], colId: g.cols[c] };
    const text = firstChar === null ? model.inputText(st.tab, r, c) : firstChar;
    cellEdit.value = text;
    formulaEl.value = text;
    cellEdit.hidden = false;
    root.classList.add("is-editing");
    placeCellEditor();
    $("[data-keys]").hidden = !isPhone();
    const target = inBar ? formulaEl : cellEdit;
    target.focus({ preventScroll: true });
    const end = target.value.length;
    target.setSelectionRange(end, end);
    suggest(target);
    schedule({ geom: false });
  }
  function placeCellEditor() {
    if (!st.editing || !st.editFrom) { cellEdit.hidden = true; return; }
    const r = g.rows.indexOf(st.editFrom.rowId), c = g.cols.indexOf(st.editFrom.colId);
    if (r < 0 || c < 0 || st.editFrom.tab !== st.tab) { cellEdit.style.display = "none"; return; }
    cellEdit.style.display = "";
    const R = cellRect(r, c);
    const box = scroller.getBoundingClientRect(), rootBox = root.querySelector(".sh-body").getBoundingClientRect();
    const st2 = model.style(model.cellAt(st.tab, r, c)?.s) || {};
    Object.assign(cellEdit.style, {
      left: `${R.x + box.left - rootBox.left}px`, top: `${R.y + box.top - rootBox.top}px`,
      minWidth: `${Math.max(R.w, 40)}px`, minHeight: `${R.h}px`,
      font: `${st2.italic ? "italic " : ""}${st2.bold ? "700 " : ""}${((st2.size || 10) * 1.333 * st.zoom).toFixed(1)}px ${st2.font ? `"${st2.font}", ` : ""}Arial, sans-serif`,
    });
    cellEdit.style.width = "auto";
    cellEdit.style.width = `${Math.max(R.w, Math.min(600, cellEdit.scrollWidth + 8))}px`;
  }
  cellEdit.addEventListener("input", () => { formulaEl.value = cellEdit.value; placeCellEditor(); suggest(cellEdit); });
  cellEdit.addEventListener("keydown", (e) => editKeys(e, cellEdit));
  function currentEditText() { return document.activeElement === formulaEl ? formulaEl.value : cellEdit.value; }
  const isFormulaText = (s) => s.startsWith("=");

  function editKeys(e, el) {
    if (!st.editing) return;
    if (suggestKeys(e, el)) return;
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); return; }
    if (e.key === "Enter" && !e.altKey && !e.shiftKey) { e.preventDefault(); commitEdit(); move(1, 0); return; }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); commitEdit(); move(-1, 0); return; }
    if (e.key === "Enter" && e.altKey) { e.preventDefault(); const p = el.selectionStart; el.value = el.value.slice(0, p) + "\n" + el.value.slice(el.selectionEnd); el.setSelectionRange(p + 1, p + 1); el.dispatchEvent(new Event("input")); return; }
    if (e.key === "Tab") { e.preventDefault(); commitEdit(); move(0, e.shiftKey ? -1 : 1); return; }
    // arrow keys in a formula after an operator pick a reference, as Sheets
    if (el === cellEdit && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && isFormulaText(el.value) && canInsertRef()) {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      const base = st.formulaPick || { r: st.editFrom.r, c: st.editFrom.c, start: refInsertStart() };
      const r = Math.max(0, Math.min(g.rows.length - 1, base.r + d[0])), c = Math.max(0, Math.min(g.cols.length - 1, base.c + d[1]));
      st.formulaPick = { r, c, r2: r, c2: c, start: base.start };
      insertPickedRef();
      return;
    }
    if (el === cellEdit && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !isFormulaText(el.value)) {
      e.preventDefault(); commitEdit();
      move(...{ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]);
      return;
    }
    if (!["Shift", "Control", "Meta", "Alt"].includes(e.key)) st.formulaPick = null;
  }

  // A reference can go in after =, an operator, a comma or an open bracket.
  function canInsertRef() {
    const el = document.activeElement === formulaEl ? formulaEl : cellEdit;
    if (st.formulaPick) return true;
    const before = el.value.slice(0, el.selectionStart).trimEnd();
    return /[=(,+\-*/^&<>:;{]$/.test(before);
  }
  function refInsertStart() { const el = document.activeElement === formulaEl ? formulaEl : cellEdit; return el.selectionStart; }
  function insertPickedRef() {
    const el = document.activeElement === formulaEl ? formulaEl : cellEdit;
    const p = st.formulaPick;
    const label = (p.tab && p.tab !== st.editFrom.tab ? `'${model.tabInfo(st.tab).name.replace(/'/g, "''")}'!` : "") + a1Of(p.r, p.c, p.r2 ?? p.r, p.c2 ?? p.c);
    const start = p.start, end = p.end ?? start;
    el.value = el.value.slice(0, start) + label + el.value.slice(end);
    p.end = start + label.length;
    el.setSelectionRange(p.end, p.end);
    if (el === cellEdit) formulaEl.value = el.value; else cellEdit.value = el.value;
    placeCellEditor();
    schedule({ geom: false });
  }

  function commitEdit() {
    if (!st.editing) return;
    const text = currentEditText();
    const f = st.editFrom;
    st.editing = false; st.editFrom = null; st.formulaPick = null;
    cellEdit.hidden = true; hideSuggest();
    root.classList.remove("is-editing");
    if (!isPhone()) $("[data-keys]").hidden = true;
    if (f) {
      const r = g.rows.indexOf(f.rowId), c = g.cols.indexOf(f.colId);
      if (r >= 0 && c >= 0) {
        if (!sizeOK() && !model.cellAt(f.tab, r, c)) toast("This spreadsheet has reached 1,000,000 filled cells; clear some to add more.");
        else {
          const before = model.inputText(f.tab, r, c);
          const refused = text !== before ? rx.refuse(f.tab, r, c, text) : null;
          if (refused) toast(`Not entered: ${refused}`);
          else if (text !== before) {
            const res = model.setInput(f.tab, r, c, text);
            if (res.error) toast(res.error);
            if (model.filledCells() > WARN_CELLS && !warned) { warned = true; toast("This spreadsheet is getting large (over 200,000 filled cells) and may be slow on a phone."); }
          }
        }
      }
    }
    scroller.focus({ preventScroll: true });
    schedule({ geom: false });
  }
  let warned = false;
  function cancelEdit() {
    st.editing = false; st.editFrom = null; st.formulaPick = null;
    cellEdit.hidden = true; hideSuggest();
    root.classList.remove("is-editing");
    if (!isPhone()) $("[data-keys]").hidden = true;
    scroller.focus({ preventScroll: true });
    schedule({ geom: false });
  }

  // ---- function suggestions while typing a formula ---------------------------------------
  const catalogNames = [...functionCatalog().keys(), "LET", "LAMBDA"].sort();
  const sugEl = $("[data-suggest]");
  let sugItems = [], sugIdx = 0, sugFor = null;
  function suggest(el) {
    const before = el.value.slice(0, el.selectionStart);
    const m = /(?:^=|[=(,+\-*/^&<>:;{\s])([A-Za-z][A-Za-z0-9._]*)$/.exec(before);
    if (!isFormulaText(el.value) || !m) { showHelp(el, before); return; }
    const q = m[1].toUpperCase();
    sugItems = catalogNames.filter((n) => n.startsWith(q)).slice(0, 8);
    if (!sugItems.length || (sugItems.length === 1 && sugItems[0] === q)) { hideSuggest(); return; }
    sugIdx = 0; sugFor = { el, start: before.length - m[1].length, end: before.length };
    sugEl.innerHTML = sugItems.map((n, i) => `<button type="button" role="option" class="${i === 0 ? "is-on" : ""}" data-fn="${n}">${n}</button>`).join("");
    positionPopupNear(el, sugEl);
    sugEl.hidden = false;
  }
  function showHelp(el, before) {
    // the function we're inside, with its arguments count
    let depth = 0, i = before.length - 1;
    for (; i >= 0; i--) { const ch = before[i]; if (ch === ")") depth++; else if (ch === "(") { if (!depth) break; depth--; } }
    const name = i > 0 ? /([A-Za-z][A-Za-z0-9._]*)$/.exec(before.slice(0, i))?.[1]?.toUpperCase() : null;
    const def = name && functionCatalog().get(name);
    if (!isFormulaText(el.value) || !def) { hideSuggest(); return; }
    const argNo = before.slice(i + 1).split(",").length;
    sugItems = []; sugFor = null;
    sugEl.innerHTML = `<div class="sh-help"><b>${esc(name)}</b>(${esc(signature(def))}) <span>· argument ${argNo}</span></div>`;
    positionPopupNear(el, sugEl);
    sugEl.hidden = false;
  }
  function signature(def) {
    const n = def.max === Infinity ? Math.max(def.min, (def.args || []).length) : def.max;
    const parts = [];
    for (let k = 0; k < Math.min(n, 6); k++) parts.push(k < def.min ? `value${k + 1}` : `[value${k + 1}]`);
    if (def.max === Infinity) parts.push("…");
    return parts.join(", ");
  }
  function hideSuggest() { sugEl.hidden = true; sugItems = []; sugFor = null; }
  function suggestKeys(e, el) {
    if (sugEl.hidden || !sugItems.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + sugItems.length) % sugItems.length; sugEl.querySelectorAll("button").forEach((b, i) => b.classList.toggle("is-on", i === sugIdx)); return true; }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); pickSuggestion(sugItems[sugIdx]); return true; }
    if (e.key === "Escape") { e.preventDefault(); hideSuggest(); return true; }
    return false;
  }
  sugEl.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-fn]"); if (b) { e.preventDefault(); pickSuggestion(b.dataset.fn); } });
  function pickSuggestion(name) {
    if (!sugFor) return;
    const el = sugFor.el;
    el.value = el.value.slice(0, sugFor.start) + name + "(" + el.value.slice(sugFor.end);
    const p = sugFor.start + name.length + 1;
    el.setSelectionRange(p, p);
    (el === cellEdit ? formulaEl : cellEdit).value = el.value;
    hideSuggest();
    el.focus();
    suggest(el);
    placeCellEditor();
  }
  function positionPopupNear(el, pop) {
    const r = el.getBoundingClientRect(), body = root.querySelector(".sh-body").getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(r.left - body.left, body.width - 260))}px`;
    const below = r.bottom - body.top + 2;
    pop.style.top = `${Math.max(0, below)}px`;
  }

  // ---- styles and formats -----------------------------------------------------------------
  const activeStyle = () => model.style(model.cellAt(st.tab, st.sel.r, st.sel.c)?.s) || {};
  const range = () => [st.tab, st.sel.r1, st.sel.c1, st.sel.r2, st.sel.c2];
  function applyStyle(patch) { if (st.viewing) return; model.setStyle(...range(), patch); schedule({ geom: false }); }
  function toggleStyle(k) { applyStyle({ [k]: activeStyle()[k] ? null : true }); }
  function setFormat(code) { applyStyle({ format: code }); }
  function changeDecimals(delta) {
    const fmt = activeStyle().format || "";
    const v = engine.valueAt(st.tab, st.sel.r, st.sel.c);
    let decimals = /\.(0+)/.exec(fmt)?.[1].length ?? (typeof v === "number" ? Math.min(10, (String(v).split(".")[1] || "").length) : 2);
    decimals = Math.max(0, Math.min(15, decimals + delta));
    const base = fmt && !/^general$/i.test(fmt) ? fmt.replace(/\.0+|(0)(?=[^0#.]*$|%|E)/, (m, z) => (z ? z : "")) : "#,##0";
    const withDec = (code) => code.replace(/0(?!.*0)/, decimals ? `0.${"0".repeat(decimals)}` : "0");
    setFormat(withDec(base.includes("0") ? base : "0"));
  }
  function borders(kind) {
    const [tab, r1, c1, r2, c2] = range();
    const B = { style: "thin", color: "#000000" };
    if (kind === "none") { model.setStyle(tab, r1, c1, r2, c2, { borderTop: null, borderBottom: null, borderLeft: null, borderRight: null }); return; }
    session.ydoc.transact(() => {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const p = {};
        if (kind === "all" || (kind === "outer" && r === r1) || kind === "top") if (kind !== "top" || r === r1) p.borderTop = B;
        if (kind === "all" || (kind === "outer" && r === r2) || (kind === "bottom" && r === r2)) p.borderBottom = B;
        if (kind === "all" || (kind === "outer" && c === c1)) p.borderLeft = B;
        if (kind === "all" || (kind === "outer" && c === c2)) p.borderRight = B;
        if (Object.keys(p).length) model.setStyle(tab, r, c, r, c, p);
      }
    }, LOCAL);
  }

  // ---- toolbar ------------------------------------------------------------------------------
  const tb = $("[data-toolbar]");
  tb.innerHTML = `
    <button type="button" class="sh-icon" data-act="undo" title="Undo (⌘Z)" aria-label="Undo">${IC.undo}</button>
    <button type="button" class="sh-icon" data-act="redo" title="Redo (⌘⇧Z)" aria-label="Redo">${IC.redo}</button>
    <span class="sh-sep"></span>
    <button type="button" class="sh-icon sh-txt" data-act="fmt-currency" title="Format as currency" aria-label="Format as currency">${ICS.currency}</button>
    <button type="button" class="sh-icon sh-txt" data-act="fmt-percent" title="Format as percent" aria-label="Format as percent">${ICS.percent}</button>
    <button type="button" class="sh-icon sh-txt" data-act="dec-less" title="Fewer decimal places" aria-label="Fewer decimal places">${ICS.decLess}</button>
    <button type="button" class="sh-icon sh-txt" data-act="dec-more" title="More decimal places" aria-label="More decimal places">${ICS.decMore}</button>
    <button type="button" class="sh-icon sh-txt" data-act="fmt-menu" title="More formats" aria-label="More formats">123 ▾</button>
    <span class="sh-sep"></span>
    <select data-font aria-label="Font">${FONTS.map((f) => `<option>${esc(f)}</option>`).join("")}</select>
    <select data-size aria-label="Font size">${SIZES.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
    <span class="sh-sep"></span>
    <button type="button" class="sh-icon sh-txt" data-act="bold" title="Bold (⌘B)" aria-label="Bold">${ICS.bold}</button>
    <button type="button" class="sh-icon sh-txt" data-act="italic" title="Italic (⌘I)" aria-label="Italic">${ICS.italic}</button>
    <button type="button" class="sh-icon sh-txt" data-act="strike" title="Strikethrough" aria-label="Strikethrough">${ICS.strike}</button>
    <button type="button" class="sh-icon" data-act="color" title="Text colour" aria-label="Text colour">${IC.textColor}</button>
    <button type="button" class="sh-icon" data-act="fill" title="Fill colour" aria-label="Fill colour">${ICS.fill}</button>
    <span class="sh-sep"></span>
    <button type="button" class="sh-icon" data-act="borders" title="Borders" aria-label="Borders">${ICS.borders}</button>
    <button type="button" class="sh-icon" data-act="merge" title="Merge cells" aria-label="Merge cells">${ICS.merge}</button>
    <button type="button" class="sh-icon" data-act="align" title="Horizontal align" aria-label="Horizontal align">${IC.alignLeft}</button>
    <button type="button" class="sh-icon" data-act="wrap" title="Text wrapping" aria-label="Text wrapping">${ICS.wrap}</button>
    <span class="sh-sep"></span>
    <button type="button" class="sh-icon sh-txt" data-act="functions" title="Functions" aria-label="Functions">${ICS.sum}</button>
    <button type="button" class="sh-icon" data-act="filter" title="Create a filter" aria-label="Create a filter">${ICS.filter}</button>`;
  tb.querySelector("[data-font]").addEventListener("change", (e) => applyStyle({ font: e.target.value === "Arial" ? null : e.target.value }));
  tb.querySelector("[data-size]").addEventListener("change", (e) => applyStyle({ size: Number(e.target.value) === 10 ? null : Number(e.target.value) }));

  // The toolbar shows the active cell's font, size and on/off styles.
  function syncToolbar() {
    if (isPhone()) return;
    const a = activeStyle();
    const font = tb.querySelector("[data-font]"), size = tb.querySelector("[data-size]");
    if (document.activeElement !== font) font.value = FONTS.includes(a.font) ? a.font : "Arial";
    if (document.activeElement !== size) { const v = String(a.size || 10); if (![...size.options].some((o) => o.value === v)) size.add(new Option(v, v)); size.value = v; }
    for (const k of ["bold", "italic", "strike"]) tb.querySelector(`[data-act=${k}]`)?.classList.toggle("is-on", !!a[k]);
    const fb = tb.querySelector("[data-act=filter]"), on = Boolean(model.filterOf(st.tab, "filter")) && !fx.view;
    fb.classList.toggle("is-on", on); fb.title = fx.view ? "Close filter view" : on ? "Remove filter" : "Create a filter"; fb.setAttribute("aria-label", fb.title);
  }

  // ---- menus ---------------------------------------------------------------------------
  let pop = null;
  function closePop() { pop?.remove(); pop = null; root.querySelectorAll(".sh-menubar > button.is-open").forEach((b) => b.classList.remove("is-open")); }
  // items: [{ label, act?, run?, keys?, sub?: items, sep?, disabled? }]
  function openMenu(items, at) {
    closePop();
    pop = document.createElement("div");
    pop.className = "sh-menu";
    pop.setAttribute("role", "menu");
    const fill = (list) => list.map((it, i) => (it.sep ? `<hr>` : `<button type="button" role="menuitem" data-i="${i}" ${it.disabled ? "disabled" : ""}>${it.swatch ? `<span class="sh-swatch" style="background:${it.swatch}"></span>` : ""}<span>${esc(it.label)}</span>${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : ""}${it.sub ? "<span>›</span>" : ""}</button>`)).join("");
    pop.innerHTML = fill(items);
    root.appendChild(pop);
    const box = root.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(at.x - box.left, box.width - pw - 4))}px`;
    pop.style.top = `${Math.max(4, Math.min(at.y - box.top, box.height - ph - 4))}px`;
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      if (it.sub) { const r = b.getBoundingClientRect(); openMenu(it.sub, { x: r.right - 4, y: r.top }); return; }
      closePop();
      it.run?.();
    });
  }
  document.addEventListener("pointerdown", onDocDown, true);
  function onDocDown(e) { if (pop && !pop.contains(e.target) && !e.target.closest?.("[data-menu],[data-act=fmt-menu],[data-act=borders],[data-act=align],[data-act=wrap],[data-act=color],[data-act=fill],[data-act=phone-menu],[data-act=merge],[data-act=functions]")) closePop(); }

  const colorItems = (key) => [{ label: "Reset", run: () => applyStyle({ [key]: null }) }, ...COLORS.map((c) => ({ label: c, swatch: c, run: () => applyStyle({ [key]: c }) }))];
  const formatItems = () => [...NUMBER_FORMATS.map(([label, code]) => ({ label, run: () => setFormat(code) })), { sep: true }, { label: "Custom number format…", run: customFormat }];
  function customFormat() {
    const cur = activeStyle().format || "";
    const code = prompt("Custom number format (as in Sheets, e.g. #,##0.00 or yyyy-mm-dd)", cur);
    if (code !== null) setFormat(code.trim() || null);
  }
  const s = () => st.sel;
  const fullRows = () => s().c1 === 0 && s().c2 === g.cols.length - 1;
  const fullCols = () => s().r1 === 0 && s().r2 === g.rows.length - 1;
  const nRows = () => s().r2 - s().r1 + 1, nCols = () => s().c2 - s().c1 + 1;

  const menus = {
    file: () => [
      { label: "Download as CSV (this tab)", run: downloadCsv },
      { label: "Open a CSV file…", run: () => importCsv() },
      { sep: true },
      { label: "Rename", run: () => { nameInput.focus(); nameInput.select(); } },
      { label: `Size: ${model.filledCells().toLocaleString()} filled cells`, disabled: true },
    ],
    edit: () => [
      { label: "Undo", keys: "⌘Z", run: doUndo }, { label: "Redo", keys: "⌘⇧Z", run: doRedo }, { sep: true },
      { label: "Cut", keys: "⌘X", run: () => clipboard("cut") }, { label: "Copy", keys: "⌘C", run: () => clipboard("copy") },
      { label: "Paste", keys: "⌘V", run: () => pasteFromClipboard("all") },
      { label: "Paste values only", keys: "⌘⇧V", run: () => pasteFromClipboard("values") }, { label: "Paste format only", run: () => pasteFromClipboard("formats") },
      { sep: true }, { label: "Delete values", run: () => model.clearRange(...range()) }, { label: "Find and replace", keys: "⌘F", run: openFind },
    ],
    view: () => [
      { label: "Freeze", sub: [
        { label: "No rows", run: () => model.setTabProps(st.tab, { frozenRows: 0 }) }, { label: "1 row", run: () => model.setTabProps(st.tab, { frozenRows: 1 }) }, { label: "2 rows", run: () => model.setTabProps(st.tab, { frozenRows: 2 }) },
        { label: `Up to row ${s().r + 1}`, run: () => model.setTabProps(st.tab, { frozenRows: s().r + 1 }) }, { sep: true },
        { label: "No columns", run: () => model.setTabProps(st.tab, { frozenCols: 0 }) }, { label: "1 column", run: () => model.setTabProps(st.tab, { frozenCols: 1 }) }, { label: "2 columns", run: () => model.setTabProps(st.tab, { frozenCols: 2 }) },
        { label: `Up to column ${indexToCol(s().c)}`, run: () => model.setTabProps(st.tab, { frozenCols: s().c + 1 }) },
      ] },
      { label: model.tabInfo(st.tab).gridlines ? "Hide gridlines" : "Show gridlines", run: () => model.setTabProps(st.tab, { gridlines: !model.tabInfo(st.tab).gridlines }) },
      { label: "Zoom", sub: [50, 75, 90, 100, 125, 150, 200].map((z) => ({ label: `${z}%`, run: () => { st.zoom = z / 100; schedule(); } })) },
    ],
    insert: () => [
      { label: `${nRows()} row${nRows() > 1 ? "s" : ""} above`, run: () => model.insertRows(st.tab, s().r1, nRows()) },
      { label: `${nRows()} row${nRows() > 1 ? "s" : ""} below`, run: () => model.insertRows(st.tab, s().r2 + 1, nRows()) },
      { label: `${nCols()} column${nCols() > 1 ? "s" : ""} left`, run: () => model.insertCols(st.tab, s().c1, nCols()) },
      { label: `${nCols()} column${nCols() > 1 ? "s" : ""} right`, run: () => model.insertCols(st.tab, s().c2 + 1, nCols()) },
      { sep: true }, { label: "Chart", run: () => cx.insert(), disabled: st.viewing }, { label: "New tab", run: newTab }, { label: "Note", run: editNote },
      { label: "Function", sub: ["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "IF", "VLOOKUP", "XLOOKUP", "SUMIF", "TODAY"].map((f) => ({ label: f, run: () => insertFunction(f) })) },
    ],
    format: () => [
      { label: "Number", sub: formatItems() },
      { label: "Text", sub: [{ label: "Bold", keys: "⌘B", run: () => toggleStyle("bold") }, { label: "Italic", keys: "⌘I", run: () => toggleStyle("italic") }, { label: "Underline", keys: "⌘U", run: () => toggleStyle("underline") }, { label: "Strikethrough", run: () => toggleStyle("strike") }] },
      { label: "Alignment", sub: alignItems() }, { label: "Wrapping", sub: wrapItems() },
      { label: "Merge cells", sub: mergeItems() },
      { label: "Conditional formatting…", run: () => { fx.close(); rx.openFormatting(); } },
      { label: "Clear formatting", run: () => model.setStyle(...range(), { font: null, size: null, bold: null, italic: null, underline: null, strike: null, color: null, fill: null, halign: null, valign: null, wrap: null, format: null, borderTop: null, borderBottom: null, borderLeft: null, borderRight: null }) },
    ],
    data: () => [
      { label: `Sort sheet by column ${indexToCol(s().c)}, A → Z`, run: () => sortRows(true, true) },
      { label: `Sort sheet by column ${indexToCol(s().c)}, Z → A`, run: () => sortRows(false, true) },
      { label: "Sort range A → Z", run: () => sortRows(true, false), disabled: s().r1 === s().r2 },
      { label: "Sort range Z → A", run: () => sortRows(false, false), disabled: s().r1 === s().r2 },
      { sep: true }, ...fx.menu(), { label: "Data validation…", run: () => { fx.close(); rx.openValidation(); } },
      { sep: true }, { label: "Named ranges…", run: namedRanges },
    ],
  };
  const alignItems = () => [["Left", "left"], ["Center", "center"], ["Right", "right"], ["Automatic", null]].map(([l, v]) => ({ label: l, run: () => applyStyle({ halign: v }) })).concat([{ sep: true }, ...[["Top", "top"], ["Middle", "middle"], ["Bottom", null]].map(([l, v]) => ({ label: l, run: () => applyStyle({ valign: v }) }))]);
  const wrapItems = () => [["Overflow", null], ["Wrap", "wrap"], ["Clip", "clip"]].map(([l, v]) => ({ label: l, run: () => applyStyle({ wrap: v }) }));
  const mergeItems = () => [
    { label: "Merge all", run: () => model.mergeRange(...range()) },
    { label: "Merge horizontally", run: () => { const [t, r1, c1, r2, c2] = range(); session.ydoc.transact(() => { for (let r = r1; r <= r2; r++) model.mergeRange(t, r, c1, r, c2); }, LOCAL); } },
    { label: "Merge vertically", run: () => { const [t, r1, c1, r2, c2] = range(); session.ydoc.transact(() => { for (let c = c1; c <= c2; c++) model.mergeRange(t, r1, c, r2, c); }, LOCAL); } },
    { label: "Unmerge", run: () => model.unmerge(st.tab, s().r, s().c) },
  ];
  function contextItems(h) {
    const items = [
      { label: "Cut", run: () => clipboard("cut") }, { label: "Copy", run: () => clipboard("copy") }, { label: "Paste", run: () => pasteFromClipboard("all") },
      { sep: true },
    ];
    if (h.inColHead || fullCols()) items.push(
      { label: `Insert ${nCols()} column${nCols() > 1 ? "s" : ""} left`, run: () => model.insertCols(st.tab, s().c1, nCols()) },
      { label: `Insert ${nCols()} column${nCols() > 1 ? "s" : ""} right`, run: () => model.insertCols(st.tab, s().c2 + 1, nCols()) },
      { label: `Delete column${nCols() > 1 ? "s" : ""}`, run: () => { const r = model.deleteCols(st.tab, s().c1, nCols()); if (r.error) toast(r.error); } },
      { label: "Hide", run: () => model.setColMeta(st.tab, s().c1, s().c2, { hidden: true }) },
      { label: "Show hidden columns", run: () => model.setColMeta(st.tab, 0, g.cols.length - 1, { hidden: false }) },
      { label: "Resize…", run: () => { const w = Number(prompt("Column width in pixels", String(Math.round(g.cw[s().c] / st.zoom)))); if (w > 0) model.setColMeta(st.tab, s().c1, s().c2, { size: w }); } },
      { label: "Fit to data", run: () => autoFitCols(s().c1, s().c2) },
      { label: "Sort sheet A → Z", run: () => sortRows(true, true) }, { label: "Sort sheet Z → A", run: () => sortRows(false, true) },
    );
    else if (h.inRowHead || fullRows()) items.push(
      { label: `Insert ${nRows()} row${nRows() > 1 ? "s" : ""} above`, run: () => model.insertRows(st.tab, s().r1, nRows()) },
      { label: `Insert ${nRows()} row${nRows() > 1 ? "s" : ""} below`, run: () => model.insertRows(st.tab, s().r2 + 1, nRows()) },
      { label: `Delete row${nRows() > 1 ? "s" : ""}`, run: () => { const r = model.deleteRows(st.tab, s().r1, nRows()); if (r.error) toast(r.error); } },
      { label: "Hide", run: () => model.setRowMeta(st.tab, s().r1, s().r2, { hidden: true }) },
      { label: "Show hidden rows", run: () => model.setRowMeta(st.tab, 0, g.rows.length - 1, { hidden: false }) },
      { label: "Resize…", run: () => { const hh = Number(prompt("Row height in pixels", String(Math.round(g.rh[s().r] / st.zoom)))); if (hh > 0) model.setRowMeta(st.tab, s().r1, s().r2, { size: hh }); } },
    );
    else items.push(
      { label: "Insert row above", run: () => model.insertRows(st.tab, s().r1, nRows()) }, { label: "Insert column left", run: () => model.insertCols(st.tab, s().c1, nCols()) },
      { label: "Delete row", run: () => { const r = model.deleteRows(st.tab, s().r1, nRows()); if (r.error) toast(r.error); } }, { label: "Delete column", run: () => { const r = model.deleteCols(st.tab, s().c1, nCols()); if (r.error) toast(r.error); } },
      { sep: true }, { label: "Delete values", run: () => model.clearRange(...range()) }, { label: model.cellAt(st.tab, s().r, s().c)?.n ? "Edit note" : "Insert note", run: editNote },
    );
    return st.viewing ? items.filter((it) => it.label === "Copy") : items;
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act],[data-menu],[data-key]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.menu) {
      const was = b.classList.contains("is-open");
      closePop();
      if (was) return;
      b.classList.add("is-open");
      const r = b.getBoundingClientRect();
      openMenu(menus[b.dataset.menu](), { x: r.left, y: r.bottom + 2 });
      return;
    }
    if (b.dataset.key) { insertKey(b.dataset.key); return; }
    const act = b.dataset.act;
    const r = b.getBoundingClientRect();
    const at = { x: r.left, y: r.bottom + 2 };
    switch (act) {
      case "close": close(); break;
      case "undo": doUndo(); break;
      case "redo": doRedo(); break;
      case "fmt-currency": setFormat(FORMATS.currency); break;
      case "fmt-percent": setFormat("0%"); break;
      case "dec-less": changeDecimals(-1); break;
      case "dec-more": changeDecimals(1); break;
      case "fmt-menu": openMenu(formatItems(), at); break;
      case "bold": case "italic": case "strike": toggleStyle(act); break;
      case "color": openMenu(colorItems("color"), at); break;
      case "fill": openMenu(colorItems("fill"), at); break;
      case "borders": openMenu([["All borders", "all"], ["Outer borders", "outer"], ["Top", "top"], ["Bottom", "bottom"], ["No borders", "none"]].map(([l, k]) => ({ label: l, run: () => borders(k) })), at); break;
      case "merge": openMenu(mergeItems(), at); break;
      case "align": openMenu(alignItems(), at); break;
      case "wrap": openMenu(wrapItems(), at); break;
      case "functions": openMenu(["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "IF", "SUMIF", "VLOOKUP", "XLOOKUP", "FILTER", "UNIQUE", "TODAY"].map((f) => ({ label: f, run: () => insertFunction(f) })), at); break;
      case "filter": fx.toggle(); break;
      case "find": openFind(); break;
      case "find-close": $("[data-find]").hidden = true; break;
      case "find-next": findNext(); break;
      case "replace-one": replace(false); break;
      case "replace-all": replace(true); break;
      case "start-edit": st.viewing = false; schedule({ geom: false }); break;
      case "commit": commitEdit(); break;
      case "sheet-format": openFormatSheet(); break;
      case "phone-menu": openMenu([
        { label: "Edit", sub: menus.edit() }, { label: "Insert", sub: menus.insert() }, { label: "Format", sub: menus.format() },
        { label: "Data", sub: menus.data() }, { label: "View", sub: menus.view() }, { label: "File", sub: menus.file() },
        ...(st.viewing ? [] : [{ label: "Done editing", run: () => { if (st.editing) commitEdit(); st.viewing = true; schedule({ geom: false }); } }]),
      ], at); break;
      case "add-tab": newTab(); break;
      case "all-tabs": openMenu(model.tabIds().map((t) => ({ label: `${model.tabInfo(t).hidden ? "(hidden) " : ""}${model.tabInfo(t).name}`, run: () => { if (model.tabInfo(t).hidden) model.setTabProps(t, { hidden: false }); switchTab(t); } })), { x: r.left, y: r.top - 8 - 32 * Math.min(10, model.tabIds().length) }); break;
      default: break;
    }
  });
  function insertKey(k) {
    if (!st.editing) beginEdit("");
    const el = document.activeElement === formulaEl ? formulaEl : cellEdit;
    el.focus();
    const p = el.selectionStart;
    el.value = el.value.slice(0, p) + k + el.value.slice(el.selectionEnd);
    el.setSelectionRange(p + k.length, p + k.length);
    el.dispatchEvent(new Event("input"));
  }
  function insertFunction(name) {
    if (st.viewing) return;
    if (!st.editing) beginEdit("=");
    const el = document.activeElement === formulaEl ? formulaEl : cellEdit;
    if (!el.value.startsWith("=")) el.value = "=" + el.value;
    const p = el.value.length;
    el.value += `${name}(`;
    el.setSelectionRange(p + name.length + 1, p + name.length + 1);
    el.dispatchEvent(new Event("input"));
  }

  // The phone's A sheet: Text / Cell / Number tabs, as Sheets' mobile app.
  function openFormatSheet() {
    const panel = $("[data-sheetpanel]");
    const tab = panel.dataset.tab || "text";
    const a = activeStyle();
    const chip = (act, label, on) => `<button type="button" class="sh-chip${on ? " is-on" : ""}" data-fs="${act}">${label}</button>`;
    const body = tab === "text"
      ? `<div class="sh-row">${chip("bold", ICS.bold, a.bold)}${chip("italic", ICS.italic, a.italic)}${chip("underline", ICS.underline, a.underline)}${chip("strike", ICS.strike, a.strike)}</div>
         <div class="sh-row"><label>Size <select data-fs-size>${SIZES.map((x) => `<option ${x === (a.size || 10) ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
         <div class="sh-row sh-colors">${COLORS.slice(0, 18).map((c) => `<button type="button" class="sh-swatch" style="background:${c}" data-fs-color="${c}" aria-label="Text colour ${c}"></button>`).join("")}</div>`
      : tab === "cell"
      ? `<div class="sh-row">${chip("al-left", "Left", a.halign === "left")}${chip("al-center", "Center", a.halign === "center")}${chip("al-right", "Right", a.halign === "right")}</div>
         <div class="sh-row">${chip("wrap", "Wrap text", a.wrap === "wrap")}${chip("merge", "Merge", false)}${chip("unmerge", "Unmerge", false)}</div>
         <div class="sh-row sh-colors">${COLORS.map((c) => `<button type="button" class="sh-swatch" style="background:${c}" data-fs-fill="${c}" aria-label="Fill ${c}"></button>`).join("")}</div>`
      : `<div class="sh-list">${NUMBER_FORMATS.map(([l, code]) => `<button type="button" data-fs-format="${esc(code ?? "")}" class="${(a.format || null) === code ? "is-on" : ""}">${esc(l)}</button>`).join("")}</div>`;
    panel.innerHTML = `<div class="sh-sheet-tabs">${["text", "cell", "number"].map((t) => `<button type="button" data-fs-tab="${t}" class="${t === tab ? "is-on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}<button type="button" class="sh-icon" data-fs="close" aria-label="Close">${IC.close}</button></div><div class="sh-sheet-body">${body}</div>`;
    panel.hidden = false;
  }
  $("[data-sheetpanel]").addEventListener("click", (e) => {
    const p = $("[data-sheetpanel]");
    const t = e.target.closest("[data-fs-tab]"); if (t) { p.dataset.tab = t.dataset.fsTab; openFormatSheet(); return; }
    const b = e.target.closest("[data-fs],[data-fs-color],[data-fs-fill],[data-fs-format]"); if (!b) return;
    if (b.dataset.fsColor) applyStyle({ color: b.dataset.fsColor });
    else if (b.dataset.fsFill) applyStyle({ fill: b.dataset.fsFill === "#ffffff" ? null : b.dataset.fsFill });
    else if (b.dataset.fsFormat !== undefined) setFormat(b.dataset.fsFormat || null);
    else {
      const a = b.dataset.fs;
      if (a === "close") { p.hidden = true; return; }
      if (["bold", "italic", "underline", "strike"].includes(a)) toggleStyle(a);
      if (a.startsWith("al-")) applyStyle({ halign: a.slice(3) });
      if (a === "wrap") applyStyle({ wrap: activeStyle().wrap === "wrap" ? null : "wrap" });
      if (a === "merge") model.mergeRange(...range());
      if (a === "unmerge") model.unmerge(st.tab, s().r, s().c);
    }
    openFormatSheet();
  });
  $("[data-sheetpanel]").addEventListener("change", (e) => { if (e.target.matches("[data-fs-size]")) { applyStyle({ size: Number(e.target.value) === 10 ? null : Number(e.target.value) }); } });

  // ---- tabs ----------------------------------------------------------------------------------
  function drawTabs() {
    const el = $("[data-tabs]");
    const ids = model.tabIds();
    el.innerHTML = `<button type="button" class="sh-icon" data-act="add-tab" title="Add a tab" aria-label="Add a tab">${IC.plus}</button>
      <button type="button" class="sh-icon" data-act="all-tabs" title="All tabs" aria-label="All tabs">${ICS.tabs}</button>
      <div class="sh-tablist" role="tablist">${ids.filter((t) => !model.tabInfo(t).hidden).map((t) => { const info = model.tabInfo(t); return `<button type="button" role="tab" class="sh-tab${t === st.tab ? " is-on" : ""}" data-tab="${esc(t)}" aria-selected="${t === st.tab}" ${info.color ? `style="--tab-color:${safeColor(info.color)}"` : ""}>${esc(info.name)}</button>`; }).join("")}</div>`;
  }
  $("[data-tabs]").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { if (b.dataset.tab === st.tab) tabMenu(b); else switchTab(b.dataset.tab); } });
  $("[data-tabs]").addEventListener("dblclick", (e) => { const b = e.target.closest("[data-tab]"); if (b) renameTab(b.dataset.tab); });
  $("[data-tabs]").addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-tab]"); if (b) { e.preventDefault(); switchTab(b.dataset.tab); tabMenu(b); } });
  function tabMenu(btn) {
    if (st.viewing) return;
    const t = st.tab;
    const r = btn.getBoundingClientRect();
    const list = model.tabIds();
    const i = list.indexOf(t);
    openMenu([
      { label: "Rename", run: () => renameTab(t) },
      { label: "Duplicate", run: () => duplicateTab(t) },
      { label: "Change colour", sub: [{ label: "None", run: () => model.setTabProps(t, { color: null }) }, ...COLORS.slice(6, 22).map((c) => ({ label: c, swatch: c, run: () => model.setTabProps(t, { color: c }) }))] },
      { label: "Hide", run: () => { if (list.filter((x) => !model.tabInfo(x).hidden).length > 1) { model.setTabProps(t, { hidden: true }); switchTab(list.find((x) => x !== t && !model.tabInfo(x).hidden)); } else toast("At least one tab has to stay visible."); } },
      { label: "Move left", disabled: i <= 0, run: () => model.moveTab(t, i - 1) },
      { label: "Move right", disabled: i >= list.length - 1, run: () => model.moveTab(t, i + 1) },
      { sep: true },
      { label: "Delete", run: () => { if (!confirm(`Delete the tab "${model.tabInfo(t).name}"?`)) return; const res = model.removeTab(t); if (res.error) toast(res.error); else switchTab(model.tabIds()[0]); } },
    ], { x: r.left, y: r.top - 300 });
  }
  function switchTab(t) {
    if (st.editing && !isFormulaText(currentEditText())) commitEdit();
    fx.close();
    rx.close();
    cx.close(); cx.deselect();
    st.tab = t;
    scroller.scrollTop = 0; scroller.scrollLeft = 0; st.scrollX = st.scrollY = 0;
    st.sel = { r: 0, c: 0, r1: 0, c1: 0, r2: 0, c2: 0 };
    geomDirty = true;
    refreshUndoScope();
    sendCursor();
    schedule();
  }
  function newTab() {
    if (st.viewing) return;
    const id = model.addTab({ at: model.tabIds().indexOf(st.tab) + 1 });
    refreshUndoScope();
    switchTab(id);
  }
  function renameTab(t) {
    if (st.viewing) return;
    const n = prompt("Tab name", model.tabInfo(t).name);
    if (n === null) return;
    const res = model.renameTab(t, n);
    if (!res.ok) toast(res.error);
  }
  function duplicateTab(t) {
    const info = model.tabInfo(t);
    const size = model.size(t);
    const id = model.addTab({ name: `Copy of ${info.name}`, rows: size.rows, cols: size.cols, at: model.tabIds().indexOf(t) + 1 });
    const block = model.copyBlock(t, 0, 0, size.rows - 1, size.cols - 1);
    model.pasteBlock(id, 0, 0, { ...block, from: { tab: id, r: 0, c: 0 } });
    refreshUndoScope();
    switchTab(id);
  }

  // ---- clipboard --------------------------------------------------------------------------
  let internalClip = null; // { block, text, cut, source }
  function selectionTsv() {
    const { r1, c1, r2, c2 } = st.sel;
    const lines = [];
    for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) row.push(displayOf(model, engine, st.tab, r, c).text.replace(/\t|\n/g, " ")); lines.push(row.join("\t")); }
    return lines.join("\n");
  }
  function clipboard(kind) {
    const { r1, c1, r2, c2 } = st.sel;
    const block = model.copyBlock(st.tab, r1, c1, r2, c2);
    const text = selectionTsv();
    internalClip = { block, text, cut: kind === "cut", source: { tab: st.tab, r1, c1, r2, c2 } };
    navigator.clipboard?.writeText?.(text).catch(() => {});
    st.clip = { ...st.sel };
    toast(kind === "cut" ? "Cut" : "Copied");
  }
  async function pasteFromClipboard(what) {
    if (st.viewing) return;
    let text = null;
    try { text = await navigator.clipboard?.readText?.(); } catch { /* not allowed: use ours */ }
    doPaste(what, text);
  }
  function doPaste(what, text) {
    const { r, c } = st.sel;
    if (internalClip && (text === null || text === undefined || text === internalClip.text)) {
      const vals = what === "values" ? (i, j) => engine.valueAt(internalClip.source.tab, internalClip.source.r1 + i, internalClip.source.c1 + j) : null;
      const res = model.pasteBlock(st.tab, r, c, internalClip.block, { what, values: vals });
      if (!res.ok) { toast(res.error); return; }
      if (internalClip.cut) { const s0 = internalClip.source; if (!(s0.tab === st.tab && s0.r1 === r && s0.c1 === c)) model.clearRange(s0.tab, s0.r1, s0.c1, s0.r2, s0.c2, { formats: true }); internalClip = null; }
      const h = internalClip ? internalClip.block.cells.length : 1;
      select(r, c, r + h - 1, c + (internalClip?.block.cells[0].length || 1) - 1, { r, c });
      return;
    }
    if (!text) return;
    const rows = parseCsv(text, "\t");
    const need = r + rows.length - g.rows.length;
    if (need > 0) model.insertRows(st.tab, g.rows.length, need);
    session.ydoc.transact(() => { rows.forEach((row, i) => row.forEach((v, j) => { if (c + j < g.cols.length) model.setInput(st.tab, r + i, c + j, v); })); }, LOCAL);
    select(r, c, r + rows.length - 1, c + Math.max(...rows.map((x) => x.length)) - 1, { r, c });
  }
  root.addEventListener("copy", (e) => { if (st.editing || !scroller.contains(document.activeElement) && document.activeElement !== scroller) return; e.preventDefault(); clipboard("copy"); e.clipboardData?.setData("text/plain", internalClip.text); });
  root.addEventListener("cut", (e) => { if (st.editing || st.viewing || document.activeElement !== scroller) return; e.preventDefault(); clipboard("cut"); e.clipboardData?.setData("text/plain", internalClip.text); });
  root.addEventListener("paste", (e) => { if (st.editing || st.viewing || document.activeElement !== scroller) return; e.preventDefault(); doPaste("all", e.clipboardData?.getData("text/plain") ?? null); });

  // ---- fill handle: copy or continue a series ----------------------------------------------
  function fillSeries(from, to) {
    if (st.viewing) return;
    const vertical = to.r1 !== from.r1 || to.r2 !== from.r2;
    if (!vertical && to.c1 === from.c1 && to.c2 === from.c2) return;
    const block = model.copyBlock(st.tab, from.r1, from.c1, from.r2, from.c2);
    session.ydoc.transact(() => {
      if (vertical) {
        const h = from.r2 - from.r1 + 1;
        for (let c = from.c1; c <= from.c2; c++) {
          const seed = []; for (let r = from.r1; r <= from.r2; r++) seed.push(model.cellAt(st.tab, r, c));
          const step = seriesStep(seed);
          const rowsTo = to.r2 > from.r2 ? range2(from.r2 + 1, to.r2) : range2(to.r1, from.r1 - 1).reverse();
          rowsTo.forEach((r, k) => {
            const n = to.r2 > from.r2 ? k + 1 : -(k + 1);
            if (step !== null) { const last = n > 0 ? seed[h - 1].v : seed[0].v; model.setInput(st.tab, r, c, String(last + step * n)); }
            else {
              const srcR = from.r1 + (((r - from.r1) % h) + h) % h;
              model.pasteBlock(st.tab, r, c, { from: { tab: st.tab, r: srcR, c }, cells: [[block.cells[srcR - from.r1][c - from.c1]]] });
            }
          });
        }
      } else {
        const w = from.c2 - from.c1 + 1;
        for (let r = from.r1; r <= from.r2; r++) {
          const seed = []; for (let c = from.c1; c <= from.c2; c++) seed.push(model.cellAt(st.tab, r, c));
          const step = seriesStep(seed);
          const colsTo = to.c2 > from.c2 ? range2(from.c2 + 1, to.c2) : range2(to.c1, from.c1 - 1).reverse();
          colsTo.forEach((c, k) => {
            const n = to.c2 > from.c2 ? k + 1 : -(k + 1);
            if (step !== null) { const last = n > 0 ? seed[w - 1].v : seed[0].v; model.setInput(st.tab, r, c, String(last + step * n)); }
            else { const srcC = from.c1 + (((c - from.c1) % w) + w) % w; model.pasteBlock(st.tab, r, c, { from: { tab: st.tab, r, c: srcC }, cells: [[block.cells[r - from.r1][srcC - from.c1]]] }); }
          });
        }
      }
    }, LOCAL);
    select(to.r1, to.c1, to.r2, to.c2, { r: from.r1, c: from.c1 });
  }
  // Numbers in a steady step continue (1, 2 → 3, 4); one number alone repeats, as Sheets.
  function seriesStep(seed) {
    if (seed.length < 2 || seed.some((x) => !x || x.f || typeof x.v !== "number")) return null;
    const d = seed[1].v - seed[0].v;
    for (let i = 2; i < seed.length; i++) if (Math.abs(seed[i].v - seed[i - 1].v - d) > 1e-9) return null;
    return d;
  }
  const range2 = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };

  // ---- sorting, fitting, notes, names ------------------------------------------------------
  function sortRows(asc, wholeSheet) {
    if (st.viewing) return;
    const sel = st.sel;
    let r1 = wholeSheet ? 0 : sel.r1, r2 = wholeSheet ? lastUsed().r : sel.r2;
    if (wholeSheet && g.fr) r1 = Math.max(r1, g.fr); // frozen header rows stay put
    if (r2 <= r1) return;
    if (!wholeSheet && !(sel.c1 === 0 && sel.c2 === g.cols.length - 1)) {
      // a block inside the sheet: move its values (formulas move as they are)
      const vals = [];
      for (let r = r1; r <= r2; r++) vals.push({ r, key: engine.valueAt(st.tab, r, sel.c) });
      vals.sort((a, b) => { const ea = a.key === null || a.key === "", eb = b.key === null || b.key === ""; if (ea || eb) return ea === eb ? a.r - b.r : ea ? 1 : -1; const c = compare(a.key, b.key); return (asc ? c : -c) || a.r - b.r; });
      const block = model.copyBlock(st.tab, r1, sel.c1, r2, sel.c2);
      session.ydoc.transact(() => vals.forEach((v, i) => model.pasteBlock(st.tab, r1 + i, sel.c1, { from: { tab: st.tab, r: r1 + i, c: sel.c1 }, cells: [block.cells[v.r - r1]] })), LOCAL);
      return;
    }
    const cmp = (a, b) => { const ea = a === null || a === "", eb = b === null || b === ""; if (ea || eb) return ea === eb ? 0 : ea ? 1e9 : -1e9; return compare(a, b); };
    model.sortRows(st.tab, r1, r2, [{ col: sel.c, asc }], (r, c) => engine.valueAt(st.tab, r, c), (a, b) => { const x = cmp(a, b); return Math.abs(x) === 1e9 ? (asc ? Math.sign(x) : -Math.sign(x)) : x; });
  }
  function autoFitCols(c1, c2 = c1) {
    const ctx = canvas.getContext("2d");
    for (let c = c1; c <= c2; c++) {
      let w = 30;
      for (let r = 0; r < g.rows.length; r++) {
        if (!model.cellAt(st.tab, r, c)) continue;
        const d = displayOf(model, engine, st.tab, r, c);
        ctx.font = `${d.st.bold ? "700 " : ""}${((d.st.size || 10) * 1.333).toFixed(1)}px Arial, sans-serif`;
        w = Math.max(w, ctx.measureText(d.text).width + 10);
      }
      model.setColMeta(st.tab, c, c, { size: Math.min(600, Math.ceil(w)) });
    }
  }
  function editNote() {
    if (st.viewing) return;
    const cur = model.cellAt(st.tab, s().r, s().c)?.n || "";
    const n = prompt(`Note for ${a1Of(s().r, s().c)}`, cur);
    if (n !== null) model.setNote(st.tab, s().r, s().c, n);
  }
  function namedRanges() {
    const list = model.nameList().map((n) => n.name).join(", ") || "none yet";
    const nm = prompt(`Name the selected range (${a1Of(s().r1, s().c1, s().r2, s().c2)}). Existing: ${list}`);
    if (!nm) return;
    const res = model.setName(nm, a1Of(s().r1, s().c1, s().r2, s().c2), st.tab);
    toast(res.ok ? `Named ${nm}` : res.error);
  }

  // ---- find and replace -------------------------------------------------------------------
  function openFind() { const f = $("[data-find]"); f.hidden = false; f.querySelector("[data-find-q]").focus(); }
  function matches() {
    const q = $("[data-find-q]").value;
    if (!q) return [];
    const mc = $("[data-find-case]").checked, inF = $("[data-find-formulas]").checked;
    const norm = (x) => (mc ? x : x.toLowerCase());
    const out = [];
    for (const k of model._cells(st.tab).keys()) {
      const [rid, cid] = k.split(".");
      const r = g.rows.indexOf(rid), c = g.cols.indexOf(cid);
      if (r < 0 || c < 0) continue;
      const text = inF ? model.inputText(st.tab, r, c) : displayOf(model, engine, st.tab, r, c).text;
      if (norm(text).includes(norm(q))) out.push({ r, c });
    }
    return out.sort((a, b) => a.r - b.r || a.c - b.c);
  }
  function findNext() {
    const list = matches();
    $("[data-find-count]").textContent = list.length ? `${list.length} found` : "Not found";
    if (!list.length) return;
    const cur = st.sel;
    const next = list.find((m) => m.r > cur.r || (m.r === cur.r && m.c > cur.c)) || list[0];
    select(next.r, next.c);
  }
  function replace(all) {
    if (st.viewing) return;
    const q = $("[data-find-q]").value, rep = $("[data-find-r]").value, mc = $("[data-find-case]").checked;
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), mc ? "g" : "gi");
    const list = all ? matches() : matches().filter((m) => m.r === st.sel.r && m.c === st.sel.c);
    session.ydoc.transact(() => { for (const m of list) model.setInput(st.tab, m.r, m.c, model.inputText(st.tab, m.r, m.c).replace(re, rep)); }, LOCAL);
    $("[data-find-count]").textContent = `${list.length} replaced`;
    if (!all) findNext();
  }

  // ---- CSV ----------------------------------------------------------------------------------
  async function downloadCsv() {
    const { r, c } = lastUsed();
    const rows = [];
    for (let i = 0; i <= r; i++) { const row = []; for (let j = 0; j <= c; j++) row.push(displayOf(model, engine, st.tab, i, j).text); rows.push(row); }
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    await deps.share?.(blob, `${file.name} - ${model.tabInfo(st.tab).name}.csv`, "text/csv");
  }
  function importCsv() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,.tsv,text/csv,text/tab-separated-values";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) { toast("That file is larger than 30 MB."); return; }
      const rows = parseCsv(await f.text());
      const id = model.addTab({ name: f.name.replace(/\.[^.]+$/, ""), rows: Math.max(1000, rows.length + 50), cols: Math.max(26, ...rows.map((x) => x.length)) });
      session.ydoc.transact(() => rows.forEach((row, i) => row.forEach((v, j) => { if (v !== "") model.setInput(id, i, j, v); })), LOCAL);
      refreshUndoScope();
      switchTab(id);
    };
    input.click();
  }

  // ---- undo -----------------------------------------------------------------------------
  function doUndo() { if (st.viewing) return; if (st.editing) cancelEdit(); undo.undo(); schedule(); }
  function doRedo() { if (st.viewing) return; undo.redo(); schedule(); }

  // ---- name ----------------------------------------------------------------------------------
  const nameInput = $(".sh-title input");
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); } if (e.key === "Escape") { nameInput.value = file.name; nameInput.blur(); } });
  nameInput.addEventListener("change", async () => {
    const n = nameInput.value.trim();
    if (!n || n === file.name) { nameInput.value = file.name; return; }
    try { await store.rename(n); file.name = n; deps.rename?.(n); } catch (e) { toast(e?.message || "Couldn't rename."); nameInput.value = file.name; }
  });

  // ---- closing ---------------------------------------------------------------------------
  const onKeyGlobal = (e) => { if (e.key === "Escape" && pop) closePop(); };
  document.addEventListener("keydown", onKeyGlobal);
  async function close() {
    if (st.editing) commitEdit();
    fx.destroy();
    rx.destroy();
    cx.destroy();
    statusEl.textContent = "Saving…";
    stopBridge();
    engine.close();
    unsub();
    ro.disconnect();
    undo.destroy();
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("keydown", onKeyGlobal);
    try { await session.close(); } catch { /* kept on the device */ }
    root.remove();
    onClose?.({ name: file.name });
  }

  // first paint
  sendCursor();
  draw();
  scroller.focus({ preventScroll: true });
  // test hooks (browser QA)
  root.__sheet = {
    model, engine, st, select, beginEdit, commitEdit, switchTab, session, doPaste,
    // a cell's centre on screen (QA clicks there)
    cellCenter: (r, c) => { const R = cellRect(r, c), b = scroller.getBoundingClientRect(); return { x: b.left + R.x + R.w / 2, y: b.top + R.y + R.h / 2, w: R.w, h: R.h, right: b.left + R.x + R.w, bottom: b.top + R.y + R.h }; },
    shown: (r, c) => displayOf(model, engine, st.tab, r, c).text,
    fx, rx, cx, rowShown: (r) => g.rh[r] > 0, rules: () => rulesC,
    idle: () => engine.whenIdle(),
  };
  return { close, model, engine };
}
