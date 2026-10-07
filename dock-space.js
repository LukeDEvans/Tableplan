// The bottom dock (#bottomDock — mini-player, weather, …) is a permanent bar along
// the bottom of the app, so the room a window has to open in ends at the dock's top
// edge, not at the bottom of the screen. Anything that positions or clamps itself
// against the screen height (context menus, popovers, drag auto-scroll, fixed
// panels) measures against this instead of window.innerHeight.
//
// CSS has the same number as var(--dock-h) (styles.css, "Bottom dock" section).

// Y of the lowest pixel a window may use: the dock's top edge while the dock is
// showing, else the bottom of the screen (signed out, or no dock in this document).
export function usableViewportBottom() {
  const screenBottom = window.innerHeight;
  const dock = typeof document !== "undefined" ? document.getElementById("bottomDock") : null;
  if (!dock) return screenBottom;
  const rect = dock.getBoundingClientRect();
  if (!rect.height) return screenBottom; // display:none (signed out)
  return Math.min(screenBottom, Math.max(0, Math.round(rect.top)));
}

// Height of the strip the dock takes off the bottom of the screen (0 when hidden).
export function dockInset() {
  return window.innerHeight - usableViewportBottom();
}

// The box a notifications window opens in — the same box on every page, so every
// bell's window is the same size: inside the page window (.workspace), under the
// row the bell sits in, down to the page window's bottom edge (which already
// stops above the dock). Returned as viewport offsets for a position:fixed box.
// Meal Plan's window anchors to its own bell and lands on this same box.
const NOTIF_WINDOW_INSET = 12;      // the page window's own padding
const NOTIF_WINDOW_HEADER_ROW = 48; // the bell's row + the gap under it
export function notificationsWindowBox() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const r = document.querySelector(".workspace")?.getBoundingClientRect();
  if (!r || !r.height) {
    return { top: 120, left: 14, right: 14, bottom: dockInset() + 10 };
  }
  const bottom = Math.max(dockInset(), Math.round(vh - r.bottom));
  const top = Math.round(r.top + NOTIF_WINDOW_INSET + NOTIF_WINDOW_HEADER_ROW);
  return {
    top: Math.max(0, Math.min(top, vh - bottom - 240)), // never squeezed below a usable height
    left: Math.round(r.left + NOTIF_WINDOW_INSET),
    right: Math.round(vw - r.right + NOTIF_WINDOW_INSET),
    bottom,
  };
}
