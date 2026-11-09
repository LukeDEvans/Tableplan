// The word processor's document schema (WORD_PROCESSOR_DESIGN.md §2): Tiptap's open
// source core plus the formatting Google Docs has. Usable without a DOM (tests build
// the schema with getSchema(baseExtensions())); the editor adds collaboration and the
// node views on top (documents/editor/editor.js).
//
// Safety: every attribute that reaches a style or an attribute is checked here
// (colours, sizes, fonts, ids), so a document from someone else — an import, a
// co-editor, a Google Doc — can't put arbitrary CSS or markup into the page.

import { Extension, Node, Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit, TableCell, TableHeader } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import { cleanFontName, fontStack, DEFAULT_SIZE } from "./fonts.js";

// ---- checks ------------------------------------------------------------------------------

export function safeColor(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/.test(s)) return s;
  const m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([01]?(?:\.\d+)?))?\s*\)$/);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}
const num = (v, min, max) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
export const safeId = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const ptFromCss = (v) => {
  const s = String(v || "");
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return s.endsWith("px") ? Math.round(n * 0.75 * 2) / 2 : n;
};

export const LINE_HEIGHTS = Object.freeze([1, 1.15, 1.5, 2]);
export const DOC_STYLES = Object.freeze(["normal", "title", "subtitle"]);
export const ORDERED_STYLES = Object.freeze(["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman", "decimal-leading-zero"]);
export const BULLET_STYLES = Object.freeze(["disc", "circle", "square", "dash", "arrow", "star"]);
export const MAX_INDENT = 8;
const INDENT_PT = 36; // half an inch per level, as Docs

// ---- text marks: font, size, colour --------------------------------------------------------

// fontFamily / fontSize / color on textStyle, stored as plain values and rendered
// through the font list (fonts.js) so stored text never becomes CSS directly.
const TextStyleAttrs = Extension.create({
  name: "liveTextStyle",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontFamily: {
          default: null,
          parseHTML: (el) => cleanFontName((el.style.fontFamily || "").split(",")[0]) || null,
          renderHTML: (a) => (a.fontFamily ? { style: `font-family: ${fontStack(a.fontFamily)}` } : {}),
        },
        fontSize: {
          default: null,
          parseHTML: (el) => num(ptFromCss(el.style.fontSize), 1, 400),
          renderHTML: (a) => (num(a.fontSize, 1, 400) ? { style: `font-size: ${num(a.fontSize, 1, 400)}pt` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontFamily: (name) => ({ chain }) => chain().setMark("textStyle", { fontFamily: cleanFontName(name) || null }).run(),
      unsetFontFamily: () => ({ chain }) => chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
      setFontSize: (pt) => ({ chain }) => chain().setMark("textStyle", { fontSize: num(pt, 1, 400) }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// Color's own renderer writes the stored value into style; check it first.
const SafeColor = Color.extend({
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        color: {
          default: null,
          parseHTML: (el) => safeColor(el.style.color),
          renderHTML: (a) => (safeColor(a.color) ? { style: `color: ${safeColor(a.color)}` } : {}),
        },
      },
    }];
  },
});

const SafeHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => safeColor(el.getAttribute("data-color") || el.style.backgroundColor),
        renderHTML: (a) => (safeColor(a.color) ? { "data-color": safeColor(a.color), style: `background-color: ${safeColor(a.color)}; color: inherit` } : {}),
      },
    };
  },
}).configure({ multicolor: true });

// ---- paragraph format: line spacing, space before/after, indents, styles -----------------------

const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => num(el.style.lineHeight, 0.5, 5),
          renderHTML: (a) => (num(a.lineHeight, 0.5, 5) ? { style: `line-height: ${num(a.lineHeight, 0.5, 5)}` } : {}),
        },
        spaceBefore: {
          default: null,
          parseHTML: (el) => num(ptFromCss(el.style.marginTop), 0, 200),
          renderHTML: (a) => (num(a.spaceBefore, 0, 200) !== null ? { style: `margin-top: ${num(a.spaceBefore, 0, 200)}pt` } : {}),
        },
        spaceAfter: {
          default: null,
          parseHTML: (el) => num(ptFromCss(el.style.marginBottom), 0, 200),
          renderHTML: (a) => (num(a.spaceAfter, 0, 200) !== null ? { style: `margin-bottom: ${num(a.spaceAfter, 0, 200)}pt` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: (el) => Math.round((num(ptFromCss(el.style.marginLeft), 0, 1000) || 0) / INDENT_PT),
          renderHTML: (a) => (a.indent > 0 ? { style: `margin-left: ${Math.min(MAX_INDENT, a.indent) * INDENT_PT}pt` } : {}),
        },
        // First-line (positive) or hanging (negative) indent, in points.
        textIndent: {
          default: null,
          parseHTML: (el) => num(ptFromCss(el.style.textIndent), -200, 200),
          renderHTML: (a) => {
            const t = num(a.textIndent, -200, 200);
            if (!t) return {};
            return t < 0 ? { style: `text-indent: ${t}pt; padding-left: ${-t}pt` } : { style: `text-indent: ${t}pt` };
          },
        },
        pageBreakBefore: {
          default: false,
          parseHTML: (el) => el.style.breakBefore === "page" || el.style.pageBreakBefore === "always",
          renderHTML: (a) => (a.pageBreakBefore ? { "data-page-break-before": "true" } : {}),
        },
        keepWithNext: {
          default: false,
          parseHTML: (el) => el.dataset.keepWithNext === "true",
          renderHTML: (a) => (a.keepWithNext ? { "data-keep-with-next": "true" } : {}),
        },
        keepLinesTogether: {
          default: false,
          parseHTML: (el) => el.dataset.keepLines === "true",
          renderHTML: (a) => (a.keepLinesTogether ? { "data-keep-lines": "true" } : {}),
        },
      },
    }, {
      types: ["paragraph"],
      attributes: {
        docStyle: {
          default: "normal",
          parseHTML: (el) => (DOC_STYLES.includes(el.dataset.docStyle) ? el.dataset.docStyle : "normal"),
          renderHTML: (a) => (a.docStyle && a.docStyle !== "normal" && DOC_STYLES.includes(a.docStyle) ? { "data-doc-style": a.docStyle, class: `doc-${a.docStyle}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const blockTypes = ["paragraph", "heading"];
    const each = (fn) => ({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!blockTypes.includes(node.type.name)) return true;
        const next = fn(node.attrs, node);
        if (next) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next }); changed = true; }
        return false;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return {
      setParagraphFormat: (attrs) => each(() => attrs),
      setLineHeight: (v) => each(() => ({ lineHeight: num(v, 0.5, 5) })),
      indentMore: () => each((a) => ({ indent: Math.min(MAX_INDENT, (a.indent || 0) + 1) })),
      indentLess: () => each((a) => ({ indent: Math.max(0, (a.indent || 0) - 1) })),
      setDocStyle: (style) => ({ chain }) => {
        if (style === "normal" || style === "title" || style === "subtitle") {
          return chain().setParagraph().updateAttributes("paragraph", { docStyle: style }).run();
        }
        const level = Number(String(style).replace(/^h/, ""));
        if (level >= 1 && level <= 6) return chain().setHeading({ level }).run();
        return false;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-]": () => this.editor.commands.indentMore(),
      "Mod-[": () => this.editor.commands.indentLess(),
      "Mod-Alt-0": () => this.editor.commands.setDocStyle("normal"),
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
    };
  },
});

// List styles: numbered (1., a., i., …) and bulleted (●, ○, ■, –, ➔, ★).
const ListStyles = Extension.create({
  name: "listStyles",
  addGlobalAttributes() {
    return [{
      types: ["orderedList"],
      attributes: {
        listStyle: {
          default: "decimal",
          parseHTML: (el) => (ORDERED_STYLES.includes(el.style.listStyleType) ? el.style.listStyleType : ({ a: "lower-alpha", A: "upper-alpha", i: "lower-roman", I: "upper-roman" }[el.getAttribute("type")] || "decimal")),
          renderHTML: (a) => (ORDERED_STYLES.includes(a.listStyle) && a.listStyle !== "decimal" ? { style: `list-style-type: ${a.listStyle}`, "data-list-style": a.listStyle } : {}),
        },
      },
    }, {
      types: ["bulletList"],
      attributes: {
        bulletStyle: {
          default: "disc",
          parseHTML: (el) => (BULLET_STYLES.includes(el.dataset.bulletStyle) ? el.dataset.bulletStyle : BULLET_STYLES.includes(el.style.listStyleType) ? el.style.listStyleType : "disc"),
          renderHTML: (a) => (BULLET_STYLES.includes(a.bulletStyle) && a.bulletStyle !== "disc" ? { "data-bullet-style": a.bulletStyle } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setListStyle: (style) => ({ commands, editor }) => {
        if (ORDERED_STYLES.includes(style)) {
          if (!editor.isActive("orderedList")) commands.toggleOrderedList();
          return commands.updateAttributes("orderedList", { listStyle: style });
        }
        if (BULLET_STYLES.includes(style)) {
          if (!editor.isActive("bulletList")) commands.toggleBulletList();
          return commands.updateAttributes("bulletList", { bulletStyle: style });
        }
        return false;
      },
      restartNumbering: (start = 1) => ({ commands }) => commands.updateAttributes("orderedList", { start: Math.max(0, Math.floor(start)) }),
    };
  },
});

// ---- change case, clear formatting -----------------------------------------------------------

export function changeCase(text, mode, atStart = true) {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") {
    let start = atStart;
    let out = "";
    for (const ch of text) {
      out += start ? ch.toUpperCase() : ch.toLowerCase();
      start = /\s/.test(ch);
    }
    return out;
  }
  return text;
}

const TextTools = Extension.create({
  name: "textTools",
  addCommands() {
    return {
      changeCase: (mode) => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        let prevSpace = true;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) { if (node.isBlock) prevSpace = true; return true; }
          const s = Math.max(from, pos);
          const e = Math.min(to, pos + node.text.length);
          if (e <= s) return false;
          const piece = node.text.slice(s - pos, e - pos);
          const before = s > pos ? node.text[s - pos - 1] : null;
          const atStart = before === null ? prevSpace : /\s/.test(before);
          const next = changeCase(piece, mode, atStart);
          prevSpace = /\s$/.test(piece);
          if (next !== piece) tr.insertText(next, tr.mapping.map(s), tr.mapping.map(e));
          return false;
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      // Format › Clear formatting: text marks off (links, comments and suggestions stay),
      // paragraph format back to Normal.
      clearFormatting: () => ({ chain, state }) => {
        const keep = new Set(["link", "comment", "insertion", "deletion"]);
        let c = chain();
        for (const name of Object.keys(state.schema.marks)) if (!keep.has(name)) c = c.unsetMark(name, { extendEmptyMarkRange: true });
        return c.setParagraphFormat({ lineHeight: null, spaceBefore: null, spaceAfter: null, indent: 0, textIndent: null }).unsetTextAlign().run();
      },
    };
  },
});

// ---- block nodes: page break, table of contents ------------------------------------------------

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }, { tag: "hr[data-page-break]" }],
  renderHTML: () => ["div", { "data-page-break": "true", class: "doc-page-break", contenteditable: "false" }],
  addCommands() {
    return { insertPageBreak: () => ({ commands }) => commands.insertContent([{ type: "pageBreak" }, { type: "paragraph" }]) };
  },
  addKeyboardShortcuts() { return { "Mod-Enter": () => this.editor.commands.insertPageBreak() }; },
});

// The table of contents is drawn from the headings at render time (node view in the
// editor; docx export writes a real Word TOC field).
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ withNumbers: { default: false } }),
  parseHTML: () => [{ tag: "div[data-toc]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-toc": "true", class: "doc-toc" })],
  addCommands() {
    return { insertTableOfContents: (withNumbers = false) => ({ commands }) => commands.insertContent({ type: "tableOfContents", attrs: { withNumbers } }) };
  },
});

// ---- inline atoms: footnote, bookmark, smart chip, page number -----------------------------

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    id: { default: null, parseHTML: (el) => safeId(el.dataset.id) },
    text: { default: "", parseHTML: (el) => String(el.dataset.text || "").slice(0, 4000) },
  }),
  parseHTML: () => [{ tag: "sup[data-footnote]" }],
  renderHTML: ({ node }) => ["sup", { "data-footnote": "true", "data-id": safeId(node.attrs.id) || "", "data-text": String(node.attrs.text || "").slice(0, 4000), class: "doc-footnote-ref" }, "*"],
  addCommands() {
    return { insertFootnote: (text = "") => ({ commands }) => commands.insertContent({ type: "footnote", attrs: { id: shortId(), text } }) };
  },
});

export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => safeId(el.id?.replace(/^bm-/, "")) } }),
  parseHTML: () => [{ tag: "span[data-bookmark]" }],
  renderHTML: ({ node }) => ["span", { "data-bookmark": "true", id: `bm-${safeId(node.attrs.id) || "x"}`, class: "doc-bookmark", title: "Bookmark" }],
  addCommands() {
    return { insertBookmark: () => ({ commands }) => commands.insertContent({ type: "bookmark", attrs: { id: shortId() } }) };
  },
});

// @ items from Live (§11): stores only kind + id + the label last seen.
export const CHIP_KINDS = Object.freeze(["person", "date", "document", "recipe", "event", "trip", "contact"]);
export const SmartChip = Node.create({
  name: "smartChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    kind: { default: "date", parseHTML: (el) => (CHIP_KINDS.includes(el.dataset.kind) ? el.dataset.kind : "date") },
    refId: { default: null, parseHTML: (el) => String(el.dataset.ref || "").slice(0, 120) || null },
    label: { default: "", parseHTML: (el) => String(el.textContent || "").slice(0, 200) },
  }),
  parseHTML: () => [{ tag: "span[data-chip]" }],
  renderHTML: ({ node }) => ["span", { "data-chip": "true", "data-kind": CHIP_KINDS.includes(node.attrs.kind) ? node.attrs.kind : "date", "data-ref": String(node.attrs.refId || "").slice(0, 120), class: "doc-chip" }, String(node.attrs.label || "").slice(0, 200)],
  renderText: ({ node }) => String(node.attrs.label || ""),
  addCommands() {
    return { insertSmartChip: (attrs) => ({ commands }) => commands.insertContent([{ type: "smartChip", attrs }, { type: "text", text: " " }]) };
  },
});

// In headers and footers: the page's number, filled in by the page layout.
export const PageNumber = Node.create({
  name: "pageNumber",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ total: { default: false } }),
  parseHTML: () => [{ tag: "span[data-page-number]" }],
  renderHTML: ({ node }) => ["span", { "data-page-number": node.attrs.total ? "total" : "page", class: "doc-page-number" }, "#"],
  addCommands() {
    return { insertPageNumber: (total = false) => ({ commands }) => commands.insertContent({ type: "pageNumber", attrs: { total } }) };
  },
});

// ---- image: kept in R2 as its own part, referenced as liveimg:<32 hex> ---------------------

export const IMAGE_SRC_RE = /^liveimg:[0-9a-f]{32}$/;
export const IMAGE_LAYOUTS = Object.freeze(["inline", "wrap-left", "wrap-right", "break"]);
export const LiveImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addOptions: () => ({ resolve: null }), // (src) → Promise<url | null>
  addAttributes: () => ({
    src: { default: null, parseHTML: (el) => (IMAGE_SRC_RE.test(el.getAttribute("data-src") || "") ? el.getAttribute("data-src") : null) },
    alt: { default: "", parseHTML: (el) => String(el.getAttribute("alt") || "").slice(0, 500) },
    width: { default: null, parseHTML: (el) => num(el.getAttribute("width"), 16, 2000) },
    layout: { default: "inline", parseHTML: (el) => (IMAGE_LAYOUTS.includes(el.dataset.layout) ? el.dataset.layout : "inline") },
    rotate: { default: 0, parseHTML: (el) => [0, 90, 180, 270].includes(Number(el.dataset.rotate)) ? Number(el.dataset.rotate) : 0 },
    crop: { default: null, parseHTML: (el) => parseCrop(el.dataset.crop) }, // { t, r, b, l } as fractions
  }),
  parseHTML: () => [{ tag: "img[data-src]" }],
  renderHTML: ({ node }) => ["img", {
    "data-src": IMAGE_SRC_RE.test(node.attrs.src || "") ? node.attrs.src : "",
    alt: String(node.attrs.alt || "").slice(0, 500),
    ...(num(node.attrs.width, 16, 2000) ? { width: String(num(node.attrs.width, 16, 2000)) } : {}),
    "data-layout": IMAGE_LAYOUTS.includes(node.attrs.layout) ? node.attrs.layout : "inline",
    "data-rotate": String([0, 90, 180, 270].includes(node.attrs.rotate) ? node.attrs.rotate : 0),
    ...(parseCrop(node.attrs.crop) ? { "data-crop": JSON.stringify(parseCrop(node.attrs.crop)) } : {}),
    class: "doc-image",
  }],
});
function parseCrop(v) {
  let c = v;
  if (typeof v === "string") { try { c = JSON.parse(v); } catch { return null; } }
  if (!c || typeof c !== "object") return null;
  const out = {};
  for (const k of ["t", "r", "b", "l"]) out[k] = num(c[k], 0, 0.45) || 0;
  return out.t || out.r || out.b || out.l ? out : null;
}

// ---- comments and suggestions (marks; the threads live in the Y.Doc) ------------------------------

export const CommentMark = Mark.create({
  name: "comment",
  excludes: "", // several comments may cover the same text
  inclusive: false,
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => safeId(el.dataset.commentId) } }),
  parseHTML: () => [{ tag: "span[data-comment-id]" }],
  renderHTML: ({ mark }) => ["span", { "data-comment-id": safeId(mark.attrs.id) || "", class: "doc-comment" }, 0],
});

const suggestionAttrs = () => ({
  id: { default: null, parseHTML: (el) => safeId(el.dataset.sid) },
  author: { default: null, parseHTML: (el) => safeId(el.dataset.author) || (String(el.dataset.author || "").match(/^[0-9a-f-]{36}$/) ? el.dataset.author : null) },
  name: { default: "", parseHTML: (el) => String(el.dataset.name || "").slice(0, 80) },
  at: { default: 0, parseHTML: (el) => Number(el.dataset.at) || 0 },
});
const suggestionRender = (tag, cls) => ({ mark }) => [tag, {
  "data-sid": safeId(mark.attrs.id) || "", "data-author": String(mark.attrs.author || "").slice(0, 64), "data-name": String(mark.attrs.name || "").slice(0, 80),
  "data-at": String(Number(mark.attrs.at) || 0), class: cls, title: `${String(mark.attrs.name || "Someone").slice(0, 80)} suggested this`,
}, 0];
export const Insertion = Mark.create({
  name: "insertion",
  inclusive: true,
  addAttributes: suggestionAttrs,
  parseHTML: () => [{ tag: "ins[data-sid]" }],
  renderHTML: suggestionRender("ins", "doc-ins"),
});
export const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  addAttributes: suggestionAttrs,
  parseHTML: () => [{ tag: "del[data-sid]" }],
  renderHTML: suggestionRender("del", "doc-del"),
});

// Table cells: background colour and vertical alignment.
const cellAttrs = {
  background: { default: null, parseHTML: (el) => safeColor(el.style.backgroundColor || el.getAttribute("data-bg")), renderHTML: (a) => (safeColor(a.background) ? { style: `background-color: ${safeColor(a.background)}` } : {}) },
  verticalAlign: { default: null, parseHTML: (el) => (["top", "middle", "bottom"].includes(el.style.verticalAlign) ? el.style.verticalAlign : null), renderHTML: (a) => (["middle", "bottom"].includes(a.verticalAlign) ? { style: `vertical-align: ${a.verticalAlign}` } : {}) },
};
const LiveCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
const LiveHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });

let idCounter = 0;
export function shortId() {
  const r = globalThis.crypto?.getRandomValues ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("") : `${Date.now().toString(16)}${(idCounter++).toString(16)}`;
  return r.slice(0, 16);
}

// The schema's extensions. { collaboration: true } leaves out Tiptap's own undo
// history (Yjs keeps a per-person one instead).
export function baseExtensions({ collaboration = false, placeholder = "", resolveImage = null } = {}) {
  return [
    StarterKit.configure({
      undoRedo: collaboration ? false : undefined,
      link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "tel"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" }, isAllowedUri: (url) => /^(https?:|mailto:|tel:|#bm-)/i.test(String(url || "")) },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
    }),
    TextStyle, TextStyleAttrs, SafeColor, SafeHighlight, Subscript, Superscript,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    ParagraphFormat, ListStyles, TextTools,
    TaskList, TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, lastColumnResizable: false }, tableCell: false, tableHeader: false }), LiveCell, LiveHeader,
    LiveImage.configure({ resolve: resolveImage }),
    PageBreak, TableOfContents, Footnote, Bookmark, SmartChip, PageNumber,
    InlineMath, BlockMath,
    CommentMark, Insertion, Deletion,
    CharacterCount,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

export { DEFAULT_SIZE };
