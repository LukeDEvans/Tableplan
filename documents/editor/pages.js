// Pages mode (WORD_PROCESSOR_DESIGN.md §5): lays the document onto pages of the chosen
// size, as Google Docs' print layout does. The editor is one long column; this plugin
// measures where each page ends and adds gaps (decorations) so the next page's text
// starts below the next page's top margin. A paragraph that crosses the bottom of a
// page continues on the next one from the line that didn't fit; tables move whole or
// split between rows; images and other blocks move whole. The page shapes, headers,
// footers and page numbers are drawn behind the text (onLayout tells the UI where).
//
// Each pass, in one task (so nothing is painted in between): clear the gaps, measure
// the natural layout, add the new gaps. Runs ~150 ms after an edit, on resize, and
// when fonts or images finish loading.

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/core";

export const pagesKey = new PluginKey("livePages");
export const PX_PER_IN = 96;
export const PAGE_GAP = 20;

const MOVE_WHOLE = new Set(["image", "horizontalRule", "blockMath", "tableOfContents", "taskItem"]);

// geometry: { pageW, pageH, mt, mb, ml, mr } in px. Returns page count and gap list.
// blocks: natural layout [{ top, bottom, kind: "text" | "table" | "atom" | "break", rows?, lines? }]
// in px from the first line; lineAt(blockIndex, y) → { pos, top } | null (the first
// line at or below y that starts a line) — passed in so this part is testable.
export function planPages(blocks, geo, lineAt = () => null) {
  const usable = Math.max(48, geo.pageH - geo.mt - geo.mb);
  const stride = geo.pageH + PAGE_GAP;
  const pageStart = (i) => i * stride; // content top of page i, in placed coordinates
  const pageEnd = (i) => i * stride + usable;
  const gaps = []; // { at: "before" | "line" | "row" | "after", block, pos?, row?, height }
  let offset = 0;
  let page = 0;
  const push = (g, fromY) => {
    const h = pageStart(page + 1) - (fromY + offset);
    if (h <= 0) return;
    gaps.push({ ...g, height: h });
    offset += h;
    page++;
  };
  blocks.forEach((b, bi) => {
    if (b.kind === "break") { push({ at: "after", block: bi }, b.bottom); return; }
    if (b.pageBreakBefore && b.top + offset > pageStart(page) + 1) push({ at: "before", block: bi }, b.top);
    let guard = 0;
    while (b.bottom + offset > pageEnd(page) + 0.5 && guard++ < 500) {
      const limit = pageEnd(page) - offset; // natural y where this page ends
      if (b.kind === "text") {
        const line = lineAt(bi, limit);
        if (line && line.top > b.top + 1 && line.top + offset > pageStart(page)) { push({ at: "line", block: bi, pos: line.pos }, line.top); continue; }
      } else if (b.kind === "table" && b.rows?.length) {
        const row = b.rows.find((r) => r.bottom > limit);
        const ri = b.rows.indexOf(row);
        if (row && ri > 0) { push({ at: "row", block: bi, row: ri, pos: row.pos }, row.top); continue; }
      }
      // Move the whole block, unless it's already at the top of a page (too tall to fit).
      if (b.top + offset > pageStart(page) + 1) { push({ at: "before", block: bi }, b.top); continue; }
      // Taller than a page: let it run over this page's bottom.
      page += Math.max(1, Math.ceil((b.bottom + offset - pageEnd(page)) / stride));
      offset += 0;
      break;
    }
  });
  const lastBottom = blocks.length ? blocks[blocks.length - 1].bottom + offset : 0;
  const pages = Math.max(page + 1, Math.ceil((lastBottom + 1) / stride));
  return { pages, gaps, usable, stride };
}

function gapEl(height, kind) {
  const el = document.createElement(kind === "line" ? "span" : "div");
  el.className = `doc-pagegap doc-pagegap-${kind}`;
  el.setAttribute("contenteditable", "false");
  el.setAttribute("aria-hidden", "true");
  el.style.height = `${height}px`;
  return el;
}

// The block's kind for planning, and for tables their rows.
function measureBlocks(view, origin, scale) {
  const out = [];
  const doc = view.state.doc;
  let pos = 0;
  doc.forEach((node, offset, index) => {
    pos = offset;
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    const top = (r.top - origin) / scale;
    const bottom = (r.bottom - origin) / scale;
    const name = node.type.name;
    const b = { top, bottom, index, pos: offset, node, dom };
    if (name === "pageBreak") b.kind = "break";
    else if (name === "table") {
      b.kind = "table";
      b.rows = [];
      const trs = dom.querySelectorAll("tr");
      let rowPos = offset + 1;
      // table > tableRow*; positions: table at offset, first row at offset+1
      node.forEach((row, rowOffset) => {
        const tr = trs[b.rows.length];
        if (!tr) return;
        const rr = tr.getBoundingClientRect();
        b.rows.push({ top: (rr.top - origin) / scale, bottom: (rr.bottom - origin) / scale, pos: offset + 1 + rowOffset });
      });
      void rowPos;
    } else if (MOVE_WHOLE.has(name) || node.isAtom) b.kind = "atom";
    else b.kind = "text";
    b.pageBreakBefore = Boolean(node.attrs?.pageBreakBefore);
    out.push(b);
  });
  void pos;
  return out;
}

// The start of the first line inside a block that doesn't fit above natural y.
function lineFinder(view, blocks, origin, scale) {
  return (bi, y) => {
    const b = blocks[bi];
    const rect = b.dom.getBoundingClientRect();
    const x = rect.left + 4;
    const limitY = origin + y * scale;
    const probe = (cy) => { try { return view.posAtCoords({ left: x, top: cy }); } catch { return null; } };
    const coords = (p, side = 1) => { try { return view.coordsAtPos(p, side); } catch { return null; } };
    let hit = probe(Math.min(limitY - 1, rect.bottom - 1));
    if (!hit) return null;
    let p = hit.pos;
    let c = coords(p);
    if (!c) return null;
    if (c.bottom <= limitY + 0.5) { // that line fits: the one after it moves
      const next = probe(c.bottom + 2);
      if (!next || next.pos <= p) return null;
      p = next.pos;
      c = coords(p);
      if (!c || c.top < limitY - 2 - c.bottom + c.top) return null;
    }
    const $p = view.state.doc.resolve(p);
    if (!$p.parent.isTextblock) return null;
    const start = $p.start();
    const lineTop = c.top;
    while (p > start) {
      const prev = coords(p - 1, 1);
      if (!prev || prev.top < lineTop - 2) break;
      p--;
    }
    return { pos: p, top: (lineTop - origin) / scale };
  };
}

// The extension. options.getGeometry() → geometry or null (Pageless); options.onLayout({ pages, gaps, geo }).
export const Pages = Extension.create({
  name: "pages",
  addOptions: () => ({ getGeometry: () => null, onLayout: () => {} }),
  addProseMirrorPlugins() {
    const opts = this.options;
    let timer = null;
    let running = false;
    let lastKey = "";
    const plugin = new Plugin({
      key: pagesKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const meta = tr.getMeta(pagesKey);
          if (meta !== undefined) return meta;
          return set.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations: (state) => pagesKey.getState(state) },
      view(view) {
        const layout = () => {
          timer = null;
          if (running || view.isDestroyed) return;
          const geo = opts.getGeometry();
          running = true;
          try {
            if (!geo) {
              if (pagesKey.getState(view.state) !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(pagesKey, DecorationSet.empty).setMeta("addToHistory", false));
              opts.onLayout(null);
              return;
            }
            // 1. natural layout
            view.dispatch(view.state.tr.setMeta(pagesKey, DecorationSet.empty).setMeta("addToHistory", false));
            const rect = view.dom.getBoundingClientRect();
            const scale = view.dom.offsetWidth ? rect.width / view.dom.offsetWidth : 1;
            const cs = getComputedStyle(view.dom);
            const origin = rect.top + (parseFloat(cs.paddingTop) || 0) * (scale || 1);
            const blocks = measureBlocks(view, origin, scale || 1);
            const plan = planPages(blocks, geo, lineFinder(view, blocks, origin, scale || 1));
            // 2. the gaps
            const decos = [];
            for (const g of plan.gaps) {
              const b = blocks[g.block];
              const key = `pg-${g.at}-${Math.round(g.height)}-${decos.length}`;
              if (g.at === "before") decos.push(Decoration.widget(b.pos, () => gapEl(g.height, "block"), { side: -1, key }));
              else if (g.at === "after") decos.push(Decoration.widget(b.pos + b.node.nodeSize, () => gapEl(g.height, "block"), { side: 1, key }));
              else if (g.at === "line") decos.push(Decoration.widget(g.pos, () => gapEl(g.height, "line"), { side: -1, key }));
              else if (g.at === "row") {
                const row = view.state.doc.nodeAt(g.pos);
                if (row) decos.push(Decoration.node(g.pos, g.pos + row.nodeSize, { class: "doc-row-break", style: `--pg-gap:${Math.round(g.height)}px` }));
              }
            }
            view.dispatch(view.state.tr.setMeta(pagesKey, DecorationSet.create(view.state.doc, decos)).setMeta("addToHistory", false));
            const k = `${plan.pages}|${JSON.stringify(geo)}`;
            opts.onLayout({ pages: plan.pages, geo, stride: plan.stride, usable: plan.usable, changed: k !== lastKey });
            lastKey = k;
          } finally { running = false; }
        };
        const schedule = (ms = 150) => { clearTimeout(timer); timer = setTimeout(() => requestAnimationFrame(layout), ms); };
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule(100)) : null;
        ro?.observe(view.dom.parentElement || view.dom);
        const onLoad = (e) => { if (e.target?.tagName === "IMG") schedule(50); };
        view.dom.addEventListener("load", onLoad, true);
        document.fonts?.ready?.then(() => schedule(0));
        document.fonts?.addEventListener?.("loadingdone", () => schedule(50));
        view.__relayout = () => schedule(0);
        schedule(0);
        return {
          update(v, prev) {
            if (running) return;
            if (v.state.doc !== prev.doc) schedule();
          },
          destroy() { clearTimeout(timer); ro?.disconnect(); view.dom.removeEventListener("load", onLoad, true); },
        };
      },
    });
    return [plugin];
  },
});
