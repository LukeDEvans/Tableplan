// Bringing Google Docs over (WORD_PROCESSOR_DESIGN.md §9): a Google Doc as the Docs
// API returns it (documents.get) → the editor's document JSON. More faithful than a
// .docx round trip: exact named styles, fonts and sizes, colours, links, lists with
// their glyphs, tables with cell colours, images, page breaks, footnotes, headers and
// footers, page size and margins. Comments come from the Drive API and are put back
// on the text they quoted, where it still matches.
//
// gdocToDoc(gdoc, { imageFor(objectId) → hex id | null }) → { doc, header, footer,
//   headerFirst, footerFirst, settings, footnoteCount, warnings }
// attachComments(docJson, comments) → threads (and comment marks added in place)

const ALIGN = { START: "left", CENTER: "center", END: "right", JUSTIFIED: "justify" };
const NAMED = { TITLE: { docStyle: "title" }, SUBTITLE: { docStyle: "subtitle" }, HEADING_1: { heading: 1 }, HEADING_2: { heading: 2 }, HEADING_3: { heading: 3 }, HEADING_4: { heading: 4 }, HEADING_5: { heading: 5 }, HEADING_6: { heading: 6 } };
const GLYPH = { DECIMAL: "decimal", ZERO_DECIMAL: "decimal-leading-zero", UPPER_ALPHA: "upper-alpha", ALPHA: "lower-alpha", UPPER_ROMAN: "upper-roman", ROMAN: "lower-roman" };
const BULLET = { "●": "disc", "○": "circle", "■": "square", "–": "dash", "-": "dash", "➔": "arrow", "★": "star", "❖": "disc", "➢": "arrow" };
const shortId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

const pt = (dim) => (dim && typeof dim.magnitude === "number" ? (dim.unit === "PT" || !dim.unit ? dim.magnitude : dim.magnitude) : null);
function rgb(c) {
  const v = c?.color?.rgbColor;
  if (!v) return null;
  const h = (x) => Math.round(Math.max(0, Math.min(1, x || 0)) * 255).toString(16).padStart(2, "0");
  return `#${h(v.red)}${h(v.green)}${h(v.blue)}`;
}

export function gdocToDoc(gdoc, { imageFor = () => null } = {}) {
  const warnings = new Set();
  const lists = gdoc.lists || {};
  const footnotes = gdoc.footnotes || {};
  const inlineObjects = gdoc.inlineObjects || {};
  let footnoteCount = 0;

  function textMarks(ts = {}, link) {
    const marks = [];
    if (ts.bold) marks.push({ type: "bold" });
    if (ts.italic) marks.push({ type: "italic" });
    if (ts.underline && !(ts.link || link)) marks.push({ type: "underline" });
    if (ts.strikethrough) marks.push({ type: "strike" });
    if (ts.baselineOffset === "SUPERSCRIPT") marks.push({ type: "superscript" });
    if (ts.baselineOffset === "SUBSCRIPT") marks.push({ type: "subscript" });
    const style = {};
    const fg = rgb(ts.foregroundColor);
    if (fg && fg !== "#000000") style.color = fg;
    const fam = ts.weightedFontFamily?.fontFamily;
    if (fam && fam !== "Arial") style.fontFamily = fam;
    const size = pt(ts.fontSize);
    if (size && size !== 11) style.fontSize = size;
    if (Object.keys(style).length) marks.push({ type: "textStyle", attrs: style });
    const bg = rgb(ts.backgroundColor);
    if (bg) marks.push({ type: "highlight", attrs: { color: bg } });
    const l = ts.link || link;
    const href = l?.url && /^(https?:|mailto:|tel:)/i.test(l.url) ? l.url : l?.bookmarkId ? `#bm-${String(l.bookmarkId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}` : l?.headingId ? `#bm-${String(l.headingId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}` : null;
    if (href) marks.push({ type: "link", attrs: { href } });
    return marks.length ? marks : undefined;
  }

  function inline(elements = []) {
    const out = [];
    const breaks = [];
    for (const el of elements) {
      if (el.textRun) {
        const content = String(el.textRun.content || "").replace(/\n$/, "");
        const parts = content.split(/\u000b/); // vertical tab = line break in Docs
        parts.forEach((s, i) => {
          if (i) out.push({ type: "hardBreak" });
          if (s) out.push({ type: "text", text: s, marks: textMarks(el.textRun.textStyle) });
        });
      } else if (el.inlineObjectElement) {
        const obj = inlineObjects[el.inlineObjectElement.inlineObjectId]?.inlineObjectProperties?.embeddedObject;
        const id = imageFor(el.inlineObjectElement.inlineObjectId);
        if (obj && id) {
          const w = pt(obj.size?.width);
          out.push({ type: "image", attrs: { src: `liveimg:${id}`, alt: String(obj.description || obj.title || "").slice(0, 500), width: w ? Math.round((w * 96) / 72) : null, layout: "inline" } });
        } else warnings.add("an image that couldn't be copied");
      } else if (el.footnoteReference) {
        const f = footnotes[el.footnoteReference.footnoteId];
        const text = (f?.content || []).map((b) => (b.paragraph?.elements || []).map((e) => e.textRun?.content || "").join("")).join("").trim();
        footnoteCount++;
        out.push({ type: "footnote", attrs: { id: shortId(), text: text.slice(0, 4000) } });
      } else if (el.pageBreak) breaks.push(out.length);
      else if (el.horizontalRule) out.push({ type: "__hr" });
      else if (el.autoText?.type === "PAGE_NUMBER") out.push({ type: "pageNumber", attrs: { total: false } });
      else if (el.autoText?.type === "PAGE_COUNT") out.push({ type: "pageNumber", attrs: { total: true } });
      else if (el.person) out.push({ type: "text", text: el.person.personProperties?.name || el.person.personProperties?.email || "" });
      else if (el.richLink) {
        const p = el.richLink.richLinkProperties || {};
        if (p.uri && /^https?:/i.test(p.uri)) out.push({ type: "text", text: p.title || p.uri, marks: [{ type: "link", attrs: { href: p.uri } }] });
      } else if (el.dateElement) out.push({ type: "smartChip", attrs: { kind: "date", refId: null, label: el.dateElement.dateElementProperties?.displayText || "" } });
      else if (el.equation) { warnings.add("an equation (kept as a placeholder)"); out.push({ type: "text", text: "[equation]" }); }
    }
    return { content: out.filter((n) => n.type !== "text" || n.text), breaks };
  }

  function paragraph(p) {
    const ps = p.paragraphStyle || {};
    const named = NAMED[ps.namedStyleType] || null;
    const attrs = {};
    if (ALIGN[ps.alignment] && ps.alignment !== "START") attrs.textAlign = ALIGN[ps.alignment];
    if (ps.lineSpacing && ps.lineSpacing !== 115) attrs.lineHeight = Math.round(ps.lineSpacing) / 100;
    const above = pt(ps.spaceAbove);
    const below = pt(ps.spaceBelow);
    if (above) attrs.spaceBefore = above;
    if (below) attrs.spaceAfter = below;
    if (!p.bullet) {
      const start = pt(ps.indentStart) || 0;
      const first = pt(ps.indentFirstLine);
      if (start) attrs.indent = Math.max(0, Math.min(8, Math.round(start / 36)));
      if (first != null && first !== start) attrs.textIndent = Math.round(first - start);
    }
    if (ps.pageBreakBefore) attrs.pageBreakBefore = true;
    if (ps.keepWithNext) attrs.keepWithNext = true;
    const { content, breaks } = inline(p.elements);
    const hrs = content.filter((n) => n.type === "__hr").length;
    const body = content.filter((n) => n.type !== "__hr");
    const make = (c) => (named?.heading
      ? { type: "heading", attrs: { level: named.heading, ...attrs }, ...(c.length ? { content: c } : {}) }
      : { type: "paragraph", attrs: { ...(named?.docStyle ? { docStyle: named.docStyle } : {}), ...attrs }, ...(c.length ? { content: c } : {}) });
    const blocks = [];
    if (breaks.length) {
      let at = 0;
      for (const b of breaks) { const c = body.slice(at, b); if (c.length) blocks.push(make(c)); blocks.push({ type: "pageBreak" }); at = b; }
      const rest = body.slice(at);
      blocks.push(make(rest));
    } else blocks.push(make(body));
    for (let i = 0; i < hrs; i++) blocks.push({ type: "horizontalRule" });
    return { blocks, bullet: p.bullet || null };
  }

  function listKind(listId, level) {
    const nl = lists[listId]?.listProperties?.nestingLevels?.[level] || {};
    if (nl.glyphType && GLYPH[nl.glyphType]) return { type: "orderedList", attrs: { listStyle: GLYPH[nl.glyphType], start: nl.startNumber || 1 } };
    if (nl.glyphSymbol === "☐" || nl.glyphSymbol === "☑") return { type: "taskList" };
    return { type: "bulletList", ...(BULLET[nl.glyphSymbol] && BULLET[nl.glyphSymbol] !== "disc" ? { attrs: { bulletStyle: BULLET[nl.glyphSymbol] } } : {}) };
  }

  function body(content = []) {
    const out = [];
    let stack = [];
    for (const el of content) {
      if (el.paragraph) {
        const { blocks, bullet } = paragraph(el.paragraph);
        if (!bullet) { stack = []; out.push(...blocks); continue; }
        const level = bullet.nestingLevel || 0;
        while (stack.length && (stack[stack.length - 1].level > level || (stack[stack.length - 1].level === level && stack[stack.length - 1].listId !== bullet.listId))) stack.pop();
        if (!stack.length || stack[stack.length - 1].level < level) {
          const node = { ...listKind(bullet.listId, level), content: [] };
          const parent = stack[stack.length - 1];
          if (parent) { const items = parent.node.content; (items[items.length - 1]?.content || out).push(node); } else out.push(node);
          stack.push({ node, listId: bullet.listId, level });
        }
        const top = stack[stack.length - 1];
        const isTask = top.node.type === "taskList";
        const checked = isTask && (el.paragraph.elements || []).every((e) => !e.textRun || e.textRun.textStyle?.strikethrough || !String(e.textRun.content || "").trim());
        top.node.content.push(isTask ? { type: "taskItem", attrs: { checked }, content: blocks.filter((b) => b.type !== "pageBreak") } : { type: "listItem", content: blocks.filter((b) => b.type !== "pageBreak") });
      } else if (el.table) {
        stack = [];
        const rows = (el.table.tableRows || []).map((r) => ({
          type: "tableRow",
          content: (r.tableCells || []).map((c) => {
            const bg = rgb(c.tableCellStyle?.backgroundColor);
            const inner = body(c.content);
            return { type: "tableCell", attrs: { colspan: c.tableCellStyle?.columnSpan || 1, rowspan: c.tableCellStyle?.rowSpan || 1, ...(bg && bg !== "#ffffff" ? { background: bg } : {}) }, content: inner.length ? inner : [{ type: "paragraph" }] };
          }),
        })).filter((r) => r.content.length);
        if (rows.length) out.push({ type: "table", content: rows });
      } else if (el.tableOfContents) { stack = []; out.push({ type: "tableOfContents", attrs: { withNumbers: false } }); }
      else if (el.sectionBreak) { /* the first one starts the document; others are kept as nothing */ }
    }
    return out;
  }

  const tab = gdoc.tabs?.[0]?.documentTab || gdoc;
  const content = body(tab.body?.content || gdoc.body?.content || []);
  const ds = tab.documentStyle || gdoc.documentStyle || {};
  const settings = {};
  const w = pt(ds.pageSize?.width);
  const h = pt(ds.pageSize?.height);
  if (w && h) {
    const [pw, ph] = w > h ? [h / 72, w / 72] : [w / 72, h / 72];
    const near = (a, b) => Math.abs(a - b) < 0.08;
    settings.pageSize = near(pw, 8.27) ? "a4" : near(ph, 14) ? "legal" : near(pw, 5.83) ? "a5" : near(pw, 11) ? "tabloid" : "letter";
    settings.landscape = w > h;
  }
  for (const [k, g] of [["marginTop", "marginTop"], ["marginBottom", "marginBottom"], ["marginLeft", "marginLeft"], ["marginRight", "marginRight"]]) {
    const v = pt(ds[g]);
    if (v != null) settings[k] = Math.round((v / 72) * 100) / 100;
  }
  if (ds.useCustomHeaderFooterMargins === undefined && ds.pageNumberStart) settings.pageNumberStart = ds.pageNumberStart;
  if (ds.useFirstPageHeaderFooter) settings.differentFirst = true;
  if (ds.flipPageOrientation) settings.landscape = !settings.landscape;
  const headers = tab.headers || gdoc.headers || {};
  const footers = tab.footers || gdoc.footers || {};
  const hf = (map, id) => (id && map[id] ? { type: "doc", content: body(map[id].content) } : null);
  const out = {
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    header: hf(headers, ds.defaultHeaderId), footer: hf(footers, ds.defaultFooterId),
    headerFirst: hf(headers, ds.firstPageHeaderId), footerFirst: hf(footers, ds.firstPageFooterId),
    settings, footnoteCount, warnings: [...warnings],
  };
  if (out.header || out.footer) settings.headerFooter = true;
  return out;
}

// Comments (Drive API comments.list): each is put on the first text that matches its
// quote and isn't already commented; ones whose text is gone are kept, unanchored.
export function attachComments(docJson, comments = []) {
  const threads = [];
  for (const c of comments) {
    if (c.deleted) continue;
    const id = `g${shortId()}`;
    const quote = String(c.quotedFileContent?.value || "").replace(/\s+/g, " ").trim();
    const replies = [{ name: c.author?.displayName || "Someone", text: String(c.content || ""), at: Date.parse(c.createdTime || "") || Date.now() },
      ...(c.replies || []).filter((r) => !r.deleted && r.content).map((r) => ({ name: r.author?.displayName || "Someone", text: String(r.content || ""), at: Date.parse(r.createdTime || "") || Date.now() }))];
    if (quote) markQuote(docJson, quote, id);
    threads.push({ id, quote: quote.slice(0, 300), resolved: Boolean(c.resolved), replies });
  }
  return threads;
}

function markQuote(doc, quote, id) {
  let done = false;
  const visit = (block) => {
    if (done || !block.content) return;
    if (block.content.some((n) => n.type === "text")) {
      const text = block.content.map((n) => (n.type === "text" ? n.text : "\u0000")).join("");
      const at = text.indexOf(quote);
      if (at < 0) return;
      const end = at + quote.length;
      const next = [];
      let pos = 0;
      for (const n of block.content) {
        const len = n.type === "text" ? n.text.length : 1;
        const s = pos;
        const e = pos + len;
        pos = e;
        if (n.type !== "text" || e <= at || s >= end) { next.push(n); continue; }
        const a = Math.max(at, s) - s;
        const b = Math.min(end, e) - s;
        if (a > 0) next.push({ ...n, text: n.text.slice(0, a) });
        next.push({ ...n, text: n.text.slice(a, b), marks: [...(n.marks || []), { type: "comment", attrs: { id } }] });
        if (b < n.text.length) next.push({ ...n, text: n.text.slice(b) });
      }
      block.content = next;
      done = true;
      return;
    }
    for (const c of block.content) visit(c);
  };
  visit(doc);
  return done;
}
