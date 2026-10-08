// mail-frame.js — the sandboxed frame an HTML email is read in.
//
// Owns: sanitizing the email for the frame, what happens to its images, the
// frame document itself, and the fit/size logic. Mail-app behavior (linkify,
// compose-on-mailto, the swipe pager) is injected through `onReady`, and the
// Gmail attachment fetch behind embedded images through `inlineImages`, so this
// module has no dependency on app.js.
//
// Why the frame is set up at DOM-ready and not on `load` (2026-10-08): `load`
// waits for every image in the email. Until it fired the frame was unsized,
// unfitted and unlinked, so an email with dozens of remote images looked slow
// to open even though its text had arrived. Now the email is fitted as soon as
// its markup is parsed and images fill in as they arrive; each one that settles
// re-fits the height.
//
// Why images are deferred by this module and not by loading="lazy": the frame's
// sandbox has scripting off, and browsers ignore loading="lazy" when scripting
// is off (the spec's anti-tracking rule), so every image loaded at once. The
// email's remote images are instead parked on data-lz-src and given their real
// source from out here, as each one comes near the screen.

import { parseInertHtml, scrubActiveAttributes } from "./html-sanitize.js";

// ── Tracking images ──────────────────────────────────────────────────────────
// Best-effort: an image that can only be a tracker (1×1 or smaller), or one
// served from a known open-tracking endpoint, is removed before the frame is
// built so it never loads. A sender that puts a per-recipient id on a real
// content image is not caught by this; only a proxy would hide that.
const TRACKER_URL_RES = [
  /\/track\/open(\.php)?\b/i,                        // Mailchimp / Mandrill and many others
  /\/wf\/open\b/i,                                   // SendGrid
  /\/trk\/open\b/i,
  /\/open\.aspx\b/i,                                 // ExactTarget / Salesforce Marketing Cloud
  /^https?:\/\/[^/]*mailtrack\.io\//i,
  /^https?:\/\/[^/]*sidekickopen\d*\.com\//i,        // HubSpot Sales
  /^https?:\/\/[^/]*google-analytics\.com\//i,
  /^https?:\/\/[^/]*doubleclick\.net\//i,
  /^https?:\/\/[^/]*facebook\.com\/tr\b/i,
  /\/(pixel|beacon|open)\.(gif|png)(\?|$)/i,
];

const cssPx = (style, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([0-9.]+)\\s*(px)?\\s*(?:!important)?\\s*(?:;|$)`, "i").exec(style || "");
  return m ? Number(m[1]) : null;
};
const attrPx = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!/^[0-9.]+(px)?$/i.test(s)) return null; // percentages etc. are not pixel sizes
  return Number(s.replace(/px$/i, ""));
};

// Pure (no DOM): takes the image's attribute values.
export function isMailTrackerImage({ src = "", width, height, style = "" } = {}) {
  if (!/^\s*https?:\/\//i.test(src || "")) return false; // embedded/data images ship with the message
  const w = attrPx(width) ?? cssPx(style, "width");
  const h = attrPx(height) ?? cssPx(style, "height");
  if (w !== null && h !== null && w <= 1 && h <= 1) return true;
  return TRACKER_URL_RES.some((re) => re.test(src));
}

// Stand-in source for a parked image: an empty SVG of the size the email
// declares, so the layout is already right when the real picture arrives. With
// no declared size it is 0×0, like any image that hasn't loaded yet.
export function mailImagePlaceholder(width, height) {
  const w = attrPx(width);
  const h = attrPx(height);
  const sized = w !== null && h !== null && w > 0 && h > 0;
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${sized ? w : 0}' height='${sized ? h : 0}'/%3E`;
}

// What the frame does with an email's images. Input is sanitizeMailFrameHtml's
// output. Returns the rewritten HTML plus counts.
//
//   block: true  — every remote image load is neutralized (http(s) <img>,
//                  [background], url() in styles). `blocked` drives the
//                  "Display images" menu item.
//   block: false — tracking images are removed (`trackers`); the rest are
//                  parked (src → data-lz-src, with a placeholder that reserves
//                  the declared size) for buildMailBodyFrame to load as they
//                  come near the screen.
//
// Either way an embedded (cid:) image has its reference moved to data-cid: the
// browser cannot fetch a cid: URL, so it would only draw a broken-image box.
// buildMailBodyFrame fills those in from the message's own attachments.
export function prepareMailImages(html, { block = false } = {}) {
  // inert: parsing must not itself fetch the images. keepHeadStyles: the input
  // leads with the email's <style> blocks — a re-parse files those under
  // <head>, so without this the body came back with the email's whole
  // stylesheet gone (no mobile media queries → fixed 600–700px tables → the
  // frame zoomed the email down to fit).
  const div = parseInertHtml(html, { keepHeadStyles: true });
  let blocked = 0;
  let trackers = 0;
  let embedded = 0;
  const isRemote = (u) => /^\s*https?:\/\//i.test(u || "");
  const hasRemote = (v) => /https?:\/\//i.test(v || "");

  // <picture><source srcset> picks the image before <img src> is consulted, so
  // it is held back the same way as the <img> it belongs to.
  div.querySelectorAll("picture source[srcset]").forEach((source) => {
    if (!hasRemote(source.getAttribute("srcset"))) return;
    source.setAttribute(block ? "data-blk-srcset" : "data-lz-srcset", source.getAttribute("srcset"));
    source.removeAttribute("srcset");
  });

  div.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const cid = /^\s*cid:(.+)$/i.exec(src);
    if (cid) {
      img.setAttribute("data-cid", cid[1].trim());
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      embedded++;
      return;
    }
    if (block) {
      if (isRemote(src)) { img.setAttribute("data-blk-src", src); img.removeAttribute("src"); blocked++; }
      const ss = img.getAttribute("srcset");
      if (ss && /https?:\/\//i.test(ss)) { img.setAttribute("data-blk-srcset", ss); img.removeAttribute("srcset"); }
      return;
    }
    if (isMailTrackerImage({ src, width: img.getAttribute("width"), height: img.getAttribute("height"), style: img.getAttribute("style") })) {
      img.remove();
      trackers++;
      return;
    }
    const ss = img.getAttribute("srcset");
    if (isRemote(src) || hasRemote(ss)) {
      if (isRemote(src)) img.setAttribute("data-lz-src", src);
      else img.setAttribute("data-lz-src", "");
      if (hasRemote(ss)) { img.setAttribute("data-lz-srcset", ss); img.removeAttribute("srcset"); }
      img.setAttribute("src", mailImagePlaceholder(img.getAttribute("width"), img.getAttribute("height")));
      img.setAttribute("decoding", "async");
      img.removeAttribute("loading");
    }
  });

  if (block) {
    const cssHasRemote = /url\(\s*['"]?\s*https?:\/\//i;          // non-global: stateless test
    const cssRemoteAll = /url\(\s*['"]?\s*https?:\/\/[^)]*\)/gi;  // global: replace every occurrence
    // Legacy table/cell background images (<td background="…">).
    div.querySelectorAll("[background]").forEach((el) => {
      if (isRemote(el.getAttribute("background"))) { el.setAttribute("data-blk-background", el.getAttribute("background")); el.removeAttribute("background"); blocked++; }
    });
    // Inline style background images.
    div.querySelectorAll("[style]").forEach((el) => {
      const s = el.getAttribute("style") || "";
      if (cssHasRemote.test(s)) { el.setAttribute("style", s.replace(cssRemoteAll, "none")); blocked++; }
    });
    // <style> block background images.
    div.querySelectorAll("style").forEach((st) => {
      const t = st.textContent || "";
      if (cssHasRemote.test(t)) { st.textContent = t.replace(cssRemoteAll, "none"); blocked++; }
    });
  }
  return { html: div.innerHTML, blocked, trackers, embedded };
}

// ── Sanitizing ───────────────────────────────────────────────────────────────
// Lighter sanitizer for iframe rendering: keeps <style> (email layouts depend
// on it) and strips active content. Scripts are additionally blocked by the
// iframe sandbox.
export function sanitizeMailFrameHtml(html) {
  // Inert parse (DOMParser): nothing executes or loads while we scrub.
  const div = parseInertHtml(html, { keepHeadStyles: true });
  div.querySelectorAll("script,iframe,frame,object,embed,applet,form,link,meta,base").forEach((el) => el.remove());
  // All on* handlers go; href/src/etc. survive only with an allowlisted scheme
  // (http(s)/mailto/tel/#frag for links; http(s)/cid:/data:image for images).
  scrubActiveAttributes(div);
  // Neutralize the email's own dark-mode rules. Marketing emails (Audible,
  // Amazon, …) ship `@media (prefers-color-scheme: dark){ … color:#FFF … }`
  // assuming the client also darkens the background. This reader always renders
  // on white, so on a dark-mode phone those rules turned every text node white
  // → invisible (only images showed). Rename the feature to an unknown one so
  // the dark query can never match; the email's default light styling remains.
  div.querySelectorAll("style").forEach((styleEl) => {
    if (/prefers-color-scheme\s*:\s*dark/i.test(styleEl.textContent)) {
      styleEl.textContent = styleEl.textContent.replace(/prefers-color-scheme(\s*:\s*dark)/gi, "x-disabled-color-scheme$1");
    }
  });
  stripLabeledEmailAds(div);
  return div.innerHTML;
}

// Clips ad units from newsletters (NYT etc.). Publishers label every ad with
// a standalone "ADVERTISEMENT" marker; from that marker we climb to the
// smallest enclosing block that is still essentially just the ad (bounded by
// how much text it contains) and remove it. Deliberately conservative: a
// block with substantial text is never removed, so at worst an ad survives —
// article content is never clipped.
export function stripLabeledEmailAds(root) {
  // Pass 1 — ad IMAGES. LiveIntent-served newsletters (NYT, Star Tribune's
  // Hot Dish, …) deliver every ad creative/chip/tracker as images from an
  // "/imp?" impression endpoint (liveintent.<pub>.com, sli.<pub>.com), often
  // alt="Ad", never with real content. Remove each one's enclosing block,
  // climbing only through wrappers with no meaningful text of their own.
  root.querySelectorAll('img[alt="Ad" i], img[src*="liveintent." i], img[src*="/imp?" i]').forEach((img) => {
    if (!root.contains(img)) return; // removed along with an earlier unit
    let el = img.closest("a") || img;
    while (el.parentElement && el.parentElement !== root) {
      const text = el.parentElement.textContent.replace(/\s+/g, " ").trim();
      if (text.length > 40) break;
      el = el.parentElement;
    }
    el.remove();
  });

  // Pass 2 — text-labeled ad units ("ADVERTISEMENT" and friends).
  const AD_LABELS = /^(advertisement|paid post|sponsored|sponsored content|paid for and posted by .{0,80})$/i;
  const MAX_AD_TEXT = 320; // an ad unit's total text (label + short ad copy)
  const markers = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (AD_LABELS.test(walker.currentNode.textContent.replace(/\s+/g, " ").trim())) {
      markers.push(walker.currentNode);
    }
  }
  markers.forEach((marker) => {
    if (!root.contains(marker)) return; // already inside a removed unit
    let unit = marker.parentElement;
    if (!unit) return;
    while (unit.parentElement && unit.parentElement !== root) {
      const parentText = unit.parentElement.textContent.replace(/\s+/g, " ").trim();
      if (parentText.length > MAX_AD_TEXT) break;
      unit = unit.parentElement;
    }
    // The creative often sits in a sibling block right after the label unit:
    // remove it only when it's clearly just a linked image with no real text.
    const next = unit.nextElementSibling;
    if (next && next.querySelector("img") && next.querySelector("a") &&
        next.textContent.replace(/\s+/g, " ").trim().length < 120) {
      next.remove();
    }
    unit.remove();
  });
}

// ── Embedded (cid:) images ───────────────────────────────────────────────────
// Only inert raster types become an <img> source; the sender controls the
// declared type, so anything else (SVG above all) is left out.
const EMBEDDED_IMAGE_TYPE_RE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
export const MAIL_EMBEDDED_IMAGE_MAX = 12;          // per message — bounds the attachment calls one email can cause
export const MAIL_EMBEDDED_IMAGE_MAX_BYTES = 3500000; // the attachment action's own response cap

// Which data-cid images in `doc` can be filled, and from which attachment.
// Pure apart from reading `doc`. Bounded by MAIL_EMBEDDED_IMAGE_MAX distinct
// attachments; several <img> may share one.
export function planEmbeddedImages(doc, attachments) {
  const byCid = new Map();
  (attachments || []).forEach((a) => {
    if (!a?.contentId || !a.attachmentId) return;
    if (!EMBEDDED_IMAGE_TYPE_RE.test(a.mimeType || "")) return;
    if (Number(a.size) > MAIL_EMBEDDED_IMAGE_MAX_BYTES) return;
    byCid.set(String(a.contentId).toLowerCase(), a);
  });
  const plan = new Map(); // attachmentId → { attachment, imgs }
  doc.querySelectorAll("img[data-cid]").forEach((img) => {
    const att = byCid.get(String(img.getAttribute("data-cid")).toLowerCase());
    if (!att) return;
    let entry = plan.get(att.attachmentId);
    if (!entry) {
      if (plan.size >= MAIL_EMBEDDED_IMAGE_MAX) return;
      entry = { attachment: att, imgs: [] };
      plan.set(att.attachmentId, entry);
    }
    entry.imgs.push(img);
  });
  return [...plan.values()];
}

// Gmail returns attachment bytes as base64url; an <img> wants plain base64.
export function embeddedImageDataUrl(mimeType, base64url) {
  if (!EMBEDDED_IMAGE_TYPE_RE.test(mimeType || "") || !base64url) return "";
  const b64 = String(base64url).replace(/-/g, "+").replace(/_/g, "/");
  return `data:${mimeType.toLowerCase()};base64,${b64}`;
}

async function fillEmbeddedImages(doc, { attachments, load } = {}) {
  if (typeof load !== "function") return;
  // Two at a time: a nicety that must not crowd out the user's own Gmail calls.
  const queue = planEmbeddedImages(doc, attachments);
  const worker = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      let url = "";
      try { url = embeddedImageDataUrl(entry.attachment.mimeType, await load(entry.attachment)); } catch { url = ""; }
      if (!url) continue;
      entry.imgs.forEach((img) => { img.setAttribute("src", url); });
    }
  };
  await Promise.all([worker(), worker()]);
}

// ── The frame ────────────────────────────────────────────────────────────────
// Last node of the frame's body. Its presence means the parser has read the
// whole email, which is the moment to fit it — long before `load`.
const FRAME_END_ID = "liv-mail-frame-end";

// options:
//   showImages    — load remote images (trackers stripped); false blocks them.
//   onReady(iframe, doc) — runs once, when the email's markup is in the frame:
//                   the mail app's own wiring (linkify, mailto, swipe pager).
//   inlineImages  — { attachments, load(attachment) → Promise<base64url> } for
//                   the email's embedded (cid:) images.
export function buildMailBodyFrame(html, { showImages = false, onReady = null, inlineImages = null } = {}) {
  const prepared = prepareMailImages(sanitizeMailFrameHtml(html), { block: !showImages });
  const bodyHtml = prepared.html;
  const iframe = document.createElement("iframe");
  iframe.className = "mail-msg-frame";
  iframe.dataset.blockedImages = String(prepared.blocked);
  iframe.dataset.trackersRemoved = String(prepared.trackers);
  // No allow-scripts: any scripting in the email is inert. allow-same-origin
  // lets the app measure the content height for auto-sizing.
  iframe.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  // The frame must never scroll internally — a mis-measured height would
  // otherwise produce a phantom nested scrollbar that swallows wheel/touch
  // scrolling. The thread panel is the only scroller.
  iframe.setAttribute("scrolling", "no");
  iframe.srcdoc =
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    // Force light rendering: the pane background is white, so let the OS/UA
    // darken nothing (and pair with the dark-media-query neutralizing in
    // sanitizeMailFrameHtml so email text never turns white-on-white).
    '<meta name="color-scheme" content="light">' +
    // text-size-adjust: iOS inflates paragraph text in a block it considers too
    // wide (any email the fit below zooms down) but leaves the email's fixed
    // pixel line-heights alone, so lines printed on top of each other.
    '<style>:root{color-scheme:light}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}html,body{margin:0;padding:0}' +
    'body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#202124;background:#fff;word-break:break-word}' +
    'img{max-width:100%;height:auto}table{max-width:100%}' +
    // A blocked remote image, or an embedded one not fetched yet, has no src —
    // browsers draw an ugly alt-text box for it ("Article Image"). Collapse
    // those so the email reads cleanly; they appear when given a src (Display
    // images re-renders; an embedded image is filled in place). figure captions
    // that belong to a hidden image go too.
    'img:not([src]){display:none!important}figure:has(> img:not([src])) figcaption,figure:has(> a > img:not([src])) figcaption{display:none}</style></head><body>' +
    bodyHtml +
    `<i id="${FRAME_END_ID}" hidden></i>` +
    "</body></html>";

  // Scale the email to fill the pane: fixed-width designs (newsletters are
  // typically ~600px) zoom up to the available width; overflowing ones zoom
  // down to fit. Height then tracks the scaled content.
  const fitAndSize = () => {
    try {
      const doc = iframe.contentDocument;
      const b = doc?.body;
      if (!b) return;
      b.style.zoom = "";
      const avail = iframe.clientWidth || 1;
      let z = 1;
      let design = 0;
      doc.querySelectorAll("table[width],td[width],table[style*='width'],div[style*='width']").forEach((el) => {
        const r = el.getBoundingClientRect().width;
        if (r >= 280 && r <= avail + 40) design = Math.max(design, r);
      });
      // Absolutely-positioned content overflows html, not body — check both.
      const wide = Math.max(b.scrollWidth, doc.documentElement.scrollWidth);
      if (wide > avail + 4) z = avail / wide;
      else if (design && design < avail - 8) z = Math.min(avail / design, 1.75);
      if (Math.abs(z - 1) > 0.03) b.style.zoom = z;
      // zoom is approximate on nested fixed-width layouts: if the doc still
      // spills past the pane it would be clipped (scrolling="no"), so tighten.
      // Read the root's width only: body.scrollWidth is in body's own unzoomed
      // units in current Chromium, so it always "still overflowed" and the
      // email was zoomed down twice.
      if (z < 1) {
        const still = doc.documentElement.scrollWidth;
        if (still > avail + 4) b.style.zoom = z * (avail / still);
      }
      // Measure the VISUAL height: with zoom applied, scrollHeight alone can
      // undershoot by a few px, which used to leave a nested scrollbar.
      const visual = Math.ceil(b.getBoundingClientRect().bottom + (doc.defaultView?.scrollY || 0));
      const h = Math.max(doc.documentElement.scrollHeight, visual) + 4;
      iframe.style.height = Math.min(Math.max(h, 40), 30000) + "px";
    } catch {}
  };
  // Coalesce refit bursts into one measure per frame. Deferring to the next
  // animation frame also breaks any synchronous ResizeObserver feedback (the
  // zoom fitAndSize applies changes body size, which would otherwise re-notify).
  let fitPending = false;
  const scheduleFit = () => {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(() => { fitPending = false; fitAndSize(); loadNearImages(); });
  };

  // Runs once, as soon as the email's markup is in the frame.
  let ready = false;
  const setUp = (doc) => {
    if (ready) return;
    ready = true;
    iframe.dataset.ready = "1";
    try { onReady?.(iframe, doc); } catch {}
    fitAndSize();
    try {
      // Re-fit whenever an image settles — load AND error both finalize layout,
      // so a blocked or broken remote image (common under no-referrer) can no
      // longer leave the frame stuck at a too-short height.
      doc.querySelectorAll("img").forEach((img) => {
        img.addEventListener("load", scheduleFit);
        img.addEventListener("error", scheduleFit);
      });
      // Event-driven height tracking: any change in the rendered body size —
      // late remote images, web-font swaps, reflow — re-fits immediately, with
      // no fixed time window that can expire before slow content finishes
      // (the old 4s poll was why slow/blocked images left a half-height frame).
      if (doc.body && typeof ResizeObserver !== "undefined") {
        new ResizeObserver(scheduleFit).observe(doc.body);
      }
    } catch {}
    // A few early re-measures cover the first layout settle even when the body
    // size doesn't change (e.g. same-metrics font swaps).
    let n = 0;
    const t = setInterval(() => { fitAndSize(); if (++n >= 6) clearInterval(t); }, 400);
    // Refit when the pane width changes (sidebar toggle, window resize)
    let lastW = iframe.clientWidth;
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (iframe.clientWidth !== lastW) { lastW = iframe.clientWidth; fitAndSize(); }
      }).observe(iframe);
    }
    if (inlineImages) fillEmbeddedImages(doc, inlineImages).catch(() => {});
    startImageLoader(doc);
  };

  // Give parked images (data-lz-src) their real source as they come near the
  // screen. Event-driven — runs on scroll, resize and re-fit, never on a timer —
  // and stops listening once nothing is left or the frame is gone. An image the
  // email itself hides (no layout box) is never fetched.
  const NEAR_PX = 1200;
  let loadNearImages = () => {};
  const startImageLoader = (doc) => {
    let pending = [...doc.querySelectorAll("img[data-lz-src]")];
    if (!pending.length) return;
    const activate = (img) => {
      const picture = img.parentElement?.tagName === "PICTURE" ? img.parentElement : null;
      picture?.querySelectorAll("source[data-lz-srcset]").forEach((source) => {
        source.setAttribute("srcset", source.getAttribute("data-lz-srcset"));
        source.removeAttribute("data-lz-srcset");
      });
      const srcset = img.getAttribute("data-lz-srcset");
      if (srcset) { img.setAttribute("srcset", srcset); img.removeAttribute("data-lz-srcset"); }
      const src = img.getAttribute("data-lz-src");
      if (src) img.setAttribute("src", src);
      img.removeAttribute("data-lz-src");
    };
    let queued = false;
    const stop = () => {
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      loadNearImages = () => {};
    };
    const run = () => {
      queued = false;
      if (!iframe.isConnected) { stop(); return; }
      const frameRect = iframe.getBoundingClientRect();
      const bodyRect = doc.body.getBoundingClientRect();
      if (!frameRect.height || !bodyRect.height) return; // not laid out (hidden pane)
      const view = window.innerHeight || document.documentElement.clientHeight;
      pending = pending.filter((img) => {
        if (!img.getClientRects().length) return true; // hidden by the email: leave parked
        // Position as a fraction of the email's height, so the answer is the
        // same whatever units the frame's zoom reports its rects in.
        const r = img.getBoundingClientRect();
        const top = frameRect.top + ((r.top - bodyRect.top) / bodyRect.height) * frameRect.height;
        const bottom = frameRect.top + ((r.bottom - bodyRect.top) / bodyRect.height) * frameRect.height;
        if (top > view + NEAR_PX || bottom < -NEAR_PX) return true;
        activate(img);
        return false;
      });
      if (!pending.length) stop();
    };
    function onMove() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
    }
    loadNearImages = onMove;
    // capture: the thread panel (not the window) is what scrolls.
    document.addEventListener("scroll", onMove, { capture: true, passive: true });
    window.addEventListener("resize", onMove, { passive: true });
    run();
  };

  // Watch for the end marker rather than wait for `load`. Bounded: stops once
  // ready, once the frame has been mounted and then removed, or after ~15s —
  // `load` below is the fallback in every case.
  let wasConnected = false;
  const startedAt = Date.now();
  const watch = () => {
    if (ready) return;
    if (iframe.isConnected) wasConnected = true;
    else if (wasConnected) return;
    if (Date.now() - startedAt > 15000) return;
    let doc = null;
    try { doc = iframe.contentDocument; } catch {}
    if (doc?.getElementById(FRAME_END_ID)) { setUp(doc); return; }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  iframe.addEventListener("load", () => {
    let doc = null;
    try { doc = iframe.contentDocument; } catch {}
    if (!doc) return;
    if (!ready) setUp(doc);
    else fitAndSize();
  });
  return iframe;
}
