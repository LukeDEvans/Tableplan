// input-clear.js — the app-wide clear button for text boxes.
//
// The rule (Luke, 2026-10-15): once the user has typed into a text box, an "x" on
// a subtly shaded circle sits at the far right of the box; tapping it empties the
// box. It applies to every text box, existing and future, without each page wiring
// it up: this module listens at the document level, so fields rendered later from
// template strings, in dialogs or sheets, get it too.
//
// Which fields: single-line text boxes (text, search, email, url, tel), not
// read-only or disabled, at least MIN_FIELD_WIDTH wide. Not textareas (clearing a
// whole note by accident is too costly), passwords, numbers, dates or other
// pickers. A field opts out with `data-no-clear` on itself or any ancestor — use it
// where a page already draws its own clear button.
//
// When it shows: after the user types (or pastes) into the field, for as long as
// the field has text. A value that was only filled in by the app (editing an
// existing event, say) shows no button until the user starts typing.
//
// How: the button is inserted right after the field as an absolutely positioned
// sibling, so it scrolls with the field and stays in the same top layer as a modal
// dialog, and it takes no space in flex or grid layouts. While it shows, the field
// gets enough right padding that text never runs under it. Clearing sets the value
// to "" and fires the same `input` and `change` events typing would, so every
// page's own handlers (search filters, dirty flags) react as usual.
//
// Nothing here is stored or synced.

export const CLEARABLE_TYPES = new Set(["text", "search", "email", "url", "tel"]);
export const MIN_FIELD_WIDTH = 80; // px — narrower boxes have no room for it
export const BUTTON_SIZE = 20; // px — the shaded circle
export const BUTTON_GAP = 6; // px — from the field's right edge

const X_SVG = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';

// Whether `el` is a text box that gets the clear button, ignoring its size and
// value. Works on anything element-shaped, so it can be tested without a DOM.
export function isClearableField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (String(el.tagName || "").toUpperCase() !== "INPUT") return false;
  const type = String(el.type || el.getAttribute?.("type") || "text").toLowerCase();
  if (!CLEARABLE_TYPES.has(type)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el.closest?.("[data-no-clear]")) return false;
  return true;
}

// Whether the button should be showing for `el` right now.
export function shouldShowClear(el, { typed, width }) {
  if (!typed) return false;
  if (!isClearableField(el)) return false;
  if (!el.isConnected) return false;
  if (!(width >= MIN_FIELD_WIDTH)) return false;
  return String(el.value ?? "") !== "";
}

// Right padding the field needs so text stops short of the button.
export function paddingNeeded() {
  return BUTTON_SIZE + BUTTON_GAP * 2;
}

export function installInputClear(doc = globalThis.document) {
  if (!doc || doc.__liveInputClear) return null;
  const win = doc.defaultView || globalThis;

  const typed = new WeakSet(); // fields the user has typed into
  const buttons = new WeakMap(); // field -> its button
  const active = new Set(); // fields whose button is in the DOM
  const savedPadding = new WeakMap(); // field -> its own inline padding-right
  const resizeObserver = typeof win.ResizeObserver === "function"
    ? new win.ResizeObserver((entries) => entries.forEach((e) => sync(e.target)))
    : null;

  function buttonFor(field) {
    let btn = buttons.get(field);
    if (btn && btn.isConnected && btn.previousElementSibling === field) return btn;
    btn?.remove();
    btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "live-input-clear";
    btn.tabIndex = -1; // keyboard users clear with select-all + delete; keep tab order
    btn.setAttribute("aria-label", "Clear text");
    btn.innerHTML = X_SVG;
    // Keep focus (and the phone's keyboard) on the field.
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearField(field);
    });
    field.insertAdjacentElement("afterend", btn);
    buttons.set(field, btn);
    return btn;
  }

  function place(field, btn) {
    const f = field.getBoundingClientRect();
    btn.style.left = "0px";
    btn.style.top = "0px";
    const origin = btn.getBoundingClientRect();
    const left = f.right - BUTTON_GAP - BUTTON_SIZE - origin.left;
    const top = f.top + (f.height - BUTTON_SIZE) / 2 - origin.top;
    btn.style.left = `${Math.round(left)}px`;
    btn.style.top = `${Math.round(top)}px`;
  }

  function padField(field) {
    if (!savedPadding.has(field)) savedPadding.set(field, field.style.paddingRight);
    const current = parseFloat(win.getComputedStyle(field).paddingRight) || 0;
    const need = paddingNeeded();
    if (current < need) field.style.paddingRight = `${need}px`;
  }

  function unpadField(field) {
    if (!savedPadding.has(field)) return;
    field.style.paddingRight = savedPadding.get(field);
    savedPadding.delete(field);
  }

  function hide(field) {
    const btn = buttons.get(field);
    if (btn) btn.remove();
    buttons.delete(field);
    unpadField(field);
    active.delete(field);
    resizeObserver?.unobserve(field);
  }

  function sync(field) {
    if (!field) return;
    const width = field.isConnected ? field.getBoundingClientRect().width : 0;
    if (!shouldShowClear(field, { typed: typed.has(field), width })) {
      if (active.has(field) || buttons.has(field)) hide(field);
      return;
    }
    padField(field);
    const btn = buttonFor(field);
    place(field, btn);
    if (!active.has(field)) {
      active.add(field);
      resizeObserver?.observe(field);
    }
  }

  function syncAll() {
    for (const field of [...active]) sync(field);
  }

  function clearField(field) {
    field.value = "";
    field.dispatchEvent(new win.Event("input", { bubbles: true }));
    field.dispatchEvent(new win.Event("change", { bubbles: true }));
    try { field.focus({ preventScroll: true }); } catch { field.focus(); }
    sync(field);
  }

  // The user typing or pasting is what arms a field.
  doc.addEventListener("input", (e) => {
    const field = e.target;
    if (!isClearableField(field)) return;
    if (e.isTrusted !== false) typed.add(field);
    sync(field);
  }, true);

  // Apps also change values themselves (a form reset after Save, a page re-render).
  // Re-check the fields that have a button after the things that usually do that.
  let pending = false;
  const scheduleSyncAll = () => {
    if (pending || !active.size) return;
    pending = true;
    const run = () => { pending = false; syncAll(); };
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(run);
    else setTimeout(run, 16);
  };
  // `scroll` too: a scrolling area that isn't itself positioned doesn't carry an
  // absolutely positioned child along, so the button is re-placed after a scroll.
  for (const type of ["click", "change", "submit", "reset", "focusin", "keyup", "transitionend", "scroll"]) {
    doc.addEventListener(type, scheduleSyncAll, true);
  }
  win.addEventListener?.("resize", scheduleSyncAll);

  doc.__liveInputClear = { sync, syncAll };
  return doc.__liveInputClear;
}
