// sortable.js — the shared sortable/reorder interaction binder.
//
//   makeSortable(container, opts) → { destroy }
//
// Owns ALL interaction mechanics for one polished reorder gesture, shared across
// the app (Media queue, Shop list, …). The consuming feature owns data, rendering,
// identity, and PERSISTENCE — it just receives a domain-level reorder event.
//
// Model (audit-driven):
//   • Pointer Events for mouse/touch/pen/trackpad (one code path).
//   • Desktop: pointerdown + small move → drag. Touch: long-press (~450ms, small
//     drift tolerated) → drag; a plain tap passes through, a swipe scrolls.
//   • Offset-preserving fixed clone follows the pointer; the source row stays as a
//     dimmed placeholder that the list reorders around (FLIP neighbour slide).
//   • One requestAnimationFrame loop does reorder-under-pointer + PROPORTIONAL edge
//     auto-scroll, resolving the nearest real scroll container (not window).
//   • Optional grouped mode: rows may cross between sibling lists (groupSelector).
//   • Keyboard alternative (no visible handle): focus a row, Space to grab, arrows
//     to move, Space to drop, Esc to cancel, with aria-live announcements.
//
// Pure decisions (thresholds, velocity, index math) live in sortable-core.js.

import {
  SORTABLE_DEFAULTS, preActivationOutcome, autoScrollVelocity,
} from "./sortable-core.js";

const INTERACTIVE = "button, a, input, select, textarea, [role='button'], [role='menuitem'], [role='switch'], [contenteditable='true'], .no-drag";
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// One shared polite live region for reorder announcements.
let liveRegion = null;
function announce(msg) {
  if (typeof document === "undefined") return;
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = "";
  // rAF so repeated identical text is still announced
  requestAnimationFrame(() => { liveRegion.textContent = msg; });
}

// After a real drag, swallow the click the browser fires on release so a reorder
// never also triggers the row's tap/click action (e.g. play).
function suppressClickOnce() {
  const swallow = (e) => { e.stopPropagation(); e.preventDefault(); window.removeEventListener("click", swallow, true); };
  window.addEventListener("click", swallow, true);
  setTimeout(() => window.removeEventListener("click", swallow, true), 400);
}

export function makeSortable(container, opts = {}) {
  if (!container) return { destroy() {} };
  const {
    rowSelector,
    getId = (row) => row.dataset.sortId,
    onReorder = () => {},
    groupSelector = null,       // grouped mode: rows may cross between these within `container`
    onGroupedDrop = null,       // ({ itemId, fromContainer, toContainer, targetId, position })
    reorder = true,             // false = pure MOVE mode (no intra-list reorder; drop-zones only)
    dropZoneSelector = null,    // move mode: valid drop targets (searched anywhere in the document)
    onDropZone = null,          // move mode: ({ itemId, row, zone }) when released over a drop zone
    handleSelector = null,      // if set, a drag only starts from within a handle inside the row
    disabledWithin = INTERACTIVE,
    longPressMs = SORTABLE_DEFAULTS.longPressMs,
    touchTolerancePx = SORTABLE_DEFAULTS.touchTolerancePx,
    mouseStartPx = SORTABLE_DEFAULTS.mouseStartPx,
    edgePx = SORTABLE_DEFAULTS.edgePx,
    maxScrollVel = SORTABLE_DEFAULTS.maxScrollVel,
    itemLabel = (row) => (row.textContent || "item").trim().slice(0, 40),
  } = opts;
  if (!rowSelector) throw new Error("makeSortable: rowSelector required");

  // The list a row currently lives in (its group sublist, or the container).
  const listOf = (row) => (groupSelector ? row.closest(groupSelector) : container) || container;
  const rowsIn = (list) => [...list.querySelectorAll(`:scope > ${rowSelector}, :scope ${rowSelector}`)]
    .filter((r) => listOf(r) === list);
  const idsIn = (list) => rowsIn(list).map(getId);

  // ── pointer drag state ──
  let g = null; // active gesture
  function resetTransforms(list) { rowsIn(list).forEach((r) => { r.style.transition = ""; r.style.transform = ""; }); }

  function scrollContainerFor(row) {
    let n = (row || container).parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 2) return n;
      n = n.parentElement;
    }
    // App-shell pages lock body/window scroll, so only fall back to the scrolling
    // document element when it can actually scroll.
    return (document.scrollingElement && document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 2)
      ? document.scrollingElement : null;
  }

  function rowUnderPointer() {
    const el = document.elementFromPoint(g.lastX, g.lastY);
    const row = el && el.closest ? el.closest(rowSelector) : null;
    if (!row || row === g.placeholder || !container.contains(row)) return null;
    return row;
  }

  // Slot the placeholder next to the row under the pointer (reparenting across
  // sublists in grouped mode), sliding the displaced neighbour with a FLIP.
  function reorderToPointer() {
    const under = rowUnderPointer();
    const ph = g.placeholder;
    if (under) {
      const r = under.getBoundingClientRect();
      const before = g.lastY < r.top + r.height / 2;
      if (before && under.previousElementSibling === ph) return;
      if (!before && under.nextElementSibling === ph) return;
      const topBefore = under.getBoundingClientRect().top;
      const parentBefore = ph.parentElement;
      under.parentElement.insertBefore(ph, before ? under : under.nextSibling);
      g.reordered = true;
      const dy = topBefore - under.getBoundingClientRect().top;
      if (dy && !reduceMotion()) {
        under.style.transition = "none";
        under.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => { under.style.transition = "transform .16s ease"; under.style.transform = ""; });
      }
      if (parentBefore !== ph.parentElement) resetTransforms(parentBefore);
    } else if (groupSelector) {
      // Empty area of a sibling list → adopt the placeholder into it.
      const el = document.elementFromPoint(g.lastX, g.lastY);
      const list = el && el.closest ? el.closest(groupSelector) : null;
      if (list && container.contains(list) && !list.contains(ph)) { list.appendChild(ph); g.reordered = true; }
    }
  }

  function autoScrollFrame() {
    const sc = g.scroller;
    if (!sc) return;
    const isDoc = sc === document.scrollingElement;
    const top = isDoc ? 0 : sc.getBoundingClientRect().top;
    const bottom = isDoc ? window.innerHeight : sc.getBoundingClientRect().bottom;
    const v = autoScrollVelocity(g.lastY, top, bottom, { edgePx, maxVel: maxScrollVel });
    if (!v) return;
    const before = sc.scrollTop;
    sc.scrollTop += v;
    if (sc.scrollTop !== before) g.scrolled = true;
  }

  // Move mode: highlight the drop target under the pointer (a day-tab, folder,
  // backlog, category — not a sibling row).
  function updateDropZone() {
    const el = document.elementFromPoint(g.lastX, g.lastY);
    const zone = el && el.closest ? el.closest(dropZoneSelector) : null;
    if (zone === g.zone) return;
    if (g.zone) g.zone.classList.remove("sortable-dropzone-over");
    g.zone = zone;
    if (g.zone) g.zone.classList.add("sortable-dropzone-over");
  }

  function loop() {
    if (!g || !g.armed) return;
    if (reorder) reorderToPointer();
    if (dropZoneSelector) updateDropZone();
    autoScrollFrame();
    g.raf = requestAnimationFrame(loop);
  }

  function positionClone() {
    if (g.clone) g.clone.style.transform = `translate(${g.lastX - g.grabX}px, ${g.lastY - g.grabY}px)`;
  }

  function activate() {
    if (!g || g.armed) return;
    g.armed = true;
    const rect = g.row.getBoundingClientRect();
    g.grabX = g.startX - rect.left;
    g.grabY = g.startY - rect.top;
    const clone = g.row.cloneNode(true);
    clone.classList.add("sortable-clone");
    clone.style.cssText += `;position:fixed;left:0;top:0;width:${rect.width}px;margin:0;z-index:9999;pointer-events:none;will-change:transform;`;
    document.body.appendChild(clone);
    g.clone = clone;
    g.placeholder = g.row;
    g.row.classList.add("sortable-placeholder");
    g.row.style.pointerEvents = "none"; // so elementFromPoint sees rows beneath
    container.classList.add("sortable-active");
    g.scroller = scrollContainerFor(g.row);
    try { g.row.setPointerCapture(g.pointerId); } catch { /* detached */ }
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* unsupported */ } }
    positionClone();
    g.raf = requestAnimationFrame(loop);
  }

  // Emit the reorder to the consuming feature. If onGroupedDrop is provided (neighbor-
  // based features like Shop, which also support cross-list moves), report the target
  // list + neighbour + before/after; otherwise report the materialized order (Media).
  // Used by both the pointer drop and the keyboard path.
  function emitDrop(row, fromContainer, fromIndex) {
    const toList = listOf(row);
    if (onGroupedDrop) {
      const rows = rowsIn(toList);
      const idx = rows.indexOf(row);
      const nextRow = rows[idx + 1], prevRow = rows[idx - 1];
      const target = nextRow ? { targetId: getId(nextRow), position: "before" }
        : prevRow ? { targetId: getId(prevRow), position: "after" }
        : { targetId: "", position: "after" };
      onGroupedDrop({ itemId: getId(row), row, fromContainer, toContainer: toList, ...target });
    } else {
      const order = idsIn(toList);
      const toIndex = order.indexOf(getId(row));
      if (toIndex !== fromIndex || toList !== fromContainer) onReorder({ itemId: getId(row), fromIndex, toIndex, order });
    }
  }
  function finishDrop() {
    // Resolve the drop zone from the ACTUAL release position (the rAF-tracked g.zone
    // can lag the final pointerup). A zone drop wins over a grouped reorder.
    if (dropZoneSelector && onDropZone) {
      const el = document.elementFromPoint(g.lastX, g.lastY);
      const zone = el && el.closest ? el.closest(dropZoneSelector) : null;
      if (zone) { onDropZone({ itemId: g.itemId, row: g.placeholder, zone }); return; }
    }
    if (reorder && g.reordered) emitDrop(g.placeholder, g.fromContainer, g.fromIndex);
  }

  function teardown() {
    if (!g) return;
    clearTimeout(g.timer);
    if (g.raf) cancelAnimationFrame(g.raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    if (g.row) { try { g.row.releasePointerCapture(g.pointerId); } catch { /* detached */ } }
    if (g.placeholder) { g.placeholder.classList.remove("sortable-placeholder"); g.placeholder.style.pointerEvents = ""; }
    if (g.clone) g.clone.remove();
    container.classList.remove("sortable-active");
    if (g.zone) g.zone.classList.remove("sortable-dropzone-over");
    if (dropZoneSelector) document.querySelectorAll(".sortable-dropzone-over").forEach((z) => z.classList.remove("sortable-dropzone-over"));
    // clear any leftover FLIP transforms wherever the placeholder ended up
    (groupSelector ? [...container.querySelectorAll(groupSelector)] : [container]).forEach(resetTransforms);
    g = null;
  }

  function onDown(e) {
    if (g || (e.pointerType === "mouse" && e.button !== 0)) return;
    const row = e.target.closest ? e.target.closest(rowSelector) : null;
    if (!row || !container.contains(row)) return;
    if (handleSelector) {
      // Handle mode: a drag begins ONLY from the handle, which bypasses the
      // interactive-child exclusion. The rest of the row keeps normal behaviour.
      if (!(e.target.closest && e.target.closest(handleSelector))) return;
    } else {
      // A control *inside* the row keeps its normal behaviour; the row matching
      // disabledWithin itself (e.g. a role="button" row) must still be draggable.
      const hit = e.target.closest(disabledWithin);
      if (hit && hit !== row && row.contains(hit)) return;
    }
    g = {
      row, itemId: getId(row), pointerId: e.pointerId, pointerType: e.pointerType,
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      grabX: 0, grabY: 0, armed: false, reordered: false, scrolled: false,
      clone: null, placeholder: null, raf: 0, timer: 0, zone: null,
      fromContainer: listOf(row), fromIndex: reorder ? idsIn(listOf(row)).indexOf(getId(row)) : -1,
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (e.pointerType === "touch") g.timer = setTimeout(activate, longPressMs);
  }

  function onMove(e) {
    if (!g || e.pointerId !== g.pointerId) return;
    g.lastX = e.clientX; g.lastY = e.clientY;
    if (!g.armed) {
      const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
      const outcome = preActivationOutcome(dist, g.pointerType, { touchTolerancePx, mouseStartPx });
      if (outcome === "cancel") teardown();       // touch swipe → let the page scroll
      else if (outcome === "activate") activate(); // mouse moved enough
      return;
    }
    e.preventDefault(); // hold the drag; don't scroll natively
    positionClone();
  }

  function onUp(e) {
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.armed) { e.preventDefault(); suppressClickOnce(); finishDrop(); }
    teardown();
  }
  function onCancel(e) {
    if (!g || e.pointerId !== g.pointerId) return;
    teardown();
  }

  // ── keyboard reorder (accessible alternative; no visible handle) ──
  // Alt/Option + Arrow Up/Down moves the focused row earlier/later. Discrete,
  // announced via aria-live, and conflict-free with a row's own Enter/Space action.
  function onKeyDown(e) {
    if (!reorder) return; // move mode: reordering keys don't apply (feature provides its own move UI)
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const row = e.target.closest ? e.target.closest(rowSelector) : null;
    if (!row || !container.contains(row)) return;
    const list = listOf(row);
    const rows = rowsIn(list);
    const fromIndex = rows.indexOf(row);
    let moved = false;
    if (e.key === "ArrowUp" && fromIndex > 0) { list.insertBefore(row, rows[fromIndex - 1]); moved = true; }
    else if (e.key === "ArrowDown" && fromIndex < rows.length - 1) { list.insertBefore(row, rows[fromIndex + 1].nextSibling); moved = true; }
    if (!moved) return;
    e.preventDefault();
    const id = getId(row);
    emitDrop(row, list, fromIndex);
    const toIndex = idsIn(list).indexOf(id);
    announce(`${itemLabel(row)} moved to position ${toIndex + 1} of ${rowsIn(list).length}.`);
    // The feature re-renders on reorder → restore focus to the moved row (or, if the
    // row itself isn't focusable, a focusable control inside it, e.g. its checkbox).
    requestAnimationFrame(() => {
      const again = [...container.querySelectorAll(rowSelector)].find((r) => getId(r) === id);
      if (!again) return;
      const focusable = again.matches("a,button,input,select,textarea,[tabindex]") ? again
        : again.querySelector("a,button,input,select,textarea,[tabindex]") || again;
      try { focusable.focus(); } catch { /* not focusable */ }
    });
  }

  container.addEventListener("pointerdown", onDown);
  container.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      teardown();
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("keydown", onKeyDown);
    },
  };
}
