// Comments and version history on screen (SPREADSHEET_DESIGN.md §5, §11 step 8): a
// side panel (a bottom sheet on the phone) for comment threads on cells — add, reply,
// edit or delete your own, resolve, reopen — and one for versions: name the current
// version, preview an old one with every changed cell highlighted, restore it.
//
//   const hx = createHistoryUI({ root, model, engine, st, schedule, toast, isPhone, session, me, select, switchTab, a1Of });
//   hx.corners()            Set of "rowId.colId" for cells with open comments
//   hx.openComments({ add })   hx.openVersions()   hx.close()   hx.destroy()

import { replyTo, editReply, deleteReply, setResolved } from "../editor/doc-model.js";
import { addCellThread, cellThreads, restoreSheet, changedCells } from "./history.js";
import { createSheetModel } from "./model.js";
import { connectEngine } from "./bridge.js";
import { createEngine } from "./engine/engine.js";
import { functionCatalog } from "./engine/functions/index.js";
import { geometry, drawGrid } from "./grid.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function createHistoryUI({ root, model, engine, st, schedule, toast = () => {}, isPhone = () => false, session, me, select, switchTab, a1Of }) {
  const ydoc = model.ydoc;
  const body = root.querySelector(".sh-body");
  let panel = null, mode = null;
  let draft = null; // a new comment being written: { tab, row, col }
  let showResolved = false, editing = null;

  // ---- redraw when comments change ---------------------------------------------------------------
  const onDeep = () => { schedule({ geom: false }); if (mode === "comments") render(); };
  const comments = ydoc.getMap("comments");
  comments.observeDeep(onDeep);

  function corners() {
    const out = new Set();
    for (const t of cellThreads(ydoc, model)) if (!t.resolved && t.cell && t.cell.tab === st.tab) out.add(`${t.cell.row}.${t.cell.col}`);
    return out;
  }

  // ---- the panel shell ------------------------------------------------------------------------------
  function close() {
    stopPreview();
    panel?.remove(); panel = null; mode = null; draft = null; editing = null;
    root.classList.remove("has-side-panel");
  }
  function openPanel(m, label) {
    close();
    mode = m;
    panel = document.createElement("aside");
    panel.className = `sh-rules sh-history${isPhone() ? " is-sheet" : ""}`;
    panel.setAttribute("aria-label", label);
    root.appendChild(panel);
    root.classList.add("has-side-panel");
    if (!isPhone()) { panel.style.top = `${body.offsetTop}px`; panel.style.bottom = `${Math.max(0, root.clientHeight - body.offsetTop - body.offsetHeight)}px`; }
    panel.addEventListener("click", onClick);
  }
  const head = (title) => `<div class="sh-rx-head"><strong>${title}</strong><button type="button" class="sh-icon" data-hx="close" aria-label="Close">✕</button></div>`;
  const cellName = (cell) => {
    if (!cell) return "";
    const r = model.rowIds(cell.tab).indexOf(cell.row), c = model.colIds(cell.tab).indexOf(cell.col);
    return `${cell.tab === st.tab ? "" : `${model.tabInfo(cell.tab).name}!`}${a1Of(r, c)}`;
  };

  // ---- comments ----------------------------------------------------------------------------------------
  function openComments({ add = false } = {}) {
    openPanel("comments", "Comments");
    if (add && !st.viewing) {
      const rows = model.rowIds(st.tab), cols = model.colIds(st.tab);
      draft = { tab: st.tab, row: rows[st.sel.r], col: cols[st.sel.c] };
    }
    render();
    panel.querySelector("[data-hx-new]")?.focus();
  }
  function render() {
    if (!panel || mode !== "comments") return;
    if (panel.contains(document.activeElement) && document.activeElement.matches("textarea") && document.activeElement.value) return; // don't wipe what someone is typing
    const all = cellThreads(ydoc, model).filter((t) => showResolved || !t.resolved);
    // this tab first, in cell order; then other tabs; then lost cells
    const pos = (t) => (t.cell ? [t.cell.tab === st.tab ? 0 : 1, model.tabIds().indexOf(t.cell.tab), model.rowIds(t.cell.tab).indexOf(t.cell.row), model.colIds(t.cell.tab).indexOf(t.cell.col)] : [2, 0, 0, 0]);
    all.sort((a, b) => { const x = pos(a), y = pos(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return a.createdAt - b.createdAt; });
    const nameOf = (r) => (r.by === me.id ? "You" : r.name || "Someone");
    let html = head("Comments") + `<div class="sh-rx-list">`;
    if (draft) html += `<div class="sh-cm-card is-new"><div class="sh-cm-cell">${esc(cellName(draft))}</div><textarea data-hx-new rows="3" placeholder="Add a comment" maxlength="5000"></textarea><div class="sh-cm-actions"><button type="button" class="sh-btn" data-hx="cancel-new">Cancel</button><button type="button" class="sh-btn is-primary" data-hx="post">Comment</button></div></div>`;
    for (const t of all) {
      html += `<div class="sh-cm-card${t.resolved ? " is-resolved" : ""}" data-thread="${esc(t.id)}">
        <button type="button" class="sh-cm-cell" data-hx="goto" data-thread="${esc(t.id)}">${t.cell ? esc(cellName(t.cell)) : "<em>The cell was deleted</em>"}${t.quote ? ` · <span>${esc(t.quote)}</span>` : ""}</button>
        ${t.replies.map((r) => `<div class="sh-cm-reply"><div class="sh-cm-who"><strong>${esc(nameOf(r))}</strong> <small>${esc(timeAgo(r.at))}${r.edited ? " · edited" : ""}</small></div>
          ${editing === r.id ? `<textarea data-hx-edit="${esc(r.id)}" rows="3">${esc(r.text)}</textarea><div class="sh-cm-actions"><button type="button" class="sh-btn" data-hx="cancel-edit">Cancel</button><button type="button" class="sh-btn is-primary" data-hx="save-edit" data-thread="${esc(t.id)}" data-id="${esc(r.id)}">Save</button></div>`
            : `<div class="sh-cm-text">${esc(r.text)}</div>${r.by === me.id && !st.viewing ? `<div class="sh-cm-actions is-small"><button type="button" class="sh-link" data-hx="edit" data-id="${esc(r.id)}">Edit</button><button type="button" class="sh-link" data-hx="delete" data-thread="${esc(t.id)}" data-id="${esc(r.id)}">Delete</button></div>` : ""}`}</div>`).join("")}
        ${st.viewing ? "" : `<textarea data-hx-reply="${esc(t.id)}" rows="2" placeholder="Reply" maxlength="5000"></textarea>
        <div class="sh-cm-actions"><button type="button" class="sh-btn" data-hx="${t.resolved ? "reopen" : "resolve"}" data-thread="${esc(t.id)}">${t.resolved ? "Reopen" : "Resolve"}</button><button type="button" class="sh-btn is-primary" data-hx="reply" data-thread="${esc(t.id)}">Reply</button></div>`}
      </div>`;
    }
    if (!all.length && !draft) html += `<p class="sh-rx-empty">No ${showResolved ? "" : "open "}comments. Choose a cell, then Insert → Comment.</p>`;
    html += `</div><label class="sh-ce-check sh-cm-resolved"><input type="checkbox" class="live-toggle" data-hx="show-resolved" ${showResolved ? "checked" : ""}> Show resolved</label>`;
    panel.innerHTML = html;
  }
  const user = () => ({ id: me.id, name: me.name || "Someone" });
  function onClick(e) {
    const b = e.target.closest("[data-hx]");
    if (!b) return;
    const a = b.dataset.hx;
    const v = (sel) => panel.querySelector(sel)?.value?.trim() || "";
    if (a === "close") { close(); return; }
    if (mode === "versions") { versionClick(e, a, b); return; }
    if (a === "show-resolved") { showResolved = b.checked; render(); return; }
    if (a === "cancel-new") { draft = null; render(); return; }
    if (a === "post") {
      const text = v("[data-hx-new]");
      if (!text || !draft) return;
      const r = model.rowIds(draft.tab).indexOf(draft.row), c = model.colIds(draft.tab).indexOf(draft.col);
      const quote = String(engine.valueAt(draft.tab, r, c) ?? "").slice(0, 120);
      addCellThread(ydoc, { id: newId(), ...draft, quote, text, user: user() });
      draft = null;
      panel.querySelector("[data-hx-new]").value = "";
      render(); return;
    }
    const thread = b.dataset.thread;
    if (a === "goto") {
      const t = cellThreads(ydoc, model).find((x) => x.id === thread);
      if (!t?.cell) return;
      if (t.cell.tab !== st.tab) switchTab(t.cell.tab);
      select(model.rowIds(st.tab).indexOf(t.cell.row), model.colIds(st.tab).indexOf(t.cell.col));
      if (isPhone()) close();
      return;
    }
    if (a === "reply") { const text = v(`[data-hx-reply="${CSS.escape(thread)}"]`); if (!text) return; panel.querySelector(`[data-hx-reply="${CSS.escape(thread)}"]`).value = ""; replyTo(ydoc, thread, { text, user: user() }); return; }
    if (a === "resolve" || a === "reopen") { setResolved(ydoc, thread, a === "resolve"); return; }
    if (a === "edit") { editing = b.dataset.id; render(); return; }
    if (a === "cancel-edit") { editing = null; render(); return; }
    if (a === "save-edit") { const text = v(`[data-hx-edit="${CSS.escape(b.dataset.id)}"]`); editing = null; if (text) editReply(ydoc, thread, b.dataset.id, text, me.id); render(); return; }
    if (a === "delete") { if (confirm("Delete this comment?")) deleteReply(ydoc, thread, b.dataset.id, me.id); }
  }

  // ---- versions --------------------------------------------------------------------------------------
  let versions = [], active = null, preview = null;
  async function openVersions() {
    openPanel("versions", "Version history");
    panel.innerHTML = `${head("Version history")}<div class="sh-rx-list"><p class="sh-rx-empty">Loading versions…</p></div>`;
    try { versions = await session.versions(); } catch (err) { if (mode === "versions") panel.querySelector(".sh-rx-list").innerHTML = `<p class="sh-rx-empty">${esc(err?.message || "Versions couldn't be loaded.")}</p>`; return; }
    renderVersions();
  }
  function renderVersions() {
    if (!panel || mode !== "versions") return;
    let html = head("Version history") + `<div class="sh-rx-list">`;
    if (!st.viewing) html += `<button type="button" class="sh-btn" data-hx="name-now">Name the current version</button>`;
    html += `<p class="sh-rx-note">Kept: every hour for a day, every day for a month, every week for a year, and named versions for good.</p>`;
    let lastDay = "";
    for (const v of versions) {
      const d = new Date(v.savedAt);
      const day = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      if (day !== lastDay) { html += `<div class="sh-vh-day">${esc(day)}</div>`; lastDay = day; }
      const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      html += `<button type="button" class="sh-vh-item${active === v.slot ? " is-on" : ""}" data-hx="version" data-slot="${esc(v.slot)}"><strong>${esc(v.name || time)}</strong><small>${v.name ? esc(time) : ""}</small></button>`;
    }
    if (!versions.length) html += `<p class="sh-rx-empty">No versions yet. One is kept every 15 minutes of editing and when you close the spreadsheet.</p>`;
    panel.innerHTML = html + `</div>`;
  }
  async function versionClick(e, a, b) {
    if (a === "name-now") {
      const name = prompt("Name this version", "");
      if (!name?.trim()) return;
      try { await session.snapshot(name.trim().slice(0, 120)); versions = await session.versions(); renderVersions(); toast("Version named."); } catch (err) { toast(err?.message || "That didn't work."); }
      return;
    }
    if (a === "version") {
      active = b.dataset.slot;
      renderVersions();
      try { showPreview(versions.find((x) => x.slot === active), await session.loadVersion(active)); } catch (err) { toast(err?.message || "That version couldn't be opened."); }
    }
  }

  // ---- previewing a version ------------------------------------------------------------------------------
  function stopPreview() {
    if (!preview) return;
    preview.el.remove(); preview.vdoc.destroy(); preview = null; active = null;
  }
  function showPreview(v, vdoc) {
    stopPreview();
    const vmodel = createSheetModel(vdoc);
    const veng = createEngine({ functions: functionCatalog() });
    connectEngine(vmodel, veng);
    const tabs = vmodel.tabIds().filter((t) => !vmodel.tabInfo(t).hidden);
    let tab = tabs.includes(st.tab) ? st.tab : tabs[0];
    const el = document.createElement("div");
    el.className = "sh-vpreview";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Version preview");
    const when = new Date(v?.savedAt || Date.now()).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    el.innerHTML = `<div class="sh-vp-bar"><span><strong>${esc(v?.name || when)}</strong> <small data-vp-count></small></span>
        ${st.viewing ? "" : `<button type="button" class="sh-btn is-primary" data-vp="restore">Restore this version</button>`}
        <button type="button" class="sh-icon" data-vp="close" aria-label="Close preview">✕</button></div>
      <div class="sh-vp-tabs">${tabs.map((t) => `<button type="button" data-vp-tab="${esc(t)}">${esc(vmodel.tabInfo(t).name)}</button>`).join("")}</div>
      <div class="sh-vp-scroll"><div class="sh-vp-space"></div><canvas></canvas></div>`;
    body.appendChild(el);
    const scroll = el.querySelector(".sh-vp-scroll"), canvas = el.querySelector("canvas"), space = el.querySelector(".sh-vp-space");
    let changed = new Set(), g = null, raf = 0;
    const draw = () => {
      raf = 0;
      if (!preview) return;
      const w = scroll.clientWidth, h = scroll.clientHeight;
      if (!w || !h || !tab) return;
      canvas.style.left = `${scroll.scrollLeft}px`; canvas.style.top = `${scroll.scrollTop}px`;
      drawGrid(canvas, vmodel, veng, tab, g, { scrollX: scroll.scrollLeft, scrollY: scroll.scrollTop, w, h, sel: null, dpr: window.devicePixelRatio || 1, changed });
    };
    const setTab = (t) => {
      tab = t;
      g = geometry(vmodel, tab, 1);
      changed = changedCells(model, vmodel, tab);
      space.style.width = `${g.headW + g.cx[g.cols.length]}px`; space.style.height = `${g.headH + g.ry[g.rows.length]}px`;
      el.querySelectorAll("[data-vp-tab]").forEach((b) => b.classList.toggle("is-on", b.dataset.vpTab === tab));
      el.querySelector("[data-vp-count]").textContent = changed.size ? `· ${changed.size} cell${changed.size === 1 ? "" : "s"} differ from now on this tab` : "· the same as now on this tab";
      // open at the first change
      let fr = Infinity, fc = Infinity;
      const rIx = new Map(g.rows.map((x, i) => [x, i])), cIx = new Map(g.cols.map((x, i) => [x, i]));
      for (const k of changed) { const [rid, cid] = k.split("."); const r = rIx.get(rid), c = cIx.get(cid); if (r !== undefined && c !== undefined && (r < fr || (r === fr && c < fc))) { fr = r; fc = c; } }
      scroll.scrollTop = fr === Infinity ? 0 : Math.max(0, g.ry[fr] - 60);
      scroll.scrollLeft = fc === Infinity ? 0 : Math.max(0, g.cx[fc] - 120);
      draw();
    };
    scroll.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(draw); });
    el.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-vp-tab]")?.dataset.vpTab;
      if (t) { setTab(t); return; }
      const a = e.target.closest("[data-vp]")?.dataset.vp;
      if (a === "close") { stopPreview(); renderVersions(); }
      if (a === "restore") {
        if (!confirm("Restore this version? What's there now is kept as a version first, so you can go back.")) return;
        try {
          await session.snapshot(`Before restoring ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`).catch(() => {});
          restoreSheet(ydoc, vdoc);
          await session.save?.();
          stopPreview();
          if (!model.tabIds().includes(st.tab)) switchTab(model.tabIds()[0]);
          schedule();
          versions = await session.versions().catch(() => versions);
          renderVersions();
          toast("Version restored.");
        } catch (err) { toast(err?.message || "The version couldn't be restored."); }
      }
    });
    preview = { el, vdoc, vmodel, veng };
    if (tab) setTab(tab);
  }

  return {
    corners, openComments, openVersions, close,
    get mode() { return mode; },
    get previewing() { return Boolean(preview); },
    destroy() { close(); comments.unobserveDeep(onDeep); },
  };
}
