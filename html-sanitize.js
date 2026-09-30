// Shared sanitizers for untrusted HTML and data-derived URLs.
//
// Everything that parses untrusted markup MUST go through an inert document
// (DOMParser "text/html"): assigning to .innerHTML of an element — even a
// detached one — in the live document runs <img onerror> handlers and starts
// network loads (tracking pixels). A DOMParser document has no browsing
// context, so nothing executes or loads while we scrub it.
//
// safeUrl / isSafeHref / isSafeSrc are pure string logic (unit-tested in node);
// the DOM helpers need a browser DOMParser and are only called at runtime.

// Strip ASCII whitespace/control chars (browsers ignore them inside schemes,
// so "java\tscript:" and "\u0000javascript:" still execute).
function compactUrl(u) {
  // eslint-disable-next-line no-control-regex
  return String(u ?? "").replace(/[\u0000- \u007f-\u009f​-‍﻿]/g, "");
}

// Returns the trimmed URL when it uses an allowlisted scheme (http, https,
// mailto, tel), otherwise `fallback` ("" by default). Pass "#" as fallback for
// an href that must stay present.
export function safeUrl(u, fallback = "") {
  const trimmed = String(u ?? "").trim();
  if (!trimmed) return fallback;
  return /^(https?:|mailto:|tel:)/i.test(compactUrl(trimmed)) ? trimmed : fallback;
}

// Link targets inside sanitized HTML: the safeUrl schemes plus in-page
// fragment links ("#section"), which are inert.
export function isSafeHref(u) {
  const c = compactUrl(u);
  if (!c) return false;
  if (c.startsWith("#")) return true;
  return /^(https?:|mailto:|tel:)/i.test(c);
}

// Resource sources (img src etc.): http(s), inline raster/svg images, and the
// cid: references email bodies use for embedded attachments. An <img> never
// executes script, even for data:image/svg+xml.
export function isSafeSrc(u) {
  const c = compactUrl(u);
  if (!c) return false;
  return /^(https?:|cid:|data:image\/)/i.test(c);
}

const URL_ATTRS = new Set(["href", "xlink:href", "action", "formaction", "src", "background", "poster", "srcset", "lowsrc", "dynsrc", "ping", "data", "codebase", "cite", "longdesc", "manifest"]);

// Parse into an inert document and return its <body>. A full HTML email puts
// its <style> blocks in <head>; `keepHeadStyles` moves them to the top of the
// body so a caller that keeps styling (the mail iframe) doesn't lose layout.
export function parseInertHtml(html, { keepHeadStyles = false } = {}) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  if (keepHeadStyles && doc.head) {
    const styles = [...doc.head.querySelectorAll("style")];
    if (styles.length) doc.body.prepend(...styles);
  }
  return doc.body;
}

// Remove every on* handler and any URL attribute whose scheme isn't allowed.
// Used by the (lighter, style-preserving) mail renderers.
export function scrubActiveAttributes(root) {
  root.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) { el.removeAttribute(attr.name); return; }
      if (!URL_ATTRS.has(name)) return;
      const v = attr.value;
      let ok;
      if (name === "href" || name === "xlink:href") ok = isSafeHref(v);
      else if (name === "src" || name === "background" || name === "poster") ok = isSafeSrc(v);
      else if (name === "srcset") ok = v.split(",").every((part) => { const u = part.trim().split(/\s+/)[0]; return !u || isSafeSrc(u); });
      else ok = false; // action/formaction/ping/data/codebase/… — never needed for display
      if (!ok) el.removeAttribute(attr.name);
    });
  });
}

// Tags removed together with their contents.
const DROP_TAGS = new Set(["script", "style", "link", "meta", "title", "head", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select", "textarea", "option", "noscript", "template", "svg", "math", "base", "audio", "video", "source", "track", "canvas", "portal", "dialog"]);

// Tags kept (with only the attributes listed in ALLOWED_ATTRS).
const ALLOWED_TAGS = new Set(["p", "br", "hr", "a", "b", "i", "em", "strong", "u", "s", "small", "sup", "sub", "mark", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "span", "div", "dl", "dt", "dd"]);

const ALLOWED_ATTRS = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start"]
};

// Allowlist sanitizer for untrusted rich text rendered into the app's own DOM
// (show notes, article bodies, …). Unknown tags are unwrapped (text kept);
// dangerous containers are dropped whole; every attribute outside the
// allowlist — including all on* handlers, style and class — is removed; href
// and src only survive with an allowlisted scheme.
export function sanitizeUntrustedHtml(html) {
  const body = parseInertHtml(html);
  const walk = (parent) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === 3) continue; // text
      if (node.nodeType !== 1) { node.remove(); continue; } // comments, PIs
      const tag = node.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { node.remove(); continue; }
      walk(node);
      if (!ALLOWED_TAGS.has(tag)) { node.replaceWith(...node.childNodes); continue; }
      const allowed = ALLOWED_ATTRS[tag] || [];
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        if (!allowed.includes(name)) { node.removeAttribute(attr.name); continue; }
        if (name === "href" && !isSafeHref(attr.value)) node.removeAttribute(attr.name);
        if (name === "src" && !isSafeSrc(attr.value)) node.removeAttribute(attr.name);
      }
      if (tag === "a" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (tag === "img") {
        if (!node.hasAttribute("src")) { node.remove(); continue; }
        node.setAttribute("style", "max-width:100%;height:auto");
      }
    }
  };
  walk(body);
  return body.innerHTML;
}
