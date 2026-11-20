// calculator-ui.js — the Calculator sheet (UTILITIES_MENU_DESIGN.md §6). Loaded
// when first opened from the utilities menu. The engine is calculator.js (pure).
//
// Looks and works like the iPhone's Calculator (Luke, 2026-11-20): black screen,
// round keys (grey numbers, lighter grey functions, orange operators), the whole
// expression in the big line as you type and the result after "=", the expression
// moving to the small grey line above. ⌫ replaces AC while there's something to
// delete. The list button (top left) opens the history; the calculator button
// (bottom left) switches Basic / Scientific. History is kept on this device only.

import { openUtilitySheet } from "./utilities-ui.js";
import { createCalculator, press } from "./calculator.js";

const TAPE_KEY = "live-calculator-tape-v1";
const MODE_KEY = "live-calculator-mode-v1";
// [key, kind, label]
const BASIC = [
  ["C", "fn"], ["±", "fn", "+/−"], ["%", "fn"], ["/", "op", "÷"],
  ["7"], ["8"], ["9"], ["*", "op", "×"],
  ["4"], ["5"], ["6"], ["-", "op", "−"],
  ["1"], ["2"], ["3"], ["+", "op", "+"],
  ["mode", "mode"], ["0"], ["."], ["=", "op", "="],
];
const SCIENTIFIC = [
  ["(", "sci"], [")", "sci"], ["x²", "sci"], ["x³", "sci"],
  ["√", "sci", "√x"], ["1/x", "sci"], ["π", "sci"], ["e", "sci"],
];
const KEYBOARD = { Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", Delete: "C", x: "*", X: "*" };
const OP_ARIA = { "/": "Divide", "*": "Multiply", "-": "Subtract", "+": "Add", "=": "Equals", "±": "Change sign", "%": "Percent", "√": "Square root", "1/x": "Reciprocal", "x²": "Squared", "x³": "Cubed" };

const ICON_LIST = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none"/></svg>`;
const ICON_CALC = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7"/><circle cx="9" cy="12" r=".6" fill="currentColor"/><circle cx="12" cy="12" r=".6" fill="currentColor"/><circle cx="15" cy="12" r=".6" fill="currentColor"/><circle cx="9" cy="16" r=".6" fill="currentColor"/><circle cx="12" cy="16" r=".6" fill="currentColor"/><circle cx="15" cy="16" r=".6" fill="currentColor"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICON_BACKSPACE = `<svg viewBox="0 0 28 24" width="30" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M9 4h15a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-7-8z"/><path d="m13 9 6 6m0-6-6 6"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const load = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? f; } catch { return f; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

let calc = null;

function keyHtml([k, kind = "", label]) {
  if (kind === "mode") return `<button type="button" class="calc-key is-num is-mode" data-key="mode" aria-label="Basic or Scientific" aria-haspopup="menu">${ICON_CALC}</button>`;
  const cls = kind === "op" ? "is-op" : kind === "fn" ? "is-fn" : kind === "sci" ? "is-sci" : "is-num";
  const text = label || k;
  return `<button type="button" class="calc-key ${cls}" data-key="${esc(k)}" aria-label="${esc(OP_ARIA[k] || text)}">${esc(text)}</button>`;
}

export function openCalculator() {
  calc ||= { ...createCalculator(), history: load(TAPE_KEY, []).slice(0, 50) };
  let scientific = load(MODE_KEY, "basic") === "scientific";
  let onKey = null;
  let ro = null;
  const sheet = openUtilitySheet({
    title: "Calculator",
    className: "calculator-sheet",
    onClose: () => { document.removeEventListener("keydown", onKey); ro?.disconnect(); },
  });
  sheet.body.innerHTML = `
    <div class="calc">
      <div class="calc-top">
        <button type="button" class="calc-icon-btn" data-act="history" aria-label="History">${ICON_LIST}</button>
        <button type="button" class="calc-icon-btn calc-close" data-act="close" aria-label="Close">${ICON_CLOSE}</button>
      </div>
      <div class="calc-screen">
        <div class="calc-expr" aria-live="polite"></div>
        <div class="calc-display" aria-live="polite"><span></span></div>
      </div>
      <div class="calc-sci" ${scientific ? "" : "hidden"}>${SCIENTIFIC.map(keyHtml).join("")}</div>
      <div class="calc-keys">${BASIC.map(keyHtml).join("")}</div>
      <div class="calc-mode-menu" role="menu" hidden>
        <button type="button" role="menuitemradio" data-mode="basic"><span class="calc-check">${ICON_CHECK}</span>Basic</button>
        <button type="button" role="menuitemradio" data-mode="scientific"><span class="calc-check">${ICON_CHECK}</span>Scientific</button>
      </div>
      <div class="calc-history" hidden>
        <div class="calc-history-head">
          <button type="button" class="calc-text-btn" data-act="clear-history">Clear</button>
          <strong>History</strong>
          <button type="button" class="calc-text-btn is-bold" data-act="history-done">Done</button>
        </div>
        <div class="calc-history-list"></div>
      </div>
    </div>`;
  const root = sheet.body.querySelector(".calc");
  const exprEl = root.querySelector(".calc-expr");
  const dispWrap = root.querySelector(".calc-display");
  const dispEl = dispWrap.querySelector("span");
  const clearKey = root.querySelector('[data-key="C"]');
  const sciEl = root.querySelector(".calc-sci");
  const modeMenu = root.querySelector(".calc-mode-menu");
  const historyEl = root.querySelector(".calc-history");
  const historyList = root.querySelector(".calc-history-list");

  // The big line shrinks to fit, then wraps (like the iPhone's long expressions).
  function fit() {
    const max = Math.min(96, Math.max(56, dispWrap.clientWidth / 4.2));
    let size = max;
    dispEl.style.whiteSpace = "nowrap";
    dispEl.style.fontSize = `${size}px`;
    while (size > 40 && dispEl.scrollWidth > dispWrap.clientWidth) {
      size -= 2;
      dispEl.style.fontSize = `${size}px`;
    }
    if (dispEl.scrollWidth > dispWrap.clientWidth) dispEl.style.whiteSpace = "normal";
  }

  function render() {
    const typing = Boolean(calc.expr) && !calc.justEvaluated;
    dispEl.textContent = calc.display;
    exprEl.textContent = calc.shown || "";
    // ⌫ while there's something to delete, AC otherwise.
    clearKey.innerHTML = typing ? ICON_BACKSPACE : "AC";
    clearKey.dataset.key = typing ? "⌫" : "C";
    clearKey.setAttribute("aria-label", typing ? "Delete" : "All clear");
    sciEl.hidden = !scientific;
    root.classList.toggle("is-scientific", scientific);
    modeMenu.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.mode === "scientific") === scientific)));
    fit();
  }

  function renderHistory() {
    historyList.innerHTML = calc.history.length
      ? calc.history.map((h, i) => `<button type="button" class="calc-history-row" data-tape="${i}"><span>${esc(h.expr)}</span><strong>${esc(h.result)}</strong></button>`).join("")
      : `<p class="calc-history-empty">No history</p>`;
  }

  function key(k) {
    const before = calc.history;
    calc = press(calc, k);
    if (calc.history !== before) save(TAPE_KEY, calc.history);
    render();
  }

  root.addEventListener("click", (e) => {
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) {
      scientific = modeBtn.dataset.mode === "scientific";
      save(MODE_KEY, scientific ? "scientific" : "basic");
      modeMenu.hidden = true;
      render();
      return;
    }
    if (!modeMenu.hidden && !e.target.closest(".calc-mode-menu")) { modeMenu.hidden = true; if (e.target.closest('[data-key="mode"]')) return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") { sheet.close(); return; }
    if (act === "history") { renderHistory(); historyEl.hidden = false; return; }
    if (act === "history-done") { historyEl.hidden = true; return; }
    if (act === "clear-history") { calc = { ...calc, history: [] }; save(TAPE_KEY, []); renderHistory(); return; }
    const row = e.target.closest("[data-tape]");
    if (row) {
      // A past calculation's result comes back into the calculator.
      const h = calc.history[Number(row.dataset.tape)];
      if (!h) return;
      calc = { ...createCalculator(), history: calc.history };
      for (const ch of h.result.replace(/,/g, "")) calc = press(calc, ch === "-" ? "-" : ch);
      historyEl.hidden = true;
      render();
      return;
    }
    const k = e.target.closest("[data-key]")?.dataset.key;
    if (!k) return;
    if (k === "mode") {
      const btn = root.querySelector('[data-key="mode"]');
      const r = btn.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      modeMenu.style.bottom = `${box.bottom - r.top + 8}px`;
      modeMenu.hidden = false;
      return;
    }
    key(k);
  });

  onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!historyEl.hidden) { if (e.key === "Escape") { e.preventDefault(); historyEl.hidden = true; } return; }
    // Esc clears; with nothing left to clear it falls through and closes the sheet.
    if (e.key === "Escape" && !calc.expr && calc.display === "0") return;
    const k = KEYBOARD[e.key] || e.key;
    if (/^[0-9.+\-*/%()=]$/.test(k) || k === "⌫" || k === "C") { e.preventDefault(); key(k); }
  };
  document.addEventListener("keydown", onKey);
  ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  ro?.observe(dispWrap);
  render();
  return sheet;
}
