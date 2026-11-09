// The word processor (WORD_PROCESSOR_DESIGN.md §13). Opens one document full screen
// over the Document page: Docs-style menus and toolbar on a laptop, a reading view
// with a pencil and a keyboard toolbar on the phone (most-used buttons on the right).
//
// openDocEditor({ store, file, me, people, deps, host?, onClose? }) → { close() }
//   store: documents/editor/store-everyday.js (or the Safe's)
//   file: { id, name, scope }   me: { id, name }   people: [{ id, name }] (the household)
//   deps: { liveOpen?, chipSource?(q), openChip?(kind, id), chipGone?(kind, id), toast?,
//           isNative?, share?(blob, name, mime), nativePdf?(), notifyMention?(ids, text, docName),
//           rename?(name) }
//
// Loaded lazily (page.js imports it when a document opens), with its own CSS.

import "./editor.css";
import "katex/dist/katex.min.css";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { DOMSerializer } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { baseExtensions, LINE_HEIGHTS, ORDERED_STYLES, BULLET_STYLES, IMAGE_LAYOUTS, safeColor } from "./extensions.js";
import { FONTS, FONT_SIZES, DEFAULT_FONT, DEFAULT_SIZE, ensureFont, fontsInJson, findFont } from "./fonts.js";
import { Suggesting } from "./suggest.js";
import { Pages, PX_PER_IN, PAGE_GAP } from "./pages.js";
import { imageNodeView, tocNodeView, chipNodeView, dateSuggestions, Endnotes, FindReplace, findKey, atTrigger, headings } from "./nodeviews.js";
import { createDocSession } from "./session.js";
import { createDocCache } from "./cache.js";
import { readSettings, writeSettings, pageBox, PAGE_SIZES, nodeText, countWords } from "./doc-model.js";
import { commentsPanel, versionsPanel, renderOutline, openDialog, promptText, esc, highlightActive } from "./panels.js";
import { colorFor } from "./live.js";
import { IC } from "./icons.js";

const COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79",
  "#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130",
];
const SPECIAL = "€£¥¢©®™°±×÷≠≤≥≈∞µπΩ∑√∫∂∆←→↑↓↔⇒⇔•·…–—‘’“”«»§¶†‡‰′″½⅓⅔¼¾✓✗★☆♥♦♣♠☐☑☒→⟶✔✘☺☹👍👎🙂😀😂😍🎉🔥💡📌📎📅✅❌⚠️❗❓";
const STYLE_OPTIONS = [["normal", "Normal text"], ["title", "Title"], ["subtitle", "Subtitle"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["h4", "Heading 4"], ["h5", "Heading 5"], ["h6", "Heading 6"]];
const MAX_IMAGE_PX = 2400;

const isPhone = () => window.matchMedia("(max-width: 760px)").matches;
const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function openDocEditor({ store, file, me, people = [], deps = {}, host = document.body, onClose = null, startEditing = false }) {
  const root = document.createElement("div");
  root.className = "wp-root";
  root.innerHTML = `
    <header class="wp-top">
      <button type="button" class="wp-back" data-act="close" aria-label="Back to Document">${IC.back}</button>
      <div class="wp-title"><input type="text" data-no-clear aria-label="Document name" maxlength="200" value="${esc(file.name)}"><span class="wp-status" role="status">Opening…</span></div>
      <div class="wp-people" data-people></div>
      <select class="wp-mode" data-mode aria-label="Mode"><option value="editing">Editing</option><option value="suggesting">Suggesting</option><option value="viewing">Viewing</option></select>
      <button type="button" class="wp-icon" data-act="comments" title="Comments" aria-label="Comments">${IC.comment}</button>
      <button type="button" class="wp-icon" data-act="phone-menu" title="More" aria-label="More">${IC.more}</button>
    </header>
    <nav class="wp-menubar" data-menubar>
      ${["File", "Edit", "View", "Insert", "Format", "Tools"].map((m) => `<button type="button" data-menu="${m.toLowerCase()}">${m}</button>`).join("")}
    </nav>
    <div class="wp-toolbar" data-toolbar role="toolbar" aria-label="Formatting"></div>
    <div class="wp-find" data-find hidden>
      <input type="search" data-find-q placeholder="Find in document" aria-label="Find">
      <span class="wp-count" data-find-count></span>
      <button type="button" class="wp-icon" data-act="find-prev" aria-label="Previous">↑</button>
      <button type="button" class="wp-icon" data-act="find-next" aria-label="Next">↓</button>
      <input type="text" data-find-r placeholder="Replace with" aria-label="Replace with">
      <button type="button" class="secondary-btn" data-act="replace-one">Replace</button>
      <button type="button" class="secondary-btn" data-act="replace-all">Replace all</button>
      <label><input type="checkbox" data-find-case> Match case</label>
      <label><input type="checkbox" data-find-re> Regular expression</label>
      <button type="button" class="wp-icon" data-act="find-close" aria-label="Close find">${IC.close}</button>
    </div>
    <div class="wp-body">
      <aside class="wp-side is-left" data-side="outline" hidden><div class="wp-side-head">Outline<button type="button" class="wp-icon" data-act="side-close" aria-label="Close">${IC.close}</button></div><div class="wp-side-body" data-outline></div></aside>
      <div class="wp-canvas" data-canvas>
        <div class="wp-preview-bar" data-preview hidden></div>
        <div class="wp-sheet" data-sheet><div class="wp-pages" data-pages></div><div class="wp-doc" data-doc></div></div>
        <div class="wp-sheet" data-preview-sheet hidden><div class="wp-doc"><div class="ProseMirror" data-preview-body></div></div></div>
        <button type="button" class="wp-fab wp-phone-only" data-act="start-edit" aria-label="Edit" hidden>${IC.pencil}</button>
      </div>
      <aside class="wp-side" data-side="comments" hidden><div class="wp-side-head">Comments<button type="button" class="wp-icon" data-act="side-close" aria-label="Close">${IC.close}</button></div><div class="wp-side-body" data-comments></div></aside>
      <aside class="wp-side" data-side="versions" hidden><div class="wp-side-head">Version history<button type="button" class="wp-icon" data-act="side-close" aria-label="Close">${IC.close}</button></div><div class="wp-side-body" data-versions></div></aside>
      <div class="wp-sheetpanel" data-sheetpanel hidden></div>
    </div>
    <div class="wp-foot" data-foot hidden></div>
    <div class="wp-kbbar" data-kbbar hidden>
      <button type="button" class="wp-icon" data-cmd="undo" aria-label="Undo">${IC.undo}</button>
      <button type="button" class="wp-icon" data-cmd="redo" aria-label="Redo">${IC.redo}</button>
      <span class="wp-spacer"></span>
      <button type="button" class="wp-icon" data-cmd="comment" aria-label="Comment">${IC.comment}</button>
      <button type="button" class="wp-icon" data-act="sheet-insert" aria-label="Insert">${IC.plus}</button>
      <button type="button" class="wp-icon" data-act="sheet-format" aria-label="Format">${IC.letterA}</button>
      <button type="button" class="wp-icon" data-act="done-edit" aria-label="Done">${IC.check}</button>
    </div>
    <div class="wp-bubble" data-bubble hidden></div>`;
  host.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const statusEl = $(".wp-status");
  const canvas = $("[data-canvas]");
  const sheet = $("[data-sheet]");
  const pagesLayer = $("[data-pages]");
  const docEl = $("[data-doc]");
  const bubble = $("[data-bubble]");
  const toast = (m) => deps.toast?.(m);

  // ---- the session (data) -------------------------------------------------------------------
  const imageUrls = new Map();
  const resolveImage = async (src) => {
    const id = String(src).slice("liveimg:".length);
    if (imageUrls.has(id)) return imageUrls.get(id);
    const p = store.images.get(id).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: sniffImage(bytes) })));
    imageUrls.set(id, p);
    try { return await p; } catch (e) { imageUrls.delete(id); throw e; }
  };
  let pageCount = 1;
  const session = createDocSession({
    store, me,
    liveOpen: deps.liveOpen || null,
    cache: createDocCache(`${file.scope}/${file.id}`, store.cacheSeal || {}),
    getText: () => ({ text: editor ? nodeText(editor.state.doc) : "", pages: pageCount }),
  });
  try { await session.ready; } catch (e) {
    statusEl.textContent = e?.message || "This document couldn't be opened.";
    statusEl.classList.add("is-error");
    $("[data-act=close]").addEventListener("click", () => { root.remove(); onClose?.({}); });
    return { close: () => root.remove() };
  }

  // ---- the editor --------------------------------------------------------------------------
  let mode = "editing";
  let settings = readSettings(session.ydoc);
  let paint = null; // marks copied by paint format
  let comments = null;
  let versions = null;
  let lastLayout = null;
  const editingAllowed = () => mode !== "viewing" && !previewing;
  let previewing = false;
  let phoneEditing = startEditing;

  // On the phone, documents open reflowed to the screen (as Docs' app, with Print
  // layout off); Print layout in ⋯ shows the pages. A setting of this device only.
  const PHONE_PRINT_KEY = "live-wp-phone-print-layout";
  let phonePrint = (() => { try { return localStorage.getItem(PHONE_PRINT_KEY) === "1"; } catch { return false; } })();
  const showPages = () => !settings.pageless && (!isPhone() || phonePrint);
  const getPageOf = (pos) => {
    if (!showPages() || !lastLayout || !editor) return "";
    try {
      const c = editor.view.coordsAtPos(pos);
      const top = docEl.getBoundingClientRect().top;
      const scale = sheetScale();
      return Math.floor(((c.top - top) / scale) / lastLayout.stride) + settings.pageNumberStart;
    } catch { return ""; }
  };

  const editor = new Editor({
    element: docEl,
    editable: false,
    extensions: [
      ...baseExtensions({
        collaboration: true,
        placeholder: "Type @ to insert people, dates, recipes and more",
        resolveImage,
        nodeViews: { image: imageNodeView(resolveImage), tableOfContents: tocNodeView(getPageOf), smartChip: chipNodeView(deps.chipGone) },
        onMathClick: (node, pos, kind) => editEquation(node, pos, kind),
      }),
      Collaboration.configure({ document: session.ydoc, field: "default" }),
      CollaborationCaret.configure({
        provider: { awareness: session.awareness },
        user: { name: me.name, color: colorFor(me.id) },
        render: (u) => {
          const c = document.createElement("span");
          c.className = "collaboration-carets__caret";
          c.style.borderColor = safeColor(u.color) || "#888";
          const l = document.createElement("span");
          l.className = "collaboration-carets__label";
          l.style.backgroundColor = safeColor(u.color) || "#888";
          l.textContent = String(u.name || "").slice(0, 40);
          c.appendChild(l);
          return c;
        },
      }),
      Suggesting,
      Pages.configure({ getGeometry: () => geometry(), onLayout: (l) => drawPages(l) }),
      Endnotes, FindReplace,
      atTrigger({ onOpen: (r) => chipMenu.open(r), onQuery: (q, r) => chipMenu.query(q, r), onClose: () => chipMenu.close() }),
    ],
    editorProps: {
      attributes: { spellcheck: "true", "aria-label": "Document", autocapitalize: "sentences" },
      handleDOMEvents: {
        click: (view, e) => {
          const chip = e.target.closest?.(".doc-chip");
          if (chip && (!view.editable || e.metaKey || e.ctrlKey || isPhone())) { deps.openChip?.(chip.dataset.kind, chip.dataset.ref); return true; }
          const fn = e.target.closest?.("sup.doc-footnote-ref");
          if (fn) { editFootnoteAt(view.posAtDOM(fn, 0)); return true; }
          const cm = e.target.closest?.(".doc-comment");
          if (cm && comments) { openSide("comments"); comments.focus(cm.dataset.commentId); highlightActive(editor, cm.dataset.commentId); }
          const a = e.target.closest?.("a[href]");
          if (a && (!view.editable || e.metaKey || e.ctrlKey)) { followLink(a.getAttribute("href")); return true; }
          return false;
        },
      },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        insertImages(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        insertImages(files);
        return true;
      },
    },
  });
  editor.storage.suggesting.user = { id: me.id, name: me.name };
  for (const f of fontsInJson(editor.getJSON())) ensureFont(f);

  // ---- modes ----------------------------------------------------------------------------------
  function setMode(m) {
    mode = m;
    editor.storage.suggesting.enabled = m === "suggesting";
    applyEditable();
    $("[data-mode]").value = m;
    drawToolbar();
  }
  function applyEditable() {
    const can = editingAllowed() && (!isPhone() || phoneEditing);
    editor.setEditable(can, false);
    $("[data-act=start-edit]").hidden = !isPhone() || phoneEditing || !editingAllowed();
    $("[data-kbbar]").hidden = !isPhone() || !phoneEditing || !editingAllowed();
  }

  // ---- page geometry and the page layer ----------------------------------------------------------
  function geometry() {
    if (!showPages()) return null;
    const box = pageBox(settings);
    return { pageW: box.w * PX_PER_IN, pageH: box.h * PX_PER_IN, mt: settings.marginTop * PX_PER_IN, mb: settings.marginBottom * PX_PER_IN, ml: settings.marginLeft * PX_PER_IN, mr: settings.marginRight * PX_PER_IN };
  }
  function sheetScale() {
    const z = Number.parseFloat(sheet.style.zoom || "1");
    return Number.isFinite(z) && z > 0 ? z : 1;
  }
  function applySheet() {
    root.classList.toggle("is-pageless", !showPages());
    const pm = editor.view.dom;
    const geo = geometry();
    if (!geo) {
      sheet.style.width = ""; sheet.style.zoom = ""; sheet.style.height = "";
      pm.style.padding = ""; pm.style.minHeight = "";
      pagesLayer.replaceChildren();
      $("[data-foot]").hidden = !settings.showWordCount;
      return;
    }
    sheet.style.width = `${geo.pageW}px`;
    const avail = canvas.clientWidth - (isPhone() ? 12 : 40);
    sheet.style.zoom = avail > 0 && avail < geo.pageW ? String(Math.max(0.3, avail / geo.pageW)) : "";
    pm.style.padding = `${geo.mt}px ${geo.mr}px ${geo.mb}px ${geo.ml}px`;
    $("[data-foot]").hidden = !settings.showWordCount;
  }

  // Headers and footers as HTML (rendered through the schema), cached until they change.
  let hfHtml = null;
  const fragHtml = (name) => {
    const frag = session.ydoc.getXmlFragment(name);
    if (!frag.length) return "";
    try {
      const node = yXmlFragmentToProseMirrorRootNode(frag, editor.schema);
      const div = document.createElement("div");
      div.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content));
      return div.innerHTML;
    } catch { return ""; }
  };
  for (const name of ["header", "footer", "headerFirst", "footerFirst"]) session.ydoc.getXmlFragment(name).observeDeep(() => { hfHtml = null; if (lastLayout) drawPages(lastLayout); });

  function drawPages(layout) {
    lastLayout = layout;
    if (!layout) { pagesLayer.replaceChildren(); return; }
    const { pages, geo, stride } = layout;
    pageCount = pages;
    hfHtml ||= { header: fragHtml("header"), footer: fragHtml("footer"), headerFirst: fragHtml("headerFirst"), footerFirst: fragHtml("footerFirst") };
    const total = pages * stride - PAGE_GAP;
    sheet.style.height = `${total}px`;
    editor.view.dom.style.minHeight = `${total}px`;
    const frag = document.createDocumentFragment();
    const hfTop = Math.min(0.5 * PX_PER_IN, geo.mt * 0.6);
    for (let i = 0; i < pages; i++) {
      const page = document.createElement("div");
      page.className = "wp-page";
      page.style.top = `${i * stride}px`;
      page.style.height = `${geo.pageH}px`;
      page.style.background = settings.pageColor;
      if (settings.headerFooter || hfHtml.header || hfHtml.footer) {
        const first = i === 0 && settings.differentFirst;
        const h = document.createElement("div");
        h.className = "wp-page-header";
        h.dataset.hf = first ? "headerFirst" : "header";
        h.dataset.placeholder = "Header";
        Object.assign(h.style, { top: `${hfTop}px`, left: `${geo.ml}px`, right: `${geo.mr}px`, maxHeight: `${Math.max(16, geo.mt - hfTop - 4)}px` });
        h.innerHTML = first ? hfHtml.headerFirst : hfHtml.header;
        const f = document.createElement("div");
        f.className = "wp-page-footer";
        f.dataset.hf = first ? "footerFirst" : "footer";
        f.dataset.placeholder = "Footer";
        Object.assign(f.style, { bottom: `${hfTop}px`, left: `${geo.ml}px`, right: `${geo.mr}px`, maxHeight: `${Math.max(16, geo.mb - hfTop - 4)}px` });
        f.innerHTML = first ? hfHtml.footerFirst : hfHtml.footer;
        for (const el of [h, f]) {
          for (const n of el.querySelectorAll("[data-page-number]")) n.textContent = String(n.dataset.pageNumber === "total" ? pages : i + settings.pageNumberStart);
          for (const img of el.querySelectorAll("img[data-src]")) resolveImage(img.dataset.src).then((u) => { img.src = u; }).catch(() => {});
        }
        page.append(h, f);
      }
      frag.appendChild(page);
    }
    pagesLayer.replaceChildren(frag);
    updateFoot();
  }
  pagesLayer.addEventListener("dblclick", (e) => { const hf = e.target.closest("[data-hf]"); if (hf) editHeaderFooter(hf.dataset.hf); });
  pagesLayer.addEventListener("click", (e) => { const hf = e.target.closest("[data-hf]"); if (hf && (isPhone() || !hf.textContent.trim())) editHeaderFooter(hf.dataset.hf); });

  session.ydoc.getMap("settings").observe(() => {
    settings = readSettings(session.ydoc);
    applySheet();
    editor.view.__relayout?.();
    drawToolbar();
  });
  const onResize = () => { applySheet(); applyEditable(); editor.view.__relayout?.(); };
  window.addEventListener("resize", onResize);

  // ---- status and people ---------------------------------------------------------------------
  const unsub = session.subscribe((s) => {
    const label = { loading: "Opening…", saving: "Saving…", saved: "All changes saved", unsaved: "Saving soon…", offline: "Offline — changes kept on this device", error: s.error || "Couldn't save" }[s.status] || "";
    statusEl.textContent = mode === "viewing" ? `Viewing · ${label}` : label;
    statusEl.classList.toggle("is-error", s.status === "error");
    const ppl = $("[data-people]");
    const seen = new Set();
    ppl.innerHTML = s.peers.filter((p) => (seen.has(p.id) ? false : seen.add(p.id))).map((p) => `<span class="wp-person" style="background:${safeColor(p.color) || "#888"}" title="${esc(p.name || "Someone")} is here">${esc(String(p.name || "?").trim()[0] || "?").toUpperCase()}</span>`).join("");
  });

  // ---- commands --------------------------------------------------------------------------------
  const chain = () => editor.chain().focus();
  const attrsOf = (name) => editor.getAttributes(name);
  const C = {
    undo: { label: "Undo", key: "⌘Z", run: () => chain().undo().run() },
    redo: { label: "Redo", key: "⌘⇧Z", run: () => chain().redo().run() },
    bold: { label: "Bold", key: "⌘B", run: () => chain().toggleBold().run(), active: () => editor.isActive("bold") },
    italic: { label: "Italic", key: "⌘I", run: () => chain().toggleItalic().run(), active: () => editor.isActive("italic") },
    underline: { label: "Underline", key: "⌘U", run: () => chain().toggleUnderline().run(), active: () => editor.isActive("underline") },
    strike: { label: "Strikethrough", key: "⌘⇧X", run: () => chain().toggleStrike().run(), active: () => editor.isActive("strike") },
    superscript: { label: "Superscript", key: "⌘.", run: () => chain().toggleSuperscript().run(), active: () => editor.isActive("superscript") },
    subscript: { label: "Subscript", key: "⌘,", run: () => chain().toggleSubscript().run(), active: () => editor.isActive("subscript") },
    code: { label: "Code", run: () => chain().toggleCode().run(), active: () => editor.isActive("code") },
    sizeUp: { label: "Increase font size", key: "⌘⇧.", run: () => setSize(nextSize(currentSize(), 1)) },
    sizeDown: { label: "Decrease font size", key: "⌘⇧,", run: () => setSize(nextSize(currentSize(), -1)) },
    lower: { label: "lowercase", run: () => chain().changeCase("lower").run() },
    upper: { label: "UPPERCASE", run: () => chain().changeCase("upper").run() },
    title: { label: "Title Case", run: () => chain().changeCase("title").run() },
    clear: { label: "Clear formatting", key: "⌘\\", run: () => chain().clearFormatting().run() },
    alignLeft: { label: "Left", key: "⌘⇧L", run: () => chain().setTextAlign("left").run(), active: () => editor.isActive({ textAlign: "left" }) },
    alignCenter: { label: "Center", key: "⌘⇧E", run: () => chain().setTextAlign("center").run(), active: () => editor.isActive({ textAlign: "center" }) },
    alignRight: { label: "Right", key: "⌘⇧R", run: () => chain().setTextAlign("right").run(), active: () => editor.isActive({ textAlign: "right" }) },
    alignJustify: { label: "Justified", key: "⌘⇧J", run: () => chain().setTextAlign("justify").run(), active: () => editor.isActive({ textAlign: "justify" }) },
    indentMore: { label: "Increase indent", key: "⌘]", run: () => (editor.isActive("listItem") || editor.isActive("taskItem") ? chain().sinkListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run() : chain().indentMore().run()) },
    indentLess: { label: "Decrease indent", key: "⌘[", run: () => (editor.isActive("listItem") || editor.isActive("taskItem") ? chain().liftListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run() : chain().indentLess().run()) },
    bullets: { label: "Bulleted list", key: "⌘⇧8", run: () => chain().toggleBulletList().run(), active: () => editor.isActive("bulletList") },
    numbers: { label: "Numbered list", key: "⌘⇧7", run: () => chain().toggleOrderedList().run(), active: () => editor.isActive("orderedList") },
    checklist: { label: "Checklist", key: "⌘⇧9", run: () => chain().toggleTaskList().run(), active: () => editor.isActive("taskList") },
    quote: { label: "Quote", run: () => chain().toggleBlockquote().run(), active: () => editor.isActive("blockquote") },
    link: { label: "Link", key: "⌘K", run: () => editLink() },
    comment: { label: "Comment", key: "⌘⌥M", run: () => addComment() },
    image: { label: "Image…", run: () => pickImages() },
    camera: { label: "Take a photo", run: () => pickImages(true) },
    table: { label: "Table…", run: () => insertTableDialog() },
    hr: { label: "Horizontal line", run: () => chain().setHorizontalRule().run() },
    pageBreak: { label: "Page break", key: "⌘↵", run: () => chain().insertPageBreak().run() },
    footnote: { label: "Footnote", key: "⌘⌥F", run: () => insertFootnote() },
    bookmark: { label: "Bookmark", run: () => chain().insertBookmark().run() },
    equation: { label: "Equation…", run: () => editEquation(null, null, "inline") },
    blockEquation: { label: "Equation on its own line…", run: () => editEquation(null, null, "block") },
    special: { label: "Special characters & emoji…", run: () => specialChars() },
    tocLinks: { label: "Table of contents (links)", run: () => chain().insertTableOfContents(false).run() },
    tocNumbers: { label: "Table of contents (page numbers)", run: () => chain().insertTableOfContents(true).run() },
    chip: { label: "Smart chip (@)…", run: () => chain().insertContent("@").run() },
    dateChip: { label: "Today's date", run: () => { const d = dateSuggestions("today")[0]; chain().insertSmartChip(d).run(); } },
    header: { label: "Header", run: () => editHeaderFooter(settings.differentFirst ? "headerFirst" : "header") },
    footer: { label: "Footer", run: () => editHeaderFooter(settings.differentFirst ? "footerFirst" : "footer") },
    pageNumbers: { label: "Page numbers…", run: () => pageNumbersDialog() },
    find: { label: "Find and replace", key: "⌘⇧H", run: () => openFind() },
    selectAll: { label: "Select all", key: "⌘A", run: () => chain().selectAll().run() },
    paint: { label: "Paint format", run: () => togglePaint(), active: () => Boolean(paint) },
    wordCount: { label: "Word count", key: "⌘⇧C", run: () => wordCount() },
    pageSetup: { label: "Page setup…", run: () => pageSetup() },
    pageless: { label: "Print layout (pages)", run: () => writeSettings(session.ydoc, { pageless: !settings.pageless }), active: () => !settings.pageless },
    phonePrint: { label: "Print layout", run: () => { phonePrint = !phonePrint; try { localStorage.setItem(PHONE_PRINT_KEY, phonePrint ? "1" : "0"); } catch { /* this session only */ } applySheet(); editor.view.__relayout?.(); }, active: () => phonePrint },
    showWordCount: { label: "Show word count", run: () => writeSettings(session.ydoc, { showWordCount: !settings.showWordCount }), active: () => settings.showWordCount },
    outline: { label: "Show outline", run: () => toggleSide("outline"), active: () => !$('[data-side="outline"]').hidden },
    comments: { label: "Comments", run: () => toggleSide("comments") },
    history: { label: "See version history", run: () => toggleSide("versions") },
    nameVersion: { label: "Name current version…", run: async () => { const n = await promptText(root, "Name this version", { placeholder: "e.g. Signed copy" }); if (n?.trim()) { await session.snapshot(n.trim()); toast("Version named."); } } },
    print: { label: "Print", key: "⌘P", run: () => exportPdf({ print: true }) },
    exportDocx: { label: "Microsoft Word (.docx)", run: () => exportDocx() },
    exportPdf: { label: "PDF document (.pdf)", run: () => exportPdf() },
    exportTxt: { label: "Plain text (.txt)", run: () => exportTxt() },
    modeEdit: { label: "Editing", run: () => setMode("editing"), active: () => mode === "editing" },
    modeSuggest: { label: "Suggesting", run: () => setMode("suggesting"), active: () => mode === "suggesting" },
    modeView: { label: "Viewing", run: () => setMode("viewing"), active: () => mode === "viewing" },
    spell: { label: "Spell check", run: () => { const on = editor.view.dom.getAttribute("spellcheck") !== "false"; editor.view.dom.setAttribute("spellcheck", on ? "false" : "true"); }, active: () => editor.view.dom.getAttribute("spellcheck") !== "false" },
    restartNumbering: { label: "Restart numbering…", run: async () => { const n = await promptText(root, "Restart numbering at", { value: "1" }); if (n != null) chain().restartNumbering(Number(n) || 1).run(); } },
    indentOptions: { label: "Indentation options…", run: () => indentDialog() },
    customSpacing: { label: "Custom spacing…", run: () => spacingDialog() },
    spaceBefore: { label: "Add space before paragraph", run: () => toggleSpace("spaceBefore") },
    spaceAfter: { label: "Add space after paragraph", run: () => toggleSpace("spaceAfter") },
    pageBreakBefore: { label: "Page break before", run: () => chain().setParagraphFormat({ pageBreakBefore: !editor.getAttributes("paragraph").pageBreakBefore }).run(), active: () => Boolean(editor.getAttributes("paragraph").pageBreakBefore) },
    hideComments: { label: "Highlight comments", run: () => root.classList.toggle("hide-comments"), active: () => !root.classList.contains("hide-comments") },
    acceptAll: { label: "Accept all suggestions", run: () => editor.commands.acceptAllSuggestions() },
    rejectAll: { label: "Reject all suggestions", run: () => editor.commands.rejectAllSuggestions() },
    // tables
    rowAbove: { label: "Insert row above", run: () => chain().addRowBefore().run() },
    rowBelow: { label: "Insert row below", run: () => chain().addRowAfter().run() },
    colLeft: { label: "Insert column left", run: () => chain().addColumnBefore().run() },
    colRight: { label: "Insert column right", run: () => chain().addColumnAfter().run() },
    delRow: { label: "Delete row", run: () => chain().deleteRow().run() },
    delCol: { label: "Delete column", run: () => chain().deleteColumn().run() },
    delTable: { label: "Delete table", run: () => chain().deleteTable().run() },
    merge: { label: "Merge cells", run: () => chain().mergeCells().run() },
    split: { label: "Unmerge cells", run: () => chain().splitCell().run() },
    headerRow: { label: "Header row", run: () => chain().toggleHeaderRow().run() },
    cellColor: { label: "Cell background…", run: (e) => colorMenu(e?.target, "cell") },
  };
  for (const [level, label] of [[0, "normal"], [1, "h1"], [2, "h2"], [3, "h3"], [4, "h4"], [5, "h5"], [6, "h6"]]) {
    C[`style_${label}`] = { label: STYLE_OPTIONS.find((s) => s[0] === label)[1], key: level ? `⌘⌥${level}` : "⌘⌥0", run: () => chain().setDocStyle(label).run() };
  }
  C.style_title = { label: "Title", run: () => chain().setDocStyle("title").run() };
  C.style_subtitle = { label: "Subtitle", run: () => chain().setDocStyle("subtitle").run() };

  const run = (id, e) => {
    const c = C[id];
    if (!c) return;
    const editOnly = !["outline", "comments", "history", "wordCount", "find", "print", "exportDocx", "exportPdf", "exportTxt", "modeEdit", "modeSuggest", "modeView", "phonePrint", "showWordCount", "hideComments", "spell", "selectAll"].includes(id);
    if (editOnly && !editingAllowed() && id !== "comment") { toast(mode === "viewing" ? "Switch to Editing or Suggesting to change the document." : "Close the version you're looking at first."); return; }
    if (editOnly && isPhone() && !phoneEditing && id !== "comment") startPhoneEditing();
    try { c.run(e); } catch (err) { toast(err?.message || "That didn't work."); }
    setTimeout(drawToolbar, 0);
  };

  // ---- text style helpers ---------------------------------------------------------------------
  const currentStyle = () => {
    if (editor.isActive("heading")) return `h${attrsOf("heading").level}`;
    return attrsOf("paragraph").docStyle || "normal";
  };
  const currentFont = () => attrsOf("textStyle").fontFamily || DEFAULT_FONT;
  const currentSize = () => {
    const s = Number(attrsOf("textStyle").fontSize);
    if (s) return s;
    const st = currentStyle();
    return { title: 26, subtitle: 15, h1: 20, h2: 16, h3: 14, h4: 12 }[st] || DEFAULT_SIZE;
  };
  const nextSize = (cur, dir) => {
    if (dir > 0) return FONT_SIZES.find((s) => s > cur) || Math.min(400, cur + 12);
    return [...FONT_SIZES].reverse().find((s) => s < cur) || Math.max(1, cur - 1);
  };
  const setSize = (pt) => { const n = Math.max(1, Math.min(400, Number(pt) || DEFAULT_SIZE)); chain().setFontSize(n).run(); };
  const setFont = (name) => { ensureFont(name); chain().setFontFamily(name).run(); };

  function togglePaint() {
    if (paint) { paint = null; drawToolbar(); return; }
    const { $from } = editor.state.selection;
    paint = { marks: (editor.state.storedMarks || $from.marks()).filter((m) => !["comment", "insertion", "deletion", "link"].includes(m.type.name)), para: { ...attrsOf("paragraph") } };
    toast("Select text to paint the format onto it.");
    drawToolbar();
  }
  editor.on("selectionUpdate", () => {
    if (paint && !editor.state.selection.empty) {
      const { from, to } = editor.state.selection;
      const tr = editor.state.tr;
      for (const name of Object.keys(editor.schema.marks)) if (!["comment", "insertion", "deletion", "link"].includes(name)) tr.removeMark(from, to, editor.schema.marks[name]);
      for (const m of paint.marks) tr.addMark(from, to, m);
      editor.view.dispatch(tr);
      paint = null;
    }
    drawToolbar();
    placeBubble();
  });
  editor.on("transaction", () => { drawToolbarSoon(); });

  function toggleSpace(key) {
    const cur = attrsOf(editor.isActive("heading") ? "heading" : "paragraph")[key];
    chain().setParagraphFormat({ [key]: cur ? null : 12 }).run();
  }

  // ---- toolbar (laptop) -------------------------------------------------------------------------
  const btn = (id, icon, title) => `<button type="button" class="wp-icon${C[id]?.active?.() ? " is-on" : ""}" data-cmd="${id}" title="${esc(title || C[id]?.label || id)}${C[id]?.key ? ` (${C[id].key})` : ""}" aria-label="${esc(title || C[id]?.label || id)}"${C[id]?.active ? ` aria-pressed="${C[id].active() ? "true" : "false"}"` : ""}>${icon}</button>`;
  const sep = '<span class="wp-sep"></span>';
  function drawToolbar() {
    const tb = $("[data-toolbar]");
    if (!tb || isPhone()) return;
    if (tb.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON") return; // typing a size
    const alignIcon = editor.isActive({ textAlign: "center" }) ? IC.alignCenter : editor.isActive({ textAlign: "right" }) ? IC.alignRight : editor.isActive({ textAlign: "justify" }) ? IC.alignJustify : IC.alignLeft;
    const font = currentFont();
    const fontKnown = findFont(font);
    const color = safeColor(attrsOf("textStyle").color) || "#000000";
    const hl = safeColor(attrsOf("highlight").color) || "transparent";
    tb.innerHTML = [
      btn("undo", IC.undo), btn("redo", IC.redo), btn("print", IC.print), btn("paint", IC.paint), sep,
      `<select class="wp-select" data-style aria-label="Paragraph style">${STYLE_OPTIONS.map(([v, l]) => `<option value="${v}"${currentStyle() === v ? " selected" : ""}>${l}</option>`).join("")}</select>`, sep,
      `<select class="wp-select" data-font aria-label="Font">${fontKnown ? "" : `<option value="${esc(font)}" selected>${esc(font)}</option>`}${FONTS.map((f) => `<option value="${esc(f.name)}"${f.name === fontKnown?.name ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select>`, sep,
      `<span class="wp-size"><button type="button" data-cmd="sizeDown" aria-label="Decrease font size">−</button><input type="text" inputmode="decimal" data-size data-no-clear aria-label="Font size" value="${currentSize()}"><button type="button" data-cmd="sizeUp" aria-label="Increase font size">+</button></span>`, sep,
      btn("bold", "<b>B</b>"), btn("italic", "<i>I</i>"), btn("underline", "<u>U</u>"),
      `<button type="button" class="wp-icon wp-swatch-btn" data-pop="color" title="Text colour" aria-label="Text colour">${IC.textColor}<span class="wp-bar" style="background:${color}"></span></button>`,
      `<button type="button" class="wp-icon wp-swatch-btn" data-pop="highlight" title="Highlight colour" aria-label="Highlight colour">${IC.highlight}<span class="wp-bar" style="background:${hl}"></span></button>`, sep,
      btn("link", IC.link), btn("comment", IC.comment), btn("image", IC.image), sep,
      `<button type="button" class="wp-icon" data-pop="align" title="Align" aria-label="Align">${alignIcon}</button>`,
      `<button type="button" class="wp-icon" data-pop="spacing" title="Line & paragraph spacing" aria-label="Line and paragraph spacing">${IC.spacing}</button>`,
      btn("checklist", IC.checklist),
      `<button type="button" class="wp-icon${editor.isActive("bulletList") ? " is-on" : ""}" data-cmd="bullets" title="Bulleted list">${IC.bullets}</button><button type="button" class="wp-icon" data-pop="bulletStyles" title="Bullet styles" aria-label="Bullet styles" style="min-width:16px">▾</button>`,
      `<button type="button" class="wp-icon${editor.isActive("orderedList") ? " is-on" : ""}" data-cmd="numbers" title="Numbered list">${IC.numbers}</button><button type="button" class="wp-icon" data-pop="numberStyles" title="Numbering styles" aria-label="Numbering styles" style="min-width:16px">▾</button>`,
      btn("indentLess", IC.indentLess), btn("indentMore", IC.indentMore), btn("clear", IC.clear),
    ].join("");
  }
  let tbTimer = null;
  const drawToolbarSoon = () => { clearTimeout(tbTimer); tbTimer = setTimeout(() => { drawToolbar(); updateFoot(); }, 80); };

  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-style]")) { run(`style_${e.target.value}`); }
    else if (e.target.matches("[data-font]")) { if (editingAllowed()) setFont(e.target.value); }
    else if (e.target.matches("[data-size]")) { if (editingAllowed()) setSize(e.target.value); }
    else if (e.target.matches("[data-mode]")) setMode(e.target.value);
    else if (e.target.matches("[data-find-case], [data-find-re]")) findUpdate();
    else if (e.target.matches("[data-phone-font]")) { if (editingAllowed()) setFont(e.target.value); }
    else if (e.target.matches("[data-phone-size]")) { if (editingAllowed()) setSize(e.target.value); }
    else if (e.target.matches("[data-phone-style]")) run(`style_${e.target.value}`);
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-size]") && e.key === "Enter") { e.preventDefault(); setSize(e.target.value); editor.commands.focus(); }
    if (e.target.matches("[data-find-q]") && e.key === "Enter") { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  });

  // ---- popup menus ---------------------------------------------------------------------------------
  let pop = null;
  function closePop() { pop?.remove(); pop = null; root.querySelectorAll(".wp-menubar > button.is-open").forEach((b) => b.classList.remove("is-open")); }
  function openPop(anchor, html, onClick) {
    closePop();
    pop = document.createElement("div");
    pop.className = "wp-pop";
    pop.innerHTML = html;
    root.appendChild(pop);
    const r = anchor?.getBoundingClientRect?.() || { left: 20, bottom: 60, top: 60 };
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${top}px`;
    pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's selection
    pop.addEventListener("click", (e) => {
      const it = e.target.closest("[data-item]");
      if (!it) return;
      const keepOpen = onClick(it.dataset.item, it, e);
      if (!keepOpen) closePop();
    });
    return pop;
  }
  const item = (id, label = C[id]?.label, extra = "") => `<button type="button" class="wp-item" data-item="${esc(id)}"><span class="wp-check">${C[id]?.active?.() ? "✓" : ""}</span>${esc(label)}${C[id]?.key ? `<span class="wp-key">${esc(C[id].key)}</span>` : ""}${extra}</button>`;
  const sub = (id, label) => `<button type="button" class="wp-item" data-item="${esc(id)}"><span class="wp-check"></span>${esc(label)}<span class="wp-key">›</span></button>`;
  const label = (t) => `<div class="wp-pop-label">${esc(t)}</div>`;
  const hr = "<hr>";

  const MENUS = {
    file: () => [label("Download"), item("exportDocx"), item("exportPdf"), item("exportTxt"), hr, item("nameVersion"), item("history"), hr, item("pageSetup"), item("print")].join(""),
    edit: () => [item("undo"), item("redo"), hr, item("selectAll"), hr, item("find")].join(""),
    view: () => [label("Mode"), item("modeEdit"), item("modeSuggest"), item("modeView"), hr, item("pageless"), item("outline"), item("showWordCount"), item("hideComments")].join(""),
    insert: () => [item("image"), ...(deps.isNative ? [item("camera")] : []), item("table"), sub("@chips", "Smart chips"), item("link"), item("equation"), item("blockEquation"), item("special"), hr, item("hr"), item("footnote"), sub("@hf", "Headers & footers"), item("pageNumbers"), item("pageBreak"), item("bookmark"), sub("@toc", "Table of contents"), hr, item("comment")].join(""),
    format: () => [sub("@text", "Text"), sub("@styles", "Paragraph styles"), sub("@align", "Align & indent"), sub("@spacing", "Line & paragraph spacing"), sub("@lists", "Bullets & numbering"), hr, sub("@hf", "Headers & footers"), item("pageNumbers"), sub("@table", "Table"), hr, item("clear")].join(""),
    tools: () => [item("wordCount"), item("spell"), hr, item("acceptAll"), item("rejectAll")].join(""),
    "@chips": () => [item("chip", "People, documents, recipes… (@)"), item("dateChip")].join(""),
    "@hf": () => [item("header"), item("footer"), item("pageNumbers")].join(""),
    "@toc": () => [item("tocLinks"), item("tocNumbers")].join(""),
    "@text": () => ["bold", "italic", "underline", "strike", "superscript", "subscript", "code"].map((i) => item(i)).join("") + hr + item("sizeUp") + item("sizeDown") + hr + label("Capitalization") + item("lower") + item("upper") + item("title"),
    "@styles": () => STYLE_OPTIONS.map(([v]) => item(`style_${v}`)).join(""),
    "@align": () => [item("alignLeft"), item("alignCenter"), item("alignRight"), item("alignJustify"), hr, item("indentMore"), item("indentLess"), item("indentOptions")].join(""),
    "@spacing": () => LINE_HEIGHTS.map((v) => `<button type="button" class="wp-item" data-item="lh:${v}"><span class="wp-check">${Number(attrsOf(editor.isActive("heading") ? "heading" : "paragraph").lineHeight || 1.15) === v ? "✓" : ""}</span>${{ 1: "Single", 1.15: "1.15", 1.5: "1.5", 2: "Double" }[v]}</button>`).join("") + item("customSpacing") + hr + item("spaceBefore") + item("spaceAfter") + item("pageBreakBefore"),
    "@lists": () => [label("Bullets"), ...BULLET_STYLES.map((s) => `<button type="button" class="wp-item" data-item="ls:${s}"><span class="wp-check"></span>${{ disc: "● Filled", circle: "○ Hollow", square: "■ Square", dash: "– Dash", arrow: "➔ Arrow", star: "★ Star" }[s]}</button>`), label("Numbers"), ...ORDERED_STYLES.map((s) => `<button type="button" class="wp-item" data-item="ls:${s}"><span class="wp-check"></span>${{ decimal: "1. 2. 3.", "lower-alpha": "a. b. c.", "upper-alpha": "A. B. C.", "lower-roman": "i. ii. iii.", "upper-roman": "I. II. III.", "decimal-leading-zero": "01. 02. 03." }[s]}</button>`), hr, item("checklist"), item("restartNumbering")].join(""),
    "@table": () => [item("table", "Insert table…"), hr, item("rowAbove"), item("rowBelow"), item("colLeft"), item("colRight"), hr, item("delRow"), item("delCol"), item("delTable"), hr, item("merge"), item("split"), item("headerRow"), item("cellColor")].join(""),
  };
  function onMenuItem(id, el, e) {
    if (id.startsWith("@")) { openPop(el, MENUS[id](), onMenuItem); return true; }
    if (id.startsWith("lh:")) { if (editingAllowed()) chain().setLineHeight(Number(id.slice(3))).run(); return false; }
    if (id.startsWith("ls:")) { if (editingAllowed()) chain().setListStyle(id.slice(3)).run(); return false; }
    if (id.startsWith("align:")) { run(id.slice(6)); return false; }
    run(id, e);
    return false;
  }
  function colorMenu(anchor, kind) {
    const none = kind === "color" ? "" : `<button type="button" class="is-none" data-item="none" title="None"></button>`;
    openPop(anchor, `<div class="wp-swatches">${none}${COLORS.map((c) => `<button type="button" data-item="${c}" title="${c}" style="background:${c}"></button>`).join("")}</div>
      <div class="wp-pop-label">Custom</div><div style="padding:4px 12px 8px"><input type="color" data-custom-color value="#000000" aria-label="Custom colour"></div>`, (v) => {
      if (!editingAllowed()) return false;
      if (kind === "color") chain().setColor(v === "none" ? "#000000" : v).run();
      else if (kind === "highlight") (v === "none" ? chain().unsetHighlight() : chain().setHighlight({ color: v })).run();
      else if (kind === "cell") chain().setCellAttribute("background", v === "none" ? null : v).run();
      return false;
    });
    pop.querySelector("[data-custom-color]")?.addEventListener("change", (ev) => {
      const v = ev.target.value;
      if (kind === "color") chain().setColor(v).run(); else if (kind === "highlight") chain().setHighlight({ color: v }).run(); else chain().setCellAttribute("background", v).run();
      closePop();
    });
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (pop && !pop.contains(t) && !t.closest("[data-menu], [data-pop]")) closePop();
    const menuBtn = t.closest("[data-menu]");
    if (menuBtn) {
      const open = menuBtn.classList.contains("is-open");
      closePop();
      if (!open) { openPop(menuBtn, MENUS[menuBtn.dataset.menu](), onMenuItem); menuBtn.classList.add("is-open"); }
      return;
    }
    const popBtn = t.closest("[data-pop]");
    if (popBtn) {
      const k = popBtn.dataset.pop;
      if (k === "color" || k === "highlight") colorMenu(popBtn, k);
      else if (k === "align") openPop(popBtn, [item("alignLeft"), item("alignCenter"), item("alignRight"), item("alignJustify")].join(""), onMenuItem);
      else if (k === "spacing") openPop(popBtn, MENUS["@spacing"](), onMenuItem);
      else if (k === "bulletStyles" || k === "numberStyles") openPop(popBtn, MENUS["@lists"](), onMenuItem);
      return;
    }
    const cmd = t.closest("[data-cmd]");
    if (cmd && !cmd.closest(".wp-pop")) { e.preventDefault(); run(cmd.dataset.cmd, e); return; }
    const act = t.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "close") close();
    else if (act === "comments") toggleSide("comments");
    else if (act === "side-close") closeSide();
    else if (act === "phone-menu") openPop(t.closest("[data-act]"), phoneMenu(), onMenuItem);
    else if (act === "start-edit") startPhoneEditing();
    else if (act === "done-edit") stopPhoneEditing();
    else if (act === "sheet-format") toggleSheet("format");
    else if (act === "sheet-insert") toggleSheet("insert");
    else if (act === "find-close") closeFind();
    else if (act === "find-next") findStep(1);
    else if (act === "find-prev") findStep(-1);
    else if (act === "replace-one") replaceOne();
    else if (act === "replace-all") replaceAll();
    else if (act === "preview-close") endPreview();
    else if (act === "preview-restore") restorePreview();
  });
  // Keep the editor's selection when tapping toolbar buttons.
  root.addEventListener("mousedown", (e) => { if (e.target.closest(".wp-toolbar button, .wp-kbbar button, .wp-bubble button, .wp-sheetpanel button")) e.preventDefault(); });

  function phoneMenu() {
    return [
      label("Mode"), item("modeEdit"), item("modeSuggest"), item("modeView"), hr,
      item("find"), item("outline"), item("history"), item("wordCount"), hr,
      item("phonePrint"), item("pageless", "Pages for everyone (page setup)"), item("pageSetup"), sub("@hf", "Headers & footers"), item("showWordCount"), hr,
      label("Share a copy"), item("exportPdf"), item("exportDocx"), item("exportTxt"), hr,
      item("acceptAll"), item("rejectAll"),
    ].join("");
  }

  // ---- phone: reading view, editing, keyboard bar, sheets ----------------------------------------
  function startPhoneEditing() {
    if (!editingAllowed()) return;
    phoneEditing = true;
    applyEditable();
    editor.commands.focus();
  }
  function stopPhoneEditing() {
    phoneEditing = false;
    closeSheet();
    applyEditable();
    editor.view.dom.blur();
    session.save();
  }
  let sheetKind = null;
  function toggleSheet(kind) { if (sheetKind === kind) closeSheet(); else openSheet(kind); }
  function closeSheet() { sheetKind = null; $("[data-sheetpanel]").hidden = true; }
  function openSheet(kind, tab = "text") {
    sheetKind = kind;
    const p = $("[data-sheetpanel]");
    p.hidden = false;
    if (kind === "insert") {
      p.innerHTML = `<div class="wp-sheet-row"><span class="wp-label">Insert</span>
        ${["image", ...(deps.isNative ? ["camera"] : []), "table", "link", "chip", "dateChip", "comment", "footnote", "hr", "pageBreak", "equation", "special", "tocLinks", "bookmark"].map((id) => `<button type="button" class="secondary-btn" data-cmd="${id}">${esc(C[id].label.replace("…", ""))}</button>`).join("")}</div>`;
      return;
    }
    const font = currentFont();
    p.innerHTML = `<div class="wp-tabs"><button type="button" data-tab="text" class="${tab === "text" ? "is-on" : ""}">Text</button><button type="button" data-tab="para" class="${tab === "para" ? "is-on" : ""}">Paragraph</button></div>
      ${tab === "text" ? `
        <div class="wp-sheet-row"><select data-phone-style aria-label="Style">${STYLE_OPTIONS.map(([v, l]) => `<option value="${v}"${currentStyle() === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="wp-sheet-row">${btn("bold", "<b>B</b>")}${btn("italic", "<i>I</i>")}${btn("underline", "<u>U</u>")}${btn("strike", "<s>S</s>")}${btn("superscript", "x²")}${btn("subscript", "x₂")}</div>
        <div class="wp-sheet-row"><select data-phone-font aria-label="Font">${FONTS.map((f) => `<option${f.name === font ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
          ${btn("sizeDown", "−")}<select data-phone-size aria-label="Size" style="min-width:70px;flex:0">${[...new Set([...FONT_SIZES, currentSize()])].sort((a, b) => a - b).map((s) => `<option${s === currentSize() ? " selected" : ""}>${s}</option>`).join("")}</select>${btn("sizeUp", "+")}</div>
        <div class="wp-sheet-row"><button type="button" class="wp-icon wp-swatch-btn" data-pop="color" aria-label="Text colour">${IC.textColor}</button><button type="button" class="wp-icon" data-pop="highlight" aria-label="Highlight">${IC.highlight}</button>${btn("clear", IC.clear)}${btn("link", IC.link)}</div>`
      : `
        <div class="wp-sheet-row">${btn("alignLeft", IC.alignLeft)}${btn("alignCenter", IC.alignCenter)}${btn("alignRight", IC.alignRight)}${btn("alignJustify", IC.alignJustify)}</div>
        <div class="wp-sheet-row">${btn("bullets", IC.bullets)}${btn("numbers", IC.numbers)}${btn("checklist", IC.checklist)}${btn("indentLess", IC.indentLess)}${btn("indentMore", IC.indentMore)}</div>
        <div class="wp-sheet-row"><span class="wp-label">Line spacing</span>${LINE_HEIGHTS.map((v) => `<button type="button" class="secondary-btn" data-lh="${v}">${{ 1: "Single", 1.15: "1.15", 1.5: "1.5", 2: "Double" }[v]}</button>`).join("")}</div>`}`;
  }
  $("[data-sheetpanel]").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) { openSheet("format", tab.dataset.tab); return; }
    const lh = e.target.closest("[data-lh]");
    if (lh && editingAllowed()) { chain().setLineHeight(Number(lh.dataset.lh)).run(); }
    if (sheetKind === "insert" && e.target.closest("[data-cmd]")) setTimeout(closeSheet, 0);
    else if (sheetKind === "format") setTimeout(() => openSheet("format", $("[data-sheetpanel] .wp-tabs .is-on")?.dataset.tab || "text"), 0);
  });

  // ---- bubble bar (selection / image / table) ------------------------------------------------------
  function placeBubble() {
    const sel = editor.state.selection;
    if (!editor.isEditable && !(mode === "viewing" && !sel.empty)) { bubble.hidden = true; return; }
    let html = "";
    if (sel instanceof NodeSelection && sel.node.type.name === "image") {
      const a = sel.node.attrs;
      html = [["inline", IC.inline, "In line"], ["wrap-left", IC.wrapLeft, "Wrap text (left)"], ["wrap-right", IC.wrapRight, "Wrap text (right)"], ["break", IC.breakText, "Break text"]]
        .map(([v, ic, l]) => `<button type="button" class="wp-icon${a.layout === v ? " is-on" : ""}" data-img="layout:${v}" title="${l}" aria-label="${l}">${ic}</button>`).join("")
        + `<span class="wp-sep"></span><button type="button" class="wp-icon" data-img="size:-" title="Smaller">−</button><button type="button" class="wp-icon" data-img="size:+" title="Larger">+</button><button type="button" class="wp-icon" data-img="size:fit" title="Full width">↔</button>`
        + `<button type="button" class="wp-icon" data-img="rotate" title="Rotate" aria-label="Rotate">${IC.rotate}</button><button type="button" class="wp-icon" data-img="crop" title="Crop" aria-label="Crop">${IC.crop}</button><button type="button" class="wp-icon" data-img="alt" title="Alt text" aria-label="Alt text">${IC.alt}</button><button type="button" class="wp-icon" data-img="delete" title="Delete" aria-label="Delete">${IC.trash}</button>`;
    } else if (editor.isActive("table") && editor.isEditable) {
      html = [["rowAbove", "↥ Row"], ["rowBelow", "↧ Row"], ["colLeft", "↤ Col"], ["colRight", "↦ Col"], ["delRow", "✕ Row"], ["delCol", "✕ Col"], ["merge", "Merge"], ["split", "Split"], ["headerRow", "Header"]].map(([id, l]) => `<button type="button" class="wp-icon" data-cmd="${id}" title="${esc(C[id].label)}">${l}</button>`).join("")
        + `<button type="button" class="wp-icon" data-cmd="cellColor" title="Cell background">🎨</button><button type="button" class="wp-icon" data-cmd="delTable" title="Delete table" aria-label="Delete table">${IC.trash}</button>`;
    } else if (!sel.empty) {
      html = editor.isEditable ? `${btn("bold", "<b>B</b>")}${btn("italic", "<i>I</i>")}${btn("underline", "<u>U</u>")}${btn("link", IC.link)}${btn("comment", IC.comment)}` : btn("comment", IC.comment);
    }
    if (!html) { bubble.hidden = true; return; }
    bubble.innerHTML = html;
    bubble.hidden = false;
    let coords;
    try { coords = editor.view.coordsAtPos(sel.from); } catch { bubble.hidden = true; return; }
    const w = bubble.offsetWidth;
    const top = coords.top - bubble.offsetHeight - 8;
    bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, coords.left - w / 2))}px`;
    bubble.style.top = `${top < 60 ? coords.bottom + 8 : top}px`;
  }
  canvas.addEventListener("scroll", () => { if (!bubble.hidden) placeBubble(); }, { passive: true });
  bubble.addEventListener("mousedown", (e) => e.preventDefault());
  bubble.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-img]");
    if (!b) return;
    const sel = editor.state.selection;
    if (!(sel instanceof NodeSelection)) return;
    const a = sel.node.attrs;
    const [k, v] = b.dataset.img.split(":");
    const set = (attrs) => editor.chain().updateAttributes("image", attrs).setNodeSelection(sel.from).run();
    if (k === "layout") set({ layout: v });
    else if (k === "size") {
      const img = editor.view.nodeDOM(sel.from)?.querySelector?.("img");
      const cur = a.width || img?.naturalWidth || 400;
      const max = editor.view.dom.clientWidth - 40;
      set({ width: v === "fit" ? null : Math.round(Math.max(40, Math.min(max, cur * (v === "+" ? 1.25 : 0.8)))) });
    } else if (k === "rotate") set({ rotate: ((a.rotate || 0) + 90) % 360 });
    else if (k === "alt") { const t = await promptText(root, "Alt text", { value: a.alt, label: "Describe the image for screen readers", multiline: true }); if (t != null) set({ alt: t.slice(0, 500) }); }
    else if (k === "crop") cropDialog(a, set);
    else if (k === "delete") editor.chain().focus().deleteSelection().run();
    placeBubble();
  });

  // ---- links ---------------------------------------------------------------------------------------
  function followLink(href) {
    if (!href) return;
    if (href.startsWith("#bm-")) { document.getElementById(href.slice(1))?.scrollIntoView({ block: "center" }); return; }
    if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, "_blank", "noopener");
  }
  async function editLink() {
    const cur = attrsOf("link").href || "";
    const { empty, from, to } = editor.state.selection;
    const marks = [];
    editor.state.doc.descendants((n) => { if (n.type.name === "bookmark") marks.push(n.attrs.id); });
    const { value, form } = await openDialog(root, {
      title: cur ? "Edit link" : "Insert link",
      body: `${empty ? `<label>Text<input type="text" name="text"></label>` : ""}<label>Link<input type="url" name="href" value="${esc(cur)}" placeholder="https://… or pick a bookmark"></label>
        ${marks.length ? `<label>Or a bookmark in this document<select name="bm"><option value="">—</option>${marks.map((m, i) => `<option value="#bm-${esc(m)}">Bookmark ${i + 1}</option>`).join("")}</select></label>` : ""}`,
      actions: [...(cur ? [{ label: "Remove link", value: "remove", danger: true }] : []), { label: "Cancel", value: null }, { label: "Apply", value: "ok", primary: true }],
    });
    if (value === "remove") { chain().extendMarkRange("link").unsetLink().run(); return; }
    if (value !== "ok") return;
    let href = (form.bm?.value || form.href.value || "").trim();
    if (!href) return;
    if (!/^(https?:|mailto:|tel:|#bm-)/i.test(href)) href = /^[^\s@]+@[^\s@]+$/.test(href) ? `mailto:${href}` : `https://${href}`;
    if (empty) {
      const text = (form.text?.value || href).trim();
      chain().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain().setTextSelection({ from, to }).extendMarkRange("link").setLink({ href }).run();
  }

  // ---- images --------------------------------------------------------------------------------------
  function pickImages(camera = false) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = !camera;
    if (camera) input.capture = "environment";
    input.onchange = () => insertImages([...input.files]);
    input.click();
  }
  async function insertImages(files) {
    if (!editingAllowed()) return;
    for (const f of files.slice(0, 20)) {
      try {
        statusEl.textContent = "Adding the image…";
        const bytes = await prepareImage(f);
        const id = randHex(16);
        await store.images.put(id, bytes);
        imageUrls.set(id, Promise.resolve(URL.createObjectURL(new Blob([bytes], { type: sniffImage(bytes) }))));
        chain().insertContent({ type: "image", attrs: { src: `liveimg:${id}`, alt: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 200) } }).run();
      } catch (e) { toast(e?.message || "That image couldn't be added."); }
    }
  }
  async function cropDialog(a, set) {
    const c = a.crop || { t: 0, r: 0, b: 0, l: 0 };
    const field = (k, l) => `<label>${l} <input type="range" name="${k}" min="0" max="45" value="${Math.round((c[k] || 0) * 100)}"></label>`;
    const { value, form } = await openDialog(root, { title: "Crop image", body: `<div class="wp-row">${field("t", "Top")}${field("b", "Bottom")}</div><div class="wp-row">${field("l", "Left")}${field("r", "Right")}</div>`, actions: [{ label: "Reset", value: "reset" }, { label: "Cancel", value: null }, { label: "Crop", value: "ok", primary: true }] });
    if (value === "reset") set({ crop: null });
    else if (value === "ok") set({ crop: { t: form.t.value / 100, r: form.r.value / 100, b: form.b.value / 100, l: form.l.value / 100 } });
  }

  // ---- tables ----------------------------------------------------------------------------------------
  async function insertTableDialog() {
    const { value, form } = await openDialog(root, { title: "Insert table", body: `<div class="wp-row"><label>Rows<input type="number" name="r" min="1" max="100" value="3"></label><label>Columns<input type="number" name="c" min="1" max="20" value="3"></label></div><label class="is-row"><input type="checkbox" name="h"> Header row</label>`, actions: [{ label: "Cancel", value: null }, { label: "Insert", value: "ok", primary: true }] });
    if (value !== "ok") return;
    chain().insertTable({ rows: Math.max(1, Math.min(100, Number(form.r.value) || 3)), cols: Math.max(1, Math.min(20, Number(form.c.value) || 3)), withHeaderRow: form.h.checked }).run();
  }

  // ---- footnotes, equations, special characters -------------------------------------------------------
  async function insertFootnote() {
    const text = await promptText(root, "Footnote", { multiline: true, placeholder: "Footnote text" });
    if (text == null) return;
    chain().insertFootnote(text.slice(0, 4000)).run();
  }
  async function editFootnoteAt(pos) {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "footnote") return;
    if (!editingAllowed()) { await openDialog(root, { title: "Footnote", body: `<p>${esc(node.attrs.text)}</p>`, actions: [{ label: "Close", value: null, primary: true }] }); return; }
    const { value, form } = await openDialog(root, { title: "Footnote", body: `<label><textarea name="v" rows="4">${esc(node.attrs.text)}</textarea></label>`, actions: [{ label: "Delete", value: "del", danger: true }, { label: "Cancel", value: null }, { label: "Save", value: "ok", primary: true }] });
    if (value === "del") editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
    else if (value === "ok") editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, text: form.v.value.slice(0, 4000) }); return true; }).run();
  }
  async function editEquation(node, pos, kind) {
    if (node && !editingAllowed()) return;
    const latex = await promptText(root, node ? "Edit equation" : "Insert equation", { value: node?.attrs.latex || "", label: "LaTeX, e.g. \\frac{a}{b} or x^2 + y^2 = z^2" });
    if (latex == null) return;
    if (!latex.trim()) { if (node) editor.chain().focus().setNodeSelection(pos).deleteSelection().run(); return; }
    if (node) editor.chain().focus()[kind === "block" ? "updateBlockMath" : "updateInlineMath"]({ latex: latex.trim(), pos }).run();
    else chain()[kind === "block" ? "insertBlockMath" : "insertInlineMath"]({ latex: latex.trim() }).run();
  }
  function specialChars() {
    openPop($("[data-toolbar]") || canvas, `<div class="wp-pop-label">Tap to insert</div><div class="wp-chars" style="padding:6px 12px;width:280px">${[...SPECIAL].filter((c) => c !== "️").map((c) => `<button type="button" data-item="${esc(c)}">${esc(c)}</button>`).join("")}</div>`, (c) => { if (editingAllowed()) chain().insertContent(c).run(); return true; });
  }

  // ---- headers & footers, page setup, page numbers ------------------------------------------------------
  async function editHeaderFooter(name) {
    if (!editingAllowed()) return;
    if (!settings.headerFooter) writeSettings(session.ydoc, { headerFooter: true });
    const title = { header: "Header", footer: "Footer", headerFirst: "First page header", footerFirst: "First page footer" }[name];
    let mini = null;
    await openDialog(root, {
      title,
      body: `<div class="wp-doc" style="border:1px solid var(--line);border-radius:8px;min-height:90px;padding:8px;background:var(--doc-paper)" data-mini></div>
        <div class="wp-row"><button type="button" class="secondary-btn" data-mini-act="pn">Insert page number</button><button type="button" class="secondary-btn" data-mini-act="pt">Insert page count</button><button type="button" class="secondary-btn" data-mini-act="c">Centre</button><button type="button" class="secondary-btn" data-mini-act="r">Right</button></div>
        <label class="is-row"><input type="checkbox" name="first"${settings.differentFirst ? " checked" : ""}> Different first page</label>`,
      actions: [{ label: "Done", value: "ok", primary: true }],
      init: (form) => {
        mini = new Editor({
          element: form.querySelector("[data-mini]"),
          extensions: [...baseExtensions({ collaboration: true, resolveImage }), Collaboration.configure({ document: session.ydoc, field: name })],
        });
        mini.commands.focus("end");
        form.addEventListener("click", (e) => {
          const a = e.target.closest("[data-mini-act]")?.dataset.miniAct;
          if (a === "pn") mini.chain().focus().insertPageNumber(false).run();
          else if (a === "pt") mini.chain().focus().insertPageNumber(true).run();
          else if (a === "c") mini.chain().focus().setTextAlign("center").run();
          else if (a === "r") mini.chain().focus().setTextAlign("right").run();
        });
        form.first.addEventListener("change", () => writeSettings(session.ydoc, { differentFirst: form.first.checked }));
      },
    });
    mini?.destroy();
    hfHtml = null;
    if (lastLayout) drawPages(lastLayout);
  }
  async function pageNumbersDialog() {
    const { value, form } = await openDialog(root, {
      title: "Page numbers",
      body: `<label>Where<select name="where"><option value="footer:right">Bottom right</option><option value="footer:center">Bottom centre</option><option value="header:right">Top right</option><option value="header:center">Top centre</option></select></label>
        <label class="is-row"><input type="checkbox" name="first" ${settings.differentFirst ? "" : "checked"}> Show on the first page</label>
        <label>Start at<input type="number" name="start" min="0" max="9999" value="${settings.pageNumberStart}"></label>`,
      actions: [{ label: "Cancel", value: null }, { label: "Apply", value: "ok", primary: true }],
    });
    if (value !== "ok") return;
    const [part, align] = form.where.value.split(":");
    writeSettings(session.ydoc, { headerFooter: true, differentFirst: !form.first.checked, pageNumberStart: Math.max(0, Math.min(9999, Number(form.start.value) || 1)), pageless: false });
    const frag = session.ydoc.getXmlFragment(part);
    const tmp = new Editor({ extensions: [...baseExtensions({ collaboration: true }), Collaboration.configure({ document: session.ydoc, field: part })] });
    tmp.chain().focus("end").insertContent({ type: "paragraph", attrs: { textAlign: align }, content: [{ type: "pageNumber" }] }).run();
    tmp.destroy();
    void frag;
  }
  async function pageSetup() {
    const s = settings;
    const { value, form } = await openDialog(root, {
      title: "Page setup",
      body: `<label class="is-row"><input type="radio" name="layout" value="pages"${s.pageless ? "" : " checked"}> Pages</label>
        <label class="is-row"><input type="radio" name="layout" value="pageless"${s.pageless ? " checked" : ""}> Pageless (no page breaks, headers or footers)</label>
        <div class="wp-row"><label>Orientation<select name="orient"><option value="p"${s.landscape ? "" : " selected"}>Portrait</option><option value="l"${s.landscape ? " selected" : ""}>Landscape</option></select></label>
        <label>Paper size<select name="size">${Object.entries(PAGE_SIZES).map(([k, v]) => `<option value="${k}"${k === s.pageSize ? " selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label></div>
        <label>Page colour<input type="color" name="color" value="${esc(s.pageColor)}"></label>
        <div class="wp-row">${["Top", "Bottom", "Left", "Right"].map((k) => `<label>${k} (in)<input type="number" step="0.1" min="0" max="4" name="m${k}" value="${s[`margin${k}`]}"></label>`).join("")}</div>`,
      actions: [{ label: "Cancel", value: null }, { label: "OK", value: "ok", primary: true }],
    });
    if (value !== "ok") return;
    writeSettings(session.ydoc, {
      pageless: form.layout.value === "pageless", landscape: form.orient.value === "l", pageSize: form.size.value, pageColor: /^#[0-9a-f]{6}$/i.test(form.color.value) ? form.color.value : "#ffffff",
      marginTop: Number(form.mTop.value), marginBottom: Number(form.mBottom.value), marginLeft: Number(form.mLeft.value), marginRight: Number(form.mRight.value),
    });
  }
  async function indentDialog() {
    const a = attrsOf(editor.isActive("heading") ? "heading" : "paragraph");
    const t = Number(a.textIndent) || 0;
    const { value, form } = await openDialog(root, {
      title: "Indentation options",
      body: `<label>Left indent (levels of 0.5")<input type="number" name="indent" min="0" max="8" value="${a.indent || 0}"></label>
        <label>Special indent<select name="kind"><option value="none"${!t ? " selected" : ""}>None</option><option value="first"${t > 0 ? " selected" : ""}>First line</option><option value="hanging"${t < 0 ? " selected" : ""}>Hanging</option></select></label>
        <label>By (inches)<input type="number" name="by" step="0.1" min="0" max="2.5" value="${Math.abs(t) / 72 || 0.5}"></label>`,
    });
    if (value !== "ok") return;
    const by = Math.max(0, Math.min(2.5, Number(form.by.value) || 0.5)) * 72;
    chain().setParagraphFormat({ indent: Math.max(0, Math.min(8, Number(form.indent.value) || 0)), textIndent: form.kind.value === "first" ? by : form.kind.value === "hanging" ? -by : null }).run();
  }
  async function spacingDialog() {
    const a = attrsOf(editor.isActive("heading") ? "heading" : "paragraph");
    const { value, form } = await openDialog(root, {
      title: "Custom spacing",
      body: `<label>Line spacing<input type="number" step="0.05" min="0.5" max="5" name="lh" value="${a.lineHeight || 1.15}"></label>
        <div class="wp-row"><label>Before (pt)<input type="number" min="0" max="200" name="b" value="${a.spaceBefore ?? 0}"></label><label>After (pt)<input type="number" min="0" max="200" name="a" value="${a.spaceAfter ?? 0}"></label></div>`,
    });
    if (value !== "ok") return;
    chain().setParagraphFormat({ lineHeight: Number(form.lh.value) || null, spaceBefore: Number(form.b.value) || 0, spaceAfter: Number(form.a.value) || 0 }).run();
  }
  async function wordCount() {
    const { from, to, empty } = editor.state.selection;
    const all = countWords(nodeText(editor.state.doc));
    const selC = empty ? null : countWords(editor.state.doc.textBetween(from, to, "\n"));
    const row = (l, v, s) => `<span>${esc(l)}</span><strong>${s != null ? `${s.toLocaleString()} of ` : ""}${v.toLocaleString()}</strong>`;
    const { form, value } = await openDialog(root, {
      title: "Word count",
      body: `<div class="wp-stats">${showPages() ? row("Pages", pageCount) : ""}${row("Words", all.words, selC?.words)}${row("Characters", all.characters, selC?.characters)}${row("Characters excluding spaces", all.charactersNoSpaces, selC?.charactersNoSpaces)}</div>
        <label class="is-row"><input type="checkbox" name="show"${settings.showWordCount ? " checked" : ""}> Display word count while typing</label>`,
      actions: [{ label: "OK", value: "ok", primary: true }],
    });
    if (value === "ok" && form.show.checked !== settings.showWordCount) writeSettings(session.ydoc, { showWordCount: form.show.checked });
  }
  function updateFoot() {
    const foot = $("[data-foot]");
    if (foot.hidden) return;
    const { from, to, empty } = editor.state.selection;
    const all = countWords(nodeText(editor.state.doc)).words;
    const s = empty ? null : countWords(editor.state.doc.textBetween(from, to, "\n")).words;
    foot.textContent = `${s != null ? `${s.toLocaleString()} of ` : ""}${all.toLocaleString()} words${!showPages() ? "" : ` · ${pageCount} page${pageCount === 1 ? "" : "s"}`}`;
  }

  // ---- find & replace ---------------------------------------------------------------------------
  const fs = editor.storage.findReplace;
  function openFind() {
    const bar = $("[data-find]");
    bar.hidden = false;
    const q = $("[data-find-q]");
    const { from, to, empty } = editor.state.selection;
    if (!empty && to - from < 100) q.value = editor.state.doc.textBetween(from, to);
    q.focus();
    q.select();
    findUpdate();
  }
  function closeFind() { $("[data-find]").hidden = true; fs.query = ""; editor.view.dispatch(editor.state.tr.setMeta(findKey, true)); editor.commands.focus(); }
  function findUpdate() {
    fs.query = $("[data-find-q]").value;
    fs.matchCase = $("[data-find-case]").checked;
    fs.regex = $("[data-find-re]").checked;
    fs.index = 0;
    editor.view.dispatch(editor.state.tr.setMeta(findKey, true));
    $("[data-find-count]").textContent = fs.query ? (fs.matches.length ? `${fs.index + 1} of ${fs.matches.length}` : "No results") : "";
  }
  function findStep(dir) {
    if (!fs.matches.length) return;
    fs.index = (fs.index + dir + fs.matches.length) % fs.matches.length;
    const m = fs.matches[fs.index];
    editor.view.dispatch(editor.state.tr.setMeta(findKey, true));
    editor.commands.setTextSelection({ from: m.from, to: m.to });
    editor.commands.scrollIntoView();
    $("[data-find-count]").textContent = `${fs.index + 1} of ${fs.matches.length}`;
  }
  function replacement(m) {
    const r = $("[data-find-r]").value;
    return fs.regex ? r.replace(/\$(\d)/g, (_, i) => m.groups?.[Number(i)] ?? "") : r;
  }
  function replaceOne() {
    if (!editingAllowed() || !fs.matches.length) return;
    const m = fs.matches[fs.index];
    editor.chain().insertContentAt({ from: m.from, to: m.to }, replacement(m)).run();
    findUpdate();
  }
  function replaceAll() {
    if (!editingAllowed() || !fs.matches.length) return;
    const n = fs.matches.length;
    const tr = editor.state.tr;
    for (const m of [...fs.matches].reverse()) {
      const text = replacement(m);
      if (text) tr.insertText(text, m.from, m.to); else tr.delete(m.from, m.to);
    }
    editor.view.dispatch(tr);
    findUpdate();
    toast(`Replaced ${n}.`);
  }
  $("[data-find-q]").addEventListener("input", findUpdate);
  $("[data-find-r]").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } });

  // ---- @ smart chips ----------------------------------------------------------------------------------
  const chipMenu = (() => {
    let range = null;
    let items = [];
    let idx = 0;
    let seq = 0;
    const draw = () => {
      if (!range) return;
      let coords;
      try { coords = editor.view.coordsAtPos(range.from); } catch { return; }
      if (!items.length) { closePop(); return; }
      openPop({ getBoundingClientRect: () => ({ left: coords.left, bottom: coords.bottom, top: coords.top }) },
        items.map((it, i) => `<button type="button" class="wp-item${i === idx ? " is-active" : ""}" data-item="${i}">${esc(it.label)}<small>${esc(it.sub || it.kind)}</small></button>`).join(""),
        (i) => { pick(Number(i)); return false; });
      pop.classList.add("wp-chipmenu");
    };
    async function query(q, r) {
      range = r;
      const my = ++seq;
      const dates = dateSuggestions(q);
      let found = [];
      try { found = (await deps.chipSource?.(q)) || []; } catch { /* the dates still work */ }
      if (my !== seq || !range) return;
      const ppl = people.filter((p) => p.name?.toLowerCase().includes(q.toLowerCase())).map((p) => ({ kind: "person", refId: p.id, label: p.name, sub: "Person" }));
      items = [...ppl, ...found.slice(0, 12), ...dates].slice(0, 14);
      idx = 0;
      draw();
    }
    function pick(i) {
      const it = items[i];
      const r = range;
      close();
      if (!it || !r) return;
      editor.chain().focus().deleteRange({ from: r.from, to: editor.state.selection.from }).insertSmartChip({ kind: it.kind, refId: it.refId, label: it.label }).run();
    }
    function close() { range = null; items = []; seq++; if (pop?.classList.contains("wp-chipmenu")) closePop(); }
    editor.view.dom.addEventListener("keydown", (e) => {
      if (!range || !items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; draw(); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); pick(idx); }
      else if (e.key === "Escape") close();
    }, true);
    return { open: (r) => query("", r), query, close };
  })();

  // ---- side panels -------------------------------------------------------------------------------------
  function closeSide() { for (const s of root.querySelectorAll("[data-side]")) s.hidden = true; if (previewing) endPreview(); }
  function openSide(kind) {
    for (const s of root.querySelectorAll("[data-side]")) if (!(kind === "outline" ? s.dataset.side === "outline" : s.dataset.side === "outline" && !isPhone())) s.hidden = s.dataset.side !== kind;
    $(`[data-side="${kind}"]`).hidden = false;
    if (kind === "outline") renderOutline($("[data-outline]"), editor);
    if (kind === "comments") comments ||= commentsPanel({ box: $("[data-comments]"), editor, ydoc: session.ydoc, me, people, mode: () => mode, host: root, onNotify: (ids, text) => deps.notifyMention?.(ids, text, nameInput.value) });
    if (kind === "versions") {
      if (!versions) versions = versionsPanel({ box: $("[data-versions]"), session, schema: editor.schema, people, me, host: root, onPreview: showPreview });
      else versions.reload();
    }
  }
  function toggleSide(kind) { const el = $(`[data-side="${kind}"]`); if (el.hidden) openSide(kind); else { el.hidden = true; if (kind === "versions" && previewing) endPreview(); } }
  $("[data-outline]").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-pos]");
    if (!a) return;
    e.preventDefault();
    const pos = Number(a.dataset.pos);
    editor.commands.setTextSelection(pos + 1);
    editor.view.nodeDOM(pos)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    if (isPhone()) closeSide();
  });
  editor.on("update", () => { if (!$('[data-side="outline"]').hidden) renderOutline($("[data-outline]"), editor); });

  // Version preview: the document is hidden and the version shown read-only.
  let previewSlot = null;
  function showPreview({ version, html }) {
    previewing = true;
    previewSlot = version.slot;
    applyEditable();
    sheet.hidden = true;
    const ps = $("[data-preview-sheet]");
    ps.hidden = false;
    ps.style.width = settings.pageless ? "" : `${pageBox(settings).w * PX_PER_IN}px`;
    const body = $("[data-preview-body]");
    body.replaceChildren(html);
    body.style.padding = settings.pageless ? "40px" : `${settings.marginTop * PX_PER_IN}px ${settings.marginRight * PX_PER_IN}px ${settings.marginBottom * PX_PER_IN}px ${settings.marginLeft * PX_PER_IN}px`;
    body.style.background = "var(--doc-paper)";
    for (const img of body.querySelectorAll("img[data-src]")) resolveImage(img.dataset.src).then((u) => { img.src = u; }).catch(() => {});
    const bar = $("[data-preview]");
    bar.hidden = false;
    const when = new Date(version.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    bar.innerHTML = `<strong>${esc(version.name || when)}</strong><button type="button" class="primary-btn" data-act="preview-restore">Restore this version</button><button type="button" class="secondary-btn" data-act="preview-close">Back to the current version</button>`;
    canvas.scrollTop = 0;
  }
  function endPreview() {
    previewing = false;
    previewSlot = null;
    $("[data-preview]").hidden = true;
    $("[data-preview-sheet]").hidden = true;
    sheet.hidden = false;
    versions?.clear();
    applyEditable();
    editor.view.__relayout?.();
  }
  async function restorePreview() {
    if (!previewSlot || mode === "viewing") return;
    if (!window.confirm("Restore this version? The document now becomes this version for everyone. The current version is kept in the history.")) return;
    const slot = previewSlot;
    endPreview();
    try {
      await session.restore(slot, copyFragment);
      toast("Version restored.");
      versions?.reload();
    } catch (e) { toast(e?.message || "That version couldn't be restored."); }
  }
  function copyFragment(from, to) {
    const json = yXmlFragmentToProseMirrorRootNode(from, editor.schema).toJSON();
    const tmpEditor = new Editor({ extensions: [...baseExtensions({ collaboration: true }), Collaboration.configure({ fragment: to })] });
    tmpEditor.commands.setContent(json);
    tmpEditor.destroy();
  }

  // ---- comments ------------------------------------------------------------------------------------------
  async function addComment() {
    if (editor.state.selection.empty) { toast("Select the text to comment on first."); return; }
    openSide("comments");
    await comments.add();
  }

  // ---- export -----------------------------------------------------------------------------------------
  const safeName = () => (nameInput.value.trim() || "Document").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
  async function shareBlob(blob, name, mime) {
    if (deps.share) return deps.share(blob, name, mime);
    const { saveFile } = await import("../../save-file.js");
    return saveFile(blob, name);
  }
  async function exportDocx() {
    statusEl.textContent = "Making the Word file…";
    try {
      const { docToDocx } = await import("./docx-export.js");
      const blob = await docToDocx({ json: editor.getJSON(), settings, ydoc: session.ydoc, schema: editor.schema, images: (id) => store.images.get(id), threads: comments ? null : null });
      await shareBlob(blob, `${safeName()}.docx`, blob.type);
    } catch (e) { toast(e?.message || "The Word file couldn't be made."); }
    session.subscribe(() => {})();
  }
  async function exportTxt() {
    await shareBlob(new Blob([nodeText(editor.state.doc)], { type: "text/plain" }), `${safeName()}.txt`, "text/plain");
  }
  async function exportPdf({ print = false } = {}) {
    const { printPages } = await import("./pdf-export.js");
    try {
      await printPages({ root, sheet, editor, settings, layout: lastLayout, geometry: geometry() || { pageW: 816, pageH: 1056, mt: 96, mb: 96, ml: 96, mr: 96 }, name: safeName(), print, nativePdf: deps.nativePdf, share: shareBlob, relayout: () => editor.view.__relayout?.() });
    } catch (e) { toast(e?.message || "The PDF couldn't be made."); }
  }

  // ---- title ----------------------------------------------------------------------------------------------
  const nameInput = $(".wp-title input");
  nameInput.addEventListener("change", async () => {
    const n = nameInput.value.trim();
    if (!n) { nameInput.value = file.name; return; }
    try { await store.rename(n); file.name = n; deps.rename?.(n); } catch (e) { toast(e?.message || "Couldn't rename."); nameInput.value = file.name; }
  });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); editor.commands.focus(); } });

  // ---- keyboard shortcuts not in the schema ---------------------------------------------------------------
  const onKey = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) { if (e.key === "Escape") closePop(); return; }
    const k = e.key.toLowerCase();
    if (k === "k" && !e.shiftKey) { e.preventDefault(); run("link"); }
    else if (k === "f" && !e.shiftKey && !e.altKey) { e.preventDefault(); openFind(); }
    else if (k === "h" && e.shiftKey) { e.preventDefault(); openFind(); }
    else if (k === "p" && !e.shiftKey) { e.preventDefault(); run("print"); }
    else if (k === "s") { e.preventDefault(); session.save(); }
    else if (k === "m" && e.altKey) { e.preventDefault(); run("comment"); }
    else if (k === "c" && e.shiftKey) { e.preventDefault(); run("wordCount"); }
    else if (e.key === "." && e.shiftKey) { e.preventDefault(); run("sizeUp"); }
    else if (e.key === "," && e.shiftKey) { e.preventDefault(); run("sizeDown"); }
    else if (e.key === "\\") { e.preventDefault(); run("clear"); }
    else if (e.altKey && /^[0-6]$/.test(e.key)) { e.preventDefault(); run(e.key === "0" ? "style_normal" : `style_h${e.key}`); }
    else if (k === "f" && e.altKey) { e.preventDefault(); run("footnote"); }
  };
  document.addEventListener("keydown", onKey);

  // ---- start -------------------------------------------------------------------------------------------
  drawToolbar();
  applySheet();
  setMode(deps.startMode || "editing");
  if (isPhone() && startEditing) startPhoneEditing();
  else if (!isPhone()) editor.commands.focus("start");
  editor.view.__relayout?.();

  async function close() {
    closePop();
    statusEl.textContent = "Saving…";
    try { await session.close(); } catch { /* kept on the device */ }
    comments?.destroy();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("keydown", onKey);
    unsub();
    editor.destroy();
    for (const p of imageUrls.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    root.remove();
    onClose?.({ name: file.name, text: "" });
  }
  return { close, editor, session, get _debug() { return { settings, lastLayout, mode }; } };
}

// The image's type from its first bytes (what the browser needs for a blob URL).
export function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
  return "application/octet-stream";
}

// Photos come in large: kept as they are up to 2400 px on the long side, else
// re-encoded as JPEG at that size (PNG kept for small images with transparency).
async function prepareImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be added here.");
  if (file.size > 30 * 1024 * 1024) throw new Error("That image is larger than 30 MB.");
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("That image couldn't be read."); }
  const scale = Math.min(1, MAX_IMAGE_PX / Math.max(bmp.width, bmp.height));
  const keep = scale === 1 && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type) && file.size < 4 * 1024 * 1024;
  if (keep) { bmp.close?.(); return new Uint8Array(await file.arrayBuffer()); }
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const png = file.type === "image/png" && c.width * c.height < 1_000_000;
  const blob = await new Promise((r) => c.toBlob(r, png ? "image/png" : "image/jpeg", 0.85));
  return new Uint8Array(await blob.arrayBuffer());
}
