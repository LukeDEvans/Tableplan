// wallet-ui.js — the Wallet sheet (UTILITIES_MENU_DESIGN.md §8). Loaded when first
// opened from the utilities menu.
//
// Cards and tickets with their barcode, shown full-width on white for a scanner;
// a Household wallet shared like Documents and a private Personal one (decision
// 15). IDs live in the Documents Safe behind Face ID (decision 14) — Wallet links
// there. Payment cards stay in Apple / Google Wallet, which Wallet opens.

import { openUtilitySheet } from "./utilities-ui.js";
import { normalizeCard, sortCards, CARD_COLORS, suggestFormat } from "./wallet-model.js";
import { code128Svg, qrSvg } from "./barcode.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let qrLib = null;
async function qrcodeLib() {
  qrLib ||= (await import("qrcode-generator")).default;
  return qrLib;
}

async function barcodeHtml(card) {
  if (!card.number || card.format === "none") return "";
  try {
    if (card.format === "qr") return `<div class="wallet-code is-qr">${qrSvg(card.number, await qrcodeLib())}</div>`;
    return `<div class="wallet-code">${code128Svg(card.number)}</div>`;
  } catch {
    return "";
  }
}

// deps: { libraries: [{ id, label }], defaultLibrary, cards(lib), saveCard(lib, card),
//         deleteCard(lib, id), scanCode() → { text, format } | null, walletApp: { label, open() } | null,
//         openSafe(), showToast(msg) }
export function openWallet(deps) {
  const { libraries = [], showToast = () => {} } = deps;
  let lib = deps.defaultLibrary || libraries[0]?.id;
  let raisedBrightness = false;
  const sheet = openUtilitySheet({ title: "Wallet", className: "wallet-sheet", onClose: () => { if (raisedBrightness) deps.setBright?.(false); } });

  function renderList() {
    const cards = sortCards(deps.cards(lib) || []);
    sheet.body.innerHTML = `
      ${libraries.length > 1 ? `<div class="utility-tabs" role="tablist">${libraries.map((l) => `<button type="button" class="utility-tab" role="tab" data-lib="${esc(l.id)}" aria-selected="${l.id === lib}">${esc(l.label)}</button>`).join("")}</div>` : ""}
      <div class="wallet-links">
        <button type="button" class="primary-btn" data-act="add">Add a card</button>
        ${deps.walletApp ? `<button type="button" class="secondary-btn" data-act="app">${esc(deps.walletApp.label)}</button>` : ""}
        ${deps.openSafe ? `<button type="button" class="secondary-btn" data-act="ids">IDs in the Safe</button>` : ""}
      </div>
      <div class="wallet-cards">${cards.length ? cards.map((c) => `
        <button type="button" class="wallet-card" data-card="${esc(c.id)}" style="background:${esc(c.color)}">
          <strong>${esc(c.name)}</strong>
          <span>${esc([c.kind === "ticket" ? (c.date || "Ticket") : "", c.number ? `•••• ${c.number.slice(-4)}` : ""].filter(Boolean).join(" · ") || " ")}</span>
        </button>`).join("") : `<p class="utility-empty">No cards in this wallet yet. Add a membership card, a loyalty card or a ticket.</p>`}</div>`;
  }

  async function renderCard(id) {
    const card = (deps.cards(lib) || []).find((c) => c.id === id);
    if (!card) { renderList(); return; }
    sheet.body.innerHTML = `
      <div class="wallet-show">
        <div class="wallet-card" style="background:${esc(card.color)};width:100%;cursor:default"><strong>${esc(card.name)}</strong>${card.kind === "ticket" && card.date ? `<span>${esc(card.date)}</span>` : ""}</div>
        ${await barcodeHtml(card)}
        ${card.number ? `<div class="wallet-number">${esc(card.number)}</div>` : ""}
        ${card.note ? `<p>${esc(card.note)}</p>` : ""}
        <div class="wallet-actions" style="justify-content:center">
          <button type="button" class="secondary-btn" data-act="back">Back</button>
          <button type="button" class="secondary-btn" data-act="edit" data-id="${esc(card.id)}">Edit</button>
        </div>
      </div>`;
    if (deps.setBright) { deps.setBright(true); raisedBrightness = true; }
  }

  function renderForm(id = null) {
    const card = id ? (deps.cards(lib) || []).find((c) => c.id === id) : null;
    const c = card || normalizeCard({});
    let color = c.color;
    sheet.body.innerHTML = `
      <form class="wallet-form" id="walletForm">
        <label>Name<input type="text" name="name" maxlength="80" value="${esc(card ? c.name : "")}" placeholder="Costco" required></label>
        <label>Kind<select name="kind"><option value="card"${c.kind === "card" ? " selected" : ""}>Card</option><option value="ticket"${c.kind === "ticket" ? " selected" : ""}>Ticket</option></select></label>
        <label>Number<input type="text" name="number" maxlength="300" value="${esc(c.number)}" autocomplete="off" inputmode="text"></label>
        ${deps.scanCode ? `<button type="button" class="secondary-btn" data-act="scan">Scan the barcode</button>` : ""}
        <label>Barcode<select name="format">
          <option value="code128"${c.format === "code128" ? " selected" : ""}>Barcode (Code 128)</option>
          <option value="qr"${c.format === "qr" ? " selected" : ""}>QR code</option>
          <option value="none"${c.format === "none" ? " selected" : ""}>Number only</option>
        </select></label>
        <label>Date (tickets)<input type="date" name="date" value="${esc(c.date)}"></label>
        <label>Note<input type="text" name="note" maxlength="300" value="${esc(c.note)}"></label>
        <div><span style="font-weight:700">Colour</span><div class="wallet-colors">${CARD_COLORS.map((col) => `<button type="button" class="wallet-color" data-color="${col}" style="background:${col}" aria-label="Colour ${col}" aria-pressed="${col === color}"></button>`).join("")}</div></div>
        ${libraries.length > 1 && !card ? `<label>Wallet<select name="lib">${libraries.map((l) => `<option value="${esc(l.id)}"${l.id === lib ? " selected" : ""}>${esc(l.label)}</option>`).join("")}</select></label>` : ""}
        <div class="wallet-actions">
          ${card ? `<button type="button" class="secondary-btn" data-act="delete" data-id="${esc(card.id)}">Delete</button>` : ""}
          <button type="button" class="secondary-btn" data-act="back">Cancel</button>
          <button type="submit" class="primary-btn">Save</button>
        </div>
      </form>`;
    const form = sheet.body.querySelector("#walletForm");
    form.querySelector(".wallet-colors").addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (!b) return;
      color = b.dataset.color;
      form.querySelectorAll("[data-color]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.color === color)));
    });
    // A new card's barcode follows the number as it's typed or pasted, until the
    // person picks a format themselves.
    let formatPicked = Boolean(card);
    form.format.addEventListener("change", () => { formatPicked = true; });
    form.number.addEventListener("input", () => { if (!formatPicked) form.format.value = suggestFormat(form.number.value); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const target = form.lib?.value || lib;
      const next = normalizeCard({
        ...(card || {}), name: form.name.value, kind: form.kind.value, number: form.number.value, format: form.format.value,
        date: form.date.value, note: form.note.value, color, updatedAt: new Date().toISOString(),
      });
      deps.saveCard(target, next);
      lib = target;
      showToast(card ? "Card updated" : "Card added");
      renderList();
    });
  }

  sheet.body.addEventListener("click", async (e) => {
    const libBtn = e.target.closest("[data-lib]");
    if (libBtn) { lib = libBtn.dataset.lib; renderList(); return; }
    const cardBtn = e.target.closest("[data-card]");
    if (cardBtn) { renderCard(cardBtn.dataset.card); return; }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a !== "edit" && raisedBrightness) { deps.setBright?.(false); raisedBrightness = false; }
    if (a === "add") renderForm();
    else if (a === "back") renderList();
    else if (a === "edit") { if (raisedBrightness) { deps.setBright?.(false); raisedBrightness = false; } renderForm(act.dataset.id); }
    else if (a === "app") deps.walletApp?.open();
    else if (a === "ids") { sheet.close(); deps.openSafe(); }
    else if (a === "delete") {
      if (!confirm("Delete this card?")) return;
      deps.deleteCard(lib, act.dataset.id);
      renderList();
    } else if (a === "scan") {
      const r = await deps.scanCode?.();
      if (!r?.text) return;
      const form = sheet.body.querySelector("#walletForm");
      form.number.value = r.text;
      form.format.value = r.format === "qr" || r.format === "pdf417" || r.format === "aztec" || r.format === "datamatrix" ? "qr" : suggestFormat(r.text);
    }
  });
  renderList();
  return sheet;
}
