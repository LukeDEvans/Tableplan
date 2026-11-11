// PowerPoint (.pptx) out (SLIDES_DESIGN.md §10): our own writer (fflate for the zip).
// Slides are written 10 in wide (9,144,000 EMU), the size Google Slides uses, so a point
// on our slides is a point in PowerPoint.
//
// Comes out: slides, size, theme colours and fonts, backgrounds (colour, gradient,
// picture), the theme's decoration, text boxes with their formatting (fonts, sizes,
// colours, bold/italic/underline/strike, highlight, links, bullets and numbering,
// alignment, line spacing, vertical alignment, insets, shrink on overflow), shapes (as
// PowerPoint's own preset shapes), lines and connectors with arrowheads, pictures (crop,
// shape mask, transparency, alt text), tables (merges, fills, borders), uploaded video
// and audio (embedded, with their poster), speaker notes, transitions and auto-advance,
// skipped slides. Charts go out as pictures of the chart; linked YouTube or Vimeo videos
// as their poster linked to the video. Not yet: animations and comments.

import { zipSync, strToU8 } from "fflate";
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { resolveColor, resolveFont } from "./themes.js";
import { cleanChartCache } from "./linked.js";
import { renderChart } from "../sheet/chart-svg.js";
import { sniffType } from "./media.js";

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
};
const RT = {
  doc: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  slide: `${NS.r}/slide`, layout: `${NS.r}/slideLayout`, master: `${NS.r}/slideMaster`, theme: `${NS.r}/theme`,
  image: `${NS.r}/image`, notes: `${NS.r}/notesSlide`, notesMaster: `${NS.r}/notesMaster`, link: `${NS.r}/hyperlink`,
  video: `${NS.r}/video`, audio: `${NS.r}/audio`, media: "http://schemas.microsoft.com/office/2007/relationships/media",
  presProps: `${NS.r}/presProps`, viewProps: `${NS.r}/viewProps`, tableStyles: `${NS.r}/tableStyles`,
  core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", app: `${NS.r}/extended-properties`,
};
const SLIDE_EMU = 9144000;

export const xesc = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const hex6 = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : null);

// our shape ids → PowerPoint preset geometry
export const PRESET = {
  rect: "rect", "round-rect": "roundRect", "snip-rect": "snip1Rect", ellipse: "ellipse", triangle: "triangle", "right-triangle": "rtTriangle",
  diamond: "diamond", parallelogram: "parallelogram", trapezoid: "trapezoid", pentagon: "pentagon", hexagon: "hexagon", octagon: "octagon",
  plus: "plus", donut: "donut", frame: "frame", can: "can", cube: "cube", heart: "heart", teardrop: "teardrop", lightning: "lightningBolt",
  moon: "moon", cloud: "cloud", "no-symbol": "noSmoking", "arrow-right": "rightArrow", "arrow-left": "leftArrow", "arrow-up": "upArrow",
  "arrow-down": "downArrow", "arrow-lr": "leftRightArrow", chevron: "chevron", "home-plate": "homePlate", "notched-arrow": "notchedRightArrow",
  star4: "star4", star5: "star5", star6: "star6", star8: "star8", star12: "star12", burst: "star16",
  "callout-rect": "wedgeRectCallout", "callout-round": "wedgeEllipseCallout", "callout-cloud": "cloudCallout", banner: "ribbon2", wave: "wave",
};
const DASH = { dot: "sysDot", dash: "dash", "long-dash": "lgDash", "dash-dot": "dashDot" };
const ARROW = { arrow: "triangle", open: "arrow", circle: "oval", diamond: "diamond", bar: "none" };

function zipFiles() {
  const files = {};
  return {
    files,
    put(path, data) { files[path] = typeof data === "string" ? strToU8(data) : data; },
  };
}
const xml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
function relsXml(list) {
  return xml(`<Relationships xmlns="${NS.rel}">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xesc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`);
}

// ---- text ----------------------------------------------------------------------------------------
function runProps(marks, base, theme, rels) {
  const m = {};
  for (const mk of marks || []) m[mk.type] = mk.attrs || true;
  const ts = m.textStyle || {};
  const size = Number(ts.fontSize) || base.size;
  const color = hex6(ts.color) || hex6(resolveColor(base.color, theme));
  const font = ts.fontFamily || base.font;
  const attrs = [`lang="en-US"`, `sz="${Math.round(Math.max(1, Math.min(400, size)) * 100)}"`];
  if (m.bold || (base.bold && !m.bold)) attrs.push(`b="1"`);
  if (m.italic || base.italic) attrs.push(`i="1"`);
  if (m.underline) attrs.push(`u="sng"`);
  if (m.strike) attrs.push(`strike="sngStrike"`);
  if (m.superscript) attrs.push(`baseline="30000"`);
  if (m.subscript) attrs.push(`baseline="-25000"`);
  let inner = "";
  if (color) inner += `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const hl = hex6(m.highlight?.color);
  if (hl) inner += `<a:highlight><a:srgbClr val="${hl}"/></a:highlight>`;
  if (font) inner += `<a:latin typeface="${xesc(font)}"/><a:cs typeface="${xesc(font)}"/>`;
  if (m.link?.href && /^(https?:|mailto:|tel:)/i.test(m.link.href)) inner += `<a:hlinkClick r:id="${rels.add(RT.link, m.link.href, true)}"/>`;
  return `<a:rPr ${attrs.join(" ")} dirty="0">${inner}</a:rPr>`;
}
function inlineRuns(nodes, base, theme, rels) {
  let out = "";
  for (const n of nodes || []) {
    if (n.type === "text") out += `<a:r>${runProps(n.marks, base, theme, rels)}<a:t>${xesc(n.text)}</a:t></a:r>`;
    else if (n.type === "hardBreak") out += `<a:br>${runProps(n.marks, base, theme, rels)}</a:br>`;
    else if (n.content) out += inlineRuns(n.content, base, theme, rels);
  }
  return out;
}
const ALIGN = { left: "l", center: "ctr", right: "r", justify: "just" };
function paraXml(node, base, theme, rels, list = null) {
  const a = node.attrs || {};
  const algn = ALIGN[a.textAlign || base.align] || "l";
  const lh = Number(a.lineHeight) || base.lineH;
  let ppr = `<a:pPr algn="${algn}"`;
  let inner = "";
  if (list) {
    const ind = 342900 * (list.level + 1), hang = -285750;
    ppr += ` marL="${ind}" indent="${hang}"`;
    inner += list.ordered ? `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"${list.start > 1 ? ` startAt="${list.start}"` : ""}/>` : `<a:buFont typeface="Arial"/><a:buChar char="${["•", "◦", "▪"][list.level % 3]}"/>`;
  } else inner += `<a:buNone/>`;
  ppr += ">";
  if (lh && lh !== 1) inner = `<a:lnSpc><a:spcPct val="${Math.round(lh * 100000)}"/></a:lnSpc>${inner}`;
  const runs = inlineRuns(node.content, base, theme, rels);
  const end = runProps([], base, theme, { add: () => "" }).replace("<a:rPr", "<a:endParaRPr").replace("</a:rPr>", "</a:endParaRPr>");
  return `<a:p>${ppr}${inner}</a:pPr>${runs}${end}</a:p>`;
}
function blocksXml(nodes, base, theme, rels, list = null, level = 0) {
  let out = "";
  for (const n of nodes || []) {
    if (n.type === "paragraph" || n.type === "heading") out += paraXml(n, n.type === "heading" ? { ...base, bold: true, size: base.size * 1.3 } : base, theme, rels, list ? { ...list, level } : null);
    else if (n.type === "bulletList" || n.type === "orderedList") {
      let k = Number(n.attrs?.start) || 1;
      for (const li of n.content || []) {
        // a list item's first paragraph carries the bullet; nested lists go a level in
        const [first, ...rest] = li.content || [];
        if (first) out += paraXml(first, base, theme, rels, { ordered: n.type === "orderedList", start: k, level });
        out += blocksXml(rest, base, theme, rels, { ordered: n.type === "orderedList" }, level + 1);
        k++;
      }
    } else if (n.type === "blockquote") out += blocksXml(n.content, base, theme, rels, null, level);
    else if (n.content) out += blocksXml(n.content, base, theme, rels, list, level);
  }
  return out;
}
export function textBodyXml(fragment, it, theme, rels, emu) {
  let json = { content: [] };
  try { json = fragment ? yXmlFragmentToProsemirrorJSON(fragment) : json; } catch { /* empty */ }
  const base = { size: Number(it.size) || 18, color: it.t === "shape" && !it.color ? "@lt1" : it.color || "@dk1", font: resolveFont(/^@(heading|body)$|^[A-Za-z0-9 ]{1,60}$/.test(it.font || "") ? it.font : "@body", theme), bold: !!it.bold, italic: !!it.italic, align: it.align || "left", lineH: Number(it.lineH) || 1.2 };
  const body = blocksXml(json.content, base, theme, rels) || paraXml({ content: [] }, base, theme, rels);
  const ins = Math.round((Number(it.pad ?? 12)) * emu);
  const anchor = it.valign === "middle" ? "ctr" : it.valign === "bottom" ? "b" : "t";
  return `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0">${it.autofit === "shrink" ? "<a:normAutofit/>" : "<a:noAutofit/>"}</a:bodyPr><a:lstStyle/>${body}</p:txBody>`;
}

// ---- shapes and pictures ----------------------------------------------------------------------------
const xfrm = (it, emu, tag = "a:xfrm") => {
  const rot = Number(it.rot) ? ` rot="${Math.round(Number(it.rot) * 60000)}"` : "";
  return `<${tag}${rot}${it.flipH ? ' flipH="1"' : ""}${it.flipV ? ' flipV="1"' : ""}><a:off x="${Math.round(it.x * emu)}" y="${Math.round(it.y * emu)}"/><a:ext cx="${Math.max(1, Math.round(it.w * emu))}" cy="${Math.max(1, Math.round(it.h * emu))}"/></${tag}>`;
};
function fillXml(c, theme, opacity) {
  const h = hex6(resolveColor(c, theme));
  if (!h) return "<a:noFill/>";
  const a = opacity !== undefined && opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : "";
  return `<a:solidFill><a:srgbClr val="${h}">${a}</a:srgbClr></a:solidFill>`;
}
function lineXml(it, theme, emu, { forLine = false } = {}) {
  const h = hex6(resolveColor(it.stroke ?? (forLine ? "@dk1" : null), theme));
  const sw = Number(it.sw ?? (forLine ? 3 : 0));
  if (!h || !sw) return "<a:ln><a:noFill/></a:ln>";
  const dash = DASH[it.dash] ? `<a:prstDash val="${DASH[it.dash]}"/>` : "";
  const head = forLine && it.a1 && ARROW[it.a1] && it.a1 !== "none" ? `<a:headEnd type="${ARROW[it.a1]}"/>` : "";
  const tail = forLine && it.a2 && ARROW[it.a2] && it.a2 !== "none" ? `<a:tailEnd type="${ARROW[it.a2]}"/>` : "";
  return `<a:ln w="${Math.round(sw * emu)}"${forLine ? ' cap="rnd"' : ""}><a:solidFill><a:srgbClr val="${h}"/></a:solidFill>${dash}${head}${tail}</a:ln>`;
}
const shadowXml = (it) => (it.shadow ? `<a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>` : "");
function geomXml(shape, radius) {
  const prst = PRESET[shape] || "rect";
  let av = "";
  if (prst === "roundRect" && Number.isFinite(radius)) av = `<a:gd name="adj" fmla="val ${Math.round(Math.min(0.5, radius) * 100000)}"/>`;
  return `<a:prstGeom prst="${prst}"><a:avLst>${av}</a:avLst></a:prstGeom>`;
}

// ---- the theme ----------------------------------------------------------------------------------------
function themeXml(theme, name = "Live") {
  const c = theme.colors;
  const clr = (tag, h) => `<a:${tag}><a:srgbClr val="${hex6(h) || "000000"}"/></a:${tag}>`;
  const font = (f) => `<a:latin typeface="${xesc(f)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return xml(`<a:theme xmlns:a="${NS.a}" name="${xesc(name)}"><a:themeElements><a:clrScheme name="${xesc(name)}">${clr("dk1", c.dk1)}${clr("lt1", c.lt1)}${clr("dk2", c.dk2)}${clr("lt2", c.lt2)}${clr("accent1", c.a1)}${clr("accent2", c.a2)}${clr("accent3", c.a3)}${clr("accent4", c.a4)}${clr("accent5", c.a5)}${clr("accent6", c.a6)}${clr("hlink", c.link)}${clr("folHlink", c.link)}</a:clrScheme>
<a:fontScheme name="${xesc(name)}"><a:majorFont>${font(theme.fonts.heading)}</a:majorFont><a:minorFont>${font(theme.fonts.body)}</a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`);
}
const CLRMAP = `bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"`;
const SPTREE_OPEN = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
const ROOT_NS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

// ---- pictures for charts ----------------------------------------------------------------------------
async function svgToPng(svg, w, h) {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement("canvas");
  c.width = Math.round(w); c.height = Math.round(h);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

// ---- the file ---------------------------------------------------------------------------------------------
// media: { bytes(id) → Promise<Uint8Array> } (the presentation's store).
export async function exportPptx(model, { media = null, chartPng = svgToPng } = {}) {
  const z = zipFiles();
  const theme = model.theme();
  const [W, H] = model.size();
  const emu = SLIDE_EMU / W;
  const cx = SLIDE_EMU, cy = Math.round(H * emu);
  const ids = model.slideIds();
  const ct = { defaults: new Map([["rels", "application/vnd.openxmlformats-package.relationships+xml"], ["xml", "application/xml"]]), overrides: [] };
  const over = (part, type) => ct.overrides.push([part, type]);
  const mediaFiles = new Map(); // id → path in the zip
  let mediaN = 0;
  async function mediaPath(id, extHint = null) {
    if (mediaFiles.has(id)) return mediaFiles.get(id);
    let bytes = null;
    try { bytes = await media?.bytes(id); } catch { bytes = null; }
    if (!bytes) { mediaFiles.set(id, null); return null; }
    const type = sniffType(bytes);
    const ext = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/webp": "png", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/ogg": "ogg" }[type] || extHint || "bin";
    const path = `ppt/media/media${++mediaN}.${ext}`;
    z.put(path, bytes);
    ct.defaults.set(ext, type === "image/webp" ? "image/png" : type);
    mediaFiles.set(id, path);
    return path;
  }
  let grey = null;
  const greyPath = async () => (grey ||= await putPng(GREY_PNG));
  async function putPng(bytes) {
    const path = `ppt/media/media${++mediaN}.png`;
    z.put(path, bytes);
    ct.defaults.set("png", "image/png");
    return path;
  }

  // master, layout, theme, notes master
  z.put("ppt/theme/theme1.xml", themeXml(theme, theme.name || "Live"));
  over("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml");
  z.put("ppt/theme/theme2.xml", themeXml(theme, "Notes"));
  over("/ppt/theme/theme2.xml", "application/vnd.openxmlformats-officedocument.theme+xml");
  z.put("ppt/slideMasters/slideMaster1.xml", xml(`<p:sldMaster ${ROOT_NS}>${SPTREE_OPEN}</p:spTree></p:cSld><p:clrMap ${CLRMAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600"><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`));
  z.put("ppt/slideMasters/_rels/slideMaster1.xml.rels", relsXml([{ id: "rId1", type: RT.layout, target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: RT.theme, target: "../theme/theme1.xml" }]));
  over("/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml");
  z.put("ppt/slideLayouts/slideLayout1.xml", xml(`<p:sldLayout ${ROOT_NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`));
  z.put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsXml([{ id: "rId1", type: RT.master, target: "../slideMasters/slideMaster1.xml" }]));
  over("/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml");
  z.put("ppt/notesMasters/notesMaster1.xml", xml(`<p:notesMaster ${ROOT_NS}>${SPTREE_OPEN}</p:spTree></p:cSld><p:clrMap ${CLRMAP}/></p:notesMaster>`));
  z.put("ppt/notesMasters/_rels/notesMaster1.xml.rels", relsXml([{ id: "rId1", type: RT.theme, target: "../theme/theme2.xml" }]));
  over("/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml");

  // slides
  for (let i = 0; i < ids.length; i++) {
    const sid = ids[i], n = i + 1;
    const s = model.slide(sid);
    const relList = [{ id: "rId1", type: RT.layout, target: "../slideLayouts/slideLayout1.xml" }];
    const rels = {
      add(type, target, external = false) {
        const hit = relList.find((r) => r.type === type && r.target === target);
        if (hit) return hit.id;
        const id = `rId${relList.length + 1}`;
        relList.push({ id, type, target, external });
        return id;
      },
    };
    let spId = 2;
    const shapes = [];
    // the theme's decoration, behind everything
    shapes.push(...decoShapes(theme, W, H, emu, () => spId++));
    for (const it of model.items(sid)) {
      const id = spId++;
      const name = xesc(it.name || `${it.t} ${id}`);
      const hidden = "";
      if (it.t === "text" || it.t === "shape") {
        const fill = it.t === "shape" ? fillXml(it.fill ?? "@a1", theme, it.opacity) : fillXml(it.fill, theme, it.opacity);
        shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"${hidden}/><p:cNvSpPr${it.t === "text" ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it, emu)}${geomXml(it.t === "shape" ? it.shape : "rect", it.radius)}${fill}${lineXml(it, theme, emu)}${shadowXml(it)}</p:spPr>${textBodyXml(model.text(sid, it.id), it, theme, rels, emu)}</p:sp>`);
      } else if (it.t === "line") {
        const prst = it.kind === "elbow" ? "bentConnector3" : it.kind === "curve" ? "curvedConnector3" : "line";
        shapes.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(it, emu)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${lineXml(it, theme, emu, { forLine: true })}</p:spPr></p:cxnSp>`);
      } else if (it.t === "image") {
        const path = it.media ? await mediaPath(it.media) : null;
        if (!path) continue;
        const rid = rels.add(RT.image, `../media/${path.split("/").pop()}`);
        const c = it.crop || {};
        const src = ["l", "t", "r", "b"].some((k) => Number(c[k])) ? `<a:srcRect l="${Math.round((Number(c.l) || 0) * 100000)}" t="${Math.round((Number(c.t) || 0) * 100000)}" r="${Math.round((Number(c.r) || 0) * 100000)}" b="${Math.round((Number(c.b) || 0) * 100000)}"/>` : "";
        const alpha = it.opacity !== undefined && it.opacity < 1 ? `<a:alphaModFix amt="${Math.round(it.opacity * 100000)}"/>` : "";
        const gray = it.recolor === "gray" ? "<a:grayscl/>" : "";
        shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}" descr="${xesc(it.alt || "")}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${alpha}${gray}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(it, emu)}${geomXml(it.mask && PRESET[it.mask] ? it.mask : "rect")}${lineXml(it, theme, emu)}${shadowXml(it)}</p:spPr></p:pic>`);
      } else if (it.t === "table") {
        shapes.push(tableXml(it, id, name, theme, emu));
      } else if (it.t === "chart") {
        const c = cleanChartCache(it.cache);
        const png = c ? await chartPng(renderChart(c.data, c.spec, { w: Math.round(it.w / 2.4), h: Math.round(it.h / 2.4), theme: { surface: hex6(resolveColor(it.fill, theme)) ? resolveColor(it.fill, theme) : "#ffffff", ink: theme.colors.dk1, muted: theme.colors.dk2, grid: "#dddddd" } }), it.w, it.h) : null;
        if (!png) continue;
        const rid = rels.add(RT.image, `../media/${(await putPng(png)).split("/").pop()}`);
        shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xesc(c.spec.title || "Chart")}" descr="${xesc(c.spec.title || "Chart")}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(it, emu)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
      } else if (it.t === "video" || it.t === "audio") {
        shapes.push(await mediaXml(it, id, name, emu, rels, mediaPath, greyPath));
      }
    }
    // background
    let bg = "";
    const b = s.bg || theme.bg;
    if (b.kind === "image" && b.media) {
      const path = await mediaPath(b.media);
      if (path) bg = `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rels.add(RT.image, `../media/${path.split("/").pop()}`)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
    } else if (b.kind === "gradient") {
      const from = hex6(resolveColor(b.from?.[0] === "#" ? b.from : `@${b.from}`, theme)) || "FFFFFF";
      const to = hex6(resolveColor(b.to?.[0] === "#" ? b.to : `@${b.to}`, theme)) || "FFFFFF";
      // CSS angles run clockwise from "up"; DrawingML's from "right"
      const ang = Math.round((((Number(b.angle) || 0) - 90 + 360) % 360) * 60000);
      bg = `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${from}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${to}"/></a:gs></a:gsLst><a:lin ang="${ang}" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`;
    } else {
      const c = hex6(b.color ? resolveColor(b.color, theme) : resolveColor(`@${b.role || "lt1"}`, theme)) || "FFFFFF";
      bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
    }
    // notes
    const nf = model.notes(sid);
    let notesJson = null;
    try { notesJson = nf ? yXmlFragmentToProsemirrorJSON(nf) : null; } catch { notesJson = null; }
    if (notesJson?.content?.some((x) => x.content?.length)) {
      const nrels = { add: () => "" };
      const body = blocksXml(notesJson.content, { size: 12, color: "#000000", font: theme.fonts.body, align: "left", lineH: 1 }, theme, nrels);
      z.put(`ppt/notesSlides/notesSlide${n}.xml`, xml(`<p:notes ${ROOT_NS}>${SPTREE_OPEN}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`));
      z.put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, relsXml([{ id: "rId1", type: RT.notesMaster, target: "../notesMasters/notesMaster1.xml" }, { id: "rId2", type: RT.slide, target: `../slides/slide${n}.xml` }]));
      over(`/ppt/notesSlides/notesSlide${n}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml");
      rels.add(RT.notes, `../notesSlides/notesSlide${n}.xml`);
    }
    const transition = transitionXml(s);
    z.put(`ppt/slides/slide${n}.xml`, xml(`<p:sld ${ROOT_NS}${s.skip ? ' show="0"' : ""}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}</p:sld>`));
    z.put(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(relList));
    over(`/ppt/slides/slide${n}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
  }

  // presentation
  const presRels = [{ id: "rId1", type: RT.master, target: "slideMasters/slideMaster1.xml" }, { id: "rId2", type: RT.notesMaster, target: "notesMasters/notesMaster1.xml" }, { id: "rId3", type: RT.theme, target: "theme/theme1.xml" }, { id: "rId4", type: RT.presProps, target: "presProps.xml" }, { id: "rId5", type: RT.viewProps, target: "viewProps.xml" }, { id: "rId6", type: RT.tableStyles, target: "tableStyles.xml" }];
  const sldIds = ids.map((_, i) => { const rid = `rId${presRels.length + 1}`; presRels.push({ id: rid, type: RT.slide, target: `slides/slide${i + 1}.xml` }); return `<p:sldId id="${256 + i}" r:id="${rid}"/>`; }).join("");
  z.put("ppt/presentation.xml", xml(`<p:presentation ${ROOT_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`));
  z.put("ppt/_rels/presentation.xml.rels", relsXml(presRels));
  over("/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
  z.put("ppt/presProps.xml", xml(`<p:presentationPr ${ROOT_NS}/>`));
  over("/ppt/presProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml");
  z.put("ppt/viewProps.xml", xml(`<p:viewPr ${ROOT_NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`));
  over("/ppt/viewProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml");
  z.put("ppt/tableStyles.xml", xml(`<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`));
  over("/ppt/tableStyles.xml", "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml");
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  z.put("docProps/core.xml", xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Live</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`));
  over("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml");
  z.put("docProps/app.xml", xml(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Live</Application><Slides>${ids.length}</Slides></Properties>`));
  over("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml");
  z.put("_rels/.rels", relsXml([{ id: "rId1", type: RT.doc, target: "ppt/presentation.xml" }, { id: "rId2", type: RT.core, target: "docProps/core.xml" }, { id: "rId3", type: RT.app, target: "docProps/app.xml" }]));
  z.put("[Content_Types].xml", xml(`<Types xmlns="${NS.ct}">${[...ct.defaults].map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join("")}${ct.overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join("")}</Types>`));
  return zipSync(z.files, { level: 6 });
}

function decoShapes(theme, W, H, emu, nextId) {
  const out = [];
  const box = (prst, x, y, w, h, color, { alpha = 1, line = null, flipH = false } = {}) => {
    const id = nextId();
    const it = { x, y, w, h, flipH };
    const fill = line ? "<a:noFill/>" : `<a:solidFill><a:srgbClr val="${hex6(color)}">${alpha < 1 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>`;
    const ln = line ? `<a:ln w="${Math.round(2 * emu)}"><a:solidFill><a:srgbClr val="${hex6(line)}"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
    out.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Theme decoration ${id}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr>${xfrm(it, emu)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fill}${ln}</p:spPr></p:sp>`);
  };
  const a = theme.colors.a1, b = theme.colors.a2;
  switch (theme.deco) {
    case "bar-left": box("rect", 0, 0, W * 0.012, H, a); break;
    case "band-top": box("rect", 0, 0, W, H * 0.018, a); break;
    case "band-bottom": box("rect", 0, H * 0.955, W, H * 0.01, b); box("rect", 0, H * 0.965, W, H * 0.035, a); break;
    case "corner": box("rtTriangle", W - H * 0.28, 0, H * 0.28, H * 0.28, a, { flipH: true }); break;
    case "frame": box("rect", W * 0.02, H * 0.035, W * 0.96, H * 0.93, null, { line: theme.colors.dk2 }); break;
    case "circle": box("ellipse", W * 0.95 - H * 0.22, H * 0.08 - H * 0.22, H * 0.44, H * 0.44, a, { alpha: 0.18 }); box("ellipse", W * 0.04 - H * 0.12, H * 0.95 - H * 0.12, H * 0.24, H * 0.24, b, { alpha: 0.18 }); break;
    default: break;
  }
  return out;
}

function tableXml(it, id, name, theme, emu) {
  const rows = Math.max(1, Number(it.rows) || 1), cols = Math.max(1, Number(it.cols) || 1);
  const colW = Array.isArray(it.colW) && it.colW.length === cols ? it.colW.map((x) => Number(x) || 1) : Array(cols).fill(1);
  const total = colW.reduce((p, q) => p + q, 0);
  const W = Math.round(it.w * emu), rowH = Math.round((it.h * emu) / rows);
  const border = hex6(resolveColor(it.stroke || "@dk2", theme)) || "999999";
  const ln = (tag) => `<a:${tag} w="12700"><a:solidFill><a:srgbClr val="${border}"/></a:solidFill></a:${tag}>`;
  const cells = it.cells || {};
  const covered = new Map();
  let body = "";
  for (let r = 0; r < rows; r++) {
    body += `<a:tr h="${rowH}">`;
    for (let c = 0; c < cols; c++) {
      const cov = covered.get(`${r}.${c}`);
      const cell = cells[`${r}.${c}`] || {};
      const rs = Math.max(1, Math.min(rows - r, Number(cell.rs) || 1)), cs = Math.max(1, Math.min(cols - c, Number(cell.cs) || 1));
      if (!cov) for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (i || j) covered.set(`${r + i}.${c + j}`, { h: j > 0, v: i > 0 });
      const span = cov ? `${cov.h ? ' hMerge="1"' : ""}${cov.v ? ' vMerge="1"' : ""}` : `${cs > 1 ? ` gridSpan="${cs}"` : ""}${rs > 1 ? ` rowSpan="${rs}"` : ""}`;
      const fill = hex6(resolveColor(cell.fill || (r === 0 && it.fill ? it.fill : null), theme));
      const color = hex6(resolveColor(cell.color || it.color || "@dk1", theme)) || "000000";
      const sz = Math.round((Number(it.size) || 16) * 100);
      const algn = ALIGN[cell.align] || "l";
      const font = resolveFont(/^@(heading|body)$|^[A-Za-z0-9 ]{1,60}$/.test(it.font || "") ? it.font : "@body", theme);
      const paras = cov ? `<a:p><a:endParaRPr lang="en-US" sz="${sz}"/></a:p>` : String(cell.text || "").split("\n").map((line) => `<a:p><a:pPr algn="${algn}"/>${line ? `<a:r><a:rPr lang="en-US" sz="${sz}"${cell.bold ? ' b="1"' : ""}${cell.italic ? ' i="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${xesc(font)}"/></a:rPr><a:t>${xesc(line)}</a:t></a:r>` : ""}<a:endParaRPr lang="en-US" sz="${sz}"/></a:p>`).join("");
      body += `<a:tc${span}><a:txBody><a:bodyPr/><a:lstStyle/>${paras}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720">${ln("lnL")}${ln("lnR")}${ln("lnT")}${ln("lnB")}${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>"}</a:tcPr></a:tc>`;
    }
    body += "</a:tr>";
  }
  const grid = colW.map((w) => `<a:gridCol w="${Math.round((W * w) / total)}"/>`).join("");
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${Math.round(it.x * emu)}" y="${Math.round(it.y * emu)}"/><a:ext cx="${W}" cy="${rowH * rows}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"/><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

// A 1×1 grey picture: the poster when a video has none.
const GREY_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
async function mediaXml(it, id, name, emu, rels, mediaPath, greyPath) {
  const posterPath = (it.poster ? await mediaPath(it.poster) : null) || (await greyPath());
  const posterRid = rels.add(RT.image, `../media/${posterPath.split("/").pop()}`);
  const sp = `<p:spPr>${xfrm(it, emu)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`;
  if (it.link) {
    // a linked video: its poster, opening the video when clicked
    const href = /^https:\/\//.test(it.link) ? it.link : null;
    const click = href ? `<a:hlinkClick r:id="${rels.add(RT.link, href, true)}"/>` : "";
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}" descr="${xesc(href || "Video")}">${click}</p:cNvPr><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${posterRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>${sp}</p:pic>`;
  }
  const path = it.media ? await mediaPath(it.media) : null;
  if (!path) return "";
  const file = `../media/${path.split("/").pop()}`;
  const vr = rels.add(it.t === "video" ? RT.video : RT.audio, file);
  const mr = rels.add(RT.media, file);
  const tag = it.t === "video" ? "a:videoFile" : "a:audioFile";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><${tag} r:link="${vr}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${mr}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${posterRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>${sp}</p:pic>`;
}

function transitionXml(s) {
  const tr = s.transition;
  const adv = s.advance ? ` advTm="${Math.round(s.advance * 1000)}"` : "";
  if (!tr && !adv) return "";
  const spd = !tr ? "" : tr.ms <= 400 ? ' spd="fast"' : tr.ms >= 900 ? ' spd="slow"' : ' spd="med"';
  const dir = { left: "r", right: "l", top: "d", bottom: "u" }[tr?.dir] || "l"; // ours: where it comes from; PowerPoint: where it goes
  const inner = !tr ? "" : {
    fade: "<p:fade/>", dissolve: "<p:dissolve/>", slide: `<p:push dir="${dir}"/>`, gallery: `<p:push dir="${dir}"/>`, cube: `<p:push dir="${dir}"/>`,
    flip: `<p:push dir="${dir}"/>`, zoom: "<p:zoom/>",
  }[tr.kind] || "";
  return `<p:transition${spd}${adv}>${inner}</p:transition>`;
}

export { GREY_PNG };
