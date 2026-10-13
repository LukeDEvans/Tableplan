// status-tap-scroll.js — tap the top of the screen (the iOS status bar) to
// scroll back to the top, like every native iOS app.
//
// Why this needs code: iOS's built-in status-bar tap only scrolls the web view's
// own document, and this app's body never scrolls (styles.css, "Every page window
// fits the viewport") — every page, sheet and dialog scrolls inside its own
// element. So the native shell forwards the tap as a window "statusTap" event
// (ios/App/App/MainViewController.swift) and this module scrolls whichever
// container is in front to the top.
//
// Which container: the scrollable ancestors of the element in the middle of the
// screen. That is whatever the user is looking at — an open dialog or sheet if
// one is up, the page window otherwise — without this file knowing every page.
// Only containers that are actually scrolled down are touched.
//
// In a browser or the PWA no "statusTap" event ever fires, so this is inert there.

const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

// True when `el` scrolls vertically and has something to scroll.
export function isVerticalScroller(el, getStyle) {
  if (!el || el.nodeType !== 1) return false;
  if (!(el.scrollHeight > el.clientHeight + 1)) return false;
  let overflowY = "";
  try { overflowY = getStyle(el)?.overflowY || ""; } catch { return false; }
  return SCROLLABLE_OVERFLOW.has(overflowY);
}

// The scrolled-down vertical scrollers from `el` up through its ancestors,
// innermost first.
export function scrolledAncestors(el, getStyle) {
  const out = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.scrollTop > 0 && isVerticalScroller(node, getStyle)) out.push(node);
  }
  return out;
}

// Points to probe, most telling first: the middle of the screen, then higher and
// lower, so a short sheet or a gap in the middle doesn't make the tap miss.
export function probePoints(width, height) {
  const x = Math.round(width / 2);
  return [0.5, 0.35, 0.7, 0.2].map((f) => [x, Math.round(height * f)]);
}

// Finds what to scroll for a status-bar tap. Returns the elements (possibly
// empty). `doc.elementFromPoint` decides what is in front.
export function findScrollTargets(doc, win) {
  const getStyle = (el) => win.getComputedStyle(el);
  const width = win.innerWidth || doc.documentElement?.clientWidth || 0;
  const height = win.innerHeight || doc.documentElement?.clientHeight || 0;
  for (const [x, y] of probePoints(width, height)) {
    let hit = null;
    try { hit = doc.elementFromPoint(x, y); } catch { hit = null; }
    const targets = scrolledAncestors(hit, getStyle);
    if (targets.length) return targets;
  }
  const root = doc.scrollingElement;
  return root && root.scrollTop > 0 ? [root] : [];
}

function prefersReducedMotion(win) {
  try { return !!win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { return false; }
}

export function scrollToTop(doc = document, win = window) {
  const targets = findScrollTargets(doc, win);
  const behavior = prefersReducedMotion(win) ? "auto" : "smooth";
  for (const el of targets) {
    try {
      if (typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior });
      else el.scrollTop = 0;
    } catch {
      el.scrollTop = 0;
    }
  }
  return targets.length;
}

let installed = false;
export function installStatusTapScroll(win = typeof window !== "undefined" ? window : null) {
  if (installed || !win || typeof win.addEventListener !== "function") return false;
  installed = true;
  win.addEventListener("statusTap", () => { scrollToTop(win.document, win); });
  return true;
}
