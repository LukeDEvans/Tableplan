// File › Download › Microsoft Word (WORD_PROCESSOR_DESIGN.md §9), made on the device
// with the `docx` library (MIT). Keeps what Word can hold: styles, fonts, sizes,
// colours, highlights, links, lists (bulleted, numbered, checklists), tables with cell
// colours, images, page breaks, footnotes, the table of contents (as a Word TOC field),
// headers and footers with page numbers, page size / orientation / margins, comments
// (each thread as one Word comment) and suggestions (as Word tracked changes).
//
// docToDocx({ json, settings, ydoc?, schema?, images?(id) → bytes, imageSize?(bytes) })
// → Blob. Loaded only when someone downloads.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, InternalHyperlink, Bookmark,
  Table, TableRow, TableCell, WidthType, ShadingType, ImageRun, PageBreak, PageNumber, Header, Footer,
  FootnoteReferenceRun, TableOfContents, CommentRangeStart, CommentRangeEnd, CommentReference, InsertedTextRun, DeletedTextRun,
  LevelFormat, PageOrientation, BorderStyle, LineRuleType,
} from "docx";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { pageBox } from "./doc-model.js";
import { listThreads } from "./doc-model.js";

const TWIP_PER_IN = 1440;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6 };
const NUM_FORMAT = { decimal: LevelFormat.DECIMAL, "lower-alpha": LevelFormat.LOWER_LETTER, "upper-alpha": LevelFormat.UPPER_LETTER, "lower-roman": LevelFormat.LOWER_ROMAN, "upper-roman": LevelFormat.UPPER_ROMAN, "decimal-leading-zero": LevelFormat.DECIMAL_ZERO };
const hex = (c) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? (c.length === 4 ? c.slice(1).split("").map((x) => x + x).join("") : c.slice(1, 7)).toUpperCase() : undefined);

export async function docToDocx({ json, settings, ydoc = null, schema = null, images = null, imageSize = defaultImageSize }) {
  const box = pageBox(settings);
  const contentWidthIn = Math.max(1, box.w - settings.marginLeft - settings.marginRight);
  const footnotes = {};
  let footnoteId = 0;
  const comments = [];
  const threads = ydoc ? new Map(listThreads(ydoc).map((t) => [t.id, t])) : new Map();
  const commentIds = new Map(); // thread id → numeric id
  let revId = 1;
  const numberingConfigs = [];
  let listInstance = 0;
  const imageCache = new Map();

  async function image(attrs) {
    const id = String(attrs.src || "").replace(/^liveimg:/, "");
    if (!images || !/^[0-9a-f]{32}$/.test(id)) return null;
    let bytes = imageCache.get(id);
    if (!bytes) { try { bytes = await images(id); imageCache.set(id, bytes); } catch { return null; } }
    const type = bytes[0] === 0x89 ? "png" : bytes[0] === 0x47 ? "gif" : bytes[0] === 0x42 ? "bmp" : "jpg";
    const nat = await imageSize(bytes);
    const maxW = contentWidthIn * 96;
    let w = attrs.width || nat.w || 400;
    w = Math.min(w, maxW);
    const h = nat.w ? Math.round((nat.h / nat.w) * w) : Math.round(w * 0.75);
    return new ImageRun({ type, data: bytes, transformation: { width: Math.round(w), height: h, ...(attrs.rotate ? { rotation: attrs.rotate } : {}) }, altText: { name: "Image", description: attrs.alt || "", title: attrs.alt || "" } });
  }

  // Inline content of a textblock → runs.
  async function runs(nodes = []) {
    const out = [];
    for (const n of nodes) {
      const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || {}]));
      const style = marks.textStyle || {};
      const base = {
        bold: Boolean(marks.bold) || undefined,
        italics: Boolean(marks.italic) || undefined,
        underline: marks.underline ? {} : undefined,
        strike: Boolean(marks.strike) || undefined,
        superScript: Boolean(marks.superscript) || undefined,
        subScript: Boolean(marks.subscript) || undefined,
        color: hex(style.color),
        font: style.fontFamily || (marks.code ? "Courier New" : undefined),
        size: style.fontSize ? Math.round(style.fontSize * 2) : undefined,
        shading: marks.highlight ? { type: ShadingType.CLEAR, fill: hex(marks.highlight.color) || "FFFF00", color: "auto" } : undefined,
      };
      let run;
      if (n.type === "text") run = { text: n.text };
      else if (n.type === "hardBreak") run = { break: 1 };
      else if (n.type === "smartChip") run = { text: n.attrs?.label || "" };
      else if (n.type === "inlineMath") run = { text: n.attrs?.latex || "", italics: true };
      else if (n.type === "image") { const img = await image(n.attrs || {}); if (img) out.push(img); continue; }
      else if (n.type === "footnote") {
        footnoteId += 1;
        footnotes[footnoteId] = { children: [new Paragraph({ children: [new TextRun(String(n.attrs?.text || ""))] })] };
        out.push(new FootnoteReferenceRun(footnoteId));
        continue;
      } else if (n.type === "bookmark") { out.push(new Bookmark({ id: `bm-${n.attrs?.id || "x"}`, children: [] })); continue; }
      else if (n.type === "pageNumber") { out.push(new TextRun({ ...base, children: [n.attrs?.total ? PageNumber.TOTAL_PAGES : PageNumber.CURRENT] })); continue; }
      else continue;
      let piece;
      const opts = { ...base, ...run };
      if (marks.insertion) piece = new InsertedTextRun({ ...opts, id: revId++, author: marks.insertion.name || "Someone", date: new Date(marks.insertion.at || Date.now()).toISOString() });
      else if (marks.deletion) piece = new DeletedTextRun({ ...opts, id: revId++, author: marks.deletion.name || "Someone", date: new Date(marks.deletion.at || Date.now()).toISOString() });
      else piece = new TextRun(opts);
      if (marks.link?.href) {
        const href = String(marks.link.href);
        piece = href.startsWith("#bm-")
          ? new InternalHyperlink({ anchor: href.slice(1), children: [new TextRun({ ...opts, style: "Hyperlink" })] })
          : /^(https?:|mailto:|tel:)/i.test(href) ? new ExternalHyperlink({ link: href, children: [new TextRun({ ...opts, style: "Hyperlink" })] }) : piece;
      }
      if (marks.comment?.id && threads.has(marks.comment.id)) {
        const cid = commentIdFor(marks.comment.id);
        out.push(new CommentRangeStart(cid), piece, new CommentRangeEnd(cid), new TextRun({ children: [new CommentReference(cid)] }));
      } else out.push(piece);
    }
    return out;
  }

  function commentIdFor(threadId) {
    if (commentIds.has(threadId)) return commentIds.get(threadId);
    const id = commentIds.size;
    commentIds.set(threadId, id);
    const t = threads.get(threadId);
    const first = t.replies[0] || { name: "Someone", text: "", at: Date.now() };
    comments.push({
      id, author: first.name || "Someone", date: new Date(first.at || Date.now()),
      children: t.replies.map((r, i) => new Paragraph({ children: [new TextRun({ text: i ? `${r.name || "Someone"}: ${r.text}` : r.text })] })),
    });
    return id;
  }

  function paraOptions(n) {
    const a = n.attrs || {};
    const o = {};
    if (ALIGN[a.textAlign]) o.alignment = ALIGN[a.textAlign];
    const spacing = {};
    if (a.spaceBefore != null) spacing.before = Math.round(a.spaceBefore * 20);
    if (a.spaceAfter != null) spacing.after = Math.round(a.spaceAfter * 20);
    if (a.lineHeight) { spacing.line = Math.round(a.lineHeight * 240); spacing.lineRule = LineRuleType.AUTO; }
    if (Object.keys(spacing).length) o.spacing = spacing;
    const indent = {};
    if (a.indent) indent.left = a.indent * 720;
    if (a.textIndent > 0) indent.firstLine = Math.round(a.textIndent * 20);
    if (a.textIndent < 0) indent.hanging = Math.round(-a.textIndent * 20);
    if (Object.keys(indent).length) o.indent = indent;
    if (a.pageBreakBefore) o.pageBreakBefore = true;
    if (a.keepWithNext) o.keepNext = true;
    if (a.keepLinesTogether) o.keepLines = true;
    return o;
  }

  async function blocks(nodes = [], ctx = {}) {
    const out = [];
    for (const n of nodes) {
      switch (n.type) {
        case "paragraph": {
          const o = paraOptions(n);
          if (n.attrs?.docStyle === "title") o.heading = HeadingLevel.TITLE;
          if (n.attrs?.docStyle === "subtitle") o.style = "Subtitle";
          if (ctx.list) Object.assign(o, ctx.list);
          const children = await runs(n.content);
          if (ctx.check != null) children.unshift(new TextRun(ctx.check ? "☑ " : "☐ "));
          out.push(new Paragraph({ ...o, children }));
          ctx = { ...ctx, check: null }; // only the item's first paragraph gets the box
          break;
        }
        case "heading": out.push(new Paragraph({ ...paraOptions(n), heading: HEADING[n.attrs?.level] || HeadingLevel.HEADING_1, children: await runs(n.content) })); break;
        case "blockquote": out.push(...(await blocks(n.content, { ...ctx, list: { indent: { left: 720 } } }))); break;
        case "bulletList":
        case "orderedList":
        case "taskList": {
          const level = (ctx.level ?? -1) + 1;
          let ref = ctx.ref;
          if (n.type === "orderedList" && (level === 0 || !ref)) {
            ref = `num${++listInstance}`;
            const fmt = NUM_FORMAT[n.attrs?.listStyle] || LevelFormat.DECIMAL;
            numberingConfigs.push({ reference: ref, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => ({ level: l, format: l === 0 ? fmt : [LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL][l % 3], text: `%${l + 1}.`, alignment: AlignmentType.LEFT, start: l === 0 ? Number(n.attrs?.start) || 1 : 1, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } })) });
          }
          for (const item of n.content || []) {
            const list = n.type === "bulletList" ? { bullet: { level } } : n.type === "orderedList" ? { numbering: { reference: ref, level } } : { indent: { left: 360 * (level + 1) } };
            const check = n.type === "taskList" ? Boolean(item.attrs?.checked) : null;
            out.push(...(await blocks(item.content, { level, ref, list, check })));
          }
          break;
        }
        case "listItem":
        case "taskItem": out.push(...(await blocks(n.content, ctx))); break;
        case "horizontalRule": out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, children: [] })); break;
        case "pageBreak": out.push(new Paragraph({ children: [new PageBreak()] })); break;
        case "blockMath": out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: n.attrs?.latex || "", italics: true })] })); break;
        case "tableOfContents": out.push(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-6" })); break;
        case "table": out.push(await table(n)); break;
        default: if (n.content) out.push(...(await blocks(n.content, ctx)));
      }
    }
    return out;
  }

  async function table(n) {
    const rows = [];
    const cols = Math.max(1, ...(n.content || []).map((r) => (r.content || []).reduce((s, c) => s + (c.attrs?.colspan || 1), 0)));
    const width = contentWidthIn * TWIP_PER_IN;
    for (const [ri, r] of (n.content || []).entries()) {
      const cells = [];
      for (const c of r.content || []) {
        const kids = await blocks(c.content);
        cells.push(new TableCell({
          children: kids.length ? kids : [new Paragraph("")],
          columnSpan: c.attrs?.colspan > 1 ? c.attrs.colspan : undefined,
          rowSpan: c.attrs?.rowspan > 1 ? c.attrs.rowspan : undefined,
          shading: hex(c.attrs?.background) ? { type: ShadingType.CLEAR, fill: hex(c.attrs.background), color: "auto" } : c.type === "tableHeader" ? { type: ShadingType.CLEAR, fill: "F8F9FA", color: "auto" } : undefined,
          width: c.attrs?.colwidth?.[0] ? { size: Math.round(c.attrs.colwidth[0] * 15), type: WidthType.DXA } : undefined,
        }));
      }
      rows.push(new TableRow({ children: cells, tableHeader: ri === 0 && (r.content || []).every((c) => c.type === "tableHeader") }));
    }
    return new Table({ rows, width: { size: width, type: WidthType.DXA }, columnWidths: Array(cols).fill(Math.round(width / cols)) });
  }

  const body = await blocks(json.content || []);

  async function hfChildren(name) {
    if (!ydoc || !schema) return null;
    const frag = ydoc.getXmlFragment(name);
    if (!frag.length) return null;
    const node = yXmlFragmentToProseMirrorRootNode(frag, schema).toJSON();
    const kids = await blocks(node.content || []);
    return kids.length ? kids : null;
  }
  const header = await hfChildren("header");
  const footer = await hfChildren("footer");
  const headerFirst = settings.differentFirst ? await hfChildren("headerFirst") : null;
  const footerFirst = settings.differentFirst ? await hfChildren("footerFirst") : null;
  const headers = {};
  const footers = {};
  if (header) headers.default = new Header({ children: header });
  if (footer) footers.default = new Footer({ children: footer });
  if (settings.differentFirst) {
    headers.first = new Header({ children: headerFirst || [new Paragraph("")] });
    footers.first = new Footer({ children: footerFirst || [new Paragraph("")] });
  }

  const doc = new Document({
    creator: "Live",
    features: { updateFields: body.some((b) => b instanceof TableOfContents) },
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    numbering: { config: numberingConfigs },
    footnotes,
    comments: { children: comments },
    sections: [{
      properties: {
        titlePage: settings.differentFirst || undefined,
        page: {
          size: { width: Math.round((settings.landscape ? box.h : box.w) * TWIP_PER_IN), height: Math.round((settings.landscape ? box.w : box.h) * TWIP_PER_IN), orientation: settings.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: settings.marginTop * TWIP_PER_IN, bottom: settings.marginBottom * TWIP_PER_IN, left: settings.marginLeft * TWIP_PER_IN, right: settings.marginRight * TWIP_PER_IN },
          pageNumbers: settings.pageNumberStart !== 1 ? { start: settings.pageNumberStart } : undefined,
        },
      },
      headers, footers,
      children: body.length ? body : [new Paragraph("")],
    }],
  });
  const blob = await Packer.toBlob(doc);
  return new Blob([blob], { type: DOCX_MIME });
}

async function defaultImageSize(bytes) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const s = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return s;
  } catch { return { w: 0, h: 0 }; }
}
