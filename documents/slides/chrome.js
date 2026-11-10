// Small pieces of the slides screen: popover menus, the colour picker (theme colours
// first, as Google Slides), and number fields.

import { ROLES, ROLE_LABELS } from "./themes.js";
import { safeColor } from "../editor/extensions.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const STANDARD = ["#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
  "#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"];

let open = null;
export function closePopover() { open?.close(); open = null; }

// A popover under (or above) an anchor. content: html; onClick(button, event) → true to close.
export function popover(host, anchor, html, { onClick = null, className = "", init = null, onClose = null } = {}) {
  closePopover();
  const el = document.createElement("div");
  el.className = `sl-pop ${className}`;
  el.setAttribute("role", "menu");
  el.innerHTML = html;
  host.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let left = Math.min(r.left - hr.left, hr.width - pw - 8);
  left = Math.max(8, left);
  let top = r.bottom - hr.top + 4;
  if (top + ph > hr.height - 8 && r.top - hr.top - ph - 4 > 8) top = r.top - hr.top - ph - 4;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, Math.min(top, hr.height - ph - 8))}px`;
  const off = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); closePopover(); } };
  setTimeout(() => { document.addEventListener("pointerdown", off, true); document.addEventListener("keydown", key, true); }, 0);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button, [data-pick]");
    if (b && onClick?.(b, e) !== false) { if (!b.dataset.keep) closePopover(); }
  });
  init?.(el);
  open = { el, close() { el.remove(); document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", key, true); onClose?.(); } };
  return el;
}

// The colour picker: theme colours (stored as roles so a theme change recolours), the
// standard grid, a custom colour, and None where it makes sense.
export function colorPicker(host, anchor, { theme, current = null, allowNone = true, roles = true, onPick }) {
  const sw = (val, hex, label) => `<button type="button" class="sl-swatch${current === val ? " is-on" : ""}" data-color="${esc(val)}" title="${esc(label)}" aria-label="${esc(label)}" style="background:${hex}"></button>`;
  const html = `
    ${allowNone ? `<button type="button" class="sl-pop-item" data-color="none">None</button>` : ""}
    ${roles ? `<div class="sl-pop-label">Theme</div><div class="sl-swatches">${ROLES.map((r) => sw(`@${r}`, theme.colors[r], ROLE_LABELS[r])).join("")}</div>` : ""}
    <div class="sl-pop-label">Standard</div>
    <div class="sl-swatches">${STANDARD.map((c) => sw(c, c, c)).join("")}</div>
    <label class="sl-pop-custom">Custom <input type="color" value="${esc(safeColor(current) || "#1a73e8")}" data-custom></label>`;
  return popover(host, anchor, html, {
    className: "sl-colors",
    onClick: (b) => { if (b.dataset.color) { onPick(b.dataset.color === "none" ? null : b.dataset.color); return true; } return false; },
    init: (el) => el.querySelector("[data-custom]").addEventListener("change", (e) => { onPick(safeColor(e.target.value)); closePopover(); }),
  });
}

// A menu from [{ label, act, on?, disabled?, sep?, sub? , keys? }].
export function menuHtml(items) {
  return items.map((it) => {
    if (it.sep) return `<div class="sl-pop-sep" role="separator"></div>`;
    if (it.head) return `<div class="sl-pop-label">${esc(it.head)}</div>`;
    return `<button type="button" class="sl-pop-item${it.on ? " is-on" : ""}" role="menuitem" data-act="${esc(it.act)}"${it.arg !== undefined ? ` data-arg="${esc(it.arg)}"` : ""}${it.disabled ? " disabled" : ""}>${it.icon || ""}<span>${esc(it.label)}</span>${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : ""}</button>`;
  }).join("");
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
export const mod = (e) => (isMac() ? e.metaKey : e.ctrlKey);
export const keyLabel = (s) => (isMac() ? s.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥") : s);
