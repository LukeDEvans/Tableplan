// Draws a slide as HTML (SLIDES_DESIGN.md §3): the editor's slide and its thumbnails,
// presenting, presenter view and export all use this, so a slide looks the same
// everywhere. A slide is laid out in its own px space (1920 × 1080 for 16:9) and scaled
// to the screen with a CSS transform.
//
// renderSlide(model, sid, { mediaUrl, textHtml, placeholders, forPresent }) → HTMLElement
//   mediaUrl(id) → url | null (images not loaded yet show a soft box until they are)
//   textHtml(fragment) → html for a text box (the editor passes the schema-based one)
//   placeholders: show "Click to add title" in empty placeholders (editor only)

import { resolveColor, resolveFont, backgroundCss, decoSvg, PLACEHOLDER_PROMPTS } from "./themes.js";
import { shapePath, dashArray } from "./shapes.js";
import { fontStack, ensureFont } from "../editor/fonts.js";
import { fragmentHasText } from "./model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// The CSS for an item's box: position, size, rotation and flips.
export function boxStyle(it) {
  const tf = [];
  if (it.rot) tf.push(`rotate(${n(it.rot)}deg)`);
  if (it.flipH) tf.push("scaleX(-1)");
  if (it.flipV) tf.push("scaleY(-1)");
  return `left:${n(it.x)}px;top:${n(it.y)}px;width:${Math.max(1, n(it.w))}px;height:${Math.max(1, n(it.h))}px;${tf.length ? `transform:${tf.join(" ")};` : ""}${it.opacity !== undefined && it.t !== "image" ? `opacity:${n(it.opacity, 1)};` : ""}`;
}

// Text defaults for a box (the runs inside may override them).
export function textStyle(it, theme) {
  const font = resolveFont(it.font, theme);
  ensureFont(font);
  const color = resolveColor(it.color || "@dk1", theme) || "#000";
  const parts = [
    `font-family:${fontStack(font)}`, `font-size:${n(it.size, 18)}pt`, `color:${color}`,
    `text-align:${["left", "center", "right", "justify"].includes(it.align) ? it.align : "left"}`,
    `line-height:${n(it.lineH, 1.2)}`, `padding:${n(it.pad, 12)}px`,
    `justify-content:${it.valign === "middle" ? "center" : it.valign === "bottom" ? "flex-end" : "flex-start"}`,
  ];
  if (it.bold) parts.push("font-weight:700");
  if (it.italic) parts.push("font-style:italic");
  return parts.join(";");
}

function svgDefsForLine(it, color, id) {
  const head = (kind, end) => {
    const mid = `${id}-${end}`;
    const sw = Math.max(1, n(it.sw, 3));
    const sz = 4;
    const common = `id="${mid}" markerUnits="strokeWidth" markerWidth="${sz}" markerHeight="${sz}" refX="${end === "e" ? sz - 0.5 : 0.5}" refY="${sz / 2}" orient="auto-start-reverse" viewBox="0 0 ${sz} ${sz}"`;
    void sw;
    switch (kind) {
      case "arrow": return `<marker ${common}><path d="M0 0 L${sz} ${sz / 2} L0 ${sz} Z" fill="${color}"/></marker>`;
      case "open": return `<marker ${common}><path d="M0.4 0.4 L${sz - 0.4} ${sz / 2} L0.4 ${sz - 0.4}" fill="none" stroke="${color}" stroke-width="0.8"/></marker>`;
      case "circle": return `<marker ${common}><circle cx="${sz / 2}" cy="${sz / 2}" r="${sz / 2.4}" fill="${color}"/></marker>`;
      case "diamond": return `<marker ${common}><path d="M0 ${sz / 2} L${sz / 2} 0 L${sz} ${sz / 2} L${sz / 2} ${sz} Z" fill="${color}"/></marker>`;
      case "bar": return `<marker ${common}><rect x="${sz / 2 - 0.4}" y="0" width="0.8" height="${sz}" fill="${color}"/></marker>`;
      default: return "";
    }
  };
  return head(it.a1, "s") + head(it.a2, "e");
}

// A line goes from the box's top-left to its bottom-right (flips make the other
// diagonals). Elbow and curved lines bend at the middle.
export function linePath(it) {
  const w = Math.max(0, n(it.w)), h = Math.max(0, n(it.h));
  if (it.kind === "elbow") return `M0 0 H${w / 2} V${h} H${w}`;
  if (it.kind === "curve") return `M0 0 C${w / 2} 0 ${w / 2} ${h} ${w} ${h}`;
  return `M0 0 L${w} ${h}`;
}

let lineSeq = 0;
function itemHtml(it, ctx) {
  const { theme } = ctx;
  const fill = resolveColor(it.fill, theme);
  const stroke = resolveColor(it.stroke, theme);
  const sw = n(it.sw, stroke ? 2 : 0);
  const shadow = it.shadow ? "filter:drop-shadow(0 6px 10px rgba(0,0,0,.28));" : "";
  const attrs = `class="sl-item sl-${it.t}" data-item="${esc(it.id)}"${it.grp ? ` data-grp="${esc(it.grp)}"` : ""} style="${boxStyle(it)}${shadow}"`;

  if (it.t === "line") {
    const color = stroke || resolveColor("@dk1", theme);
    const id = `ln${++lineSeq}`;
    const w = Math.max(1, n(it.w)), h = Math.max(1, n(it.h));
    return `<div ${attrs}><svg class="sl-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible" aria-hidden="true"><defs>${svgDefsForLine(it, color, id)}</defs><path d="${linePath(it)}" fill="none" stroke="${color}" stroke-width="${Math.max(1, n(it.sw, 3))}" stroke-linecap="round" stroke-linejoin="round"${it.dash ? ` stroke-dasharray="${dashArray(it.dash, it.sw)}"` : ""}${it.a1 && it.a1 !== "none" ? ` marker-start="url(#${id}-s)"` : ""}${it.a2 && it.a2 !== "none" ? ` marker-end="url(#${id}-e)"` : ""}/></svg></div>`;
  }

  if (it.t === "image") {
    const url = ctx.mediaUrl?.(it.media) || null;
    const c = it.crop || {};
    const cl = n(c.l), ct = n(c.t), cr = n(c.r), cb = n(c.b);
    const vw = Math.max(0.05, 1 - cl - cr), vh = Math.max(0.05, 1 - ct - cb);
    const clip = it.mask && it.mask !== "rect" ? `clip-path:path('${shapePath(it.mask, n(it.w), n(it.h)).d}');` : "";
    const border = stroke && sw ? `outline:${sw}px ${it.dash ? "dashed" : "solid"} ${stroke};outline-offset:-${sw}px;` : "";
    const filter = it.recolor === "gray" ? "grayscale(1)" : it.recolor === "sepia" ? "sepia(.9)" : it.recolor === "dim" ? "brightness(.6)" : "";
    const img = url
      ? `<img src="${esc(url)}" alt="${esc(it.alt || "")}" draggable="false" style="position:absolute;left:${(-cl / vw) * 100}%;top:${(-ct / vh) * 100}%;width:${100 / vw}%;height:${100 / vh}%;${it.fit === "contain" ? "object-fit:contain;" : "object-fit:fill;"}${filter ? `filter:${filter};` : ""}${it.opacity !== undefined ? `opacity:${n(it.opacity, 1)};` : ""}">`
      : `<div class="sl-img-wait" role="img" aria-label="${esc(it.alt || "Image")}"></div>`;
    return `<div ${attrs}><div class="sl-crop" style="${clip}${border}">${img}</div></div>`;
  }

  if (it.t === "video" || it.t === "audio") {
    const poster = it.poster ? ctx.mediaUrl?.(it.poster) : (it.t === "video" && it.media && ctx.mediaInfo?.(it.media)?.poster ? ctx.mediaUrl?.(ctx.mediaInfo(it.media).poster) : null);
    const inner = it.t === "audio"
      ? `<div class="sl-audio-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></div>`
      : `${poster ? `<img src="${esc(poster)}" alt="" draggable="false" class="sl-poster">` : `<div class="sl-video-blank"></div>`}<div class="sl-play" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.55)"/><path d="M10 8l6 4-6 4z" fill="#fff"/></svg></div>`;
    return `<div ${attrs}><div class="sl-media-box">${inner}</div></div>`;
  }

  if (it.t === "table") return `<div ${attrs}>${tableHtml(it, ctx)}</div>`;

  if (it.t === "chart") return `<div ${attrs}><div class="sl-chart-wait">Chart</div></div>`;

  // text and shapes: an optional shape drawn under the text
  let under = "";
  if (it.t === "shape") {
    const { d, evenodd } = shapePath(it.shape, n(it.w), n(it.h), it.radius);
    const f2 = fill ?? resolveColor("@a1", theme);
    const s2 = it.stroke === undefined ? null : stroke;
    under = `<svg class="sl-svg" width="${Math.max(1, n(it.w))}" height="${Math.max(1, n(it.h))}" viewBox="0 0 ${Math.max(1, n(it.w))} ${Math.max(1, n(it.h))}" overflow="visible" aria-hidden="true"><path d="${d}" fill="${f2 || "none"}"${evenodd ? ' fill-rule="evenodd"' : ""}${s2 && sw ? ` stroke="${s2}" stroke-width="${sw}"${it.dash ? ` stroke-dasharray="${dashArray(it.dash, sw)}"` : ""}` : ""}/></svg>`;
  } else if (fill || (stroke && sw)) {
    under = `<div class="sl-textbg" style="${fill ? `background:${fill};` : ""}${stroke && sw ? `border:${sw}px ${it.dash ? "dashed" : "solid"} ${stroke};` : ""}"></div>`;
  }
  const fr = ctx.model.text(ctx.sid, it.id);
  const has = fragmentHasText(fr);
  const body = has ? ctx.textHtml(fr) : (ctx.placeholders && it.role ? `<p class="sl-prompt">${esc(PLACEHOLDER_PROMPTS[it.role] || "")}</p>` : "");
  const textColor = it.t === "shape" && !it.color ? { ...it, color: "@lt1" } : it;
  return `<div ${attrs}>${under}<div class="sl-text${it.autofit === "shrink" ? " is-shrink" : ""}" style="${textStyle(textColor, theme)}">${body}</div></div>`;
}

function tableHtml(it, ctx) {
  const rows = Math.max(1, Math.min(50, n(it.rows, 2))), cols = Math.max(1, Math.min(20, n(it.cols, 2)));
  const colW = Array.isArray(it.colW) && it.colW.length === cols ? it.colW : Array(cols).fill(1);
  const total = colW.reduce((a, b) => a + n(b, 1), 0) || 1;
  const cells = it.cells || {};
  const border = resolveColor(it.stroke || "@dk2", ctx.theme) || "#999";
  const out = [`<table class="sl-table" style="border-color:${border};${textStyle(it, ctx.theme)};padding:0"><colgroup>${colW.map((w) => `<col style="width:${(n(w, 1) / total) * 100}%">`).join("")}</colgroup>`];
  const covered = new Set();
  for (let r = 0; r < rows; r++) {
    out.push("<tr>");
    for (let c = 0; c < cols; c++) {
      if (covered.has(`${r}.${c}`)) continue;
      const cell = cells[`${r}.${c}`] || {};
      const rs = Math.max(1, Math.min(rows - r, n(cell.rs, 1))), cs = Math.max(1, Math.min(cols - c, n(cell.cs, 1)));
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (i || j) covered.add(`${r + i}.${c + j}`);
      const bg = resolveColor(cell.fill || (r === 0 && it.header !== false && it.fill ? it.fill : null), ctx.theme);
      const color = resolveColor(cell.color, ctx.theme);
      out.push(`<td data-cell="${r}.${c}"${rs > 1 ? ` rowspan="${rs}"` : ""}${cs > 1 ? ` colspan="${cs}"` : ""} style="border-color:${border};${bg ? `background:${bg};` : ""}${color ? `color:${color};` : ""}${cell.bold ? "font-weight:700;" : ""}${["left", "center", "right"].includes(cell.align) ? `text-align:${cell.align};` : ""}">${esc(cell.text || "").replace(/\n/g, "<br>")}</td>`);
    }
    out.push("</tr>");
  }
  out.push("</table>");
  return out.join("");
}

export function renderSlide(model, sid, { mediaUrl = () => null, mediaInfo = (id) => model.mediaInfo(id), textHtml, placeholders = false, doc = document } = {}) {
  const theme = model.theme();
  const [W, H] = model.size();
  const s = model.slide(sid);
  const el = doc.createElement("div");
  el.className = "sl-slide";
  el.dataset.slide = sid;
  el.style.width = `${W}px`;
  el.style.height = `${H}px`;
  const bgUrl = s?.bg?.kind === "image" ? mediaUrl(s.bg.media) : null;
  el.style.background = backgroundCss(s?.bg, theme, bgUrl);
  const ctx = { model, sid, theme, mediaUrl, mediaInfo, textHtml, placeholders };
  const deco = decoSvg(theme, W, H);
  el.innerHTML = `${deco ? `<svg class="sl-deco" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${deco}</svg>` : ""}${s ? model.items(sid).map((it) => itemHtml(it, ctx)).join("") : ""}`;
  return el;
}

// Shrinks text that overflows a box set to "shrink on overflow" (after it's in the page).
export function fitText(root) {
  for (const t of root.querySelectorAll(".sl-text.is-shrink")) {
    t.style.fontSize = "";
    const base = Number.parseFloat(getComputedStyle(t).fontSize) || 16;
    let size = base;
    for (let i = 0; i < 12 && t.scrollHeight > t.clientHeight + 1 && size > 6; i++) { size *= 0.9; t.style.fontSize = `${size}px`; }
  }
}

// The scale that fits a W × H slide in a box.
export const fitScale = (W, H, bw, bh) => Math.max(0.01, Math.min(bw / W, bh / H));

// Renders a slide into a host at a given width (thumbnails, presenter view).
export function mountScaled(host, slideEl, W, H, width, height = null) {
  const s = height ? fitScale(W, H, width, height) : width / W;
  slideEl.style.transform = `scale(${s})`;
  slideEl.style.transformOrigin = "0 0";
  host.style.width = `${W * s}px`;
  host.style.height = `${H * s}px`;
  host.replaceChildren(slideEl);
  return s;
}
