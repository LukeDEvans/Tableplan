// PowerPoint (.pptx) in (SLIDES_DESIGN.md §10): our own reader. fflate unzips;
// fast-xml-parser (in order-preserving mode, since a paragraph's runs, breaks and fields
// come in order) reads the XML into a small tree.
//
// Comes in: slide size, the theme's colours and fonts, backgrounds (colour, gradient,
// picture; from the slide, its layout or master), placeholders in the place their layout
// or master puts them, text with its formatting (fonts, sizes, colours, bold / italic /
// underline / strike, links, bullets and numbering, alignment, line spacing, insets,
// vertical alignment, shrink on overflow), shapes (PowerPoint's preset shapes mapped to
// ours), lines and connectors with arrowheads, pictures (crop, shape mask, alt text),
// groups, tables (merges, fills), charts (as charts, from the data saved in the file),
// embedded video and audio, speaker notes, transitions, auto-advance, hidden slides.
// What doesn't come over is listed in `notes`.
//
//   readPptx(bytes) → plain data (for tests)
//   pptxIntoModel(model, bytes, { putMedia }) → { notes }   putMedia(bytes, mime) → media id

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { PRESET } from "./pptx-export.js";
import { cleanTheme, SIZES } from "./themes.js";
import { writeJson } from "./text.js";
import { sniffType } from "./media.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true, preserveOrder: true, parseTagValue: false, parseAttributeValue: false, trimValues: false });
const FROM_PRESET = Object.fromEntries(Object.entries(PRESET).map(([ours, theirs]) => [theirs, ours]));
Object.assign(FROM_PRESET, { roundRect: "round-rect", flowChartProcess: "rect", flowChartAlternateProcess: "round-rect", flowChartDecision: "diamond", flowChartTerminator: "round-rect", flowChartConnector: "ellipse", wedgeRoundRectCallout: "callout-rect", star7: "star8", star10: "star12", star24: "burst", star32: "burst", ribbon: "banner", doubleWave: "wave", leftRightUpArrow: "plus", snip2SameRect: "snip-rect", round1Rect: "round-rect", round2SameRect: "round-rect" });
const ARROW_IN = { triangle: "arrow", stealth: "arrow", arrow: "open", oval: "circle", diamond: "diamond" };

// ---- a small XML tree ----------------------------------------------------------------------------------
// { n: name, a: { attrs }, c: [children], t: text }
function toTree(list) {
  const out = [];
  for (const node of list || []) {
    const keys = Object.keys(node).filter((k) => k !== ":@");
    for (const k of keys) {
      if (k === "#text") { out.push({ n: "#text", t: String(node[k]), a: {}, c: [] }); continue; }
      out.push({ n: k, a: node[":@"] || {}, c: toTree(node[k]) });
    }
  }
  return out;
}
export function parseXml(s) {
  const t = toTree(parser.parse(s));
  return t.find((x) => x.n !== "?xml" && x.n !== "#text") || { n: "", a: {}, c: [] };
}
const kid = (node, name) => node?.c?.find((x) => x.n === name) || null;
const kids = (node, name) => (node?.c || []).filter((x) => x.n === name);
const path = (node, ...names) => names.reduce((n, name) => kid(n, name), node);
const textOf = (node) => (!node ? "" : node.n === "#text" ? node.t : (node.c || []).map(textOf).join(""));
function findDeep(node, name, depth = 0) {
  if (!node || depth > 12) return null;
  if (node.n === name) return node;
  for (const c of node.c || []) { const f = findDeep(c, name, depth + 1); if (f) return f; }
  return null;
}
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---- the package --------------------------------------------------------------------------------------
function openPackage(bytes) {
  let files;
  // Unpacking is capped by each entry's stated size (fflate never writes past it), so a
  // small file can't ask for gigabytes: one entry up to 80 MB, 300 MB in all. A first pass
  // only reads the list of entries, so a file over the total is refused before any unpacking.
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const keep = (f) => f.originalSize <= 80 * 1024 * 1024;
  let total = 0;
  try { unzipSync(u8, { filter: (f) => { if (keep(f)) total += f.originalSize; return false; } }); } catch { throw new Error("That file isn't a PowerPoint (.pptx) file."); }
  const tooBig = total > 300 * 1024 * 1024;
  if (!tooBig) {
    try { files = unzipSync(u8, { filter: keep }); } catch { throw new Error("That file isn't a PowerPoint (.pptx) file."); }
  }
  if (tooBig) throw new Error("That PowerPoint file unpacks to more than 300 MB, which is more than can be opened here.");
  if (!files["ppt/presentation.xml"]) throw new Error("That file isn't a PowerPoint (.pptx) file.");
  const xmlCache = new Map();
  const xml = (p) => { if (!files[p]) return null; if (!xmlCache.has(p)) xmlCache.set(p, parseXml(strFromU8(files[p]))); return xmlCache.get(p); };
  const resolve = (from, target) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = from.split("/").slice(0, -1);
    for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
    return parts.join("/");
  };
  const relsCache = new Map();
  function rels(part) {
    if (relsCache.has(part)) return relsCache.get(part);
    const dir = part.split("/").slice(0, -1).join("/");
    const r = xml(`${dir}/_rels/${part.split("/").pop()}.rels`);
    const map = new Map();
    for (const x of kids(r, "Relationship")) map.set(x.a.Id, { type: String(x.a.Type || "").split("/").pop(), target: x.a.TargetMode === "External" ? x.a.Target : resolve(part, x.a.Target || ""), external: x.a.TargetMode === "External" });
    relsCache.set(part, map);
    return map;
  }
  const relOfType = (part, type) => [...rels(part).values()].find((r) => r.type === type) || null;
  return { files, xml, rels, relOfType };
}

// ---- colours ---------------------------------------------------------------------------------------------
const hexOk = (h) => /^[0-9a-f]{6}$/i.test(h || "");
function applyMods(hex, node) {
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  // to HSL for lumMod / lumOff
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  let alpha = 1, touched = false;
  for (const m of node.c || []) {
    const v = num(m.a.val) / 100000;
    if (m.n === "lumMod") { l *= v; touched = true; }
    else if (m.n === "lumOff") { l += v; touched = true; }
    else if (m.n === "tint") { l = l + (1 - l) * (1 - v); touched = true; }
    else if (m.n === "shade") { l *= v; touched = true; }
    else if (m.n === "alpha") alpha = v;
  }
  if (touched) {
    l = Math.max(0, Math.min(1, l));
    const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    if (s === 0) r = g = b = l;
    else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3); }
  }
  return { hex: `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`, alpha };
}
const SCHEME_ALIAS = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
function colorIn(node, scheme, phClr = null) {
  if (!node) return null;
  const c = node.c?.find((x) => ["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"].includes(x.n));
  if (!c) return null;
  let hex = null;
  if (c.n === "srgbClr" && hexOk(c.a.val)) hex = c.a.val;
  else if (c.n === "sysClr") hex = hexOk(c.a.lastClr) ? c.a.lastClr : c.a.val === "window" ? "FFFFFF" : "000000";
  else if (c.n === "schemeClr") { const key = SCHEME_ALIAS[c.a.val] || c.a.val; hex = key === "phClr" ? phClr?.slice(1) : scheme[key]?.slice(1); }
  else if (c.n === "prstClr") hex = { black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "008000", yellow: "FFFF00", gray: "808080" }[c.a.val] || "000000";
  if (!hexOk(hex)) return null;
  return applyMods(hex, c);
}

// ---- theme -------------------------------------------------------------------------------------------------
function readTheme(themeXml) {
  const scheme = {};
  const cs = findDeep(themeXml, "clrScheme");
  const names = { dk1: "dk1", lt1: "lt1", dk2: "dk2", lt2: "lt2", accent1: "a1", accent2: "a2", accent3: "a3", accent4: "a4", accent5: "a5", accent6: "a6", hlink: "link" };
  for (const k of Object.keys(names)) {
    const node = kid(cs, k);
    const c = node && colorIn(node, {});
    if (c) scheme[k] = c.hex;
  }
  const fs = findDeep(themeXml, "fontScheme");
  const major = path(fs, "majorFont", "latin")?.a.typeface || "Arial";
  const minor = path(fs, "minorFont", "latin")?.a.typeface || "Arial";
  const ours = {};
  for (const [k, v] of Object.entries(names)) if (scheme[k]) ours[v] = scheme[k];
  return { scheme, colors: ours, fonts: { heading: cleanFont(major), body: cleanFont(minor) } };
}
const cleanFont = (f) => String(f || "").replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 60) || "Arial";

// ---- reading ------------------------------------------------------------------------------------------------
export function readPptx(bytes) {
  const pkg = openPackage(bytes);
  const pres = pkg.xml("ppt/presentation.xml");
  const sz = kid(pres, "sldSz");
  const cx = num(sz?.a.cx, 9144000), cy = num(sz?.a.cy, 5143500);
  const slideRefs = kids(kid(pres, "sldIdLst"), "sldId").map((s) => pkg.rels("ppt/presentation.xml").get(s.a.id))
    .filter((r) => r && r.type === "slide").map((r) => r.target);
  const notes = new Set();
  // the theme (through the first slide's master)
  let theme = { scheme: {}, colors: {}, fonts: { heading: "Arial", body: "Arial" } };
  const firstLayout = slideRefs[0] && pkg.relOfType(slideRefs[0], "slideLayout")?.target;
  const firstMaster = firstLayout && pkg.relOfType(firstLayout, "slideMaster")?.target;
  const themePart = firstMaster && pkg.relOfType(firstMaster, "theme")?.target;
  if (themePart && pkg.xml(themePart)) theme = readTheme(pkg.xml(themePart));
  const ptScale = 720 / (cx / 12700); // their points → ours (a slide is 720 pt wide here)
  const slides = slideRefs.map((p) => readSlide(pkg, p, theme, notes, ptScale));
  return { cx, cy, theme, slides, notes: [...notes], pkg, ptScale };
}

const phKey = (sp) => { const ph = findDeep(kid(sp, "nvSpPr") || kid(sp, "nvPicPr") || kid(sp, "nvGraphicFramePr") || sp, "ph"); return ph ? { type: ph.a.type || "body", idx: ph.a.idx ?? null } : null; };
function placeholderOf(tree, key) {
  if (!tree || !key) return null;
  const spTree = path(tree, "cSld", "spTree");
  const all = kids(spTree, "sp");
  const byIdx = key.idx !== null ? all.find((s) => phKey(s)?.idx === key.idx) : null;
  if (byIdx) return byIdx;
  const t = key.type === "ctrTitle" ? ["ctrTitle", "title"] : key.type === "subTitle" ? ["subTitle", "body"] : [key.type];
  return all.find((s) => t.includes(phKey(s)?.type)) || null;
}

function readSlide(pkg, part, theme, notes, ptScale = 1) {
  const tree = pkg.xml(part);
  const layoutPart = pkg.relOfType(part, "slideLayout")?.target;
  const layout = layoutPart ? pkg.xml(layoutPart) : null;
  const masterPart = layoutPart ? pkg.relOfType(layoutPart, "slideMaster")?.target : null;
  const master = masterPart ? pkg.xml(masterPart) : null;
  const ctx = { pkg, part, theme, notes, layout, layoutPart, master, masterPart, ptScale };
  const items = [];
  readShapes(path(tree, "cSld", "spTree"), ctx, items, null, null);
  // background: the slide's, else its layout's, else its master's
  let bg = null;
  for (const [t, p] of [[tree, part], [layout, layoutPart], [master, masterPart]]) {
    const b = path(t, "cSld", "bg");
    if (b) { bg = readBackground(b, { ...ctx, part: p }); break; }
  }
  // notes
  let notesText = null;
  const notesPart = pkg.relOfType(part, "notesSlide")?.target;
  if (notesPart && pkg.xml(notesPart)) {
    const nt = pkg.xml(notesPart);
    const body = kids(path(nt, "cSld", "spTree"), "sp").find((s) => phKey(s)?.type === "body");
    if (body) notesText = readText(kid(body, "txBody"), { ...ctx, part: notesPart, ptScale: 1 }, { size: 12, ph: null });
  }
  // transition (PowerPoint often wraps it in mc:AlternateContent)
  const tr = findDeep(tree, "transition");
  let transition = null, advance = 0;
  if (tr) {
    const kind = tr.c?.find((x) => x.n !== "#text" && x.n !== "sndAc" && x.n !== "extLst");
    const ms = tr.a.dur ? num(tr.a.dur, 500) : tr.a.spd === "fast" ? 300 : tr.a.spd === "slow" ? 1000 : 600;
    const map = { fade: "fade", dissolve: "dissolve", push: "slide", cover: "slide", pull: "slide", wipe: "slide", split: "fade", zoom: "zoom", newsflash: "zoom", cut: null, prism: "cube", gallery: "gallery", flip: "flip", vortex: "zoom", conveyor: "gallery" };
    const k = kind ? map[kind.n] : null;
    if (k) transition = { kind: k, dir: { l: "right", r: "left", u: "bottom", d: "top" }[kind.a.dir] || "right", ms: Math.max(100, Math.min(5000, ms)) };
    else if (kind && kind.n !== "cut") notes.add("Some transitions became a fade or were left out.");
    if (tr.a.advTm) advance = Math.round(num(tr.a.advTm) / 1000);
  }
  if (findDeep(tree, "timing") && findDeep(findDeep(tree, "timing"), "par")) notes.add("Animations weren't brought over yet.");
  if (pkg.relOfType(part, "comments")) notes.add("Comments weren't brought over.");
  return { items, bg, notes: notesText, transition, advance, skip: tree?.a?.show === "0" };
}

// The fill and line a shape actually has (its own, else its style's).
function shapeFill(spPr, style, ctx) {
  const scheme = ctx.theme.scheme;
  if (kid(spPr, "noFill")) return { fill: "none" };
  const solid = kid(spPr, "solidFill");
  if (solid) { const c = colorIn(solid, scheme); return c ? { fill: c.hex, alpha: c.alpha } : {}; }
  const grad = kid(spPr, "gradFill");
  if (grad) { const gs = kids(kid(grad, "gsLst"), "gs")[0]; const c = gs && colorIn(gs, scheme); return c ? { fill: c.hex, alpha: c.alpha } : {}; }
  if (kid(spPr, "blipFill")) return {};
  const ref = kid(style, "fillRef");
  if (ref && num(ref.a.idx) > 0) { const c = colorIn(ref, scheme); if (c) return { fill: c.hex }; }
  return null; // nothing said
}
function shapeLine(spPr, style, ctx) {
  const ln = kid(spPr, "ln");
  const scheme = ctx.theme.scheme;
  if (ln && kid(ln, "noFill")) return { stroke: null, sw: 0 };
  let color = ln ? colorIn(kid(ln, "solidFill"), scheme) : null;
  if (!color && kid(style, "lnRef") && num(kid(style, "lnRef").a.idx) > 0) color = colorIn(kid(style, "lnRef"), scheme);
  if (!color) return null;
  const out = { stroke: color.hex, sw: num(ln?.a.w, 12700) / 12700 }; // points for now (pptxIntoModel turns them into slide px)
  const dash = kid(ln, "prstDash")?.a.val;
  const d = { sysDot: "dot", dot: "dot", sysDash: "dash", dash: "dash", lgDash: "long-dash", dashDot: "dash-dot", lgDashDot: "dash-dot", sysDashDot: "dash-dot" }[dash];
  if (d) out.dash = d;
  const he = kid(ln, "headEnd")?.a.type, te = kid(ln, "tailEnd")?.a.type;
  if (ARROW_IN[he]) out.a1 = ARROW_IN[he];
  if (ARROW_IN[te]) out.a2 = ARROW_IN[te];
  return out;
}

// Reads shapes into items. g: the group transform { scaleX, scaleY, offX, offY, chOffX, chOffY } or null.
function readShapes(spTree, ctx, items, g, grp) {
  for (const node of spTree?.c || []) {
    if (node.n === "AlternateContent") { const pick = kid(node, "Choice") || kid(node, "Fallback"); if (pick) readShapes(pick, ctx, items, g, grp); continue; }
    if (node.n === "grpSp") {
      const x = path(node, "grpSpPr", "xfrm");
      const off = kid(x, "off"), ext = kid(x, "ext"), chOff = kid(x, "chOff"), chExt = kid(x, "chExt");
      const sx = num(chExt?.a.cx) ? num(ext?.a.cx) / num(chExt.a.cx) : 1, sy = num(chExt?.a.cy) ? num(ext?.a.cy) / num(chExt.a.cy) : 1;
      const inner = { sx, sy, offX: num(off?.a.x), offY: num(off?.a.y), chX: num(chOff?.a.x), chY: num(chOff?.a.y) };
      const composed = g ? { ...inner, parent: g } : inner;
      readShapes(node, ctx, items, composed, grp || `g${items.length}${Math.random().toString(36).slice(2, 7)}`);
      continue;
    }
    if (!["sp", "pic", "cxnSp", "graphicFrame"].includes(node.n)) continue;
    try {
      const it = readOne(node, ctx, g);
      if (it) { if (grp) it.fields.grp = grp; items.push(it); }
    } catch { ctx.notes.add("A few shapes couldn't be read and were left out."); }
  }
}
// Maps a shape's EMU box through any groups it's in.
function place(xfrmNode, g) {
  const off = kid(xfrmNode, "off"), ext = kid(xfrmNode, "ext");
  if (!off || !ext) return null;
  let x = num(off.a.x), y = num(off.a.y), w = num(ext.a.cx), h = num(ext.a.cy);
  for (let t = g; t; t = t.parent) { x = t.offX + (x - t.chX) * t.sx; y = t.offY + (y - t.chY) * t.sy; w *= t.sx; h *= t.sy; }
  return { x, y, w, h, rot: num(xfrmNode.a.rot) / 60000, flipH: xfrmNode.a.flipH === "1", flipV: xfrmNode.a.flipV === "1" };
}
function inheritedXfrm(node, ctx) {
  const key = phKey(node);
  if (!key) return null;
  for (const t of [ctx.layout, ctx.master]) {
    const ph = placeholderOf(t, key);
    const x = ph && path(ph, "spPr", "xfrm");
    if (x && kid(x, "off")) return x;
  }
  return null;
}

function readOne(node, ctx, g) {
  const spPr = kid(node, "spPr") || kid(node, "grpSpPr");
  let xf = node.n === "graphicFrame" ? kid(node, "xfrm") : path(node, "spPr", "xfrm");
  if (!xf || !kid(xf, "off")) xf = inheritedXfrm(node, ctx);
  const box = xf ? place(xf, g) : null;
  if (!box) return null;
  const name = (kid(node, "nvSpPr") || kid(node, "nvPicPr") || kid(node, "nvCxnSpPr") || kid(node, "nvGraphicFramePr"))?.c?.[0]?.a?.name || "";
  const style = kid(node, "style");
  const fields = { emu: box, name: String(name).slice(0, 100) };

  if (node.n === "cxnSp" || (node.n === "sp" && /^(line|straightConnector1)$/.test(path(node, "spPr", "prstGeom")?.a.prst || ""))) {
    const prst = path(node, "spPr", "prstGeom")?.a.prst || "line";
    const ln = shapeLine(spPr, style, ctx) || { stroke: ctx.theme.colors.dk1 || "#000000", sw: 1 };
    return { fields: { ...fields, t: "line", kind: /bent/.test(prst) ? "elbow" : /curved/.test(prst) ? "curve" : "straight", ...ln } };
  }
  if (node.n === "pic") {
    const nvPr = path(node, "nvPicPr", "nvPr");
    const video = kid(nvPr, "videoFile"), audio = kid(nvPr, "audioFile");
    const blip = path(node, "blipFill", "blip");
    const embed = blip?.a.embed;
    const rel = embed && ctx.pkg.rels(ctx.part).get(embed);
    const descr = path(node, "nvPicPr", "cNvPr")?.a.descr || "";
    const mediaEmbed = findDeep(nvPr, "media")?.a.embed;
    if (video || audio) {
      const mrel = mediaEmbed ? ctx.pkg.rels(ctx.part).get(mediaEmbed) : null;
      const link = (video || audio).a.link && ctx.pkg.rels(ctx.part).get((video || audio).a.link);
      if (mrel && !mrel.external) return { fields: { ...fields, t: video ? "video" : "audio", play: "click", controls: true }, mediaPart: mrel.target, posterPart: rel && !rel.external ? rel.target : null };
      if (link?.external && /^https:\/\//.test(link.target)) return { fields: { ...fields, t: "video", link: link.target, play: "click" } };
      ctx.notes.add("A linked video or sound couldn't be brought over.");
      return null;
    }
    if (!rel || rel.external) return null;
    const src = path(node, "blipFill", "srcRect");
    const crop = src ? { l: num(src.a.l) / 100000, t: num(src.a.t) / 100000, r: num(src.a.r) / 100000, b: num(src.a.b) / 100000 } : null;
    const prst = path(node, "spPr", "prstGeom")?.a.prst;
    const mask = prst && prst !== "rect" ? FROM_PRESET[prst] : null;
    const alpha = kid(blip, "alphaModFix")?.a.amt;
    const ln = shapeLine(spPr, style, ctx);
    return { fields: { ...fields, t: "image", alt: String(descr).slice(0, 1000), ...(crop && Object.values(crop).some(Boolean) ? { crop } : {}), ...(mask ? { mask } : {}), ...(alpha ? { opacity: num(alpha) / 100000 } : {}), ...(kid(blip, "grayscl") ? { recolor: "gray" } : {}), ...(ln?.stroke ? { stroke: ln.stroke, sw: ln.sw } : {}) }, mediaPart: rel.target };
  }
  if (node.n === "graphicFrame") {
    const gd = path(node, "graphic", "graphicData");
    const tbl = kid(gd, "tbl");
    if (tbl) return readTable(tbl, fields, ctx);
    const chartRef = findDeep(gd, "chart");
    if (chartRef?.a.id) {
      const rel = ctx.pkg.rels(ctx.part).get(chartRef.a.id);
      const cx = rel && ctx.pkg.xml(rel.target);
      const cache = cx && readChart(cx);
      if (cache) return { fields: { ...fields, t: "chart", cache } };
      ctx.notes.add("A chart of a kind we don't draw yet was left out.");
      return null;
    }
    ctx.notes.add("SmartArt and embedded objects weren't brought over.");
    return null;
  }
  // sp: text box or shape
  const prst = path(node, "spPr", "prstGeom")?.a.prst;
  const isTextBox = kid(path(node, "nvSpPr"), "cNvSpPr")?.a.txBox === "1";
  const key = phKey(node);
  const fill = shapeFill(spPr, style, ctx);
  const ln = shapeLine(spPr, style, ctx);
  if (path(node, "spPr", "custGeom")) ctx.notes.add("Freeform shapes became rectangles.");
  const isShape = !isTextBox && !key && (fill?.fill && fill.fill !== "none" || ln?.stroke || (prst && prst !== "rect"));
  const out = { ...fields, t: isShape ? "shape" : "text" };
  if (isShape) out.shape = FROM_PRESET[prst] || "rect";
  if (fill?.fill) out.fill = fill.fill; else if (isShape) out.fill = "none";
  if (fill?.alpha !== undefined && fill.alpha < 1) out.opacity = fill.alpha;
  if (ln) Object.assign(out, ln);
  if (findDeep(spPr, "outerShdw")) out.shadow = true;
  const body = kid(node, "txBody");
  const bodyPr = kid(body, "bodyPr") || {};
  const anchor = bodyPr.a?.anchor || inheritedBodyPr(node, ctx)?.a?.anchor;
  if (anchor) out.valign = anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top";
  if (kid(bodyPr, "normAutofit")) out.autofit = "shrink";
  const lIns = bodyPr.a?.lIns;
  if (lIns !== undefined) out.padEmu = num(lIns);
  const phType = key?.type || null;
  const defSize = defaultSize(node, ctx, phType);
  out.size = defSize;
  if (phType === "title" || phType === "ctrTitle") out.font = "@heading";
  else out.font = "@body";
  out.color = isShape ? null : "@dk1";
  const text = body ? readText(body, ctx, { size: defSize, ph: phType, placeholderNode: node }) : null;
  // the box's size: its first run's, when it has one (so the box reads as its text does)
  const firstSize = JSON.stringify(text || {}).match(/"fontSize":([\d.]+)/);
  if (firstSize) out.size = Number(firstSize[1]) / (ctx.ptScale || 1);
  // an empty placeholder isn't brought over (PowerPoint doesn't show it either)
  if (key && !isShape && !textHas(text)) return null;
  if (out.color === null) delete out.color;
  return { fields: out, text };
}
const textHas = (json) => JSON.stringify(json || {}).includes('"text":"') && /"text":"[^"]*\S/.test(JSON.stringify(json));
function inheritedBodyPr(node, ctx) {
  const key = phKey(node);
  for (const t of [ctx.layout, ctx.master]) { const ph = placeholderOf(t, key); const b = ph && path(ph, "txBody", "bodyPr"); if (b?.a?.anchor) return b; }
  return null;
}
// The size PowerPoint would use for text with no size of its own, in pt.
function defaultSize(node, ctx, phType) {
  const key = phKey(node);
  for (const t of [ctx.layout, ctx.master]) {
    const ph = placeholderOf(t, key);
    const sz = ph && findDeep(path(ph, "txBody", "lstStyle"), "defRPr")?.a.sz;
    if (sz) return num(sz) / 100;
  }
  const tx = path(ctx.master, "txStyles");
  const style = phType === "title" || phType === "ctrTitle" ? kid(tx, "titleStyle") : phType ? kid(tx, "bodyStyle") : kid(tx, "otherStyle");
  const sz = findDeep(style, "defRPr")?.a.sz;
  if (sz) return num(sz) / 100;
  return phType === "title" || phType === "ctrTitle" ? 44 : phType ? 28 : 18;
}

// A txBody → ProseMirror JSON (the word processor's schema).
function readText(body, ctx, { size, ph }) {
  if (!body) return null;
  const scheme = ctx.theme.scheme;
  const paras = kids(body, "p");
  const bulletsByDefault = ph === "body" || ph === "obj" || ph === null && false;
  const blocks = [];
  let list = null;
  for (const p of paras) {
    const pPr = kid(p, "pPr");
    const lvl = num(pPr?.a.lvl);
    const content = [];
    for (const r of p.c || []) {
      if (r.n === "r" || r.n === "fld") {
        const t = textOf(kid(r, "t"));
        if (!t) continue;
        const rPr = kid(r, "rPr");
        const marks = [];
        if (rPr?.a.b === "1") marks.push({ type: "bold" });
        if (rPr?.a.i === "1") marks.push({ type: "italic" });
        if (rPr?.a.u && rPr.a.u !== "none") marks.push({ type: "underline" });
        if (rPr?.a.strike && rPr.a.strike !== "noStrike") marks.push({ type: "strike" });
        if (num(rPr?.a.baseline) > 0) marks.push({ type: "superscript" }); else if (num(rPr?.a.baseline) < 0) marks.push({ type: "subscript" });
        const attrs = {};
        if (rPr?.a.sz) attrs.fontSize = Math.round((num(rPr.a.sz) / 100) * ctx.ptScale * 10) / 10;
        const c = colorIn(kid(rPr, "solidFill"), scheme);
        if (c) attrs.color = c.hex;
        const font = kid(rPr, "latin")?.a.typeface;
        if (font && !font.startsWith("+")) attrs.fontFamily = cleanFont(font);
        if (Object.keys(attrs).length) marks.push({ type: "textStyle", attrs: { fontSize: attrs.fontSize ?? null, color: attrs.color ?? null, fontFamily: attrs.fontFamily ?? null } });
        const hl = colorIn(kid(rPr, "highlight"), scheme);
        if (hl) marks.push({ type: "highlight", attrs: { color: hl.hex } });
        const link = kid(rPr, "hlinkClick")?.a.id;
        const rel = link && ctx.pkg.rels(ctx.part).get(link);
        if (rel?.external && /^(https?:|mailto:|tel:)/i.test(rel.target)) marks.push({ type: "link", attrs: { href: rel.target } });
        content.push({ type: "text", text: t, ...(marks.length ? { marks } : {}) });
      } else if (r.n === "br") content.push({ type: "hardBreak" });
    }
    const attrs = {};
    const algn = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" }[pPr?.a.algn];
    if (algn) attrs.textAlign = algn;
    const lnPct = path(pPr, "lnSpc", "spcPct")?.a.val;
    if (lnPct) attrs.lineHeight = Math.round((num(lnPct) / 100000) * 100) / 100;
    const para = { type: "paragraph", ...(Object.keys(attrs).length ? { attrs } : {}), content };
    const buNone = kid(pPr, "buNone"), buChar = kid(pPr, "buChar"), buNum = kid(pPr, "buAutoNum");
    const bullet = buNum ? "ordered" : buChar ? "bullet" : buNone ? null : bulletsByDefault && content.length ? "bullet" : null;
    if (bullet) {
      if (!list || list.kind !== bullet) { list = { kind: bullet, node: { type: bullet === "ordered" ? "orderedList" : "bulletList", content: [] } }; blocks.push(list.node); }
      // levels: nest under the previous item
      let target = list.node;
      for (let k = 0; k < Math.min(lvl, 4); k++) {
        const last = target.content[target.content.length - 1];
        if (!last) break;
        let sub = last.content.find((x) => x.type === "bulletList" || x.type === "orderedList");
        if (!sub) { sub = { type: target.type, content: [] }; last.content.push(sub); }
        target = sub;
      }
      target.content.push({ type: "listItem", content: [para] });
    } else { list = null; blocks.push(para); }
  }
  void size;
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

function readTable(tbl, fields, ctx) {
  const scheme = ctx.theme.scheme;
  const cols = kids(kid(tbl, "tblGrid"), "gridCol").map((c) => num(c.a.w, 1));
  const rows = kids(tbl, "tr");
  const cells = {};
  rows.slice(0, 30).forEach((tr, r) => kids(tr, "tc").slice(0, 12).forEach((tc, c) => {
    if (tc.a.hMerge === "1" || tc.a.vMerge === "1") return;
    const paras = kids(kid(tc, "txBody"), "p");
    const text = paras.map((p) => kids(p, "r").map((x) => textOf(kid(x, "t"))).join("")).join("\n");
    const firstR = findDeep(kid(tc, "txBody"), "rPr");
    const cell = {};
    if (text) cell.text = text.slice(0, 5000);
    if (firstR?.a.b === "1") cell.bold = true;
    const fill = colorIn(kid(kid(tc, "tcPr"), "solidFill"), scheme);
    if (fill) cell.fill = fill.hex;
    const color = colorIn(kid(firstR, "solidFill"), scheme);
    if (color) cell.color = color.hex;
    const algn = { ctr: "center", r: "right" }[findDeep(kid(tc, "txBody"), "pPr")?.a.algn];
    if (algn) cell.align = algn;
    if (num(tc.a.gridSpan) > 1) cell.cs = Math.min(12, num(tc.a.gridSpan));
    if (num(tc.a.rowSpan) > 1) cell.rs = Math.min(30, num(tc.a.rowSpan));
    if (Object.keys(cell).length) cells[`${r}.${c}`] = cell;
  }));
  const firstSz = findDeep(tbl, "rPr")?.a.sz;
  return { fields: { ...fields, t: "table", rows: Math.min(30, rows.length), cols: Math.min(12, cols.length), colW: cols.slice(0, 12).map((w) => Math.max(1, Math.round(w / 12700))), cells, size: firstSz ? num(firstSz) / 100 : 14, font: "@body", color: "@dk1", stroke: "@dk2" } };
}

// A chart part → our chart (spec + the data saved in the file).
function readChart(cx) {
  const plot = findDeep(cx, "plotArea");
  if (!plot) return null;
  const kinds = ["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart", "pieChart", "pie3DChart", "doughnutChart", "scatterChart"];
  const ch = plot.c.find((x) => kinds.includes(x.n));
  if (!ch) return null;
  const spec = {};
  if (/^bar/.test(ch.n)) spec.type = kid(ch, "barDir")?.a.val === "bar" ? "bar" : "column";
  else if (/^line/.test(ch.n)) spec.type = "line";
  else if (/^area/.test(ch.n)) spec.type = "area";
  else if (/^(pie|doughnut)/.test(ch.n)) { spec.type = "pie"; if (ch.n === "doughnutChart") spec.donut = true; }
  else spec.type = "scatter";
  const grouping = kid(ch, "grouping")?.a.val;
  if (grouping === "stacked") spec.stacked = "stacked"; else if (grouping === "percentStacked") spec.stacked = "percent";
  if (kid(ch, "smooth")?.a.val === "1" || findDeep(ch, "smooth")?.a.val === "1") spec.smooth = true;
  const title = findDeep(kid(findDeep(cx, "chart"), "title"), "rich");
  if (title) spec.title = textOf(title).trim().slice(0, 200);
  const legend = findDeep(cx, "legend");
  spec.legend = legend ? ({ t: "top", b: "bottom", r: "right", l: "right" }[path(legend, "legendPos")?.a.val] || "auto") : "none";
  const pts = (node) => {
    const cache = findDeep(node, "strCache") || findDeep(node, "numCache");
    if (!cache) return [];
    const n = num(kid(cache, "ptCount")?.a.val, 0);
    const out = Array(Math.min(5000, n)).fill(null);
    for (const p of kids(cache, "pt")) { const i = num(p.a.idx, -1); if (i >= 0 && i < out.length) out[i] = textOf(kid(p, "v")); }
    return out;
  };
  const series = [];
  let categories = [], xNumbers = null;
  for (const ser of kids(ch, "ser").slice(0, 40)) {
    const name = pts(kid(ser, "tx"))[0] || `Series ${series.length + 1}`;
    const vals = pts(kid(ser, "val") || kid(ser, "yVal")).map((v) => (v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null));
    if (!categories.length) {
      const cat = kid(ser, "cat") || kid(ser, "xVal");
      categories = pts(cat).map((v) => String(v ?? ""));
      if (spec.type === "scatter") xNumbers = categories.map((v) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : null));
    }
    series.push({ name: String(name).slice(0, 200), values: vals });
  }
  if (!series.length) return null;
  if (!categories.length) categories = series[0].values.map((_, i) => String(i + 1));
  const data = { categories, series };
  if (xNumbers) data.xNumbers = xNumbers;
  return { spec, data };
}

function readBackground(bg, ctx) {
  const pr = kid(bg, "bgPr");
  const scheme = ctx.theme.scheme;
  if (pr) {
    const solid = kid(pr, "solidFill");
    if (solid) { const c = colorIn(solid, scheme); return c ? { kind: "solid", color: c.hex } : null; }
    const grad = kid(pr, "gradFill");
    if (grad) {
      const gs = kids(kid(grad, "gsLst"), "gs");
      const a = gs[0] && colorIn(gs[0], scheme), b = gs[gs.length - 1] && colorIn(gs[gs.length - 1], scheme);
      const ang = num(kid(grad, "lin")?.a.ang) / 60000;
      if (a && b) return { kind: "gradient", from: a.hex, to: b.hex, angle: Math.round((ang + 90) % 360) };
    }
    const blip = path(pr, "blipFill", "blip");
    if (blip?.a.embed) { const rel = ctx.pkg.rels(ctx.part).get(blip.a.embed); if (rel && !rel.external) return { kind: "image", part: rel.target, fit: "cover" }; }
  }
  const ref = kid(bg, "bgRef");
  if (ref) { const c = colorIn(ref, scheme); if (c) return { kind: "solid", color: c.hex }; }
  return null;
}

// ---- into a presentation ------------------------------------------------------------------------------------
export async function pptxIntoModel(model, bytes, { putMedia }) {
  const data = readPptx(bytes);
  const { cx, cy, theme, pkg, ptScale } = data;
  const notes = new Set(data.notes);
  // our size: the standard one that matches, else custom (1920 wide)
  const ratio = cx / cy;
  let sizeKey = null;
  for (const [key, [w, h]] of Object.entries(SIZES)) if (Math.abs(w / h - ratio) < 0.01) sizeKey = key;
  const W = sizeKey ? SIZES[sizeKey][0] : 1920, H = sizeKey ? SIZES[sizeKey][1] : Math.round(1920 / ratio);
  const k = W / cx; // EMU → slide px
  const mediaIds = new Map();
  async function media(part) {
    if (!part) return null;
    if (mediaIds.has(part)) return mediaIds.get(part);
    const b = pkg.files[part];
    let id = null;
    if (b) {
      const mime = sniffType(b);
      if (/^(image\/(png|jpeg|gif|webp)|video\/|audio\/)/.test(mime)) {
        if (b.length > 70 * 1024 * 1024) notes.add("A video larger than 70 MB was left out.");
        else {
          id = await putMedia(b, mime);
          if (id && !model.mediaInfo(id)) model.addMedia(id, { kind: mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "image", mime, size: b.length });
        }
      } else notes.add("Some pictures in formats that can't be shown here (such as EMF, WMF or SVG) were left out.");
    }
    mediaIds.set(part, id);
    return id;
  }
  model.transact(() => {
    model.meta.set("format", 1);
    if (sizeKey) { model.meta.set("size", sizeKey); model.meta.delete("w"); model.meta.delete("h"); } else { model.meta.set("size", "custom"); model.meta.set("w", W); model.meta.set("h", H); }
    model.meta.set("theme", cleanTheme({ id: "plain", colors: { ...theme.colors }, fonts: theme.fonts, bg: { kind: "solid", role: "lt1" }, deco: "none" }));
  });
  const existing = model.slideIds();
  for (const s of data.slides) {
    const sid = model.addSlide({ layout: "blank" });
    const patch = { skip: s.skip || null, transition: s.transition || null, advance: s.advance || null };
    if (s.bg) {
      if (s.bg.kind === "image") { const id = await media(s.bg.part); patch.bg = id ? { kind: "image", media: id, fit: "cover" } : null; }
      else patch.bg = s.bg;
    }
    model.setSlide(sid, patch);
    for (const it of s.items) {
      const f = { ...it.fields };
      const e = f.emu;
      delete f.emu;
      f.x = Math.round(e.x * k); f.y = Math.round(e.y * k); f.w = Math.max(1, Math.round(e.w * k)); f.h = Math.max(1, Math.round(e.h * k));
      if (f.t === "line") { f.w = Math.round(e.w * k); f.h = Math.round(e.h * k); }
      if (e.rot) f.rot = e.rot;
      if (e.flipH) f.flipH = true;
      if (e.flipV) f.flipV = true;
      if (f.padEmu !== undefined) { f.pad = Math.round(f.padEmu * k); delete f.padEmu; }
      if (f.size) f.size = Math.round(f.size * ptScale * 10) / 10;
      if (f.sw) f.sw = Math.max(1, Math.round(f.sw * (k * 12700) / 1)); // their line width (pt) → slide px
      if (it.mediaPart) { const id = await media(it.mediaPart); if (!id) continue; f.media = id; }
      if (it.posterPart) { const id = await media(it.posterPart); if (id) f.poster = id; }
      const iid = model.addItem(sid, f);
      if (it.text && model.text(sid, iid)) { try { model.transact(() => writeJson(model.text(sid, iid), it.text)); } catch { notes.add("Some text formatting couldn't be kept."); } }
    }
    if (s.notes) { try { model.transact(() => writeJson(model.notes(sid), s.notes)); } catch { /* left out */ } }
  }
  if (existing.length && data.slides.length) model.deleteSlides(existing);
  return { notes: [...notes], slides: data.slides.length };
}
