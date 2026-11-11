// PDF and picture export (SLIDES_DESIGN.md §10). Everything happens on the device.
//
// PDF: slides only (one per page), slides with their notes, or handouts (2, 3 or 6 to a
// page). On the laptop it goes through the browser's print dialog (Save as PDF); on the
// iPhone through the native PDF plugin, then the share sheet. Animations show their
// final state; videos show their poster.
//
// Pictures (PNG): this slide or every slide (zipped), at 1920 or 3840 px wide. On the
// laptop the slide is drawn to a canvas from its own markup, with its fonts and images
// put inside; on the iPhone the web view takes a native snapshot of the slide.

import { zipSync } from "fflate";
import { renderSlide, fitText } from "./render.js";
import { fragmentHtml } from "./text.js";
import { esc } from "./chrome.js";

const PAGE = { slideW: 960 }; // a slide page: 10 in wide at 96 px/in
const LETTER = [816, 1056];   // 8.5 × 11 in

// Loads every picture the slides use, so pages and pictures aren't missing any.
async function loadMedia(model, ids, media) {
  const want = new Set();
  for (const sid of ids) {
    const s = model.slide(sid);
    if (s?.bg?.media) want.add(s.bg.media);
    for (const it of model.items(sid)) { if (it.media && (it.t === "image")) want.add(it.media); if (it.poster) want.add(it.poster); }
  }
  await Promise.all([...want].map((id) => media.load(id).catch(() => null)));
}
// Waits for web fonts and images in a box to be ready.
async function settle(box) {
  try { await document.fonts?.ready; } catch { /* fine */ }
  await Promise.all([...box.querySelectorAll("img")].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 5000); }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function slideBox(model, sid, media, width) {
  const [W, H] = model.size();
  const s = width / W;
  const el = renderSlide(model, sid, { mediaUrl: (id) => media.url(id), textHtml: fragmentHtml });
  el.style.transform = `scale(${s})`;
  el.style.transformOrigin = "0 0";
  const box = document.createElement("div");
  box.className = "sl-print-slide";
  box.style.width = `${width}px`;
  box.style.height = `${H * s}px`;
  box.appendChild(el);
  return box;
}

// The pages for a PDF. layout: "slides" | "notes" | "handout2" | "handout3" | "handout6".
export function buildPages(model, ids, media, layout = "slides") {
  const [W, H] = model.size();
  const pages = [];
  if (layout === "slides") {
    const pw = PAGE.slideW, ph = Math.round((PAGE.slideW * H) / W);
    for (const sid of ids) {
      const page = document.createElement("div");
      page.className = "sl-print-page";
      page.style.cssText = `width:${pw}px;height:${ph}px`;
      page.appendChild(slideBox(model, sid, media, pw));
      pages.push(page);
    }
    return { pages, pageW: pw, pageH: ph };
  }
  const [pw, ph] = LETTER;
  const margin = 48;
  if (layout === "notes") {
    ids.forEach((sid, i) => {
      const page = document.createElement("div");
      page.className = "sl-print-page is-letter";
      page.style.cssText = `width:${pw}px;height:${ph}px;padding:${margin}px`;
      page.appendChild(slideBox(model, sid, media, pw - 2 * margin));
      const nf = model.notes(sid);
      const notes = document.createElement("div");
      notes.className = "sl-print-notes";
      notes.innerHTML = `<div class="sl-print-num">Slide ${i + 1}</div>${(nf && fragmentHtml(nf)) || ""}`;
      page.appendChild(notes);
      pages.push(page);
    });
    return { pages, pageW: pw, pageH: ph };
  }
  const per = layout === "handout2" ? 2 : layout === "handout3" ? 3 : 6;
  for (let i = 0; i < ids.length; i += per) {
    const page = document.createElement("div");
    page.className = `sl-print-page is-letter is-handout${per}`;
    page.style.cssText = `width:${pw}px;height:${ph}px;padding:${margin}px`;
    const inner = pw - 2 * margin;
    ids.slice(i, i + per).forEach((sid, k) => {
      const row = document.createElement("div");
      row.className = "sl-print-hrow";
      const w = per === 6 ? (inner - 24) / 2 : per === 3 ? inner * 0.48 : inner * 0.8;
      row.appendChild(slideBox(model, sid, media, w));
      if (per === 3) { const lines = document.createElement("div"); lines.className = "sl-print-lines"; row.appendChild(lines); }
      row.dataset.n = String(i + k + 1);
      page.appendChild(row);
    });
    pages.push(page);
  }
  return { pages, pageW: pw, pageH: ph };
}

export async function exportPdf({ model, media, layout = "slides", name = "Presentation", nativePdf = null, share = null, skipHidden = true }) {
  const ids = model.slideIds().filter((id) => !(skipHidden && model.slide(id)?.skip));
  if (!ids.length) throw new Error("There are no slides to export.");
  await loadMedia(model, ids, media);
  const { pages, pageW, pageH } = buildPages(model, ids, media, layout);
  const box = document.createElement("div");
  box.className = "sl-print";
  const style = document.createElement("style");
  style.textContent = `@page { size: ${pageW}px ${pageH}px; margin: 0; }
    .sl-print { position: fixed; left: -100000px; top: 0; z-index: -1; }
    .sl-print-page { position: relative; overflow: hidden; background: #fff; break-after: page; page-break-after: always; box-sizing: border-box; color: #000; font: 12pt/1.4 Arial, sans-serif; }
    .sl-print-slide { position: relative; overflow: hidden; box-shadow: 0 0 0 1px #ccc; }
    .sl-print-notes { margin-top: 24px; font-size: 12pt; }
    .sl-print-notes p { margin: 0 0 6px; }
    .sl-print-num { font-weight: 700; margin-bottom: 8px; }
    .is-handout2 .sl-print-hrow { display: flex; justify-content: center; margin-bottom: 40px; }
    .is-handout3 .sl-print-hrow { display: flex; gap: 24px; margin-bottom: 36px; }
    .is-handout6 { display: grid; grid-template-columns: 1fr 1fr; gap: 28px 24px; align-content: start; }
    .sl-print-lines { flex: 1; background: repeating-linear-gradient(transparent 0 27px, #bbb 27px 28px); }
    @media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } body > *:not(.sl-print) { display: none !important; } .sl-print { position: static; } }`;
  box.appendChild(style);
  for (const p of pages) box.appendChild(p);
  document.body.appendChild(box);
  try {
    for (const p of pages) for (const s of p.querySelectorAll(".sl-slide")) fitText(s);
    await settle(box);
    if (nativePdf) {
      const b64 = await nativePdf({ widthPt: (pageW * 72) / 96, heightPt: (pageH * 72) / 96, pages: pages.length });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await share?.(new Blob([bytes], { type: "application/pdf" }), `${name}.pdf`, "application/pdf");
      return pages.length;
    }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; window.removeEventListener("afterprint", finish); resolve(); };
      window.addEventListener("afterprint", finish);
      window.print();
      setTimeout(finish, 60_000);
    });
    return pages.length;
  } finally { box.remove(); }
}

// ---- pictures ---------------------------------------------------------------------------------

const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

// The CSS the slide markup needs, from this page's own stylesheets.
function slideCss() {
  const out = [];
  for (const sh of document.styleSheets) {
    let rules;
    try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) if (r.cssText && /\.sl-(slide|item|text|svg|textbg|crop|img|media|play|audio|poster|video|table|chart|deco|prompt)/.test(r.cssText)) out.push(r.cssText);
  }
  return out.join("\n");
}
// @font-face rules for the Google fonts in use, with the font files inside.
const fontCache = new Map();
async function fontCss(families) {
  const parts = [];
  for (const sh of document.querySelectorAll("link[data-live-font]")) {
    if (!families.has(sh.dataset.liveFont)) continue;
    if (!fontCache.has(sh.href)) {
      fontCache.set(sh.href, (async () => {
        const css = await (await fetch(sh.href)).text();
        const urls = [...new Set(css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g) || [])].map((u) => u.slice(4, -1));
        let out = css;
        for (const u of urls) { try { out = out.split(u).join(await toDataUrl(await (await fetch(u)).blob())); } catch { /* falls back */ } }
        return out;
      })().catch(() => ""));
    }
    parts.push(await fontCache.get(sh.href));
  }
  return parts.join("\n");
}

// One slide → PNG bytes (laptop: canvas; the iPhone uses snapshotSlide below).
export async function slidePng(model, sid, media, { width = 1920 } = {}) {
  const [W, H] = model.size();
  await loadMedia(model, [sid], media);
  const el = renderSlide(model, sid, { mediaUrl: (id) => media.url(id), textHtml: fragmentHtml });
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${W}px;height:${H}px;overflow:hidden`;
  holder.appendChild(el);
  document.body.appendChild(holder);
  try {
    fitText(el);
    await settle(holder);
    // pictures as data URLs (a drawn SVG can't load anything)
    for (const im of el.querySelectorAll("img")) { try { im.src = await toDataUrl(await (await fetch(im.src)).blob()); } catch { im.remove(); } }
    const bg = el.style.background.match(/url\("?(blob:[^")]+)"?\)/);
    if (bg) { try { el.style.background = el.style.background.replace(bg[1], await toDataUrl(await (await fetch(bg[1])).blob())); } catch { /* plain */ } }
    const families = new Set([...el.querySelectorAll("*")].map((n) => getComputedStyle(n).fontFamily.split(",")[0].replace(/["']/g, "").trim()));
    const css = `${await fontCss(families)}\n${slideCss()}`;
    el.style.position = "static";
    const xhtml = new XMLSerializer().serializeToString(el);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;position:relative;overflow:hidden"><style>${css.replace(/<\/style/gi, "")}</style>${xhtml}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const k = width / W;
    const c = document.createElement("canvas");
    c.width = Math.round(W * k);
    c.height = Math.round(H * k);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("That slide couldn't be drawn as a picture.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally { holder.remove(); }
}

// The iPhone: show the slide over everything and take a native snapshot of it.
export async function snapshotSlide(model, sid, media, plugin) {
  const [W, H] = model.size();
  await loadMedia(model, [sid], media);
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = Math.min(vw / W, vh / H);
  const cover = document.createElement("div");
  cover.style.cssText = "position:fixed;inset:0;z-index:5000;background:#000";
  const el = renderSlide(model, sid, { mediaUrl: (id) => media.url(id), textHtml: fragmentHtml });
  el.style.transform = `scale(${s})`;
  el.style.transformOrigin = "0 0";
  cover.appendChild(el);
  document.body.appendChild(cover);
  try {
    fitText(el);
    await settle(cover);
    const r = await plugin.snapshot({ x: 0, y: 0, width: W * s, height: H * s });
    return Uint8Array.from(atob(r.png), (c) => c.charCodeAt(0));
  } finally { cover.remove(); }
}

export async function exportPng({ model, media, sid = null, width = 1920, name = "Presentation", share, snapshot = null }) {
  const ids = sid ? [sid] : model.slideIds().filter((id) => !model.slide(id)?.skip);
  const one = (id) => (snapshot ? snapshotSlide(model, id, media, snapshot) : slidePng(model, id, media, { width }));
  const safe = String(name).replace(/[\\/:*?"<>|]+/g, " ").trim() || "Presentation";
  if (ids.length === 1) {
    const n = model.slideIds().indexOf(ids[0]) + 1;
    await share(new Blob([await one(ids[0])], { type: "image/png" }), `${safe} - slide ${n}.png`, "image/png");
    return 1;
  }
  const files = {};
  for (const id of ids) files[`${safe} - slide ${String(model.slideIds().indexOf(id) + 1).padStart(2, "0")}.png`] = [await one(id), { level: 0 }];
  await share(new Blob([zipSync(files)], { type: "application/zip" }), `${safe} slides.zip`, "application/zip");
  return ids.length;
}

void esc;
