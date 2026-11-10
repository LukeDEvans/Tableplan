// The filter on screen (SPREADSHEET_DESIGN.md §5): the toolbar's "Create a filter",
// the button on each header cell and its panel (sort, by condition, by values, by
// colour), and filter views — named filters that change only what *you* see, so you
// can filter while Marijane works. Logic is in filters.js, storage in model.js.
//
// ui.js creates one per open spreadsheet:
//   const fx = createFilterUI({ root, model, engine, st, schedule, cellRect, scroller, toast, isPhone });
//   fx.hidden()        rows to hide on the current tab (for geometry)
//   fx.head(g)         what the grid draws (header row, range, columns that filter)
//   fx.buttonAt(h)     column index if a pointer hit landed on a header button, else -1
//   fx.openPanel(c)    fx.toggle()    fx.menu()    fx.close()

import { hiddenRows, valueList, filterBounds, hasCriteria, regionAround, CONDITIONS, conditionOf } from "./filters.js";
import { displayOf } from "./grid.js";
import { compare } from "./engine/values.js";
import { indexToCol } from "./engine/parser.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const MAX_LIST = 500;

export function createFilterUI({ root, model, engine, st, schedule, cellRect, scroller, toast = () => {}, isPhone = () => false }) {
  let view = null; // the filter view I'm in (mine only; never shared)
  let panel = null;
  const viewBar = document.createElement("div");
  viewBar.className = "sh-viewbar";
  viewBar.hidden = true;
  root.querySelector(".sh-body").before(viewBar);

  // any change to a filter or view (mine or someone else's) redraws: rows hide or show
  const filterTypes = new WeakMap();
  const isFilterType = (type) => {
    if (filterTypes.has(type)) return filterTypes.get(type);
    let yes = false;
    for (const [n, t] of model.ydoc.share) if (t === type) { yes = n.startsWith("filters:"); break; }
    filterTypes.set(type, yes);
    return yes;
  };
  const onTx = (tr) => { for (const type of tr.changed.keys()) if (isFilterType(type)) { schedule(); return; } };
  model.ydoc.on("afterTransaction", onTx);

  const owner = () => view || "filter";
  function spec() {
    if (view && !model.filterOf(st.tab, view)) view = null; // deleted (by me or someone else) or another tab
    return model.filterOf(st.tab, owner());
  }
  const cellInfo = (r, c) => { const d = displayOf(model, engine, st.tab, r, c); return { text: d.text, value: d.value, fill: d.st?.fill || null, color: d.st?.color || null }; };

  function hidden() {
    const sp = spec();
    syncViewBar();
    return sp ? hiddenRows(model, st.tab, sp, cellInfo) : null;
  }

  function head() {
    const sp = spec();
    const b = sp && filterBounds(model, st.tab, sp);
    if (!b) return null;
    const cols = model.colIds(st.tab);
    const active = new Set();
    for (let c = b.c1; c <= b.c2; c++) if (hasCriteria(sp.criteria[cols[c]])) active.add(c);
    return { r: b.r1, r2: b.r2, c1: b.c1, c2: b.c2, active, view: Boolean(view) };
  }

  function buttonAt(h) {
    if (h.inRowHead || h.inColHead) return -1;
    const H = head();
    if (!H || h.r !== H.r || h.c < H.c1 || h.c > H.c2) return -1;
    const R = cellRect(h.r, h.c);
    return h.x >= R.x + R.w - Math.max(22, R.h) ? h.c : -1;
  }

  // ---- creating and removing ------------------------------------------------------------------

  const filled = (r, c) => { const v = engine.valueAt(st.tab, r, c); return v !== null && v !== undefined && v !== ""; };
  function create() {
    const s = st.sel, rows = model.rowIds(st.tab), cols = model.colIds(st.tab);
    let box;
    if (s.r1 === s.r2 && s.c1 === s.c2) box = regionAround(filled, s.r, s.c, rows.length - 1, cols.length - 1);
    else box = { r1: s.r1, r2: Math.min(s.r2, rows.length - 1), c1: s.c1, c2: Math.min(s.c2, cols.length - 1) };
    // whole columns follow the data to its end; a table grows as rows are added right below it
    const wholeCols = s.r1 === 0 && s.r2 >= rows.length - 1;
    model.setFilter(st.tab, "filter", { top: rows[box.r1], bottom: wholeCols ? null : rows[box.r2], left: cols[box.c1], right: cols[box.c2] });
  }
  function toggle() {
    close();
    if (view) { view = null; schedule(); return; }
    if (model.filterOf(st.tab, "filter")) model.removeFilter(st.tab, "filter");
    else create();
    schedule();
  }

  // ---- filter views -------------------------------------------------------------------------

  function newView() {
    close();
    const base = model.filterOf(st.tab, "filter");
    let from = base;
    if (!from) {
      const s = st.sel, rows = model.rowIds(st.tab), cols = model.colIds(st.tab);
      const b = s.r1 === s.r2 && s.c1 === s.c2 ? regionAround(filled, s.r, s.c, rows.length - 1, cols.length - 1) : s;
      from = { top: rows[b.r1], bottom: rows[b.r2], left: cols[b.c1], right: cols[b.c2], criteria: {} };
    }
    view = model.newFilterView(st.tab, from);
    schedule();
  }
  function enterView(id) { close(); view = id; schedule(); }
  function renameView() {
    const sp = view && model.filterOf(st.tab, view);
    if (!sp) return;
    const name = prompt("Filter view name", sp.name || "");
    if (name && name.trim()) model.setFilter(st.tab, view, { ...sp, name: name.trim() });
  }
  function deleteView() {
    if (!view) return;
    const sp = model.filterOf(st.tab, view);
    if (!confirm(`Delete the filter view "${sp?.name || "Filter view"}"? It's gone for both of you.`)) return;
    model.removeFilter(st.tab, view);
    view = null;
    schedule();
  }
  function syncViewBar() {
    const sp = view && model.filterOf(st.tab, view);
    viewBar.hidden = !sp;
    root.classList.toggle("is-filter-view", Boolean(sp));
    if (!sp) return;
    const html = `<span class="sh-vb-label">Filter view</span><button type="button" class="sh-vb-name" data-vb="rename" title="Rename">${esc(sp.name || "Filter view")}</button>
      <span class="sh-vb-note">Only you see this</span>
      <button type="button" class="sh-btn" data-vb="delete">Delete</button>
      <button type="button" class="sh-icon" data-vb="exit" aria-label="Close filter view" title="Close filter view">✕</button>`;
    if (viewBar.dataset.html !== html) { viewBar.innerHTML = html; viewBar.dataset.html = html; }
  }
  viewBar.addEventListener("click", (e) => {
    const a = e.target.closest("[data-vb]")?.dataset.vb;
    if (a === "rename") renameView();
    else if (a === "delete") deleteView();
    else if (a === "exit") { view = null; schedule(); }
  });

  // the Data menu's items
  function menu() {
    const hasFilter = Boolean(model.filterOf(st.tab, "filter"));
    const views = model.filterViews(st.tab);
    return [
      { label: hasFilter && !view ? "Remove filter" : "Create a filter", run: toggle, disabled: Boolean(view) },
      { label: "Filter views", sub: [
        { label: "Create new filter view", run: newView },
        ...(views.length ? [{ sep: true }, ...views.map((v) => ({ label: `${v.id === view ? "✓ " : ""}${v.name}`, run: () => enterView(v.id) }))] : []),
        ...(view ? [{ sep: true }, { label: "Rename this view", run: renameView }, { label: "Delete this view", run: deleteView }, { label: "Close this view", run: () => { view = null; schedule(); } }] : []),
      ] },
    ];
  }

  // ---- the panel --------------------------------------------------------------------------

  function destroy() { close(); model.ydoc.off("afterTransaction", onTx); }
  function close() {
    if (!panel) return;
    panel.remove(); panel = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escKey, true);
  }
  function outside(e) { if (panel && !panel.contains(e.target)) close(); }
  function escKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

  function sortBy(c, asc) {
    const b = filterBounds(model, st.tab, spec());
    if (!b || b.r2 <= b.r1) return;
    const cmp = (a, x) => { const ea = a === null || a === "", eb = x === null || x === ""; if (ea || eb) return ea === eb ? 0 : ea ? 1e9 : -1e9; return compare(a, x); };
    model.sortRows(st.tab, b.r1 + 1, b.r2, [{ col: c, asc }], (r, cc) => engine.valueAt(st.tab, r, cc), (a, x) => { const v = cmp(a, x); return Math.abs(v) === 1e9 ? (asc ? Math.sign(v) : -Math.sign(v)) : v; });
  }

  function openPanel(c) {
    close();
    const sp = spec();
    if (!sp) return;
    const colId = model.colIds(st.tab)[c];
    const crit = sp.criteria[colId] || {};
    const list = valueList(model, st.tab, sp, c, cellInfo);
    const shown = new Map(list.map((x) => [x.text, x.shown]));
    // colours used in the column (for "Filter by colour")
    const b = filterBounds(model, st.tab, sp);
    const fills = new Set(), inks = new Set();
    for (let r = b.r1 + 1; r <= b.r2; r++) { const i = cellInfo(r, c); if (i.fill) fills.add(i.fill.toLowerCase()); if (i.color) inks.add(i.color.toLowerCase()); }

    panel = document.createElement("div");
    panel.className = `sh-filter${isPhone() ? " is-sheet" : ""}`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `Filter column ${indexToCol(c)}`);
    const opOptions = `<option value="">None</option>${CONDITIONS.map((x) => (x.sep ? `<option disabled>──────────</option>` : `<option value="${x.op}" ${crit.cond?.op === x.op ? "selected" : ""}>${esc(x.label)}</option>`)).join("")}`;
    const colourSel = (key, set, label) => (set.size ? `<label class="sh-f-colour">${label} <select data-f-colour="${key}"><option value="">Any</option>${[...set].map((x) => `<option value="${x}" ${(crit.color?.[key] || "").toLowerCase() === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>` : "");
    panel.innerHTML = `
      <div class="sh-f-head"><strong>${esc(cellInfo(b.r1, c).text || `Column ${indexToCol(c)}`)}</strong></div>
      <div class="sh-f-sort"><button type="button" class="sh-btn" data-f="asc">Sort A → Z</button><button type="button" class="sh-btn" data-f="desc">Sort Z → A</button></div>
      <details ${crit.color ? "open" : ""} ${fills.size || inks.size ? "" : "hidden"}><summary>Filter by colour</summary>${colourSel("fill", fills, "Fill")}${colourSel("text", inks, "Text")}</details>
      <details ${crit.cond?.op ? "open" : ""}><summary>Filter by condition</summary>
        <select data-f-op aria-label="Condition">${opOptions}</select>
        <input type="text" data-f-a placeholder="Value or formula" aria-label="Value">
        <input type="text" data-f-b placeholder="and" aria-label="Second value">
      </details>
      <details open><summary>Filter by values</summary>
        <div class="sh-f-row"><button type="button" class="sh-link" data-f="all">Select all</button><button type="button" class="sh-link" data-f="none">Clear</button><span class="sh-f-count" data-f-count></span></div>
        <input type="search" data-f-q placeholder="Search" aria-label="Search values">
        <div class="sh-f-list" data-f-list role="group" aria-label="Values"></div>
      </details>
      <div class="sh-f-foot"><button type="button" class="sh-btn" data-f="cancel">Cancel</button><button type="button" class="sh-btn is-primary" data-f="ok">OK</button></div>`;
    root.appendChild(panel);
    const $ = (s) => panel.querySelector(s);
    const opSel = $("[data-f-op]"), aIn = $("[data-f-a]"), bIn = $("[data-f-b]"), qIn = $("[data-f-q]"), listEl = $("[data-f-list]");
    aIn.value = crit.cond?.a ?? ""; bIn.value = crit.cond?.b ?? "";
    const syncInputs = () => { const n = conditionOf(opSel.value)?.n ?? 0; aIn.hidden = n < 1; bIn.hidden = n < 2; aIn.placeholder = conditionOf(opSel.value)?.date ? "today, tomorrow or a date" : "Value"; };
    syncInputs();
    opSel.addEventListener("change", () => { syncInputs(); if (!aIn.hidden) aIn.focus(); });

    const visible = () => { const q = qIn.value.trim().toLowerCase(); return list.filter((x) => !q || (x.text || "(Blanks)").toLowerCase().includes(q)); };
    function renderList() {
      const items = visible();
      listEl.innerHTML = items.slice(0, MAX_LIST).map((x, i) => `<label><input type="checkbox" data-i="${i}" ${shown.get(x.text) ? "checked" : ""}><span>${x.text === "" ? "<em>(Blanks)</em>" : esc(x.text)}</span><small>${x.count}</small></label>`).join("")
        + (items.length > MAX_LIST ? `<p class="sh-f-more">${items.length - MAX_LIST} more — search to narrow the list</p>` : "")
        + (items.length ? "" : `<p class="sh-f-more">No values</p>`);
      listEl._items = items;
      const on = list.filter((x) => shown.get(x.text)).length;
      $("[data-f-count]").textContent = `${on} of ${list.length}`;
    }
    renderList();
    qIn.addEventListener("input", renderList);
    listEl.addEventListener("change", (e) => { const i = e.target.dataset?.i; if (i === undefined) return; shown.set(listEl._items[i].text, e.target.checked); renderList(); });

    panel.addEventListener("click", (e) => {
      const f = e.target.closest("[data-f]")?.dataset.f;
      if (!f) return;
      if (f === "all" || f === "none") { for (const x of visible()) shown.set(x.text, f === "all"); renderList(); return; }
      if (f === "cancel") { close(); return; }
      if (f === "asc" || f === "desc") { close(); sortBy(c, f === "asc"); schedule(); return; }
      if (f === "ok") {
        const next = {};
        const hide = list.filter((x) => !shown.get(x.text)).map((x) => x.text);
        if (hide.length) next.hide = hide;
        if (opSel.value) next.cond = { op: opSel.value, ...(aIn.hidden ? {} : { a: aIn.value }), ...(bIn.hidden ? {} : { b: bIn.value }) };
        const fillSel = panel.querySelector("[data-f-colour=fill]"), textSel = panel.querySelector("[data-f-colour=text]");
        if (fillSel?.value || textSel?.value) next.color = { ...(fillSel?.value ? { fill: fillSel.value } : {}), ...(textSel?.value ? { text: textSel.value } : {}) };
        model.setCriteria(st.tab, owner(), colId, next);
        close();
        schedule();
        if (hide.length === list.length && list.length) toast("Every value is unticked, so every row is hidden.");
      }
    });

    // place it under the header cell (laptop) or as a sheet from the bottom (phone)
    if (!isPhone()) {
      const R = cellRect(b.r1, c), sb = scroller.getBoundingClientRect(), rb = root.getBoundingClientRect();
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      const x = sb.left - rb.left + R.x + R.w - pw;
      let y = sb.top - rb.top + R.y + R.h + 2;
      if (y + ph > rb.height - 4 && sb.top - rb.top + R.y - ph - 2 >= 4) y = sb.top - rb.top + R.y - ph - 2; // no room below: above the cell
      panel.style.left = `${Math.max(4, Math.min(x, rb.width - pw - 4))}px`;
      panel.style.top = `${Math.max(4, Math.min(y, rb.height - ph - 4))}px`;
    }
    setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escKey, true); }, 0);
  }

  return {
    hidden, head, buttonAt, openPanel, toggle, menu, close, destroy, newView, enterView,
    get view() { return view; },
    exitView: () => { view = null; schedule(); },
  };
}
