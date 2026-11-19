// calculator-ui.js — the Calculator sheet (UTILITIES_MENU_DESIGN.md §6). Loaded
// when first opened from the utilities menu. The engine is calculator.js (pure);
// the tape (history) is kept on this device only.

import { openUtilitySheet } from "./utilities-ui.js";
import { createCalculator, press, displayFor } from "./calculator.js";

const TAPE_KEY = "live-calculator-tape-v1";
const KEYS = [
  ["C", "fn"], ["±", "fn"], ["%", "fn"], ["/", "op", "÷"],
  ["7"], ["8"], ["9"], ["*", "op", "×"],
  ["4"], ["5"], ["6"], ["-", "op", "−"],
  ["1"], ["2"], ["3"], ["+", "op", "+"],
  ["0", "wide"], ["."], ["=", "op", "="],
];
const KEYBOARD = { Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", Delete: "C", x: "*", X: "*" };

let calc = null;

function loadTape() {
  try { const t = JSON.parse(localStorage.getItem(TAPE_KEY) || "[]"); return Array.isArray(t) ? t.slice(0, 50) : []; } catch { return []; }
}
function saveTape(t) {
  try { localStorage.setItem(TAPE_KEY, JSON.stringify(t.slice(0, 50))); } catch { /* ignore */ }
}

export function openCalculator() {
  calc ||= { ...createCalculator(), history: loadTape() };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let onKey = null;
  const sheet = openUtilitySheet({
    title: "Calculator",
    className: "calculator-sheet",
    onClose: () => document.removeEventListener("keydown", onKey),
  });
  sheet.body.innerHTML = `
    <div class="calc">
      <div class="calc-expr" aria-live="polite"></div>
      <div class="calc-display" aria-live="polite"></div>
      <div class="calc-keys">${KEYS.map(([k, kind = "", label]) => `<button type="button" class="calc-key${kind === "op" ? " is-op" : kind === "fn" ? " is-fn" : kind === "wide" ? " is-wide" : ""}" data-key="${esc(k)}" aria-label="${esc(label || k)}">${esc(label || (k === "C" ? "AC" : k))}</button>`).join("")}</div>
      <div class="calc-tape" aria-label="History"></div>
    </div>`;
  const exprEl = sheet.body.querySelector(".calc-expr");
  const dispEl = sheet.body.querySelector(".calc-display");
  const tapeEl = sheet.body.querySelector(".calc-tape");
  const clearKey = sheet.body.querySelector('[data-key="C"]');

  function render() {
    dispEl.textContent = calc.display;
    exprEl.textContent = calc.justEvaluated ? "" : (calc.expr && displayFor(calc.expr) !== calc.display ? displayFor(calc.expr) : "");
    clearKey.textContent = calc.expr && !calc.justEvaluated ? "C" : "AC";
    tapeEl.innerHTML = calc.history.length
      ? calc.history.slice(0, 20).map((h, i) => `<div class="calc-tape-row" data-tape="${i}"><span>${esc(h.expr)}</span><strong>${esc(h.result)}</strong></div>`).join("")
      : "";
  }
  function key(k) {
    const before = calc.history;
    calc = press(calc, k);
    if (calc.history !== before) saveTape(calc.history);
    render();
  }
  sheet.body.querySelector(".calc-keys").addEventListener("click", (e) => {
    const k = e.target.closest("[data-key]")?.dataset.key;
    if (k) key(k);
  });
  // A tap on a history line puts its result back in.
  tapeEl.addEventListener("click", (e) => {
    const i = Number(e.target.closest("[data-tape]")?.dataset.tape);
    const h = calc.history[i];
    if (!h) return;
    calc = { ...createCalculator(), history: calc.history };
    for (const ch of h.result.replace(/,/g, "")) calc = press(calc, ch === "-" ? "-" : ch);
    render();
  });
  onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Esc clears; with nothing left to clear it falls through and closes the sheet.
    if (e.key === "Escape" && !calc.expr && calc.display === "0") return;
    const k = KEYBOARD[e.key] || e.key;
    if (/^[0-9.+\-*/%()=]$/.test(k) || k === "⌫" || k === "C") { e.preventDefault(); key(k); }
  };
  document.addEventListener("keydown", onKey);
  render();
  return sheet;
}
