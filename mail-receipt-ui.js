// mail-receipt-ui.js — Mail's "Send to Finance" (Luke, 2026-11-22).
// An email picked in Mail (an emailed receipt or order confirmation) is read by
// the server (gmail.js readReceipt), shown for a check, and on Save becomes a
// receipt in the one receipts list (state.receipts, RECEIPTS.md) through Shop's
// importFinanceInboxReceipts — the same door the inbox sweep's email receipts
// use, with the same id (the Gmail message id), so one email never makes two
// receipts. A receipt for the same purchase already saved (scanned, shared,
// emailed — receipt-duplicates.js) is shown first, and saving anyway means
// "Keep both". The email's text is filed in Document › Receipts as a PDF pointing
// at the receipt (email-receipt-pdf.js), replacing the screenshot.
// Manual only: nothing is read or saved without the tap.
import { emailReceiptPdf } from "./email-receipt-pdf.js";

export function createMailReceiptModule(deps) {
  const {
    state, escapeHtml, showMailToast, callGmailApi, getLastGmailApiError,
    importFinanceInboxReceipts, queueReceiptFile, openReceiptDetail, canMarkPersonal,
    receiptDuplicateOf, keepReceiptsApart,
  } = deps;

  const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
  const shortDate = (iso) => {
    const t = Date.parse(`${iso}T12:00:00`);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  };
  // The email's Date header as YYYY-MM-DD (local), for a receipt the reader couldn't date.
  const headerDay = (header) => {
    const t = Date.parse(header || "");
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const receiptsList = () => (Array.isArray(state.receipts) ? state.receipts : []);
  const receiptIdFor = (messageId) => `receipt-email-${messageId}`;

  function sendMailToFinance(thread, lastMsg) {
    const messageId = lastMsg?.id || "";
    if (!thread || !messageId) return;
    const d = document.createElement("dialog");
    d.className = "recipe-dialog auth-dialog ingest-dialog mail-receipt-dialog";
    d.innerHTML =
      `<div class="recipe-form">` +
        `<div class="ingest-head"><h3 style="margin:0">Send to Finance</h3>` +
        `<button class="icon-btn" data-close type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>` +
        `<div data-body><div class="mail-loading">Reading this email for a receipt…</div></div>` +
      `</div>`;
    document.body.appendChild(d);
    d.showModal();
    d.querySelector("[data-close]").addEventListener("click", () => d.close());
    d.addEventListener("close", () => d.remove());
    const body = d.querySelector("[data-body]");
    const none = (message, extra = "") => {
      body.innerHTML = `<div class="ingest-none"><p>${escapeHtml(message)}</p><div class="ingest-none-actions">${extra}<button class="secondary-btn" data-done type="button">Close</button></div></div>`;
      body.querySelector("[data-done]").addEventListener("click", () => d.close());
    };

    const existing = receiptsList().find((r) => r?.id === receiptIdFor(messageId));
    if (existing) {
      none("This email's receipt is already in Finance.", `<button class="primary-btn" data-open type="button">Open receipt</button>`);
      body.querySelector("[data-open]").addEventListener("click", () => { d.close(); openReceiptDetail(existing.id); });
      return;
    }
    if (!navigator.onLine) { none("You're offline. Reading a receipt needs a connection — try again when you're back online."); return; }

    callGmailApi({ action: "readReceipt", messageId }).then((data) => {
      if (!d.isConnected) return;
      if (!data) { none(getLastGmailApiError() || "Couldn't read that email."); return; }
      if (!data.receipt) { none("No receipt or order total found in this email."); return; }
      showReview(d, body, { ...data.receipt, id: messageId }, data.meta || {}, data.text || "");
    }).catch(() => { if (d.isConnected) none("Couldn't read that email."); });
  }

  function showReview(d, body, receipt, meta, text) {
    const date = receipt.date || headerDay(meta.date);
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    // The same purchase already saved some other way (receipt-duplicates.js): ask.
    const sameOrder = receiptDuplicateOf({
      id: receiptIdFor(receipt.id), storeName: receipt.merchant, purchaseDate: date,
      total: receipt.total, orderNumber: receipt.orderNumber, createdAt: new Date().toISOString(),
    });
    const row = (label, value) => value ? `<div class="ingest-field"><span class="ingest-field-label">${escapeHtml(label)}</span><span class="ingest-field-value">${escapeHtml(value)}</span></div>` : "";
    const shown = items.slice(0, 8);
    const itemList = items.length
      ? `<ul class="mail-receipt-items">${shown.map((it) => `<li><span>${escapeHtml(it.name || "Item")}</span><span>${it.price ? money(it.price) : ""}</span></li>`).join("")}` +
        `${items.length > shown.length ? `<li class="mail-receipt-more">and ${items.length - shown.length} more</li>` : ""}</ul>`
      : "";
    body.innerHTML =
      `<div class="ingest-card">` +
        `<div class="ingest-card-head"><span class="ingest-card-icon">🧾</span><div>` +
          `<div class="ingest-card-title">${escapeHtml(receipt.merchant || "Receipt")}</div>` +
          `<div class="ingest-card-sub">${escapeHtml([shortDate(date), money(receipt.total)].filter(Boolean).join(" · "))}</div></div></div>` +
        `<div class="ingest-fields">` +
          (receipt.tax ? row("Tax", money(receipt.tax)) : "") +
          (receipt.cardLast4 ? row("Card", `ending ${receipt.cardLast4}`) : "") +
          row("Order", receipt.orderNumber || "") +
          row("Items", items.length ? String(items.length) : "") +
        `</div>` +
        itemList +
        (canMarkPersonal() ? `<label class="mail-receipt-personal"><span>Personal purchase <span class="hint">only in your Personal view</span></span><input type="checkbox" class="live-toggle" data-personal /></label>` : "") +
        (sameOrder ? `<div class="ingest-conflict-banner"><div class="ingest-conflict-head">Looks like a receipt you already have</div>` +
          `${escapeHtml([sameOrder.storeName, shortDate(sameOrder.purchaseDate), money(sameOrder.total)].filter(Boolean).join(" · "))}. ` +
          `Keep both only if this was a separate charge (a split shipment, or the same thing bought twice).</div>` : "") +
        `<p class="ingest-intro mail-receipt-note">The email is kept in Document › Receipts as a PDF.</p>` +
        `<div class="ingest-actions">` +
          (sameOrder
            ? `<button class="primary-btn compact-btn" data-open-same type="button">Open saved receipt</button><button class="secondary-btn compact-btn" data-save type="button">Keep both</button>`
            : `<button class="primary-btn compact-btn" data-save type="button">Save receipt</button>`) +
          `<button class="secondary-btn compact-btn" data-cancel type="button">Cancel</button>` +
        `</div>` +
      `</div>`;
    body.querySelector("[data-cancel]").addEventListener("click", () => d.close());
    body.querySelector("[data-open-same]")?.addEventListener("click", () => { d.close(); openReceiptDetail(sameOrder.id); });
    body.querySelector("[data-save]").addEventListener("click", () => {
      const personal = Boolean(body.querySelector("[data-personal]")?.checked);
      const saved = saveReceipt({ ...receipt, date, view: personal ? "personal" : "", ...(sameOrder ? { notDuplicateOf: [sameOrder.id] } : {}) }, meta, text);
      if (saved && sameOrder) { try { keepReceiptsApart(saved, sameOrder.id); } catch { /* the receipt is saved either way */ } }
      d.close();
      if (saved) showMailToast(personal ? "Receipt saved to Finance (Personal)." : "Receipt saved to Finance.", () => openReceiptDetail(saved), { actionLabel: "Open", durationMs: 5000 });
      else showMailToast("Couldn't save that receipt — it may have been deleted before.");
    });
  }

  // → the receipt's id, or "" when it wasn't added (deleted earlier: tombstoned).
  function saveReceipt(receipt, meta, text) {
    importFinanceInboxReceipts([{ ...receipt, source: "email" }], { quiet: true }); // this sheet already asked about duplicates
    const id = receiptIdFor(receipt.id);
    if (!receiptsList().some((r) => r?.id === id)) return "";
    try {
      const pdf = emailReceiptPdf({ subject: meta.subject, from: meta.from, date: meta.date, text });
      const file = new File([pdf], "receipt.pdf", { type: "application/pdf" });
      Promise.resolve(queueReceiptFile?.([file], { receiptId: id })).catch(() => {});
    } catch { /* best-effort: the receipt stands on its own */ }
    return id;
  }

  return { sendMailToFinance };
}
