// utilities-ui.js — the corner utilities menu (UTILITIES_MENU_DESIGN.md).
//
// The nine-dot button in the top-right corner: tap opens a plain dropdown of
// tools (Talk to Liv, Chat with Liv, Scan, Camera, Shazam, Calculator, Clock,
// Wallet); press and hold talks to Liv (the dots become a sound wave; release
// sends, slide away cancels). Each tool opens as a full-screen sheet over the
// current page (openUtilitySheet). Items that don't work on this device are left
// off (decision 11: the laptop has no Camera, Shazam or alarms).
//
// DOM only, no app state: everything the menu does goes through `actions`.

export const HOLD_MS = 420;
export const CANCEL_DISTANCE = 60;

export const UTILITY_ITEMS = Object.freeze([
  { id: "talk", label: "Talk to Liv" },
  { id: "chat", label: "Chat with Liv" },
  { id: "scan", label: "Scan" },
  { id: "camera", label: "Camera", phoneOnly: true },
  { id: "shazam", label: "Shazam", phoneOnly: true },
  { id: "calculator", label: "Calculator" },
  { id: "clock", label: "Clock" },
  { id: "wallet", label: "Wallet" },
]);

// The items this device shows. `can` = { camera, shazam } capability flags.
export function visibleUtilityItems({ camera = false, shazam = false } = {}) {
  return UTILITY_ITEMS.filter((it) => (it.id === "camera" ? camera : it.id === "shazam" ? shazam : true));
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function bindUtilitiesMenu({ button, menu, capabilities = () => ({}), actions = {}, closeOtherMenus = () => {} }) {
  if (!button || !menu) return null;
  let mode = "main"; // main | scan

  function render() {
    const can = capabilities();
    if (mode === "scan") {
      const items = [
        ...(can.scanCamera ? [{ id: "scan-camera", label: "Camera" }] : []),
        { id: "scan-library", label: can.scanCamera ? "Photo library" : "Choose photos" },
      ];
      menu.innerHTML = `<button type="button" role="menuitem" class="utilities-back" data-util="back" aria-label="Back to tools">‹ Scan</button>`
        + items.map((it) => `<button type="button" role="menuitem" data-util="${it.id}">${esc(it.label)}</button>`).join("");
      return;
    }
    menu.innerHTML = visibleUtilityItems(can).map((it) => `<button type="button" role="menuitem" data-util="${it.id}">${esc(it.label)}</button>`).join("");
  }

  function open() {
    closeOtherMenus();
    mode = "main";
    render();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  }
  function close() {
    menu.hidden = true;
    mode = "main";
    button.setAttribute("aria-expanded", "false");
  }
  const toggle = () => (menu.hidden ? open() : close());

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = e.target.closest("[data-util]")?.dataset.util;
    if (!id) return;
    if (id === "back") { mode = "main"; render(); return; }
    if (id === "scan") {
      // Straight to the picker where there's no camera choice to make.
      if (!capabilities().scanCamera) { close(); actions.scan?.("library"); return; }
      mode = "scan"; render(); menu.querySelector("[data-util]:not(.utilities-back)")?.focus(); return;
    }
    close();
    if (id === "scan-camera") actions.scan?.("camera");
    else if (id === "scan-library") actions.scan?.("library");
    else actions[id]?.();
  });

  // ── Tap = menu; press and hold = talk ──────────────────────────────────────
  let holdTimer = null;
  let holding = false;
  let cancelled = false;
  let origin = null;
  let suppressClick = false;

  function setTalking(on, cancel = false) {
    button.classList.toggle("is-talking", on);
    button.classList.toggle("is-cancelling", on && cancel);
    button.setAttribute("aria-label", on ? (cancel ? "Release to cancel" : "Listening — release to send") : "Tools");
  }

  button.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    origin = { x: e.clientX, y: e.clientY };
    holding = false; cancelled = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holding = true;
      suppressClick = true;
      close();
      try { button.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      setTalking(true);
      actions.talkStart?.();
    }, HOLD_MS);
  });
  button.addEventListener("pointermove", (e) => {
    if (!holding || !origin) return;
    const far = Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > CANCEL_DISTANCE;
    if (far !== cancelled) { cancelled = far; setTalking(true, far); }
  });
  const finish = (cancel) => {
    clearTimeout(holdTimer);
    if (!holding) return;
    holding = false;
    setTalking(false);
    if (cancel || cancelled) actions.talkCancel?.(); else actions.talkEnd?.();
  };
  button.addEventListener("pointerup", () => finish(false));
  button.addEventListener("pointercancel", () => finish(true));
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (suppressClick) { suppressClick = false; return; }
    toggle();
  });

  return { open, close, toggle, isOpen: () => !menu.hidden, render };
}

// ── Sheets ───────────────────────────────────────────────────────────────────
// A full-screen sheet over the current page. Returns { dialog, body, close }.
export function openUtilitySheet({ title, className = "", onClose = () => {}, headerExtra = "" } = {}) {
  const d = document.createElement("dialog");
  d.className = `utility-sheet ${className}`.trim();
  d.innerHTML = `
    <div class="utility-sheet-inner">
      <header class="utility-sheet-head">
        <h2>${esc(title)}</h2>
        <div class="utility-sheet-actions">${headerExtra}<button type="button" class="icon-btn utility-sheet-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button></div>
      </header>
      <div class="utility-sheet-body"></div>
    </div>`;
  document.body.appendChild(d);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { onClose(); } catch { /* ignore */ }
    if (d.open) d.close();
    d.remove();
  };
  const api = { dialog: d, body: d.querySelector(".utility-sheet-body"), close };
  d.querySelector(".utility-sheet-close").addEventListener("click", () => api.close());
  d.addEventListener("cancel", (e) => { e.preventDefault(); api.close(); });
  d.showModal();
  return api;
}

// ── Scan: where should this go? ───────────────────────────────────────────────
// files: image Files; destinations: [{ id, label }]; suggested: id.
// onPick(id) runs the destination; the sheet closes first unless it returns
// "keep-open" (Document asks for a folder in the same sheet).
export function openScanDestinationSheet({ files = [], destinations = [], suggested = "receipt", onPick = () => {}, onClose = () => {} }) {
  const sheet = openUtilitySheet({ title: "Scan", className: "scan-destination-sheet", onClose });
  const urls = files.slice(0, 6).map((f) => URL.createObjectURL(f));
  const done = () => urls.forEach((u) => URL.revokeObjectURL(u));
  const prevClose = sheet.close;
  sheet.close = () => { done(); prevClose(); };
  sheet.body.innerHTML = `
    <div class="scan-dest-previews">${urls.map((u) => `<img src="${u}" alt="">`).join("")}${files.length > 6 ? `<span>+${files.length - 6}</span>` : ""}</div>
    <p class="scan-dest-question">Where should this go?</p>
    <div class="scan-dest-options">
      ${destinations.map((d) => `<button type="button" class="scan-dest-option${d.id === suggested ? " is-suggested" : ""}" data-dest="${esc(d.id)}">${esc(d.label)}${d.id === suggested ? "<small>Suggested</small>" : ""}</button>`).join("")}
    </div>
    <div class="scan-dest-step" hidden></div>`;
  sheet.body.querySelector(".scan-dest-options").addEventListener("click", async (e) => {
    const id = e.target.closest("[data-dest]")?.dataset.dest;
    if (!id) return;
    const keep = await onPick(id, sheet);
    if (keep !== "keep-open") sheet.close();
  });
  return sheet;
}
