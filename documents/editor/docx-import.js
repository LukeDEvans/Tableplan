// Opening a Word file as a Live document (WORD_PROCESSOR_DESIGN.md §9), on the device:
// the .docx is unzipped (fflate) and its XML read (fast-xml-parser) straight into the
// editor's document JSON. Kept: paragraph styles (headings, title, subtitle), fonts,
// sizes, bold / italic / underline / strike / super- and subscript, colours,
// highlights, links, bookmarks, alignment, spacing, indents, bulleted and numbered
// lists (nested), tables (merged columns, cell colours), images, page and line breaks,
// footnotes, headers and footers with page numbers, page size / orientation / margins,
// comments, and tracked changes (as suggestions). What isn't understood is kept as
// plain text and counted in `warnings`.
//
// docxToDoc(bytes) → { doc, header, footer, headerFirst, footerFirst, settings,
//   images: [{ id, bytes }], threads: [{ id, quote, replies: [{ name, text, at }] }], warnings }

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", preserveOrder: true, trimValues: false, parseTagValue: false, parseAttributeValue: false, processEntities: true, htmlEntities: true });

// preserveOrder nodes: { "w:p": [children], ":@": { attrs } } or { "#text": "…" }
const tag = (n) => Object.keys(n).find((k) => k !== ":@");
const kids = (n) => (n && Array.isArray(n[tag(n)]) ? n[tag(n)] : []);
const attr = (n, a) => n?.[":@"]?.[a];
const find = (n, name) => kids(n).find((c) => tag(c) === name);
const findAll = (n, name) => kids(n).filter((c) => tag(c) === name);
const textOf = (n) => kids(n).map((c) => (c["#text"] != null ? String(c["#text"]) : "")).join("");
const deep = (n, name, out = []) => { for (const c of kids(n)) { if (tag(c) === name) out.push(c); deep(c, name, out); } return out; };
const onOff = (n) => n && !["0", "false", "off", "none"].includes(String(attr(n, "w:val") ?? "true"));

const HL = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff" };
const JC = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
const NUM = { decimal: "decimal", lowerLetter: "lower-alpha", upperLetter: "upper-alpha", lowerRoman: "lower-roman", upperRoman: "upper-roman", decimalZero: "decimal-leading-zero" };
const hexId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const shortId = () => hexId().slice(0, 16);

function parse(xml) {
  try { return parser.parse(xml); } catch { return []; }
}
const root = (tree, name) => tree.find((n) => tag(n) === name);

export function docxToDoc(bytes) {
  let files;
  try { files = unzipSync(bytes); } catch { throw new Error("That isn't a Word (.docx) file."); }
  const read = (p) => (files[p] ? strFromU8(files[p]) : null);
  const docXml = read("word/document.xml");
  if (!docXml) throw new Error("That Word file has no document in it.");
  const warnings = new Set();

  // relationships
  const rels = new Map();
  const relsFor = (path) => {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const xml = read(`${dir}/_rels/${name}.rels`);
    const out = new Map();
    if (!xml) return out;
    for (const r of findAll(root(parse(xml), "Relationships"), "Relationship")) {
      out.set(attr(r, "Id"), { target: attr(r, "Target"), mode: attr(r, "TargetMode"), type: attr(r, "Type") || "" });
    }
    return out;
  };
  for (const [k, v] of relsFor("word/document.xml")) rels.set(k, v);

  // styles: styleId → { heading, title, subtitle, run, para }
  const styles = new Map();
  const stylesXml = read("word/styles.xml");
  if (stylesXml) {
    for (const s of findAll(root(parse(stylesXml), "w:styles"), "w:style")) {
      const id = attr(s, "w:styleId");
      const name = String(attr(find(s, "w:name"), "w:val") || "").toLowerCase();
      const outline = find(find(s, "w:pPr"), "w:outlineLvl");
      let kind = null;
      const m = name.match(/^heading (\d)$/);
      if (m) kind = { heading: Math.min(6, Number(m[1])) };
      else if (outline && attr(outline, "w:val") != null && Number(attr(outline, "w:val")) < 6) kind = { heading: Number(attr(outline, "w:val")) + 1 };
      else if (name === "title") kind = { docStyle: "title" };
      else if (name === "subtitle") kind = { docStyle: "subtitle" };
      styles.set(id, { kind, basedOn: attr(find(s, "w:basedOn"), "w:val"), rPr: find(s, "w:rPr"), pPr: find(s, "w:pPr") });
    }
  }
  const styleKind = (id) => { for (let i = 0, s = styles.get(id); s && i < 10; i++, s = styles.get(s.basedOn)) if (s.kind) return s.kind; return null; };

  // numbering: numId → level → { ordered, format, start }
  const numbering = new Map();
  const numXml = read("word/numbering.xml");
  if (numXml) {
    const n = root(parse(numXml), "w:numbering");
    const abstract = new Map();
    for (const a of findAll(n, "w:abstractNum")) {
      const levels = {};
      for (const l of findAll(a, "w:lvl")) {
        const fmt = attr(find(l, "w:numFmt"), "w:val") || "bullet";
        levels[Number(attr(l, "w:ilvl"))] = { ordered: fmt !== "bullet" && fmt !== "none", format: NUM[fmt] || "decimal", start: Number(attr(find(l, "w:start"), "w:val")) || 1, text: attr(find(l, "w:lvlText"), "w:val") || "" };
      }
      abstract.set(attr(a, "w:abstractNumId"), levels);
    }
    for (const num of findAll(n, "w:num")) numbering.set(attr(num, "w:numId"), abstract.get(attr(find(num, "w:abstractNumId"), "w:val")) || {});
  }

  // footnotes and comments
  const footnotes = new Map();
  const fnXml = read("word/footnotes.xml");
  if (fnXml) for (const f of findAll(root(parse(fnXml), "w:footnotes"), "w:footnote")) {
    if (Number(attr(f, "w:id")) > 0) footnotes.set(attr(f, "w:id"), deep(f, "w:t").map(textOf).join("").trim());
  }
  const commentsById = new Map();
  const cXml = read("word/comments.xml");
  if (cXml) for (const c of findAll(root(parse(cXml), "w:comments"), "w:comment")) {
    commentsById.set(attr(c, "w:id"), { name: attr(c, "w:author") || "Someone", at: Date.parse(attr(c, "w:date") || "") || Date.now(), text: findAll(c, "w:p").map((p) => deep(p, "w:t").map(textOf).join("")).join("\n").trim() });
  }

  const images = [];
  const imageIds = new Map();
  function imageFor(relId, relMap) {
    const r = relMap.get(relId);
    if (!r || r.mode === "External") return null;
    const path = r.target.startsWith("/") ? r.target.slice(1) : `word/${r.target.replace(/^\.\//, "")}`;
    if (imageIds.has(path)) return imageIds.get(path);
    const b = files[path];
    if (!b || b.length > 30 * 1024 * 1024) return null;
    const isImg = (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x47 && b[1] === 0x49);
    if (!isImg) { warnings.add("an image in a format Live can't show (e.g. EMF)"); return null; }
    const id = hexId();
    images.push({ id, bytes: b });
    imageIds.set(path, id);
    return id;
  }

  // ---- runs -------------------------------------------------------------------------------
  function runMarks(rPr, ctx) {
    const marks = [];
    if (!rPr) return ctx.marks.slice();
    const ts = {};
    if (onOff(find(rPr, "w:b"))) marks.push({ type: "bold" });
    if (onOff(find(rPr, "w:i"))) marks.push({ type: "italic" });
    const u = find(rPr, "w:u");
    if (u && attr(u, "w:val") !== "none") marks.push({ type: "underline" });
    if (onOff(find(rPr, "w:strike")) || onOff(find(rPr, "w:dstrike"))) marks.push({ type: "strike" });
    const va = attr(find(rPr, "w:vertAlign"), "w:val");
    if (va === "superscript") marks.push({ type: "superscript" });
    if (va === "subscript") marks.push({ type: "subscript" });
    const color = attr(find(rPr, "w:color"), "w:val");
    if (color && /^[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== "000000") ts.color = `#${color.toLowerCase()}`;
    const sz = Number(attr(find(rPr, "w:sz"), "w:val"));
    if (sz) ts.fontSize = sz / 2;
    const fonts = find(rPr, "w:rFonts");
    const font = attr(fonts, "w:ascii") || attr(fonts, "w:hAnsi");
    if (font) ts.fontFamily = font;
    if (Object.keys(ts).length) marks.push({ type: "textStyle", attrs: ts });
    const hl = attr(find(rPr, "w:highlight"), "w:val");
    const shd = attr(find(rPr, "w:shd"), "w:fill");
    if (hl && HL[hl]) marks.push({ type: "highlight", attrs: { color: HL[hl] } });
    else if (shd && /^[0-9a-f]{6}$/i.test(shd) && shd.toLowerCase() !== "ffffff") marks.push({ type: "highlight", attrs: { color: `#${shd.toLowerCase()}` } });
    if (attr(find(rPr, "w:rStyle"), "w:val") === "Hyperlink") { /* the link mark comes from the hyperlink element */ }
    return [...ctx.marks, ...marks];
  }

  // Inline content of a paragraph (and its wrappers) → { inline: [], breaks: [index] }
  function inline(nodes, ctx, out, relMap) {
    for (const n of nodes) {
      const t = tag(n);
      if (t === "w:r") {
        const marks = runMarks(find(n, "w:rPr"), ctx);
        for (const c of kids(n)) {
          const ct = tag(c);
          if (ct === "w:t" || ct === "w:delText") { const s = textOf(c); if (s) out.push({ type: "text", text: s, marks: dedupe(marks) }); }
          else if (ct === "w:tab") out.push({ type: "text", text: "\t", marks: dedupe(marks) });
          else if (ct === "w:br" || ct === "w:cr") {
            if (attr(c, "w:type") === "page") out.push({ type: "__pagebreak" });
            else out.push({ type: "hardBreak" });
          } else if (ct === "w:lastRenderedPageBreak") { /* layout hint only */ }
          else if (ct === "w:drawing" || ct === "w:pict") {
            const blip = deep(c, "a:blip")[0] || deep(c, "v:imagedata")[0];
            const relId = attr(blip, "r:embed") || attr(blip, "r:id");
            const id = relId ? imageFor(relId, relMap) : null;
            const ext = deep(c, "wp:extent")[0];
            const anchor = deep(c, "wp:anchor").length > 0;
            const align = deep(c, "wp:align").map(textOf)[0];
            const alt = attr(deep(c, "wp:docPr")[0], "descr") || "";
            if (id) out.push({ type: "image", attrs: { src: `liveimg:${id}`, alt: alt.slice(0, 500), width: ext ? Math.round(Number(attr(ext, "cx")) / 9525) || null : null, layout: anchor ? (align === "right" ? "wrap-right" : "wrap-left") : "inline" } });
          } else if (ct === "w:footnoteReference") {
            const txt = footnotes.get(attr(c, "w:id"));
            if (txt != null) out.push({ type: "footnote", attrs: { id: shortId(), text: txt.slice(0, 4000) } });
          } else if (ct === "w:fldChar") {
            const ft = attr(c, "w:fldCharType");
            if (ft === "begin") ctx.field = { instr: "", result: true };
            else if (ft === "separate" && ctx.field) ctx.field.inResult = true;
            else if (ft === "end") ctx.field = null;
          } else if (ct === "w:instrText" && ctx.field) {
            ctx.field.instr += textOf(c);
            const instr = ctx.field.instr.trim().toUpperCase();
            if (/^(PAGE|NUMPAGES)\b/.test(instr) && !ctx.field.done) { out.push({ type: "pageNumber", attrs: { total: instr.startsWith("NUMPAGES") } }); ctx.field.done = true; }
          }
        }
        // A field's shown result after a PAGE field we already turned into a page number: drop it.
        if (ctx.field?.done && ctx.field.inResult) { while (out.length && out[out.length - 1].type === "text") out.pop(); }
      } else if (t === "w:hyperlink") {
        const r = relMap.get(attr(n, "r:id"));
        const href = r?.target && /^(https?:|mailto:|tel:)/i.test(r.target) ? r.target : attr(n, "w:anchor") ? `#bm-${String(attr(n, "w:anchor")).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}` : null;
        inline(kids(n), href ? { ...ctx, marks: [...ctx.marks, { type: "link", attrs: { href } }] } : ctx, out, relMap);
      } else if (t === "w:ins" || t === "w:del") {
        const s = { id: shortId(), author: null, name: String(attr(n, "w:author") || "Someone").slice(0, 80), at: Date.parse(attr(n, "w:date") || "") || 0 };
        inline(kids(n), { ...ctx, marks: [...ctx.marks, { type: t === "w:ins" ? "insertion" : "deletion", attrs: s }] }, out, relMap);
      } else if (t === "w:commentRangeStart") {
        const id = attr(n, "w:id");
        if (commentsById.has(id)) ctx.comments.add(id);
        ctx.marks = [...ctx.marks.filter((m) => m.type !== "comment" || m.attrs.id !== `c${id}`), ...(commentsById.has(id) ? [{ type: "comment", attrs: { id: `c${id}` } }] : [])];
      } else if (t === "w:commentRangeEnd") {
        const id = attr(n, "w:id");
        ctx.marks = ctx.marks.filter((m) => !(m.type === "comment" && m.attrs.id === `c${id}`));
      } else if (t === "w:bookmarkStart") {
        const name = String(attr(n, "w:name") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
        if (name && name !== "_GoBack" && !name.startsWith("_Toc")) out.push({ type: "bookmark", attrs: { id: name } });
      } else if (t === "w:smartTag" || t === "w:customXml" || t === "w:sdtContent" || t === "w:fldSimple") {
        const instr = String(attr(n, "w:instr") || "").trim().toUpperCase();
        if (t === "w:fldSimple" && /^(PAGE|NUMPAGES)\b/.test(instr)) out.push({ type: "pageNumber", attrs: { total: instr.startsWith("NUMPAGES") } });
        else inline(kids(n), ctx, out, relMap);
      } else if (t === "w:sdt") inline(kids(find(n, "w:sdtContent") || {}), ctx, out, relMap);
      else if (t === "m:oMath" || t === "m:oMathPara") { const s = deep(n, "m:t").map(textOf).join(""); if (s) out.push({ type: "inlineMath", attrs: { latex: s } }); }
      else if (t && t !== "w:pPr" && t !== "w:proofErr" && t !== "w:permStart" && t !== "w:permEnd" && t !== "w:bookmarkEnd" && t !== "#text") {
        const s = deep(n, "w:t").map(textOf).join("");
        if (s) { out.push({ type: "text", text: s, marks: dedupe(ctx.marks) }); warnings.add(`unsupported content (${t})`); }
      }
    }
    return out;
  }

  // ---- paragraphs --------------------------------------------------------------------------
  function paragraph(p, ctx, relMap) {
    const pPr = find(p, "w:pPr");
    const styleId = attr(find(pPr, "w:pStyle"), "w:val");
    const kind = styleId ? styleKind(styleId) : null;
    const attrs = {};
    const jc = JC[attr(find(pPr, "w:jc"), "w:val")];
    if (jc && jc !== "left") attrs.textAlign = jc;
    const sp = find(pPr, "w:spacing");
    if (sp) {
      if (attr(sp, "w:before") != null) attrs.spaceBefore = Math.round(Number(attr(sp, "w:before")) / 20);
      if (attr(sp, "w:after") != null) attrs.spaceAfter = Math.round(Number(attr(sp, "w:after")) / 20);
      const line = Number(attr(sp, "w:line"));
      if (line && (!attr(sp, "w:lineRule") || attr(sp, "w:lineRule") === "auto")) attrs.lineHeight = Math.round((line / 240) * 100) / 100;
    }
    const ind = find(pPr, "w:ind");
    const numPr = find(pPr, "w:numPr");
    if (ind && !numPr) {
      const left = Number(attr(ind, "w:left") ?? attr(ind, "w:start")) || 0;
      if (left) attrs.indent = Math.max(0, Math.min(8, Math.round(left / 720)));
      const first = Number(attr(ind, "w:firstLine")) || 0;
      const hang = Number(attr(ind, "w:hanging")) || 0;
      if (first) attrs.textIndent = Math.round(first / 20);
      else if (hang) attrs.textIndent = -Math.round(hang / 20);
    }
    if (onOff(find(pPr, "w:pageBreakBefore"))) attrs.pageBreakBefore = true;
    if (onOff(find(pPr, "w:keepNext"))) attrs.keepWithNext = true;
    const content = inline(kids(p), ctx, [], relMap);
    // Split on page breaks: paragraph, pageBreak, paragraph…
    const parts = [[]];
    for (const c of content) { if (c.type === "__pagebreak") parts.push([]); else parts[parts.length - 1].push(c); }
    const make = (inl) => (kind?.heading
      ? { type: "heading", attrs: { level: kind.heading, ...attrs }, content: inl }
      : { type: "paragraph", attrs: { ...(kind?.docStyle ? { docStyle: kind.docStyle } : {}), ...attrs }, content: inl });
    const out = [];
    parts.forEach((inl, i) => { if (i) out.push({ type: "pageBreak" }); if (inl.length || i === 0 || i === parts.length - 1) out.push(make(inl.length ? inl : undefined)); });
    const list = numPr ? { numId: attr(find(numPr, "w:numId"), "w:val"), level: Number(attr(find(numPr, "w:ilvl"), "w:val")) || 0 } : null;
    return { blocks: out.map(clean), list: list && list.numId !== "0" ? list : null };
  }

  function table(tbl, ctx, relMap) {
    const rows = [];
    for (const tr of findAll(tbl, "w:tr")) {
      const cells = [];
      for (const tc of findAll(tr, "w:tc")) {
        const tcPr = find(tc, "w:tcPr");
        const vMerge = find(tcPr, "w:vMerge");
        if (vMerge && attr(vMerge, "w:val") !== "restart") continue; // merged into the cell above
        const span = Number(attr(find(tcPr, "w:gridSpan"), "w:val")) || 1;
        const fill = attr(find(tcPr, "w:shd"), "w:fill");
        const content = body(kids(tc), ctx, relMap);
        cells.push({ type: "tableCell", attrs: { colspan: span, rowspan: 1, ...(fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== "ffffff" ? { background: `#${fill.toLowerCase()}` } : {}) }, content: content.length ? content : [{ type: "paragraph" }] });
      }
      if (cells.length) rows.push({ type: "tableRow", content: cells });
    }
    return rows.length ? { type: "table", content: rows } : null;
  }

  // Block content with lists grouped: consecutive list paragraphs nest by level.
  function body(nodes, ctx, relMap) {
    const out = [];
    let stack = []; // [{ list, numId, level }]
    const closeAll = () => { stack = []; };
    const listTypeFor = (numId, level) => {
      const lv = numbering.get(numId)?.[level] || { ordered: false };
      if (!lv.ordered && /☐|☑|☒|□/.test(lv.text)) return { type: "bulletList" };
      return lv.ordered ? { type: "orderedList", attrs: { listStyle: lv.format, start: lv.start } } : { type: "bulletList" };
    };
    for (const n of nodes) {
      const t = tag(n);
      if (t === "w:p") {
        const { blocks, list } = paragraph(n, ctx, relMap);
        if (!list) { closeAll(); out.push(...blocks); continue; }
        while (stack.length && (stack[stack.length - 1].level > list.level || (stack[stack.length - 1].level === list.level && stack[stack.length - 1].numId !== list.numId))) stack.pop();
        if (!stack.length || stack[stack.length - 1].level < list.level) {
          const lt = listTypeFor(list.numId, list.level);
          const listNode = { ...lt, content: [] };
          if (stack.length) {
            const parentItems = stack[stack.length - 1].node.content;
            const lastItem = parentItems[parentItems.length - 1];
            if (lastItem) lastItem.content.push(listNode); else out.push(listNode);
          } else out.push(listNode);
          stack.push({ node: listNode, numId: list.numId, level: list.level });
        }
        stack[stack.length - 1].node.content.push({ type: "listItem", content: blocks.filter((b) => b.type !== "pageBreak") });
      } else if (t === "w:tbl") { closeAll(); const tb = table(n, ctx, relMap); if (tb) out.push(tb); }
      else if (t === "w:sdt") { closeAll(); out.push(...body(kids(find(n, "w:sdtContent") || {}), ctx, relMap)); }
      else if (t === "w:customXml") out.push(...body(kids(n), ctx, relMap));
    }
    return out;
  }

  const docTree = parse(docXml);
  const bodyNode = find(root(docTree, "w:document"), "w:body");
  const ctx = { marks: [], comments: new Set(), field: null };
  const content = body(kids(bodyNode), ctx, rels);

  // section: page setup and headers / footers
  const sect = deep(bodyNode, "w:sectPr").pop();
  const settings = {};
  if (sect) {
    const pg = find(sect, "w:pgSz");
    const w = Number(attr(pg, "w:w")) / 1440;
    const h = Number(attr(pg, "w:h")) / 1440;
    if (w && h) {
      const landscape = attr(pg, "w:orient") === "landscape" || w > h;
      const [pw, ph] = landscape ? [h, w] : [w, h];
      const near = (a, b) => Math.abs(a - b) < 0.08;
      settings.pageSize = near(pw, 8.27) && near(ph, 11.69) ? "a4" : near(pw, 8.5) && near(ph, 14) ? "legal" : near(pw, 5.83) ? "a5" : near(pw, 11) && near(ph, 17) ? "tabloid" : "letter";
      settings.landscape = landscape;
    }
    const mar = find(sect, "w:pgMar");
    if (mar) for (const [k, a] of [["marginTop", "w:top"], ["marginBottom", "w:bottom"], ["marginLeft", "w:left"], ["marginRight", "w:right"]]) {
      const v = Number(attr(mar, a)) / 1440;
      if (Number.isFinite(v) && v >= 0) settings[k] = Math.round(v * 100) / 100;
    }
    if (find(sect, "w:titlePg")) settings.differentFirst = true;
    const start = Number(attr(find(sect, "w:pgNumType"), "w:start"));
    if (start) settings.pageNumberStart = start;
  }
  const hf = { header: null, footer: null, headerFirst: null, footerFirst: null };
  if (sect) {
    for (const ref of [...findAll(sect, "w:headerReference"), ...findAll(sect, "w:footerReference")]) {
      const isHeader = tag(ref) === "w:headerReference";
      const type = attr(ref, "w:type") || "default";
      const key = type === "first" ? (isHeader ? "headerFirst" : "footerFirst") : type === "default" ? (isHeader ? "header" : "footer") : null;
      const r = rels.get(attr(ref, "r:id"));
      if (!key || !r) continue;
      const path = `word/${r.target.replace(/^\.\//, "")}`;
      const xml = read(path);
      if (!xml) continue;
      const tree = parse(xml);
      const top = root(tree, isHeader ? "w:hdr" : "w:ftr");
      const c = body(kids(top), { marks: [], comments: new Set(), field: null }, relsFor(path));
      if (c.some((b) => b.content?.length || b.type !== "paragraph")) hf[key] = { type: "doc", content: c };
    }
    if (hf.header || hf.footer) settings.headerFooter = true;
  }

  // Comment threads: quotes from the marked text.
  const quotes = new Map();
  const walk = (n) => {
    for (const m of n.marks || []) if (m.type === "comment") quotes.set(m.attrs.id, `${quotes.get(m.attrs.id) || ""}${n.text || ""}`);
    for (const c of n.content || []) walk(c);
  };
  walk({ content });
  const threads = [...ctx.comments].map((id) => ({ id: `c${id}`, quote: (quotes.get(`c${id}`) || "").slice(0, 300), replies: [commentsById.get(id)] }));

  return {
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    ...hf, settings, images, threads, warnings: [...warnings],
  };
}

function dedupe(marks) {
  const seen = new Map();
  for (const m of marks) {
    const k = m.type === "comment" || m.type === "insertion" || m.type === "deletion" ? `${m.type}:${m.attrs?.id}` : m.type;
    if (m.type === "textStyle" && seen.has(k)) seen.set(k, { type: "textStyle", attrs: { ...seen.get(k).attrs, ...m.attrs } });
    else seen.set(k, m);
  }
  const out = [...seen.values()];
  return out.length ? out : undefined;
}

function clean(node) {
  if (!node || typeof node !== "object") return node;
  const out = { type: node.type };
  if (node.attrs && Object.keys(node.attrs).length) out.attrs = node.attrs;
  if (node.marks?.length) out.marks = node.marks;
  if (node.text != null) out.text = node.text;
  if (node.content?.length) out.content = node.content.map(clean);
  return out;
}
