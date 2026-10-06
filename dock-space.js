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
