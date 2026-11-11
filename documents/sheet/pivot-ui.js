// Pivot tables on screen (SPREADSHEET_DESIGN.md §5): Insert → Pivot table, the
// "Edit pivot table" button on a pivot, and the editor (rows, columns, values,
// filters). A pivot is the formula =PIVOT.TABLE(source, "settings", header cells…) in
// its corner cell (engine/functions/pivot.js); this module reads and writes that formula,
// so a pivot gets everything formulas get: it follows inserted columns and sorts,
// recalculates with its data, spills, and shows #REF! when something is in the way.
//
//   const px = createPivotUI({ root, model, engine, st, schedule, toast, isPhone, openMenu, cellRect, select, newTabWithName });
//   px.at(r, c)        the pivot whose output covers this cell → { r, c } of its corner, or null
//   px.chip()          place the "Edit pivot table" button for the selection
//   px.insert()  px.open(r, c)  px.close()  px.destroy()

import { parse, refToA1, quoteSheet } from "./engine/parser.js";
import { displayOf } from "./grid.js";
import { SUMMARIZE, SHOW_AS, keyText } from "./pivot.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const PREFIX = "=PIVOT.TABLE(";
export const isPivotText = (t) => typeof t === "string" && t.toUpperCase().startsWith(PREFIX);

export function createPivotUI({ root, model, engine, st, schedule, toast = () => {}, isPhone = () => false, openMenu, cellRect, select, newTabWithName, regionAround }) {
  const body = root.querySelector(".sh-body");
  const chipEl = document.createElement("button");
  chipEl.type = "button";
  chipEl.className = "sh-pivot-chip";
  chipEl.textContent = "Edit pivot table";
  chipEl.hidden = true;
  body.appendChild(chipEl);
  chipEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  chipEl.addEventListener("click", () => { const p = at(st.sel.r, st.sel.c); if (p) open(p.r, p.c); });

  let panel = null, cur = null; // cur: { tab, r, c } of the pivot being edited

  // ---- finding a pivot ---------------------------------------------------------------------------
  const textAt = (tab, r, c) => model.inputText(tab, r, c);
  function at(r, c) {
    if (isPivotText(textAt(st.tab, r, c))) return { r, c };
    const rows = model.rowIds(st.tab), cols = model.colIds(st.tab);
    const a = engine.spillAnchorOf(st.tab, rows[r], cols[c]);
    if (!a) return null;
    const ar = rows.indexOf(a.row), ac = cols.indexOf(a.col);
    return ar >= 0 && ac >= 0 && isPivotText(textAt(st.tab, ar, ac)) ? { r: ar, c: ac } : null;
  }
  function chip() {
    const p = !st.viewing && !st.editing ? at(st.sel.r, st.sel.c) : null;
    chipEl.hidden = !p || Boolean(panel);
    if (!p) return;
    const R = cellRect(p.r, p.c);
    chipEl.style.left = `${Math.max(4, R.x)}px`;
    chipEl.style.top = `${Math.max(4, R.y - 30)}px`;
  }

  // ---- reading and writing the formula --------------------------------------------------------------
  const tabByName = (name) => (name ? model.tabIds().find((id) => model.tabInfo(id).name.toLowerCase() === String(name).toLowerCase()) : null);
  // → { srcTab, src: { r1, c1, r2 (null = open), c2 }, settings (f = source column offset) } or null
  function read(tab, r, c) {
    const text = textAt(tab, r, c);
    if (!isPivotText(text)) return null;
    let tree;
    try { tree = parse(text); } catch { return null; }
    const [srcNode, setNode, ...fieldNodes] = tree.args || [];
    if (srcNode?.t !== "ref" || setNode?.t !== "str") return null;
    const srcTab = srcNode.sheet ? tabByName(srcNode.sheet) : tab;
    if (!srcTab) return null;
    let settings;
    try { settings = JSON.parse(setNode.v); } catch { return null; }
    const src = { r1: srcNode.r1 ?? 0, c1: srcNode.c1, r2: srcNode.r2, c2: srcNode.c2 };
    const offs = fieldNodes.map((n) => (n?.t === "ref" ? n.c1 - src.c1 : -1));
    const map = (list) => (list || []).map((x) => ({ ...x, f: offs[x.f] ?? -1 })).filter((x) => x.f >= 0);
    return { srcTab, src, settings: { rows: map(settings.rows), cols: map(settings.cols), values: map(settings.values), filters: map(settings.filters) } };
  }
  function formulaFor(tab, p) {
    const sheet = p.srcTab === tab ? null : model.tabInfo(p.srcTab).name;
    const srcA1 = refToA1({ t: "ref", sheet, kind: p.src.r2 === null || p.src.r2 === undefined ? "open" : "range", r1: p.src.r1, c1: p.src.c1, r2: p.src.r2 ?? null, c2: p.src.c2 });
    // fields: the header cells of the columns in use, numbered in order
    const used = [...new Set(["rows", "cols", "values", "filters"].flatMap((k) => p.settings[k].map((x) => x.f)))].sort((a, b) => a - b);
    const num = new Map(used.map((f, i) => [f, i]));
    const map = (list) => list.map((x) => ({ ...x, f: num.get(x.f) }));
    const json = JSON.stringify({ rows: map(p.settings.rows), cols: map(p.settings.cols), values: map(p.settings.values), filters: map(p.settings.filters) });
    const fieldA1 = used.map((f) => refToA1({ t: "ref", sheet, kind: "cell", r1: p.src.r1, c1: p.src.c1 + f, r2: p.src.r1, c2: p.src.c1 + f }));
    return `${PREFIX}${[srcA1, `"${json.replace(/"/g, '""')}"`, ...fieldA1].join(", ")})`;
  }
  function write(p) {
    if (!cur) return;
    const res = model.setInput(cur.tab, cur.r, cur.c, formulaFor(cur.tab, p));
    if (res?.error) toast(res.error);
    schedule();
  }
  const headerNames = (p) => {
    const out = [];
    for (let c = p.src.c1; c <= p.src.c2; c++) { const t = displayOf(model, engine, p.srcTab, p.src.r1, c).text; out.push(t || `Column ${c - p.src.c1 + 1}`); }
    return out;
  };

  // ---- inserting ----------------------------------------------------------------------------------
  function insert() {
    if (st.viewing) return;
    const s = st.sel, rows = model.rowIds(st.tab), cols = model.colIds(st.tab);
    const filled = (r, c) => { const v = engine.valueAt(st.tab, r, c); return v !== null && v !== undefined && v !== ""; };
    const box = s.r1 === s.r2 && s.c1 === s.c2 ? regionAround(filled, s.r, s.c, rows.length - 1, cols.length - 1) : { r1: s.r1, r2: s.r2, c1: s.c1, c2: Math.min(s.c2, cols.length - 1) };
    if (box.r2 <= box.r1) { toast("Pick a table with a header row and at least one row of data."); return; }
    const srcTab = st.tab;
    const n = model.tabIds().filter((id) => /^Pivot table \d+$/.test(model.tabInfo(id).name)).length + 1;
    const tab = newTabWithName(`Pivot table ${n}`);
    const p = { srcTab, src: { r1: box.r1, c1: box.c1, r2: box.r2, c2: box.c2 }, settings: { rows: [], cols: [], values: [], filters: [] } };
    cur = { tab, r: 0, c: 0 };
    model.setInput(tab, 0, 0, formulaFor(tab, p));
    select(0, 0);
    open(0, 0);
  }

  // ---- the editor --------------------------------------------------------------------------------
  function close() { panel?.remove(); panel = null; cur = null; root.classList.remove("has-side-panel"); chip(); }
  function open(r, c) {
    const p = read(st.tab, r, c);
    if (!p) { toast("That pivot table can't be read."); return; }
    panel?.remove();
    cur = { tab: st.tab, r, c };
    panel = document.createElement("aside");
    panel.className = `sh-rules sh-pivot-editor${isPhone() ? " is-sheet" : ""}`;
    panel.setAttribute("aria-label", "Pivot table editor");
    root.appendChild(panel);
    root.classList.add("has-side-panel");
    if (!isPhone()) { panel.style.top = `${body.offsetTop}px`; panel.style.bottom = `${Math.max(0, root.clientHeight - body.offsetTop - body.offsetHeight)}px`; }
    panel.addEventListener("click", onClick);
    panel.addEventListener("change", onChange);
    chipEl.hidden = true;
    render();
  }
  const current = () => (cur ? read(cur.tab, cur.r, cur.c) : null);
  function render() {
    if (!panel) return;
    const p = current();
    if (!p) { close(); return; }
    const names = headerNames(p);
    const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
    const srcText = `${p.srcTab === cur.tab ? "" : `${quoteSheet(model.tabInfo(p.srcTab).name)}!`}${refToA1({ t: "ref", sheet: null, kind: p.src.r2 === null ? "open" : "range", r1: p.src.r1, c1: p.src.c1, r2: p.src.r2, c2: p.src.c2 })}`;
    const valueOpts = p.settings.values.map((v, i) => [`v${i}`, `${v.fn || "SUM"} of ${names[v.f] ?? "?"}`]);
    const group = (kind, x, i) => `<div class="sh-pv-item"><div class="sh-pv-top"><strong>${esc(names[x.f] ?? "?")}</strong><button type="button" class="sh-icon" data-pv-del="${kind}:${i}" aria-label="Remove">✕</button></div>
      <div class="sh-pv-grid"><label>Order<select data-pv="${kind}:${i}:order">${opt([["asc", "Ascending"], ["desc", "Descending"]], x.order || "asc")}</select></label>
      ${kind === "rows" ? `<label>Sort by<select data-pv="${kind}:${i}:sortBy">${opt([["", names[x.f] ?? "Itself"], ...valueOpts], Number.isInteger(x.sortBy) ? `v${x.sortBy}` : "")}</select></label>` : ""}</div>
      <label class="sh-ce-check"><input type="checkbox" class="live-toggle" data-pv="${kind}:${i}:totals" ${x.totals === false ? "" : "checked"}> Show totals</label></div>`;
    const value = (x, i) => `<div class="sh-pv-item"><div class="sh-pv-top"><strong>${esc(names[x.f] ?? "?")}</strong><button type="button" class="sh-icon" data-pv-del="values:${i}" aria-label="Remove">✕</button></div>
      <div class="sh-pv-grid"><label>Summarize by<select data-pv="values:${i}:fn">${opt(SUMMARIZE.map((f) => [f, f]), x.fn || "SUM")}</select></label>
      <label>Show as<select data-pv="values:${i}:show">${opt(SHOW_AS, x.show || "default")}</select></label></div></div>`;
    const filter = (x, i) => {
      const vals = distinct(p, x.f);
      const hide = new Set(x.hide || []);
      return `<div class="sh-pv-item"><div class="sh-pv-top"><strong>${esc(names[x.f] ?? "?")}</strong><span class="sh-pv-note">${hide.size ? `${hide.size} hidden` : "Showing all"}</span><button type="button" class="sh-icon" data-pv-del="filters:${i}" aria-label="Remove">✕</button></div>
        <div class="sh-f-list">${vals.map((t) => `<label><input type="checkbox" data-pv-hide="${i}" data-v="${esc(t)}" ${hide.has(t) ? "" : "checked"}><span>${t === "" ? "<em>(Blanks)</em>" : esc(t)}</span></label>`).join("")}</div></div>`;
    };
    const section = (kind, title, items, fn) => `<section class="sh-pv-sec"><div class="sh-pv-head"><span>${title}</span><button type="button" class="sh-btn" data-pv-add="${kind}">Add</button></div>${items.map(fn).join("") || ""}</section>`;
    panel.innerHTML = `
      <div class="sh-rx-head"><strong>Pivot table editor</strong><button type="button" class="sh-icon" data-pv-close aria-label="Close">✕</button></div>
      <div class="sh-rx-edit">
        <label class="sh-rx-field">Data range<input type="text" data-pv-src value="${esc(srcText)}" spellcheck="false"></label>
        ${section("rows", "Rows", p.settings.rows, (x, i) => group("rows", x, i))}
        ${section("cols", "Columns", p.settings.cols, (x, i) => group("cols", x, i))}
        ${section("values", "Values", p.settings.values, value)}
        ${section("filters", "Filters", p.settings.filters, filter)}
      </div>
      <div class="sh-rx-foot"><button type="button" class="sh-btn is-primary" data-pv-close>Done</button></div>`;
  }
  function distinct(p, f) {
    const set = new Set();
    const r2 = p.src.r2 ?? model.rowIds(p.srcTab).length - 1;
    for (let r = p.src.r1 + 1; r <= r2 && set.size < 300; r++) set.add(keyText(engine.valueAt(p.srcTab, r, p.src.c1 + f)));
    return [...set].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  function onClick(e) {
    const t = e.target;
    if (t.closest("[data-pv-close]")) { close(); return; }
    const del = t.closest("[data-pv-del]")?.dataset.pvDel;
    const p = current();
    if (!p) return;
    if (del) {
      const [kind, i] = del.split(":");
      p.settings[kind].splice(Number(i), 1);
      // a removed value no longer sorts anything
      if (kind === "values") for (const g of p.settings.rows) if (Number.isInteger(g.sortBy)) { if (g.sortBy === Number(i)) delete g.sortBy; else if (g.sortBy > Number(i)) g.sortBy--; }
      write(p); render(); return;
    }
    const add = t.closest("[data-pv-add]")?.dataset.pvAdd;
    if (add) {
      const names = headerNames(p);
      const r = t.getBoundingClientRect();
      openMenu(names.map((n, f) => ({ label: n, run: () => {
        const q = current(); if (!q) return;
        const item = add === "values" ? { f, fn: isNumberColumn(q, f) ? "SUM" : "COUNTA" } : add === "filters" ? { f, hide: [] } : { f, order: "asc" };
        q.settings[add].push(item);
        write(q); render();
      } })), { x: r.left, y: r.bottom + 2 });
    }
  }
  function isNumberColumn(p, f) {
    const r2 = Math.min(p.src.r2 ?? model.rowIds(p.srcTab).length - 1, p.src.r1 + 50);
    for (let r = p.src.r1 + 1; r <= r2; r++) { const v = engine.valueAt(p.srcTab, r, p.src.c1 + f); if (typeof v === "number") return true; if (typeof v === "string" && v) return false; }
    return false;
  }
  function onChange(e) {
    const t = e.target;
    const p = current();
    if (!p) return;
    if (t.matches("[data-pv-src]")) {
      const text = t.value.trim();
      const bang = text.lastIndexOf("!");
      let srcTab = cur.tab, rest = text;
      if (bang > 0) { srcTab = tabByName(text.slice(0, bang).replace(/^'(.*)'$/, "$1").replace(/''/g, "'")); rest = text.slice(bang + 1); }
      let node = null;
      try { node = parse(`=${rest}`); } catch { node = null; }
      if (!srcTab || node?.t !== "ref" || !["range", "open"].includes(node.kind)) { toast("Enter a range like Sheet1!A1:D100."); render(); return; }
      const width = node.c2 - node.c1 + 1;
      const keep = (list) => list.filter((x) => x.f < width);
      write({ srcTab, src: { r1: node.r1, c1: node.c1, r2: node.r2, c2: node.c2 }, settings: { rows: keep(p.settings.rows), cols: keep(p.settings.cols), values: keep(p.settings.values), filters: keep(p.settings.filters) } });
      render(); return;
    }
    if (t.matches("[data-pv-hide]")) {
      const fl = p.settings.filters[Number(t.dataset.pvHide)];
      const hide = new Set(fl.hide || []);
      if (t.checked) hide.delete(t.dataset.v); else hide.add(t.dataset.v);
      fl.hide = [...hide];
      write(p); render(); return;
    }
    const key = t.dataset.pv;
    if (!key) return;
    const [kind, i, field] = key.split(":");
    const item = p.settings[kind][Number(i)];
    if (field === "totals") item.totals = t.checked;
    else if (field === "sortBy") { if (t.value) item.sortBy = Number(t.value.slice(1)); else delete item.sortBy; }
    else item[field] = t.value;
    write(p); render();
  }

  return {
    at, chip, insert, open, close, read, formulaFor,
    get editing() { return cur; },
    destroy() { close(); chipEl.remove(); },
  };
}
