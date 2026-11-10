// The slides screen (SLIDES_DESIGN.md §3, §11): opens over the Document page.
// Laptop: menu bar and toolbar, the filmstrip on the left, the slide in the middle with
// speaker notes below, side panels on the right. iPhone: opens to view (swipe through
// slides); the pencil edits; the filmstrip runs along the bottom; + inserts; the format
// sheet fits what's selected.
//
// openSlidesEditor({ store, file, me, deps, host?, onClose?, startEditing? }) → { close() }

import "./slides.css";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { createDocSession } from "../editor/session.js";
import { createDocCache } from "../editor/cache.js";
import { colorFor } from "../editor/live.js";
import { IC } from "../editor/icons.js";
import { openDialog, promptText } from "../editor/panels.js";
import { baseExtensions, safeColor } from "../editor/extensions.js";
import { FONTS, FONT_SIZES } from "../editor/fonts.js";
import { createSlidesModel, LOCAL, fragmentHasText } from "./model.js";
import { renderSlide, fitText, fitScale, boxStyle, textStyle } from "./render.js";
import { fragmentHtml } from "./text.js";
import { LAYOUTS, THEMES, layoutFor, resolveColor, SIZES } from "./themes.js";
import { SHAPES, SHAPE_GROUPS, shapeIcon } from "./shapes.js";
import { popover, closePopover, colorPicker, menuHtml, esc, mod, keyLabel } from "./chrome.js";
import { prepareImage, mediaId, mediaCache } from "./media.js";
import { createFilmstrip } from "./filmstrip.js";
import { createPanels } from "./panels.js";

const isPhone = () => window.matchMedia("(max-width: 700px), (pointer: coarse) and (max-width: 900px)").matches;
const CLIP_MARK = "live-slides:";
// Pictures, video and audio behind the last copy (id → { info, bytes: Promise }), so
// pasting into another presentation in this app brings them along.
const clipMedia = new Map();
const mediaIdsIn = (data) => {
  const ids = new Set();
  const walk = (v) => { if (!v || typeof v !== "object") return; for (const [k, x] of Object.entries(v)) { if ((k === "media" || k === "poster") && typeof x === "string" && /^[0-9a-f]{32}$/.test(x)) ids.add(x); else if (typeof x === "object") walk(x); } };
  walk(data);
  return [...ids];
};
const MIN = 8;
const SI = {
  present: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  textbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1" stroke-dasharray="3 2"/><path d="M8 9h8M12 9v7"/></svg>',
  shape: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="5"/><rect x="11" y="11" width="9" height="9"/></svg>',
  line: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5"/></svg>',
  newSlide: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="15" height="11" rx="1"/><path d="M19 15v6M16 18h6"/></svg>',
  bg: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/></svg>',
  layout: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M10 9v11"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5-1-2 0-3s4 0 5-2c1.5-3-2-11-7-11z"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="11" cy="7" r="1.3"/><circle cx="15.5" cy="8" r="1.3"/></svg>',
  transition: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="10" height="12" rx="1"/><rect x="12" y="6" width="10" height="12" rx="1" stroke-dasharray="2 2"/></svg>',
  animate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="12" r="5"/><path d="M3 9h5M2 12h5M3 15h5"/></svg>',
  fill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 13l6-8 6 8-6 6z"/><path d="M19 15s2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 2-3.5 2-3.5"/></svg>',
  border: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20L20 4" stroke-width="2"/><path d="M14 4l6 6"/></svg>',
  weight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16" stroke-width="1"/><path d="M4 11h16" stroke-width="2.4"/><path d="M4 17h16" stroke-width="4"/></svg>',
  dash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h4M10 8h4M17 8h4M3 15h18" /></svg>',
  format: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  notes: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  valign: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16M4 20h16M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3"/></svg>',
  arrange: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="11" height="11"/><rect x="10" y="10" width="11" height="11" fill="currentColor" fill-opacity=".15"/></svg>',
};

export async function openSlidesEditor({ store, file, me, deps = {}, host = document.body, onClose = null, startEditing = false }) {
  const root = document.createElement("div");
  root.className = "sl-root";
  root.innerHTML = `
    <header class="sl-top">
      <button type="button" class="sl-icon sl-back" data-act="close" aria-label="Back to Document">${IC.back}</button>
      <div class="sl-title"><input type="text" data-no-clear aria-label="Presentation name" maxlength="200" value="${esc(file.name)}"><span class="sl-status" role="status">Opening…</span></div>
      <div class="sl-people" data-people></div>
      <button type="button" class="sl-icon" data-act="find" title="Find and replace" aria-label="Find and replace">${IC.find}</button>
      <button type="button" class="sl-present-btn" data-act="present" title="Present" aria-label="Present">${SI.present}<span>Present</span></button>
      <button type="button" class="sl-icon" data-act="phone-menu" title="More" aria-label="More">${IC.more}</button>
    </header>
    <nav class="sl-menubar" data-menubar>${["File", "Edit", "View", "Insert", "Format", "Slide", "Arrange"].map((m) => `<button type="button" data-menu="${m.toLowerCase()}">${m}</button>`).join("")}</nav>
    <div class="sl-toolbar" data-toolbar role="toolbar" aria-label="Tools"></div>
    <div class="sl-find" data-find hidden>
      <input type="search" data-find-q placeholder="Find" aria-label="Find">
      <input type="text" data-find-r placeholder="Replace with" aria-label="Replace with">
      <label><input type="checkbox" data-find-case> Match case</label>
      <span class="sl-count" data-find-count></span>
      <button type="button" class="sl-btn" data-act="find-next">Find</button>
      <button type="button" class="sl-btn" data-act="replace-all">Replace all</button>
      <button type="button" class="sl-icon" data-act="find-close" aria-label="Close find">${IC.close}</button>
    </div>
    <div class="sl-body">
      <aside class="sl-film" data-film aria-label="Slides"></aside>
      <main class="sl-main">
        <div class="sl-stagewrap" data-stagewrap>
          <div class="sl-stage" data-stage tabindex="-1" aria-label="Slide">
            <div class="sl-slidehost" data-slidehost></div>
            <div class="sl-overlay" data-overlay aria-hidden="true"></div>
          </div>
          <button type="button" class="sl-fab" data-act="start-edit" aria-label="Edit" hidden>${IC.pencil}</button>
          <button type="button" class="sl-fab sl-fab-plus" data-act="insert-menu" aria-label="Insert" hidden>${IC.plus}</button>
        </div>
        <div class="sl-notes-resize" data-notes-resize aria-hidden="true"></div>
        <section class="sl-notes" data-notes aria-label="Speaker notes"><div class="sl-notes-ed" data-notes-ed></div></section>
      </main>
      <aside class="sl-panel" data-panel hidden></aside>
    </div>
    <div class="sl-sheet" data-sheet hidden></div>`;
  host.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const statusEl = $(".sl-status");
  const toast = (m) => deps.toast?.(m);

  // ---- session -------------------------------------------------------------------------------
  let model = null;
  const session = createDocSession({
    store, me,
    liveOpen: deps.liveOpen || null,
    cache: createDocCache(`${file.scope}/${file.id}`, store.cacheSeal || {}),
    getText: () => ({ text: model ? model.searchText(100_000) : "", pages: model ? model.slideIds().length : 1 }),
    onRemoteChange: () => remoteChanged(),
  });
  try { await session.ready; } catch (e) {
    session.close().catch(() => {});
    statusEl.textContent = e?.message || "This presentation couldn't be opened.";
    statusEl.classList.add("is-error");
    $("[data-act=close]").addEventListener("click", () => { root.remove(); onClose?.({}); });
    return { close: () => root.remove() };
  }
  model = createSlidesModel(session.ydoc);
  if (!model.slideIds().length) model.init();
  model.tidy();

  const ydoc = session.ydoc;
  const undo = new Y.UndoManager([ydoc.getMap("meta"), ydoc.getArray("order"), ydoc.getMap("slides"), ydoc.getMap("media")], { trackedOrigins: new Set([LOCAL, ySyncPluginKey]), captureTimeout: 500 });
  // each move, resize or colour change is its own undo step (typing still groups)
  const onBefore = (tr) => { if (tr.origin === LOCAL) undo.stopCapturing(); };
  ydoc.on("beforeTransaction", onBefore);

  // ---- view state ----------------------------------------------------------------------------
  const st = {
    slide: model.slideIds()[0],
    sel: [],                 // selected item ids (current slide)
    slideSel: [],            // selected slides in the filmstrip (for multi-slide actions)
    editing: null,           // { iid, editor, el }
    viewing: isPhone() && !startEditing,
    scale: 1,
    focus: "stage",          // "stage" | "film" | "text" | "notes"
    tool: null,              // insert tool: { kind: "text" | "shape" | "line", shape? }
    panel: null,             // open side panel
  };
  const editingAllowed = () => !st.viewing;
  root.classList.toggle("is-viewing", st.viewing);
  root.classList.toggle("is-phone", isPhone());

  const media = mediaCache(store, { onLoad: () => { invalidateAll(); renderStage(); } });
  const mediaUrl = (id) => media.url(id);

  // ---- rendering the current slide -----------------------------------------------------------
  const slideHost = $("[data-slidehost]");
  const stage = $("[data-stage]");
  const stageWrap = $("[data-stagewrap]");
  const overlay = $("[data-overlay]");
  let slideEl = null;
  let renderedSlide = null;
  let rafStage = 0;

  function layoutStage() {
    const [W, H] = model.size();
    const r = stageWrap.getBoundingClientRect();
    const pad = isPhone() ? 8 : 28;
    st.scale = fitScale(W, H, Math.max(50, r.width - pad * 2), Math.max(50, r.height - pad * 2));
    stage.style.width = `${W * st.scale}px`;
    stage.style.height = `${H * st.scale}px`;
    if (slideEl) slideEl.style.transform = `scale(${st.scale})`;
    drawOverlay();
  }

  function renderStage() {
    cancelAnimationFrame(rafStage);
    rafStage = 0;
    if (!model.slide(st.slide)) st.slide = model.slideIds()[0];
    const fresh = renderSlide(model, st.slide, { mediaUrl, textHtml: fragmentHtml, placeholders: !st.viewing });
    fresh.style.transform = `scale(${st.scale})`;
    fresh.style.transformOrigin = "0 0";
    if (!slideEl || renderedSlide !== st.slide) {
      stopEditingText();
      slideHost.replaceChildren(fresh);
      slideEl = fresh;
      renderedSlide = st.slide;
    } else {
      patchSlide(slideEl, fresh);
    }
    fitText(slideEl);
    st.sel = st.sel.filter((id) => model.item(st.slide, id));
    drawOverlay();
    updateToolbar();
    awarenessSel();
  }
  const scheduleStage = () => { if (!rafStage) rafStage = requestAnimationFrame(() => renderStage()); };

  // Replaces only the items that changed, so the box being typed in keeps its editor.
  function patchSlide(cur, fresh) {
    cur.style.background = fresh.style.background;
    cur.style.width = fresh.style.width;
    cur.style.height = fresh.style.height;
    const want = [...fresh.children];
    const have = new Map([...cur.children].map((el) => [el.dataset.item || `_${el.className}`, el]));
    const keep = new Set();
    let prev = null;
    for (const el of want) {
      const key = el.dataset.item || `_${el.className}`;
      let node = have.get(key);
      if (node && st.editing && key === st.editing.iid) {
        // keep the editor; take the new box style and text defaults
        node.setAttribute("style", el.getAttribute("style"));
        const t = el.querySelector(".sl-text");
        if (t) st.editing.el.setAttribute("style", t.getAttribute("style"));
        const under = el.querySelector(".sl-svg, .sl-textbg");
        const oldUnder = node.querySelector(".sl-svg, .sl-textbg");
        if (under && oldUnder) oldUnder.replaceWith(under); else if (under) node.prepend(under); else oldUnder?.remove();
      } else if (!node || node.outerHTML !== el.outerHTML) {
        if (node) node.replaceWith(el); else (prev ? prev.after(el) : cur.prepend(el));
        node = el;
      }
      if (prev ? node.previousElementSibling !== prev : node !== cur.firstElementChild) (prev ? prev.after(node) : cur.prepend(node));
      keep.add(node);
      prev = node;
    }
    for (const el of [...cur.children]) if (!keep.has(el)) el.remove();
  }

  // ---- the selection overlay -----------------------------------------------------------------
  const HANDLES = [["nw", -1, -1], ["n", 0, -1], ["ne", 1, -1], ["e", 1, 0], ["se", 1, 1], ["s", 0, 1], ["sw", -1, 1], ["w", -1, 0]];
  let override = null; // id → fields while dragging (drawn without touching the model)
  const itemNow = (id) => { const it = model.item(st.slide, id); const o = override?.get(id); return it && o ? { ...it, ...o } : it; };
  const selItems = () => st.sel.map((id) => model.item(st.slide, id)).filter(Boolean);
  const selNow = () => st.sel.map(itemNow).filter(Boolean);

  function bboxOf(list) {
    if (!list.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of list) {
      const pts = corners(it);
      for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function corners(it) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const a = ((it.rot || 0) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => {
      const lx = (dx * it.w) / 2, ly = (dy * it.h) / 2;
      return [cx + lx * c - ly * s, cy + lx * s + ly * c];
    });
  }
  const lineEnds = (it) => {
    const p1 = [it.x + (it.flipH ? it.w : 0), it.y + (it.flipV ? it.h : 0)];
    const p2 = [it.x + (it.flipH ? 0 : it.w), it.y + (it.flipV ? 0 : it.h)];
    return [p1, p2];
  };

  let guides = [];
  let marquee = null;
  function drawOverlay() {
    const s = st.scale;
    const parts = [];
    // other people's selections, in their colour
    for (const [cid, a] of session.awareness.getStates()) {
      if (cid === session.awareness.clientID || a?.slides?.slide !== st.slide) continue;
      const color = safeColor(a.user?.color) || "#888";
      for (const iid of (a.slides.sel || []).slice(0, 50)) {
        const it = itemNow(iid);
        if (!it) continue;
        const b = bboxOf([it]);
        parts.push(`<div class="sl-peer-sel" style="left:${b.x * s - 2}px;top:${b.y * s - 2}px;width:${b.w * s + 4}px;height:${b.h * s + 4}px;border-color:${color}"><span style="background:${color}">${esc(String(a.user?.name || "").slice(0, 30))}</span></div>`);
      }
    }
    const list = selNow();
    if (list.length && !st.viewing) {
      const single = list.length === 1 ? list[0] : null;
      if (single && single.t === "line") {
        const [p1, p2] = lineEnds(single);
        parts.push(`<div class="sl-sel-line"></div>`);
        parts.push(`<div class="sl-handle sl-end" data-h="p1" style="left:${p1[0] * s}px;top:${p1[1] * s}px"></div><div class="sl-handle sl-end" data-h="p2" style="left:${p2[0] * s}px;top:${p2[1] * s}px"></div>`);
      } else {
        const box = single ? single : bboxOf(list);
        const rot = single?.rot || 0;
        const locked = list.some((x) => x.lock);
        parts.push(`<div class="sl-sel${locked ? " is-locked" : ""}${st.editing ? " is-editing" : ""}" style="left:${box.x * s}px;top:${box.y * s}px;width:${box.w * s}px;height:${box.h * s}px;transform:rotate(${rot}deg)">
          ${list.length > 1 ? list.map((it) => { const b = bboxOf([it]); return `<div class="sl-sel-each" style="left:${(b.x - box.x) * s}px;top:${(b.y - box.y) * s}px;width:${b.w * s}px;height:${b.h * s}px"></div>`; }).join("") : ""}
          ${locked || st.editing ? "" : HANDLES.map(([h]) => `<div class="sl-handle" data-h="${h}"></div>`).join("")}
          ${locked || st.editing || !single ? "" : `<div class="sl-rot" data-h="rot" title="Rotate"></div>`}
        </div>`);
      }
    }
    for (const g of guides) parts.push(g.axis === "x" ? `<div class="sl-guide is-v" style="left:${g.at * s}px"></div>` : `<div class="sl-guide is-h" style="top:${g.at * s}px"></div>`);
    if (marquee) parts.push(`<div class="sl-marquee" style="left:${Math.min(marquee.x1, marquee.x2) * s}px;top:${Math.min(marquee.y1, marquee.y2) * s}px;width:${Math.abs(marquee.x2 - marquee.x1) * s}px;height:${Math.abs(marquee.y2 - marquee.y1) * s}px"></div>`);
    overlay.innerHTML = parts.join("");
  }

  function awarenessSel() {
    session.awareness.setLocalStateField("slides", { slide: st.slide, sel: st.sel.slice(0, 50) });
  }
  session.awareness.on("change", () => { drawOverlay(); film.markPeers(peerSlides()); offerRemote(); });

  // Someone (you on the laptop, or Marijane) is presenting this: offer to be the remote.
  let remote = null, remoteBanner = null;
  async function offerRemote() {
    if (remote || presenting) { remoteBanner?.remove(); remoteBanner = null; return; }
    const { presentersIn } = await import("./remote.js");
    const p = presentersIn(session.awareness)[0];
    if (!p) { remoteBanner?.remove(); remoteBanner = null; return; }
    if (!remoteBanner) {
      remoteBanner = document.createElement("div");
      remoteBanner.className = "sl-remote-offer";
      remoteBanner.innerHTML = `<span data-who></span><button type="button" class="sl-btn" data-r="control">Control the presentation</button><button type="button" class="sl-icon" data-r="no" aria-label="Dismiss">${IC.close}</button>`;
      remoteBanner.addEventListener("click", async (e) => {
        const a = e.target.closest("[data-r]")?.dataset.r;
        if (a === "no") { remoteBanner.remove(); remoteBanner = null; remote = "dismissed"; setTimeout(() => { if (remote === "dismissed") remote = null; }, 60000); return; }
        if (a !== "control") return;
        const cur = presentersIn(session.awareness)[0];
        if (!cur) return;
        const { openRemote } = await import("./remote.js");
        remoteBanner?.remove(); remoteBanner = null;
        stopEditingText();
        remote = openRemote({ host: root, model, media, awareness: session.awareness, target: cur.cid, onClose: () => { remote = null; } });
      });
      root.appendChild(remoteBanner);
    }
    remoteBanner.querySelector("[data-who]").textContent = `${p.name === me.name ? "You're" : `${p.name} is`} presenting this on another screen.`;
  }
  const peerSlides = () => {
    const out = new Map();
    for (const [cid, a] of session.awareness.getStates()) if (cid !== session.awareness.clientID && a?.slides?.slide) out.set(a.slides.slide, safeColor(a.user?.color) || "#888");
    return out;
  };

  // ---- selecting -----------------------------------------------------------------------------
  function select(ids, { add = false } = {}) {
    const exp = new Set(add ? st.sel : []);
    for (const id of ids) for (const g of model.groupOf(st.slide, id)) exp.add(g);
    if (st.editing && !exp.has(st.editing.iid)) stopEditingText();
    st.sel = [...exp];
    drawOverlay();
    updateToolbar();
    awarenessSel();
    panels.refresh();
  }
  function clearSelection() { stopEditingText(); st.sel = []; drawOverlay(); updateToolbar(); awarenessSel(); panels.refresh(); }

  function goSlide(id, { keepSel = false } = {}) {
    if (!id || !model.slide(id)) return;
    if (id !== st.slide) { stopEditingText(); st.sel = keepSel ? st.sel : []; st.slide = id; }
    st.slideSel = [id];
    renderStage();
    film.setCurrent(id);
    mountNotes();
    panels.refresh();
  }
  const slideIndex = () => model.slideIds().indexOf(st.slide);

  // ---- pointer: select, move, resize, rotate, marquee, draw -----------------------------------
  const toSlide = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / st.scale, y: (e.clientY - r.top) / st.scale };
  };
  let drag = null;
  let tapInfo = { id: null, t: 0 };

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    closePopover();
    const p = toSlide(e);
    if (st.viewing) { swipeStart(e); return; }
    if (st.editing && e.target.closest(".sl-text") && e.target.closest(`[data-item="${CSS.escape(st.editing.iid)}"]`)) return; // typing
    const h = e.target.closest("[data-h]")?.dataset.h;
    if (h) { startHandle(e, h, p); return; }
    if (st.tool) { startDraw(e, p); return; }
    const itemEl = e.target.closest(".sl-item");
    const iid = itemEl?.dataset.item;
    if (iid) {
      const already = st.sel.includes(iid);
      const it = model.item(st.slide, iid);
      if (e.shiftKey || mod(e)) { select(already ? st.sel.filter((x) => !model.groupOf(st.slide, iid).includes(x)) : [iid], { add: !already }); if (already) select(st.sel); return; }
      if (!already) select([iid]);
      // a second tap / click on a selected text box goes into the text
      const now = Date.now();
      const second = already && st.sel.length === 1 && (it?.t === "text" || it?.t === "shape") && tapInfo.id === iid;
      tapInfo = { id: iid, t: now };
      startMove(e, p, second ? { thenEdit: { iid, x: e.clientX, y: e.clientY } } : {});
      return;
    }
    if (st.editing) stopEditingText();
    tapInfo = { id: null, t: 0 };
    startMarquee(e, p);
  });

  stage.addEventListener("dblclick", (e) => {
    if (st.viewing) return;
    const iid = e.target.closest(".sl-item")?.dataset.item;
    const it = iid && model.item(st.slide, iid);
    if (it && (it.t === "text" || it.t === "shape")) startEditingText(iid, { x: e.clientX, y: e.clientY });
    else if (it?.t === "image") panels.open("format");
    else if (it?.t === "table") editTable(iid);
  });

  function capture(e, onMove, onUp) {
    const target = e.target;
    try { target.setPointerCapture?.(e.pointerId); } catch { /* ok */ }
    const move = (ev) => onMove(ev);
    const up = (ev) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); onUp(ev); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Snapping: the moving box's edges and centre to the slide's and other items'.
  function snapTargets(exclude) {
    const [W, H] = model.size();
    const xs = [0, W / 2, W], ys = [0, H / 2, H];
    for (const it of model.items(st.slide)) {
      if (exclude.has(it.id)) continue;
      const b = bboxOf([it]);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }
  function snap(box, targets, tol) {
    let dx = 0, dy = 0;
    const g = [];
    const tryAxis = (vals, cands) => {
      let best = null;
      for (const v of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c }; }
      return best;
    };
    const bx = tryAxis([box.x, box.x + box.w / 2, box.x + box.w], targets.xs);
    const by = tryAxis([box.y, box.y + box.h / 2, box.y + box.h], targets.ys);
    if (bx) { dx = bx.d; g.push({ axis: "x", at: bx.at }); }
    if (by) { dy = by.d; g.push({ axis: "y", at: by.at }); }
    return { dx, dy, guides: g };
  }

  function startMove(e, p0, { thenEdit = null } = {}) {
    const list = selItems();
    if (!list.length || list.some((x) => x.lock)) { if (thenEdit) startEditingText(thenEdit.iid, thenEdit); return; }
    const start = list.map((it) => ({ id: it.id, x: it.x, y: it.y }));
    const box0 = bboxOf(list);
    const targets = snapTargets(new Set(list.map((x) => x.id)));
    let moved = false;
    let last = { dx: 0, dy: 0 };
    const els = list.map((it) => slideEl.querySelector(`[data-item="${CSS.escape(it.id)}"]`));
    const threshold = e.pointerType === "touch" ? 6 : 3;
    capture(e, (ev) => {
      const p = toSlide(ev);
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (!moved && Math.hypot(dx * st.scale, dy * st.scale) < threshold) return;
      moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = ev.altKey ? { dx: 0, dy: 0, guides: [] } : snap({ ...box0, x: box0.x + dx, y: box0.y + dy }, targets, 8 / st.scale);
      dx += sn.dx; dy += sn.dy;
      guides = sn.guides;
      last = { dx, dy };
      start.forEach((s, i) => { if (els[i]) { els[i].style.left = `${s.x + dx}px`; els[i].style.top = `${s.y + dy}px`; } });
      drawOverlayMoving(list, dx, dy);
    }, () => {
      guides = [];
      if (moved && (last.dx || last.dy)) {
        model.transact(() => start.forEach((s) => model.updateItems(st.slide, [s.id], { x: Math.round(s.x + last.dx), y: Math.round(s.y + last.dy) })));
      } else if (thenEdit) startEditingText(thenEdit.iid, thenEdit);
      renderStage();
    });
  }
  function drawOverlayMoving(list, dx, dy) {
    override = new Map(list.map((it) => [it.id, { x: it.x + dx, y: it.y + dy }]));
    drawOverlay();
    override = null;
  }
  function drawWith(map) { override = map; drawOverlay(); override = null; }

  function startHandle(e, h, p0) {
    e.stopPropagation();
    const list = selItems();
    if (!list.length) return;
    if (h === "rot") return startRotate(e, list[0]);
    if (h === "p1" || h === "p2") return startLineEnd(e, list[0], h);
    const single = list.length === 1 ? list[0] : null;
    const [dxs, dys] = HANDLES.find((x) => x[0] === h).slice(1);
    const keepRatio0 = single?.t === "image" || single?.t === "video";
    let next = null;
    capture(e, (ev) => {
      const p = toSlide(ev);
      const ratio = (dxs && dys) && (keepRatio0 ? !ev.shiftKey : ev.shiftKey);
      if (single) next = [resizeRotated(single, dxs, dys, p, ratio)];
      else {
        const b = bboxOf(list);
        const ax = dxs > 0 ? b.x : b.x + b.w, ay = dys > 0 ? b.y : b.y + b.h;
        let nw = dxs ? Math.max(MIN, dxs > 0 ? p.x - ax : ax - p.x) : b.w;
        let nh = dys ? Math.max(MIN, dys > 0 ? p.y - ay : ay - p.y) : b.h;
        if (ratio) { const k = Math.max(nw / b.w, nh / b.h); nw = b.w * k; nh = b.h * k; }
        const nx = dxs > 0 ? ax : dxs < 0 ? ax - nw : b.x, ny = dys > 0 ? ay : dys < 0 ? ay - nh : b.y;
        const sx = nw / b.w, sy = nh / b.h;
        next = list.map((it) => ({ id: it.id, x: nx + (it.x - b.x) * sx, y: ny + (it.y - b.y) * sy, w: Math.max(1, it.w * sx), h: Math.max(1, it.h * sy) }));
      }
      for (const n of next) { const el = slideEl.querySelector(`[data-item="${CSS.escape(n.id)}"]`); if (el) Object.assign(el.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px` }); }
      drawWith(new Map(next.map((n) => [n.id, n])));
    }, () => {
      if (next) model.transact(() => next.forEach((n) => model.updateItems(st.slide, [n.id], { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h) })));
      renderStage();
    });
    void p0;
  }

  // Resizes a (possibly rotated) box by one handle, keeping the opposite side in place.
  function resizeRotated(it, dx, dy, p, ratio) {
    const a = ((it.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const ax = cx + ((-dx * it.w) / 2) * c - ((-dy * it.h) / 2) * s;
    const ay = cy + ((-dx * it.w) / 2) * s + ((-dy * it.h) / 2) * c;
    const vx = p.x - ax, vy = p.y - ay;
    const qx = vx * c + vy * s, qy = -vx * s + vy * c;
    let w = dx ? Math.max(MIN, dx * qx) : it.w;
    let h = dy ? Math.max(MIN, dy * qy) : it.h;
    if (ratio) { const k = Math.max(w / it.w, h / it.h); w = it.w * k; h = it.h * k; }
    const lx = dx ? (dx * w) / 2 : 0, ly = dy ? (dy * h) / 2 : 0;
    const centerX = ax + lx * c - ly * s, centerY = ay + lx * s + ly * c;
    return { id: it.id, x: centerX - w / 2, y: centerY - h / 2, w, h };
  }

  function startRotate(e, it) {
    const r = stage.getBoundingClientRect();
    const cx = r.left + (it.x + it.w / 2) * st.scale, cy = r.top + (it.y + it.h / 2) * st.scale;
    let rot = it.rot || 0;
    const el = slideEl.querySelector(`[data-item="${CSS.escape(it.id)}"]`);
    capture(e, (ev) => {
      let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else for (const k of [0, 90, 180, 270, 360]) if (Math.abs(deg - k) < 3) deg = k % 360;
      rot = deg;
      if (el) el.style.transform = `rotate(${deg}deg)${it.flipH ? " scaleX(-1)" : ""}${it.flipV ? " scaleY(-1)" : ""}`;
      drawWith(new Map([[it.id, { rot: deg }]]));
    }, () => { model.updateItems(st.slide, [it.id], { rot: Math.round(rot * 10) / 10 }); renderStage(); });
  }

  function startLineEnd(e, it, which) {
    const [p1, p2] = lineEnds(it);
    let next = null;
    capture(e, (ev) => {
      let p = toSlide(ev);
      const fixed = which === "p1" ? p2 : p1;
      if (ev.shiftKey) {
        const ang = Math.atan2(p.y - fixed[1], p.x - fixed[0]);
        const snapA = (Math.round(ang / (Math.PI / 4)) * Math.PI) / 4;
        const len = Math.hypot(p.x - fixed[0], p.y - fixed[1]);
        p = { x: fixed[0] + len * Math.cos(snapA), y: fixed[1] + len * Math.sin(snapA) };
      }
      const a = which === "p1" ? [p.x, p.y] : p1, b = which === "p2" ? [p.x, p.y] : p2;
      next = lineBox(a, b);
      drawWith(new Map([[it.id, next]]));
    }, () => { if (next) model.updateItems(st.slide, [it.id], { ...next, flipH: next.flipH || null, flipV: next.flipV || null }); renderStage(); });
  }
  const lineBox = (a, b) => ({ x: Math.round(Math.min(a[0], b[0])), y: Math.round(Math.min(a[1], b[1])), w: Math.round(Math.abs(b[0] - a[0])), h: Math.round(Math.abs(b[1] - a[1])), flipH: a[0] > b[0], flipV: a[1] > b[1] });

  function startMarquee(e, p0) {
    marquee = { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y };
    let moved = false;
    capture(e, (ev) => {
      const p = toSlide(ev);
      marquee.x2 = p.x; marquee.y2 = p.y;
      moved = moved || Math.hypot((p.x - p0.x) * st.scale, (p.y - p0.y) * st.scale) > 4;
      if (moved) drawOverlay();
    }, () => {
      const m = marquee;
      marquee = null;
      if (!moved) { clearSelection(); return; }
      const x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2), y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
      const hits = model.items(st.slide).filter((it) => { const b = bboxOf([it]); return b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1; }).map((it) => it.id);
      select(hits);
    });
  }

  // Drawing a new box with the insert tool (or a click for the default size).
  function startDraw(e, p0) {
    const tool = st.tool;
    let p1 = p0;
    marquee = tool.kind === "line" ? null : { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y };
    capture(e, (ev) => {
      p1 = toSlide(ev);
      if (ev.shiftKey && tool.kind !== "line") { const d = Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)); p1 = { x: p0.x + Math.sign(p1.x - p0.x || 1) * d, y: p0.y + Math.sign(p1.y - p0.y || 1) * d }; }
      if (marquee) { marquee.x2 = p1.x; marquee.y2 = p1.y; } else { const b = lineBox([p0.x, p0.y], [p1.x, p1.y]); guides = []; drawLinePreview(b); return; }
      drawOverlay();
    }, () => {
      marquee = null;
      overlay.querySelector(".sl-line-preview")?.remove();
      setTool(null);
      const small = Math.hypot((p1.x - p0.x) * st.scale, (p1.y - p0.y) * st.scale) < 6;
      if (tool.kind === "line") {
        const b = small ? lineBox([p0.x, p0.y], [p0.x + 300, p0.y]) : lineBox([p0.x, p0.y], [p1.x, p1.y]);
        const id = model.addItem(st.slide, { t: "line", ...b, flipH: b.flipH || undefined, flipV: b.flipV || undefined, stroke: "@dk1", sw: 4, kind: tool.lineKind || "straight", a2: tool.arrow ? "arrow" : undefined });
        renderStage(); select([id]);
        return;
      }
      const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      const w = small ? (tool.kind === "text" ? 600 : 300) : Math.abs(p1.x - p0.x), h = small ? (tool.kind === "text" ? 100 : 300) : Math.abs(p1.y - p0.y);
      const id = tool.kind === "text"
        ? model.addItem(st.slide, { t: "text", x, y, w, h, font: "@body", size: 18, color: "@dk1" })
        : model.addItem(st.slide, { t: "shape", shape: tool.shape || "rect", x, y, w, h, fill: "@a1", stroke: "@a1", sw: 0 });
      renderStage(); select([id]);
      if (tool.kind === "text") startEditingText(id);
    });
  }
  function drawLinePreview(b) {
    drawOverlay();
    const s = st.scale;
    const [x1, y1, x2, y2] = [b.x + (b.flipH ? b.w : 0), b.y + (b.flipV ? b.h : 0), b.x + (b.flipH ? 0 : b.w), b.y + (b.flipV ? 0 : b.h)];
    overlay.insertAdjacentHTML("beforeend", `<svg class="sl-line-preview" width="100%" height="100%"><line x1="${x1 * s}" y1="${y1 * s}" x2="${x2 * s}" y2="${y2 * s}"/></svg>`);
  }
  function setTool(t) {
    st.tool = t;
    root.classList.toggle("is-drawing", !!t);
    if (t) { stopEditingText(); clearSelection(); toast(isPhone() ? "Tap or drag on the slide to place it." : "Click or drag on the slide to place it."); }
    updateToolbar();
  }

  // ---- phone: swipe through slides while viewing --------------------------------------------
  function swipeStart(e) {
    const x0 = e.clientX, y0 = e.clientY, t0 = Date.now();
    capture(e, () => {}, (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - t0 < 800) step(dx < 0 ? 1 : -1);
    });
  }
  function step(d) {
    const ids = model.slideIds();
    const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(st.slide) + d));
    goSlide(ids[i]);
  }

  // ---- typing in a text box ------------------------------------------------------------------
  const caretRender = (u) => {
    const c = document.createElement("span");
    c.className = "collaboration-carets__caret";
    c.style.borderColor = safeColor(u.color) || "#888";
    const l = document.createElement("span");
    l.className = "collaboration-carets__label";
    l.style.backgroundColor = safeColor(u.color) || "#888";
    l.textContent = String(u.name || "").slice(0, 40);
    c.appendChild(l);
    return c;
  };
  function textEditor(element, fragment, { placeholder = "" } = {}) {
    return new Editor({
      element,
      extensions: [
        ...baseExtensions({ collaboration: true, placeholder }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({ provider: { awareness: session.awareness }, user: { name: me.name, color: colorFor(me.id) }, render: caretRender }),
      ],
      editorProps: { attributes: { spellcheck: "true", autocapitalize: "sentences" } },
    });
  }

  function startEditingText(iid, at = null) {
    if (!editingAllowed()) return;
    const it = model.item(st.slide, iid);
    if (!it || it.lock || (it.t !== "text" && it.t !== "shape")) return;
    if (st.editing?.iid === iid) return;
    stopEditingText();
    const fr = model.text(st.slide, iid);
    const wrap = slideEl.querySelector(`[data-item="${CSS.escape(iid)}"]`);
    const textEl = wrap?.querySelector(".sl-text");
    if (!fr || !textEl) return;
    if (!st.sel.includes(iid)) { st.sel = [iid]; }
    textEl.innerHTML = "";
    textEl.classList.add("is-live");
    const editor = textEditor(textEl, fr, { placeholder: it.role ? "" : "" });
    st.editing = { iid, editor, el: textEl };
    st.focus = "text";
    editor.on("selectionUpdate", () => updateToolbar());
    editor.on("transaction", () => { updateToolbar(); fitText(slideEl); });
    editor.on("focus", () => { st.focus = "text"; });
    requestAnimationFrame(() => {
      editor.commands.focus("end");
      if (at?.x != null) {
        const pos = editor.view.posAtCoords({ left: at.x, top: at.y });
        if (pos) editor.commands.setTextSelection(pos.pos);
      }
    });
    drawOverlay();
    updateToolbar();
  }

  function stopEditingText() {
    const ed = st.editing;
    if (!ed) return;
    st.editing = null;
    try { ed.editor.destroy(); } catch { /* gone */ }
    st.focus = "stage";
    // the box shows its stored text again (or its prompt)
    const fresh = renderSlide(model, st.slide, { mediaUrl, textHtml: fragmentHtml, placeholders: !st.viewing });
    const nw = fresh.querySelector(`[data-item="${CSS.escape(ed.iid)}"]`);
    const old = slideEl?.querySelector(`[data-item="${CSS.escape(ed.iid)}"]`);
    if (nw && old) old.replaceWith(nw);
    // an empty text box someone just made is removed (as Google Slides does)
    const it = model.item(st.slide, ed.iid);
    if (it && it.t === "text" && !it.role && !fragmentHasText(model.text(st.slide, ed.iid)) && !it.fill && !it.stroke) {
      model.deleteItems(st.slide, [ed.iid]);
      st.sel = st.sel.filter((x) => x !== ed.iid);
      scheduleStage();
    }
    if (slideEl) fitText(slideEl);
    drawOverlay();
    updateToolbar();
  }

  // ---- speaker notes -------------------------------------------------------------------------
  let notesEditor = null;
  function mountNotes() {
    const box = $("[data-notes-ed]");
    notesEditor?.destroy();
    notesEditor = null;
    const fr = model.notes(st.slide);
    if (!fr) { box.innerHTML = ""; return; }
    box.innerHTML = "";
    notesEditor = textEditor(box, fr, { placeholder: "Click to add speaker notes" });
    notesEditor.setEditable(editingAllowed());
    notesEditor.on("focus", () => { st.focus = "notes"; stopEditingText(); });
  }
  // dragging the bar above the notes resizes them (laptop)
  $("[data-notes-resize]").addEventListener("pointerdown", (e) => {
    const notes = $("[data-notes]");
    const h0 = notes.getBoundingClientRect().height, y0 = e.clientY;
    capture(e, (ev) => { notes.style.height = `${Math.max(40, Math.min(window.innerHeight * 0.6, h0 - (ev.clientY - y0)))}px`; layoutStage(); }, () => {});
  });

  // ---- adding things -------------------------------------------------------------------------
  function centredBox(w, h) {
    const [W, H] = model.size();
    return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
  }
  async function pickImages({ camera = false, replace = null } = {}) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = !camera && !replace;
    if (camera) input.capture = "environment";
    input.onchange = () => insertImages([...input.files], { replace });
    input.click();
  }
  async function storeImage(f) {
    const img = await prepareImage(f);
    const id = await mediaId(store, img.bytes);
    if (!model.mediaInfo(id)) {
      await store.images.put(id, img.bytes);
      model.addMedia(id, { kind: "image", mime: img.mime, size: img.bytes.length, w: img.w, h: img.h });
    }
    media.put(id, img.bytes);
    return { id, ...img };
  }
  async function insertImages(files, { replace = null, at = null } = {}) {
    if (!editingAllowed()) return;
    const added = [];
    for (const f of files.slice(0, 20)) {
      try {
        statusEl.textContent = "Adding the image…";
        const img = await storeImage(f);
        if (replace) { model.updateItems(st.slide, [replace], { media: img.id, crop: null }); added.push(replace); continue; }
        const [W, H] = model.size();
        const k = Math.min(1, (W * 0.6) / img.w, (H * 0.6) / img.h);
        const box = centredBox(Math.round(img.w * k), Math.round(img.h * k));
        if (at) { box.x = Math.round(at.x - box.w / 2); box.y = Math.round(at.y - box.h / 2); }
        box.x += added.length * 30; box.y += added.length * 30;
        added.push(model.addItem(st.slide, { t: "image", media: img.id, ...box, alt: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 200) }));
      } catch (e) { toast(e?.message || "That image couldn't be added."); }
    }
    statusEl.textContent = "";
    showStatus(session.state);
    renderStage();
    if (added.length) select(added);
  }
  function insertShape(shape) { setTool({ kind: "shape", shape }); }
  function insertTable(rows = 3, cols = 3) {
    const [W] = model.size();
    const box = centredBox(Math.round(W * 0.7), rows * 70);
    const id = model.addItem(st.slide, { t: "table", rows, cols, ...box, font: "@body", size: 16, color: "@dk1", stroke: "@dk2", fill: "@lt2", cells: {} });
    renderStage(); select([id]);
  }
  async function editTable(iid) {
    const { editTableDialog } = await import("./table.js");
    editTableDialog({ root, model, sid: st.slide, iid, onDone: () => renderStage() });
  }
  function newSlide(layout = null) {
    const cur = model.slide(st.slide);
    const next = layout || (cur?.layout === "title" ? "title-body" : cur?.layout && cur.layout !== "blank" ? cur.layout : "title-body");
    const id = model.addSlide({ layout: next, after: st.slide });
    goSlide(id);
    film.refresh();
  }

  // ---- arranging -----------------------------------------------------------------------------
  function alignSel(how) {
    const list = selItems();
    if (!list.length) return;
    const [W, H] = model.size();
    const ref = list.length > 1 ? bboxOf(list) : { x: 0, y: 0, w: W, h: H };
    model.transact(() => {
      for (const it of list) {
        const b = bboxOf([it]);
        const p = {};
        if (how === "left") p.x = it.x + (ref.x - b.x);
        if (how === "center") p.x = it.x + (ref.x + ref.w / 2 - (b.x + b.w / 2));
        if (how === "right") p.x = it.x + (ref.x + ref.w - (b.x + b.w));
        if (how === "top") p.y = it.y + (ref.y - b.y);
        if (how === "middle") p.y = it.y + (ref.y + ref.h / 2 - (b.y + b.h / 2));
        if (how === "bottom") p.y = it.y + (ref.y + ref.h - (b.y + b.h));
        for (const k of Object.keys(p)) p[k] = Math.round(p[k]);
        model.updateItems(st.slide, [it.id], p);
      }
    });
    renderStage();
  }
  function distribute(axis) {
    const list = selItems();
    if (list.length < 3) return;
    const bs = list.map((it) => ({ it, b: bboxOf([it]) })).sort((a, b) => (axis === "h" ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = bs[0].b, last = bs[bs.length - 1].b;
    const total = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
    const sum = bs.reduce((n, x) => n + (axis === "h" ? x.b.w : x.b.h), 0);
    const gap = (total - sum) / (bs.length - 1);
    let at = axis === "h" ? first.x : first.y;
    model.transact(() => bs.forEach(({ it, b }) => {
      const d = at - (axis === "h" ? b.x : b.y);
      model.updateItems(st.slide, [it.id], axis === "h" ? { x: Math.round(it.x + d) } : { y: Math.round(it.y + d) });
      at += (axis === "h" ? b.w : b.h) + gap;
    }));
    renderStage();
  }
  function nudge(dx, dy) {
    const list = selItems().filter((x) => !x.lock);
    if (!list.length) return;
    model.transact(() => list.forEach((it) => model.updateItems(st.slide, [it.id], { x: it.x + dx, y: it.y + dy })));
    renderStage();
  }
  function deleteSel() {
    if (!st.sel.length) return;
    const locked = selItems().filter((x) => x.lock).map((x) => x.id);
    const ids = st.sel.filter((x) => !locked.includes(x));
    stopEditingText();
    model.deleteItems(st.slide, ids);
    st.sel = locked;
    renderStage();
  }
  function setItems(patch) { if (!st.sel.length) return; model.updateItems(st.slide, st.sel, patch); renderStage(); panels.refresh(); }

  // ---- clipboard -----------------------------------------------------------------------------
  let clip = null; // { kind: "items" | "slides", data }
  function copy(cut = false, e = null) {
    if (st.focus === "film" && st.slideSel.length) {
      clip = { kind: "slides", data: model.exportSlides(st.slideSel) };
      if (cut) { deleteSlides(st.slideSel); }
    } else if (st.sel.length) {
      clip = { kind: "items", data: model.copyItems(st.slide, st.sel), from: st.slide };
      if (cut) deleteSel();
    } else return false;
    clipMedia.clear();
    for (const id of mediaIdsIn(clip.data)) {
      const p = media.bytes(id);
      p.catch(() => {});
      clipMedia.set(id, { info: model.mediaInfo(id), bytes: p });
    }
    const text = CLIP_MARK + JSON.stringify(clip);
    if (e?.clipboardData) { e.clipboardData.setData("text/plain", text); e.preventDefault(); } else navigator.clipboard?.writeText(text).catch(() => {});
    return true;
  }
  function paste(e) {
    if (!editingAllowed()) return;
    const files = [...(e?.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); insertImages(files); return; }
    const text = e?.clipboardData?.getData("text/plain") || "";
    let c = clip;
    if (text.startsWith(CLIP_MARK)) { try { c = JSON.parse(text.slice(CLIP_MARK.length)); } catch { c = null; } }
    else if (text) {
      e?.preventDefault();
      const box = centredBox(900, 200);
      const id = model.addItem(st.slide, { t: "text", ...box, font: "@body", size: 20, color: "@dk1" });
      const fr = model.text(st.slide, id);
      import("./text.js").then(({ writeJson, linesJson }) => { model.transact(() => writeJson(fr, linesJson(text.split(/\r?\n/).slice(0, 200)))); renderStage(); select([id]); });
      return;
    }
    if (!c) return;
    e?.preventDefault();
    bringMedia(c.data).then(() => doPaste(c));
  }
  // Media the pasted things use that this presentation doesn't have yet.
  async function bringMedia(data) {
    for (const id of mediaIdsIn(data)) {
      if (model.mediaInfo(id)) continue;
      const src = clipMedia.get(id);
      if (!src) continue;
      try {
        const bytes = await src.bytes;
        await store.images.put(id, bytes);
        media.put(id, bytes);
        model.addMedia(id, src.info || { kind: "image", size: bytes.length });
      } catch { /* shows a soft box */ }
    }
  }
  function doPaste(c) {
    try {
      if (c.kind === "slides") {
        const ids = model.importSlides(c.data, slideIndex() + 1);
        film.refresh(); goSlide(ids[0]);
      } else if (c.kind === "items") {
        const same = c.from === st.slide;
        const ids = model.pasteItems(st.slide, c.data, { dx: same ? 20 : 0, dy: same ? 20 : 0 });
        renderStage(); select(ids);
      }
    } catch (err) { toast(err?.message || "Couldn't paste that."); }
  }
  function duplicate() {
    if (st.focus === "film" || !st.sel.length) { const ids = model.duplicateSlides(st.slideSel.length ? st.slideSel : [st.slide]); film.refresh(); goSlide(ids[0]); return; }
    const ids = model.pasteItems(st.slide, model.copyItems(st.slide, st.sel), { dx: 20, dy: 20 });
    renderStage(); select(ids);
  }
  function deleteSlides(ids) {
    const all = model.slideIds();
    if (ids.length >= all.length) { toast("A presentation needs at least one slide."); return; }
    const i = Math.min(...ids.map((x) => all.indexOf(x)));
    model.deleteSlides(ids);
    const left = model.slideIds();
    goSlide(left[Math.min(i, left.length - 1)]);
    film.refresh();
  }
  root.addEventListener("copy", (e) => { if (st.focus === "text" || st.focus === "notes" || isTyping(e.target)) return; copy(false, e); });
  root.addEventListener("cut", (e) => { if (st.focus === "text" || st.focus === "notes" || isTyping(e.target)) return; copy(true, e); });
  root.addEventListener("paste", (e) => { if (st.focus === "text" || st.focus === "notes" || isTyping(e.target)) return; paste(e); });
  const isTyping = (el) => !!el?.closest?.("input, textarea, [contenteditable=true]");

  // drop images onto the slide (laptop)
  stage.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault(); });
  stage.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    insertImages(files, { at: toSlide(e) });
  });

  // ---- keyboard ------------------------------------------------------------------------------
  const onDocKey = (e) => {
    // keys reach the editor when focus is in it or nowhere in particular (after a popover closes)
    if (!(root.contains(e.target) || e.target === document.body || e.target === document.documentElement)) return;
    if (root.querySelector(".wp-dialog") || presenting) return;
    onKey(e);
  };
  document.addEventListener("keydown", onDocKey);
  function onKey(e) {
    if (mod(e) && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      if (isTyping(e.target) && !e.target.closest(".sl-text, .sl-notes-ed")) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "y" || e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if (st.editing || st.focus === "notes" || isTyping(e.target)) {
      if (e.key === "Escape" && st.editing) { e.preventDefault(); const iid = st.editing.iid; stopEditingText(); select([iid]); }
      return;
    }
    if (presenting) return;
    const k = e.key;
    if (st.viewing) {
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") { e.preventDefault(); step(1); }
      if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { e.preventDefault(); step(-1); }
      return;
    }
    if (mod(e) && k === "Enter") { e.preventDefault(); present({ fromStart: e.shiftKey ? false : false }); return; }
    if (k === "Escape") { if (st.tool) setTool(null); else clearSelection(); closePopover(); return; }
    if ((k === "Delete" || k === "Backspace")) {
      e.preventDefault();
      if (st.focus === "film" && !st.sel.length) deleteSlides(st.slideSel.length ? st.slideSel : [st.slide]); else deleteSel();
      return;
    }
    if (mod(e) && k === "d") { e.preventDefault(); duplicate(); return; }
    if (mod(e) && k === "a") { e.preventDefault(); select(model.items(st.slide).map((x) => x.id)); return; }
    if (mod(e) && (k === "g" || k === "G")) { e.preventDefault(); if (e.shiftKey) { model.ungroup(st.slide, st.sel); } else model.group(st.slide, st.sel); renderStage(); return; }
    if (mod(e) && k === "m") { e.preventDefault(); newSlide(); return; }
    if (mod(e) && (k === "ArrowUp" || k === "ArrowDown") && st.sel.length) { e.preventDefault(); model.restack(st.slide, st.sel, k === "ArrowUp" ? (e.shiftKey ? "front" : "forward") : (e.shiftKey ? "back" : "backward")); renderStage(); return; }
    if (k.startsWith("Arrow")) {
      e.preventDefault();
      if (st.sel.length) { const d = e.shiftKey ? 10 : 1; nudge(k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0, k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0); }
      else step(k === "ArrowLeft" || k === "ArrowUp" ? -1 : 1);
      return;
    }
    if (k === "Enter" && st.sel.length === 1) { e.preventDefault(); startEditingText(st.sel[0]); return; }
    if (k === "PageDown") { e.preventDefault(); step(1); }
    if (k === "PageUp") { e.preventDefault(); step(-1); }
  }

  function doUndo() { stopEditingText(); undo.undo(); afterHistory(); }
  function doRedo() { stopEditingText(); undo.redo(); afterHistory(); }
  function afterHistory() { model.tidy(); invalidateAll(); renderStage(); film.refresh(); mountNotes(); }

  // ---- the filmstrip ---------------------------------------------------------------------------
  const invalidateAll = () => { film.clear(); film.refresh(); };
  const film = createFilmstrip({
    box: $("[data-film]"), root, model,
    render: (sid) => renderSlide(model, sid, { mediaUrl, textHtml: fragmentHtml }),
    current: () => st.slide,
    selected: () => st.slideSel,
    editable: editingAllowed,
    phone: isPhone,
    onPick: (sid, { add, range }) => {
      st.focus = "film";
      if (add) st.slideSel = st.slideSel.includes(sid) ? st.slideSel.filter((x) => x !== sid) : [...st.slideSel, sid];
      else if (range) { const ids = model.slideIds(); const a = ids.indexOf(st.slide), b = ids.indexOf(sid); st.slideSel = ids.slice(Math.min(a, b), Math.max(a, b) + 1); }
      else st.slideSel = [sid];
      if (!add && !range) goSlide(sid); else film.setCurrent(st.slide);
    },
    onMove: (ids, to) => { model.moveSlides(ids, to); film.refresh(); },
    onMenu: (sid, anchor) => slideMenu(sid, anchor),
    onNew: () => newSlide(),
  });

  function slideMenu(sid, anchor) {
    if (!editingAllowed()) return;
    if (!st.slideSel.includes(sid)) { st.slideSel = [sid]; goSlide(sid); }
    const s = model.slide(sid);
    popover(root, anchor, menuHtml([
      { label: "New slide", act: "new-slide" },
      { label: "Duplicate slide", act: "dup-slide" },
      { label: st.slideSel.length > 1 ? `Delete ${st.slideSel.length} slides` : "Delete slide", act: "del-slide" },
      { label: s?.skip ? "Unskip slide" : "Skip slide", act: "skip-slide" },
      { sep: true },
      { label: "Change layout…", act: "panel", arg: "layout" },
      { label: "Change background…", act: "panel", arg: "background" },
      { label: "Transition…", act: "panel", arg: "transition" },
      { sep: true },
      { label: s?.section ? "Rename section…" : "Add section…", act: "section" },
      ...(s?.section ? [{ label: "Remove section", act: "section-off" }] : []),
      { label: "Move slide to beginning", act: "move-first" },
      { label: "Move slide to end", act: "move-last" },
    ]), { onClick: (b) => runAct(b.dataset.act, b.dataset.arg) });
  }

  // ---- menus and toolbar -----------------------------------------------------------------------
  function menuItems(name) {
    const sel = selItems();
    const one = sel.length === 1 ? sel[0] : null;
    const L = (s) => keyLabel(s);
    switch (name) {
      case "file": return [
        { label: "New slide", act: "new-slide", keys: L("Ctrl+M") },
        { label: "Present", act: "present", keys: L("Ctrl+Enter") },
        { label: "Present from the beginning", act: "present-start" },
        { sep: true },
        { label: "Rename", act: "rename" },
        { label: "Page setup…", act: "page-setup" },
        { label: "Version history", act: "panel", arg: "versions" },
        { label: "Name current version…", act: "name-version" },
      ];
      case "edit": return [
        { label: "Undo", act: "undo", keys: L("Ctrl+Z"), disabled: !undo.canUndo() },
        { label: "Redo", act: "redo", keys: L("Ctrl+Shift+Z"), disabled: !undo.canRedo() },
        { sep: true },
        { label: "Cut", act: "cut", keys: L("Ctrl+X"), disabled: !sel.length },
        { label: "Copy", act: "copy", keys: L("Ctrl+C"), disabled: !sel.length },
        { label: "Duplicate", act: "duplicate", keys: L("Ctrl+D") },
        { label: "Delete", act: "delete", disabled: !sel.length },
        { label: "Select all", act: "select-all", keys: L("Ctrl+A") },
        { sep: true },
        { label: "Find and replace", act: "find" },
      ];
      case "view": return [
        { label: "Present", act: "present" },
        { label: "Speaker notes", act: "toggle-notes", on: !root.classList.contains("no-notes") },
        { label: "Filmstrip", act: "toggle-film", on: !root.classList.contains("no-film") },
        { label: "Comments", act: "panel", arg: "comments" },
      ];
      case "insert": return [
        { label: "Image…", act: "image" },
        { label: "Text box", act: "tool-text" },
        { label: "Shape…", act: "shape-menu" },
        { label: "Line", act: "tool-line" },
        { label: "Arrow", act: "tool-arrow" },
        { label: "Table…", act: "table" },
        { label: "Video…", act: "video" },
        { label: "Audio…", act: "audio" },
        { sep: true },
        { label: "Comment", act: "panel", arg: "comments" },
        { label: "New slide", act: "new-slide", keys: L("Ctrl+M") },
      ];
      case "format": return [
        { label: "Format options…", act: "panel", arg: "format", disabled: !sel.length },
        { label: "Bold", act: "bold", disabled: !sel.length && !st.editing },
        { label: "Italic", act: "italic", disabled: !sel.length && !st.editing },
        { sep: true },
        { label: "Align left", act: "text-align", arg: "left" },
        { label: "Centre", act: "text-align", arg: "center" },
        { label: "Align right", act: "text-align", arg: "right" },
        { sep: true },
        { label: "Shrink text on overflow", act: "autofit", on: one?.autofit === "shrink", disabled: !one || !(one.t === "text" || one.t === "shape") },
        { label: "Clear formatting", act: "clear-format", disabled: !st.editing },
      ];
      case "slide": return [
        { label: "New slide", act: "new-slide", keys: L("Ctrl+M") },
        { label: "Duplicate slide", act: "dup-slide" },
        { label: "Delete slide", act: "del-slide" },
        { label: model.slide(st.slide)?.skip ? "Unskip slide" : "Skip slide", act: "skip-slide" },
        { sep: true },
        { label: "Next slide", act: "next" },
        { label: "Previous slide", act: "prev" },
        { sep: true },
        { label: "Change background…", act: "panel", arg: "background" },
        { label: "Apply layout…", act: "panel", arg: "layout" },
        { label: "Transition…", act: "panel", arg: "transition" },
        { label: "Change theme…", act: "panel", arg: "theme" },
      ];
      case "arrange": return [
        { head: "Order" },
        { label: "Bring to front", act: "restack", arg: "front", disabled: !sel.length, keys: L("Ctrl+Shift+↑") },
        { label: "Bring forward", act: "restack", arg: "forward", disabled: !sel.length, keys: L("Ctrl+↑") },
        { label: "Send backward", act: "restack", arg: "backward", disabled: !sel.length, keys: L("Ctrl+↓") },
        { label: "Send to back", act: "restack", arg: "back", disabled: !sel.length, keys: L("Ctrl+Shift+↓") },
        { head: "Align" },
        ...["left", "center", "right", "top", "middle", "bottom"].map((a) => ({ label: { left: "Left", center: "Centre", right: "Right", top: "Top", middle: "Middle", bottom: "Bottom" }[a], act: "align", arg: a, disabled: !sel.length })),
        { head: "Distribute" },
        { label: "Horizontally", act: "distribute", arg: "h", disabled: sel.length < 3 },
        { label: "Vertically", act: "distribute", arg: "v", disabled: sel.length < 3 },
        { sep: true },
        { label: "Group", act: "group", disabled: sel.length < 2, keys: L("Ctrl+G") },
        { label: "Ungroup", act: "ungroup", disabled: !sel.some((x) => x.grp), keys: L("Ctrl+Shift+G") },
        { label: one?.lock ? "Unlock" : "Lock", act: "lock", disabled: !sel.length },
        { sep: true },
        { label: "Rotate 90° clockwise", act: "rot90", disabled: !sel.length },
        { label: "Flip horizontally", act: "flip", arg: "h", disabled: !sel.length },
        { label: "Flip vertically", act: "flip", arg: "v", disabled: !sel.length },
      ];
      default: return [];
    }
  }

  $("[data-menubar]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]");
    if (!b) return;
    popover(root, b, menuHtml(menuItems(b.dataset.menu)), { onClick: (x) => { if (x.dataset.act) runAct(x.dataset.act, x.dataset.arg, x); } });
  });

  const tb = $("[data-toolbar]");
  function updateToolbar() {
    if (!tb) return;
    const sel = selItems();
    const one = sel.length === 1 ? sel[0] : null;
    const ed = st.editing?.editor;
    const btn = (act, icon, title, { on = false, arg = null, disabled = false } = {}) => `<button type="button" class="sl-icon${on ? " is-on" : ""}" data-act="${act}"${arg ? ` data-arg="${esc(arg)}"` : ""} title="${esc(title)}" aria-label="${esc(title)}"${disabled ? " disabled" : ""}>${icon}</button>`;
    const sep = `<span class="sl-sep"></span>`;
    const parts = [
      btn("new-slide", SI.newSlide, "New slide"),
      btn("undo", IC.undo, "Undo", { disabled: !undo.canUndo() }), btn("redo", IC.redo, "Redo", { disabled: !undo.canRedo() }),
      sep,
      btn("tool-text", SI.textbox, "Text box", { on: st.tool?.kind === "text" }),
      btn("image", IC.image, "Image"),
      btn("shape-menu", SI.shape, "Shape", { on: st.tool?.kind === "shape" }),
      btn("line-menu", SI.line, "Line", { on: st.tool?.kind === "line" }),
      sep,
    ];
    const textish = ed || (one && (one.t === "text" || one.t === "shape" || one.t === "table"));
    if (one && one.t !== "image" && one.t !== "line" && one.t !== "video" && one.t !== "audio") {
      parts.push(btn("fill-color", SI.fill, "Fill colour"));
    }
    if (one && one.t !== "video" && one.t !== "audio") {
      parts.push(btn("stroke-color", SI.border, one.t === "line" ? "Line colour" : "Border colour"), btn("stroke-weight", SI.weight, "Border weight"), btn("stroke-dash", SI.dash, "Border dash"));
    }
    if (textish) {
      const attrs = ed ? ed.getAttributes("textStyle") : {};
      const font = (ed && attrs.fontFamily) || one?.font || "@body";
      const fontName = font === "@heading" ? model.theme().fonts.heading : font === "@body" ? model.theme().fonts.body : font;
      const size = (ed && attrs.fontSize) || one?.size || 18;
      parts.push(sep,
        `<select data-tb="font" aria-label="Font" title="Font">${FONTS.map((f) => `<option${f.name === fontName ? " selected" : ""}>${esc(f.name)}</option>`).join("")}${FONTS.some((f) => f.name === fontName) ? "" : `<option selected>${esc(fontName)}</option>`}</select>`,
        `<button type="button" class="sl-icon sl-txt" data-act="size-dn" aria-label="Smaller">−</button><input class="sl-size" data-tb="size" aria-label="Font size" data-no-clear value="${esc(size)}" inputmode="decimal"><button type="button" class="sl-icon sl-txt" data-act="size-up" aria-label="Bigger">+</button>`,
        btn("bold", "<b>B</b>", "Bold", { on: ed ? ed.isActive("bold") : !!one?.bold }),
        btn("italic", "<i>I</i>", "Italic", { on: ed ? ed.isActive("italic") : !!one?.italic }),
        btn("underline", "<u>U</u>", "Underline", { on: !!ed?.isActive("underline"), disabled: !ed }),
        btn("text-color", IC.textColor, "Text colour"),
        btn("highlight", IC.highlight, "Highlight colour", { disabled: !ed }),
        btn("link", IC.link, "Link", { disabled: !ed }),
        sep,
        btn("align-menu", IC.alignLeft, "Align"),
        btn("valign-menu", SI.valign, "Vertical align"),
        btn("spacing-menu", IC.spacing, "Line spacing"),
        btn("bullets", IC.bullets, "Bulleted list", { on: !!ed?.isActive("bulletList") }),
        btn("numbers", IC.numbers, "Numbered list", { on: !!ed?.isActive("orderedList") }),
        btn("indent-less", IC.indentLess, "Decrease indent", { disabled: !ed }),
        btn("indent-more", IC.indentMore, "Increase indent", { disabled: !ed }),
        btn("clear-format", IC.clear, "Clear formatting", { disabled: !ed }));
    }
    if (one?.t === "image") parts.push(btn("crop", IC.crop, "Crop and mask"), btn("panel", SI.format, "Format options", { arg: "format" }));
    if (!sel.length && !ed) parts.push(btn("panel", SI.bg, "Background", { arg: "background" }), btn("panel", SI.layout, "Layout", { arg: "layout" }), btn("panel", SI.theme, "Theme", { arg: "theme" }), btn("panel", SI.transition, "Transition", { arg: "transition" }));
    else parts.push(sep, btn("arrange-menu", SI.arrange, "Arrange"), btn("panel", SI.animate, "Animate", { arg: "animate" }), btn("panel", SI.format, "Format options", { arg: "format" }));
    tb.innerHTML = parts.join("");
    // phone: the pencil while viewing, + while editing
    $("[data-act=start-edit]").hidden = !st.viewing;
    $("[data-act=insert-menu]").hidden = st.viewing || !isPhone();
  }

  tb.addEventListener("change", (e) => {
    const t = e.target.dataset.tb;
    if (t === "font") applyText({ font: e.target.value });
    if (t === "size") { const n = Number(e.target.value); if (n >= 1 && n <= 400) applyText({ size: n }); }
  });
  tb.addEventListener("keydown", (e) => { if (e.target.dataset.tb === "size" && e.key === "Enter") { e.preventDefault(); e.target.blur(); } });

  // Text formatting applies to the selected text while typing, else to the whole box.
  function applyText(p) {
    const ed = st.editing?.editor;
    if (ed) {
      const c = ed.chain().focus();
      if (p.font) c.setFontFamily(p.font);
      if (p.size) c.setFontSize(p.size);
      if (p.color !== undefined) { if (p.color) c.setColor(resolveColor(p.color, model.theme())); else c.unsetColor(); }
      c.run();
      return;
    }
    if (!st.sel.length) return;
    const patch = {};
    if (p.font) patch.font = p.font;
    if (p.size) patch.size = p.size;
    if (p.color !== undefined) patch.color = p.color;
    // a whole box: also clear the same setting on its runs, so the box setting shows
    clearRunMarks(st.sel, p);
    setItems(patch);
  }
  function clearRunMarks(ids, p) {
    const keys = [];
    if (p.font) keys.push("fontFamily");
    if (p.size) keys.push("fontSize");
    if (p.color !== undefined) keys.push("color");
    if (!keys.length) return;
    model.transact(() => {
      for (const iid of ids) {
        const fr = model.text(st.slide, iid);
        if (!fr) continue;
        const walk = (n) => {
          if (n instanceof Y.XmlText) {
            const delta = n.toDelta();
            let at = 0;
            for (const op of delta) {
              const len = typeof op.insert === "string" ? op.insert.length : 1;
              const ts = op.attributes?.textStyle;
              if (ts && keys.some((k) => ts[k] != null)) {
                const next = { ...ts };
                for (const k of keys) next[k] = null;
                const empty = Object.values(next).every((v) => v == null);
                n.format(at, len, { textStyle: empty ? null : next });
              }
              at += len;
            }
          } else if (n.toArray) n.toArray().forEach(walk);
        };
        walk(fr);
      }
    });
  }

  function toggleMark(mark) {
    const ed = st.editing?.editor;
    if (ed) { ed.chain().focus()[`toggle${mark[0].toUpperCase()}${mark.slice(1)}`]().run(); return; }
    if (!st.sel.length) return;
    const one = selItems()[0];
    if (mark === "bold" || mark === "italic") setItems({ [mark]: one?.[mark] ? null : true });
  }

  function alignText(a) {
    const ed = st.editing?.editor;
    if (ed) { ed.chain().focus().setTextAlign(a).run(); return; }
    // the whole box: its own alignment, and its paragraphs follow it
    model.transact(() => {
      for (const iid of st.sel) {
        const fr = model.text(st.slide, iid);
        fr?.toArray().forEach((n) => { if (n instanceof Y.XmlElement && n.getAttribute("textAlign")) n.removeAttribute("textAlign"); });
      }
    });
    setItems({ align: a });
  }

  // ---- actions --------------------------------------------------------------------------------
  async function runAct(act, arg, el = null) {
    const ed = st.editing?.editor;
    const anchor = el || root.querySelector(`[data-act="${CSS.escape(act)}"]`) || tb;
    switch (act) {
      case "close": return close();
      case "undo": return doUndo();
      case "redo": return doRedo();
      case "new-slide": return newSlide(arg || null);
      case "present": return present({ fromStart: false });
      case "present-start": return present({ fromStart: true });
      case "copy": return copy(false);
      case "cut": return copy(true);
      case "duplicate": return duplicate();
      case "delete": return deleteSel();
      case "select-all": return select(model.items(st.slide).map((x) => x.id));
      case "find": return toggleFind(true);
      case "find-close": return toggleFind(false);
      case "find-next": return findNext();
      case "replace-all": return replaceAll();
      case "toggle-notes": root.classList.toggle("no-notes"); return layoutStage();
      case "toggle-film": root.classList.toggle("no-film"); return layoutStage();
      case "tool-text": return setTool(st.tool?.kind === "text" ? null : { kind: "text" });
      case "tool-line": return setTool({ kind: "line" });
      case "tool-arrow": return setTool({ kind: "line", arrow: true });
      case "image": return pickImages();
      case "camera": return pickImages({ camera: true });
      case "table": {
        const { value, form } = await openDialog(root, { title: "Insert table", body: `<div class="wp-row"><label>Rows<input type="number" name="r" min="1" max="20" value="3"></label><label>Columns<input type="number" name="c" min="1" max="10" value="3"></label></div>`, actions: [{ label: "Cancel", value: null }, { label: "Insert", value: "ok", primary: true }] });
        if (value === "ok") insertTable(Math.max(1, Math.min(20, Number(form.r.value) || 3)), Math.max(1, Math.min(10, Number(form.c.value) || 3)));
        return;
      }
      case "video": case "audio": {
        const { addMediaDialog } = await import("./av.js");
        return addMediaDialog({ root, kind: act, model, store, media, sid: st.slide, deps, toast, onAdded: (id) => { renderStage(); select([id]); } });
      }
      case "shape-menu":
        return popover(root, anchor, SHAPE_GROUPS.map((g) => `<div class="sl-pop-label">${esc(g.name)}</div><div class="sl-shapes">${g.shapes.map((id) => `<button type="button" class="sl-shape-btn" data-shape="${id}" title="${esc(SHAPES[id].name)}" aria-label="${esc(SHAPES[id].name)}">${shapeIcon(id)}</button>`).join("")}</div>`).join(""), { className: "sl-shape-pop", onClick: (b) => { if (b.dataset.shape) insertShape(b.dataset.shape); } });
      case "line-menu":
        return popover(root, anchor, menuHtml([{ label: "Line", act: "line", arg: "straight" }, { label: "Arrow", act: "line", arg: "arrow" }, { label: "Elbow connector", act: "line", arg: "elbow" }, { label: "Curved connector", act: "line", arg: "curve" }]), { onClick: (b) => setTool({ kind: "line", arrow: b.dataset.arg === "arrow", lineKind: ["elbow", "curve"].includes(b.dataset.arg) ? b.dataset.arg : "straight" }) });
      case "insert-menu":
        return popover(root, anchor, menuHtml([{ label: "Text box", act: "tool-text" }, { label: "Photo or picture", act: "image" }, { label: "Take a photo", act: "camera" }, { label: "Shape", act: "shape-menu" }, { label: "Line or arrow", act: "line-menu" }, { label: "Table", act: "table" }, { label: "Video", act: "video" }, { label: "Audio", act: "audio" }, { sep: true }, { label: "New slide", act: "new-slide" }]), { onClick: (b) => { setTimeout(() => runAct(b.dataset.act, b.dataset.arg, $("[data-act=insert-menu]")), 0); } });
      case "fill-color": return colorPicker(root, anchor, { theme: model.theme(), current: selItems()[0]?.fill, onPick: (c) => setItems({ fill: c || "none" }) });
      case "stroke-color": return colorPicker(root, anchor, { theme: model.theme(), current: selItems()[0]?.stroke, onPick: (c) => setItems(c ? { stroke: c, sw: selItems()[0]?.sw || 2 } : { stroke: null, sw: 0 }) });
      case "stroke-weight": return popover(root, anchor, menuHtml([1, 2, 3, 4, 6, 8, 12, 16, 24].map((w) => ({ label: `${w} px`, act: "sw", arg: w, on: selItems()[0]?.sw === w }))), { onClick: (b) => setItems({ sw: Number(b.dataset.arg), ...(selItems()[0]?.stroke ? {} : { stroke: "@dk1" }) }) });
      case "stroke-dash": return popover(root, anchor, menuHtml([["solid", "Solid"], ["dot", "Dotted"], ["dash", "Dashed"], ["long-dash", "Long dash"], ["dash-dot", "Dash dot"]].map(([v, l]) => ({ label: l, act: "dash", arg: v }))), { onClick: (b) => setItems({ dash: b.dataset.arg === "solid" ? null : b.dataset.arg }) });
      case "text-color": return colorPicker(root, anchor, { theme: model.theme(), current: ed ? ed.getAttributes("textStyle").color : selItems()[0]?.color, allowNone: false, roles: true, onPick: (c) => applyText({ color: c }) });
      case "highlight": return colorPicker(root, anchor, { theme: model.theme(), roles: false, onPick: (c) => { const ch = ed?.chain().focus(); if (!ch) return; if (c) ch.setHighlight({ color: resolveColor(c, model.theme()) }).run(); else ch.unsetHighlight().run(); } });
      case "link": {
        if (!ed) return;
        const cur = ed.getAttributes("link").href || "";
        const v = await promptText(root, "Link", { value: cur, label: "Web address", placeholder: "https://" });
        if (v === null) return;
        const href = v.trim() && !/^[a-z]+:/i.test(v.trim()) ? `https://${v.trim()}` : v.trim();
        if (!href) ed.chain().focus().unsetLink().run(); else ed.chain().focus().extendMarkRange("link").setLink({ href }).run();
        return;
      }
      case "size-up": case "size-dn": {
        const cur = Number($("[data-tb=size]")?.value) || 18;
        const list = [...FONT_SIZES, 120, 144, 200];
        const n = act === "size-up" ? list.find((x) => x > cur) || cur + 12 : [...list].reverse().find((x) => x < cur) || Math.max(1, cur - 1);
        return applyText({ size: n });
      }
      case "bold": case "italic": case "underline": return toggleMark(act);
      case "align-menu": return popover(root, anchor, menuHtml([["left", "Left"], ["center", "Centre"], ["right", "Right"], ["justify", "Justified"]].map(([v, l]) => ({ label: l, act: "text-align", arg: v }))), { onClick: (b) => alignText(b.dataset.arg) });
      case "text-align": return alignText(arg);
      case "valign-menu": return popover(root, anchor, menuHtml([["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]].map(([v, l]) => ({ label: l, act: "valign", arg: v, on: (selItems()[0]?.valign || "top") === v }))), { onClick: (b) => setItems({ valign: b.dataset.arg }) });
      case "spacing-menu": return popover(root, anchor, menuHtml([1, 1.15, 1.5, 2].map((v) => ({ label: v === 1 ? "Single" : v === 2 ? "Double" : String(v), act: "lh", arg: v, on: (selItems()[0]?.lineH || 1.2) === v }))), { onClick: (b) => { if (ed) ed.chain().focus().setLineHeight(Number(b.dataset.arg)).run(); else setItems({ lineH: Number(b.dataset.arg) }); } });
      case "bullets": case "numbers": {
        if (!ed && st.sel.length === 1) { startEditingText(st.sel[0]); await new Promise((r) => requestAnimationFrame(r)); st.editing?.editor.commands.selectAll(); }
        const e2 = st.editing?.editor;
        if (e2) e2.chain().focus()[act === "bullets" ? "toggleBulletList" : "toggleOrderedList"]().run();
        return;
      }
      case "indent-less": return ed?.chain().focus().indentLess().run();
      case "indent-more": return ed?.chain().focus().indentMore().run();
      case "clear-format": return ed?.chain().focus().clearFormatting().run();
      case "autofit": { const one = selItems()[0]; if (one) setItems({ autofit: one.autofit === "shrink" ? null : "shrink" }); return; }
      case "arrange-menu": return popover(root, anchor, menuHtml(menuItems("arrange")), { onClick: (b) => runAct(b.dataset.act, b.dataset.arg) });
      case "restack": model.restack(st.slide, st.sel, arg); return renderStage();
      case "align": return alignSel(arg);
      case "distribute": return distribute(arg);
      case "group": model.group(st.slide, st.sel); return renderStage();
      case "ungroup": model.ungroup(st.slide, st.sel); return renderStage();
      case "lock": { const on = !selItems()[0]?.lock; return setItems({ lock: on || null }); }
      case "rot90": model.transact(() => selItems().forEach((it) => model.updateItems(st.slide, [it.id], { rot: ((it.rot || 0) + 90) % 360 }))); return renderStage();
      case "flip": model.transact(() => selItems().forEach((it) => model.updateItems(st.slide, [it.id], arg === "h" ? { flipH: it.flipH ? null : true } : { flipV: it.flipV ? null : true }))); return renderStage();
      case "crop": return panels.open("format");
      case "panel": return panels.open(arg);
      case "dup-slide": { const ids = model.duplicateSlides(st.slideSel.length ? st.slideSel : [st.slide]); film.refresh(); return goSlide(ids[ids.length - 1]); }
      case "del-slide": return deleteSlides(st.slideSel.length ? st.slideSel : [st.slide]);
      case "skip-slide": { const on = !model.slide(st.slide)?.skip; model.setSlide(st.slideSel.length ? st.slideSel : [st.slide], { skip: on }); return film.refresh(); }
      case "section": {
        const v = await promptText(root, "Section", { value: model.slide(st.slide)?.section || "", label: "Section name (shown in the filmstrip)" });
        if (v !== null) { model.setSlide(st.slide, { section: v.trim().slice(0, 200) || null }); film.refresh(); }
        return;
      }
      case "section-off": model.setSlide(st.slide, { section: null }); return film.refresh();
      case "move-first": model.moveSlides(st.slideSel.length ? st.slideSel : [st.slide], 0); return film.refresh();
      case "move-last": model.moveSlides(st.slideSel.length ? st.slideSel : [st.slide], model.slideIds().length); return film.refresh();
      case "next": return step(1);
      case "prev": return step(-1);
      case "rename": { const inp = $(".sl-title input"); inp.focus(); inp.select(); return; }
      case "page-setup": return pageSetup();
      case "name-version": {
        const v = await promptText(root, "Name this version", { label: "Name", placeholder: "e.g. Final for Sunday" });
        if (v?.trim()) { await session.snapshot(v.trim()); toast("Version named."); }
        return;
      }
      case "start-edit": return setViewing(false);
      case "phone-menu": return phoneMenu(anchor);
      default: return undefined;
    }
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.closest(".sl-pop") || b.closest(".sl-panel") || b.closest(".sl-sheet") || b.closest(".wp-dialog")) return;
    runAct(b.dataset.act, b.dataset.arg, b);
  });

  function phoneMenu(anchor) {
    popover(root, anchor, menuHtml([
      ...(st.viewing ? [{ label: "Edit", act: "start-edit" }] : [{ label: "Done editing", act: "stop-edit" }]),
      { label: "Present", act: "present" },
      { label: "Speaker notes", act: "panel", arg: "notes" },
      { sep: true },
      ...(st.viewing ? [] : [
        { label: "Theme", act: "panel", arg: "theme" },
        { label: "Layout", act: "panel", arg: "layout" },
        { label: "Background", act: "panel", arg: "background" },
        { label: "Transition", act: "panel", arg: "transition" },
        { label: "Animations", act: "panel", arg: "animate" },
        { sep: true },
      ]),
      { label: "Find and replace", act: "find" },
      { label: "Comments", act: "panel", arg: "comments" },
      { label: "Version history", act: "panel", arg: "versions" },
      { label: "Page setup", act: "page-setup" },
    ]), { onClick: (b) => { if (b.dataset.act === "stop-edit") setViewing(true); else runAct(b.dataset.act, b.dataset.arg, anchor); } });
  }

  function setViewing(v) {
    st.viewing = v;
    root.classList.toggle("is-viewing", v);
    stopEditingText();
    if (v) clearSelection();
    notesEditor?.setEditable(!v);
    renderStage();
    updateToolbar();
  }

  async function pageSetup() {
    const [W, H] = model.size();
    const cur = model.meta.get("size") || "16:9";
    const { value, form } = await openDialog(root, {
      title: "Page setup",
      body: `<label>Slide size<select name="size">${Object.keys(SIZES).map((k) => `<option value="${k}"${cur === k ? " selected" : ""}>${{ "16:9": "Widescreen 16:9", "4:3": "Standard 4:3", "16:10": "Widescreen 16:10", "1:1": "Square" }[k]}</option>`).join("")}<option value="custom"${cur === "custom" ? " selected" : ""}>Custom</option></select></label>
        <div class="wp-row"><label>Width (px)<input type="number" name="w" min="200" max="4000" value="${W}"></label><label>Height (px)<input type="number" name="h" min="200" max="4000" value="${H}"></label></div>`,
      actions: [{ label: "Cancel", value: null }, { label: "Apply", value: "ok", primary: true }],
    });
    if (value !== "ok") return;
    if (form.size.value === "custom") model.setSize("custom", Math.round(Number(form.w.value)), Math.round(Number(form.h.value)));
    else model.setSize(form.size.value);
    invalidateAll(); layoutStage(); renderStage();
  }

  // ---- find and replace -------------------------------------------------------------------------
  const findBox = $("[data-find]");
  function toggleFind(on) {
    findBox.hidden = !on;
    if (on) $("[data-find-q]").focus();
  }
  function* textNodes() {
    for (const sid of model.slideIds()) {
      for (const it of model.items(sid)) { const fr = model.text(sid, it.id); if (fr) yield { sid, iid: it.id, fr }; }
      const nf = model.notes(sid); if (nf) yield { sid, iid: null, fr: nf };
    }
  }
  function matcher() {
    const q = $("[data-find-q]").value;
    if (!q) return null;
    const flags = $("[data-find-case]").checked ? "g" : "gi";
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }
  let findAt = -1;
  function findNext() {
    const re = matcher();
    if (!re) return;
    const hits = [];
    for (const n of textNodes()) { const walk = (x) => { if (x instanceof Y.XmlText) { const s = x.toString().replace(/<[^>]*>/g, ""); if (s.match(re)) hits.push(n); } else x.toArray?.().forEach(walk); }; walk(n.fr); }
    const uniq = hits.filter((h, i) => hits.findIndex((o) => o.sid === h.sid && o.iid === h.iid) === i);
    $("[data-find-count]").textContent = uniq.length ? `${Math.min(findAt + 2, uniq.length)} of ${uniq.length}` : "No results";
    if (!uniq.length) return;
    findAt = (findAt + 1) % uniq.length;
    const h = uniq[findAt];
    goSlide(h.sid);
    if (h.iid) select([h.iid]);
  }
  function replaceAll() {
    const re = matcher();
    if (!re || !editingAllowed()) return;
    const to = $("[data-find-r]").value;
    let count = 0;
    stopEditingText();
    model.transact(() => {
      for (const n of textNodes()) {
        const walk = (x) => {
          if (x instanceof Y.XmlText) {
            const delta = x.toDelta();
            let at = 0;
            const edits = [];
            for (const op of delta) {
              if (typeof op.insert === "string") {
                let m;
                const r2 = new RegExp(re.source, re.flags);
                while ((m = r2.exec(op.insert))) { edits.push({ at: at + m.index, len: m[0].length, attrs: op.attributes }); if (!m[0].length) r2.lastIndex++; }
                at += op.insert.length;
              } else at += 1;
            }
            for (const ed of edits.reverse()) { x.delete(ed.at, ed.len); x.insert(ed.at, to, ed.attrs || {}); count++; }
          } else x.toArray?.().forEach(walk);
        };
        walk(n.fr);
      }
    });
    $("[data-find-count]").textContent = `${count} replaced`;
    renderStage(); invalidateAll(); mountNotes();
  }
  $("[data-find-q]").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } });
  $("[data-find-q]").addEventListener("input", () => { findAt = -1; $("[data-find-count]").textContent = ""; });

  // ---- the side panels -----------------------------------------------------------------------------
  const panels = createPanels({
    box: $("[data-panel]"), sheet: $("[data-sheet]"), root,
    app: {
      model, session, store, me, deps, media, toast,
      get slide() { return st.slide; }, get sel() { return st.sel; }, get slideSel() { return st.slideSel; }, selItems, phone: isPhone,
      setItems, renderStage: () => { renderStage(); }, invalidateAll, film: () => film, goSlide,
      pickImages, storeImage, editingAllowed, people: () => deps.people || [],
      onClose: () => layoutStage(),
      onOpen: () => layoutStage(),
    },
  });

  // ---- presenting ------------------------------------------------------------------------------
  let presenting = null;
  async function present({ fromStart = false } = {}) {
    if (presenting) return;
    stopEditingText();
    closePopover();
    const { startPresenting } = await import("./present.js");
    const ids = model.slideIds();
    presenting = startPresenting({
      model, media, session, me, deps, host,
      start: fromStart ? 0 : Math.max(0, ids.indexOf(st.slide)),
      name: currentName(),
      onEnd: (lastId) => { presenting = null; if (lastId && model.slide(lastId)) goSlide(lastId); root.focus?.(); },
    });
  }

  // ---- status, people, name ----------------------------------------------------------------------
  function showStatus(s) {
    statusEl.classList.toggle("is-error", s.status === "error");
    statusEl.textContent = s.status === "saving" ? "Saving…" : s.status === "unsaved" ? "Unsaved changes" : s.status === "offline" ? "Offline — saved on this device" : s.status === "error" ? (s.error || "Couldn't save") : s.status === "saved" ? "Saved" : "";
    $("[data-people]").innerHTML = (s.peers || []).filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i).map((p) => `<span class="sl-person" style="background:${safeColor(p.color) || "#888"}" title="${esc(p.name)}">${esc(String(p.name || "?").slice(0, 1).toUpperCase())}</span>`).join("");
  }
  const unsub = session.subscribe(showStatus);
  const nameInput = $(".sl-title input");
  const currentName = () => nameInput.value.trim() || "Untitled presentation";
  nameInput.addEventListener("change", async () => {
    const n = currentName();
    try { await store.rename(n); deps.rename?.(n); } catch { toast("Couldn't rename it."); }
  });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); } });

  // ---- remote edits ------------------------------------------------------------------------------
  let remoteTimer = 0;
  function remoteChanged() {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => {
      if (model.tidy()) film.refresh();
      if (!model.slide(st.slide)) { const ids = model.slideIds(); goSlide(ids[0]); }
      scheduleStage();
      panels.refresh({ soft: true });
    }, 60);
  }
  // any change: the filmstrip learns which slides changed
  const slidesMap = ydoc.getMap("slides");
  const onDeep = (events) => {
    const touched = new Set();
    for (const ev of events) {
      if (ev.target === slidesMap) ev.changes.keys.forEach((_, k) => touched.add(k));
      else if (ev.path.length) touched.add(ev.path[0]);
    }
    film.invalidate([...touched]);
    if (touched.has(st.slide) && !st.editing) scheduleStage();
  };
  slidesMap.observeDeep(onDeep);
  const onMeta = () => { invalidateAll(); scheduleStage(); };
  ydoc.getMap("meta").observe(onMeta);
  const onOrder = () => film.refresh();
  ydoc.getArray("order").observe(onOrder);

  // ---- layout ------------------------------------------------------------------------------------
  const ro = new ResizeObserver(() => { root.classList.toggle("is-phone", isPhone()); layoutStage(); });
  ro.observe(stageWrap);
  stage.addEventListener("focusin", () => { if (!st.editing) st.focus = "stage"; });
  $("[data-film]").addEventListener("focusin", () => { st.focus = "film"; });

  layoutStage();
  renderStage();
  film.refresh();
  mountNotes();
  updateToolbar();

  // ---- closing -------------------------------------------------------------------------------------
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    stopEditingText();
    notesEditor?.destroy();
    presenting?.end?.();
    closePopover();
    panels.close();
    ro.disconnect();
    slidesMap.unobserveDeep(onDeep);
    ydoc.getMap("meta").unobserve(onMeta);
    ydoc.getArray("order").unobserve(onOrder);
    unsub();
    ydoc.off("beforeTransaction", onBefore);
    document.removeEventListener("keydown", onDocKey);
    undo.destroy();
    statusEl.textContent = "Saving…";
    try { await session.close(); } catch { /* kept on the device */ }
    media.close();
    root.remove();
    onClose?.({ name: currentName() });
  }

  // for checks (scripts/qa-slides.mjs)
  root.__slides = { model, session, st, select, goSlide, startEditingText, stopEditingText, runAct, renderStage, film: () => film, panels, undo, present, setViewing };
  return { close };
}

void boxStyle; void textStyle; void THEMES; void LAYOUTS; void layoutFor;
