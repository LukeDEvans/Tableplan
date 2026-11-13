// Node views and small plugins for the editor (WORD_PROCESSOR_DESIGN.md §2, §11):
// images from R2, the table of contents drawn from the headings, smart chips that
// open their item, the footnotes list at the end, find & replace highlighting, and
// the @ menu's trigger.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { IMAGE_SRC_RE } from "./extensions.js";

// ---- images ---------------------------------------------------------------------------------

export function imageNodeView(resolve) {
  return ({ node }) => {
    const wrap = document.createElement("span");
    wrap.className = "doc-img";
    wrap.contentEditable = "false";
    const img = document.createElement("img");
    img.className = "doc-image";
    img.draggable = false;
    wrap.appendChild(img);
    let current = null;
    const apply = (n) => {
      wrap.dataset.layout = n.attrs.layout || "inline";
      img.alt = n.attrs.alt || "";
      if (n.attrs.width) img.style.width = `${Math.round(n.attrs.width)}px`; else img.style.removeProperty("width");
      img.style.transform = n.attrs.rotate ? `rotate(${n.attrs.rotate}deg)` : "";
      const c = n.attrs.crop;
      img.style.clipPath = c ? `inset(${(c.t || 0) * 100}% ${(c.r || 0) * 100}% ${(c.b || 0) * 100}% ${(c.l || 0) * 100}%)` : "";
      if (n.attrs.src !== current) {
        current = n.attrs.src;
        img.removeAttribute("src");
        if (IMAGE_SRC_RE.test(current || "") && resolve) {
          resolve(current).then((url) => { if (current === n.attrs.src && url) img.src = url; else if (!url) wrap.classList.add("doc-img-missing"); }).catch(() => wrap.classList.add("doc-img-missing"));
        } else wrap.classList.add("doc-img-missing");
      }
    };
    apply(node);
    return {
      dom: wrap,
      update(n) { if (n.type.name !== "image") return false; apply(n); return true; },
      selectNode() { wrap.classList.add("ProseMirror-selectednode"); },
      deselectNode() { wrap.classList.remove("ProseMirror-selectednode"); },
      ignoreMutation: () => true,
    };
  };
}

// ---- table of contents -------------------------------------------------------------------------

export function headings(doc) {
  const out = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "heading") { out.push({ level: n.attrs.level, text: n.textContent.trim() || "(untitled)", pos }); return false; }
    if (n.type.name === "paragraph" && n.attrs.docStyle === "title") { out.push({ level: 0, text: n.textContent.trim() || "(untitled)", pos }); return false; }
    return n.type.name === "doc" || n.isBlock && !n.isTextblock;
  });
  return out;
}

export function tocNodeView(getPageOf) {
  return ({ node, editor }) => {
    const dom = document.createElement("div");
    dom.className = "doc-toc";
    dom.contentEditable = "false";
    dom.setAttribute("data-toc", "true");
    let withNumbers = node.attrs.withNumbers;
    const draw = () => {
      const hs = headings(editor.state.doc).filter((h) => h.level > 0);
      dom.replaceChildren();
      if (!hs.length) { const p = document.createElement("p"); p.className = "doc-toc-empty"; p.textContent = "Add headings (Format › Paragraph styles) and they'll appear here."; dom.appendChild(p); return; }
      for (const h of hs) {
        const a = document.createElement("a");
        a.href = "#";
        a.style.paddingLeft = `${(h.level - 1) * 16}px`;
        a.textContent = h.text;
        a.dataset.pos = String(h.pos);
        if (withNumbers) { const n = document.createElement("span"); n.className = "n"; n.textContent = String(getPageOf?.(h.pos) ?? ""); a.appendChild(n); }
        dom.appendChild(a);
      }
    };
    dom.addEventListener("mousedown", (e) => {
      const a = e.target.closest("a[data-pos]");
      if (!a) return;
      e.preventDefault();
      const pos = Number(a.dataset.pos);
      editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    });
    const off = () => editor.off("update", draw);
    editor.on("update", draw);
    draw();
    return { dom, update(n) { if (n.type.name !== "tableOfContents") return false; withNumbers = n.attrs.withNumbers; draw(); return true; }, destroy: off, ignoreMutation: () => true };
  };
}

// ---- smart chips --------------------------------------------------------------------------------

export function chipNodeView(isGone) {
  return ({ node }) => {
    const dom = document.createElement("span");
    dom.className = "doc-chip";
    dom.contentEditable = "false";
    const apply = (n) => {
      dom.dataset.kind = n.attrs.kind;
      dom.dataset.ref = n.attrs.refId || "";
      dom.textContent = n.attrs.label || "";
      dom.classList.toggle("is-gone", Boolean(isGone?.(n.attrs.kind, n.attrs.refId)));
    };
    apply(node);
    return { dom, update(n) { if (n.type.name !== "smartChip") return false; apply(n); return true; }, ignoreMutation: () => true };
  };
}

// Dates for the @ menu from what's typed: today, tomorrow, yesterday, weekdays, ISO dates.
export function dateSuggestions(q, now = new Date()) {
  const s = String(q || "").trim().toLowerCase();
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const add = (n) => { const d = day(now); d.setDate(d.getDate() + n); return d; };
  const label = (d) => d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out = [];
  const pushD = (name, d) => out.push({ kind: "date", refId: iso(d), label: label(d), sub: name });
  if ("today".startsWith(s) || !s) pushD("Today", add(0));
  if ("tomorrow".startsWith(s) || !s) pushD("Tomorrow", add(1));
  if (s && "yesterday".startsWith(s)) pushD("Yesterday", add(-1));
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const wd = days.findIndex((d) => s.length >= 3 && d.startsWith(s));
  if (wd >= 0) { const diff = (wd - now.getDay() + 7) % 7 || 7; pushD(days[wd][0].toUpperCase() + days[wd].slice(1), add(diff)); }
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const d = m[0].includes("-") ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[1]) - 1, Number(m[2]));
    if (!Number.isNaN(d.getTime())) pushD("Date", d);
  }
  return out;
}

// ---- footnotes listed at the end -------------------------------------------------------------

export const endnotesKey = new PluginKey("liveEndnotes");
export const Endnotes = Extension.create({
  name: "endnotes",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: endnotesKey,
      props: {
        decorations(state) {
          const notes = [];
          state.doc.descendants((n) => { if (n.type.name === "footnote") notes.push(n.attrs.text || ""); return true; });
          if (!notes.length) return DecorationSet.empty;
          const key = `fn-${notes.length}-${notes.join("\u0001").length}-${hash(notes.join("\u0001"))}`;
          const widget = Decoration.widget(state.doc.content.size, () => {
            const box = document.createElement("div");
            box.className = "wp-endnotes";
            box.contentEditable = "false";
            const ol = document.createElement("ol");
            for (const t of notes) { const li = document.createElement("li"); li.textContent = t || " "; ol.appendChild(li); }
            box.appendChild(ol);
            return box;
          }, { side: 1, key, ignoreSelection: true });
          return DecorationSet.create(state.doc, [widget]);
        },
      },
    })];
  },
});
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ---- find & replace ----------------------------------------------------------------------------

export const findKey = new PluginKey("liveFind");

// Matches of a query in a document: [{ from, to }]. Text inside one textblock only.
export function findMatches(doc, query, { matchCase = false, regex = false } = {}) {
  if (!query) return [];
  let re;
  try { re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi"); } catch { return []; }
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map = [];
    node.forEach((child, off) => {
      if (child.isText) { for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + off + i); text += child.text; }
      else { map.push(pos + 1 + off); text += "￼"; }
    });
    map.push(pos + 1 + node.content.size);
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 10000) {
      if (!m[0].length) { re.lastIndex++; continue; }
      out.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1, text: m[0], groups: m });
      if (out.length > 5000) return false;
    }
    return false;
  });
  return out;
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addStorage: () => ({ query: "", matchCase: false, regex: false, index: 0, matches: [] }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: findKey,
      props: {
        decorations(state) {
          if (!storage.query) return DecorationSet.empty;
          storage.matches = findMatches(state.doc, storage.query, storage);
          if (storage.index >= storage.matches.length) storage.index = 0;
          return DecorationSet.create(state.doc, storage.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === storage.index ? "find-hit is-current" : "find-hit" })));
        },
      },
    })];
  },
});

// ---- the @ trigger --------------------------------------------------------------------------------

// Calls onOpen(range) when "@" is typed at a word start, onQuery(text, range) as typing
// continues, onClose() when the cursor leaves it.
export function atTrigger({ onOpen, onQuery, onClose }) {
  const key = new PluginKey("liveAt");
  return Extension.create({
    name: "atTrigger",
    addProseMirrorPlugins() {
      let active = null; // { from }
      return [new Plugin({
        key,
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== "@") return false;
            const before = from > 0 ? view.state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n") : "";
            if (before && /[\p{L}\p{N}_.+-]/u.test(before) && !/[.!?,;:)]/.test(before)) return false; // not inside a word or an email address
            active = { from };
            setTimeout(() => { if (active?.from === from) onOpen({ from, to: from + 1 }); }, 0);
            return false;
          },
        },
        view: () => ({
          update(view) {
            if (!active) return;
            const { from } = active;
            const sel = view.state.selection;
            const ch = from < view.state.doc.content.size ? view.state.doc.textBetween(from, Math.min(from + 1, view.state.doc.content.size)) : "";
            if (!sel.empty || sel.from <= from || ch !== "@") { active = null; onClose(); return; }
            const q = view.state.doc.textBetween(from + 1, sel.from, "\n", "\n");
            if (q.length > 40 || /\n/.test(q) || /\s{2}/.test(q)) { active = null; onClose(); return; }
            onQuery(q, { from, to: sel.from });
          },
          destroy() { active = null; },
        }),
      })];
    },
  });
}
