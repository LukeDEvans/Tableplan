// receipt-duplicates.js — PURE: receipts that are the same purchase saved twice
// (Luke, 2026-11-22). A paper receipt scanned twice, an email caught by the inbox
// and also sent by hand from another email, an order shared from the iPhone and
// also emailed. No DOM, no network, no app state.
//
// Works on a receipt record (receipt-domain.js normalizeReceipt: storeName,
// purchaseDate) or Finance's view of one (receiptForFinance: merchant, date).
//
// Two receipts are the same purchase when
//   order   both print the same store order number (4+ characters, ignoring case,
//           spaces, dashes and a leading "#"), or
//   match   the totals agree (±2¢), the dates are at most 2 days apart and the
//           store names start with the same word ("Target" / "TARGET T-1234",
//           "Costco Wholesale" / "COSTCO WHSE"; not "Lunds Market" / "Whole Foods Market").
// Never when someone tapped "Keep both" for that pair (notDuplicateOf on either),
// or when each is already linked to a different bank charge (two real purchases).
//
// The app always asks (Luke, 2026-11-22): nothing here deletes or merges on its own.
import { financeMerchantTokens } from "./finance-transactions.js";

export const DUPLICATE_DAYS = 2;
const CENTS = 0.02;
const DAY_MS = 86400000;

const text = (v) => String(v ?? "").trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const store = (r) => text(r?.storeName ?? r?.merchant);
const day = (r) => {
  const s = text(r?.purchaseDate ?? r?.date);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T12:00:00`) : NaN;
  return Number.isFinite(t) ? t : null;
};
export const orderKey = (v) => text(v).toLowerCase().replace(/^#/, "").replace(/[\s-]/g, "");
const keptApart = (a, b) =>
  (Array.isArray(a?.notDuplicateOf) && a.notDuplicateOf.includes(b.id)) ||
  (Array.isArray(b?.notDuplicateOf) && b.notDuplicateOf.includes(a.id));

// → "order" | "match" | "" (not the same purchase).
export function sameReceipt(a, b) {
  if (!a?.id || !b?.id || a.id === b.id) return "";
  if (keptApart(a, b)) return "";
  if (a.financeTxnId && b.financeTxnId && a.financeTxnId !== b.financeTxnId) return "";
  const oa = orderKey(a.orderNumber), ob = orderKey(b.orderNumber);
  if (oa.length >= 4 && oa === ob) return "order";
  const ta = num(a.total), tb = num(b.total);
  if (!(ta > 0) || !(tb > 0) || Math.abs(ta - tb) > CENTS) return "";
  const da = day(a), db = day(b);
  if (da == null || db == null || Math.abs(da - db) > DUPLICATE_DAYS * DAY_MS + 1) return "";
  return sameStore(store(a), store(b)) ? "match" : "";
}

// The store's first real word (digits, "#", "the" and 1–2 letter bits skipped).
const brand = (name) => financeMerchantTokens(name).find((t) => t.length >= 3 && t !== "the") || "";
function sameStore(a, b) {
  const x = brand(a), y = brand(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
}

// The receipt in `list` that `receipt` duplicates, or null. An order-number match
// wins over a store/total/date match; then the one saved first.
export function findDuplicate(list, receipt) {
  let best = null, bestWhy = "";
  for (const other of Array.isArray(list) ? list : []) {
    const why = sameReceipt(receipt, other);
    if (!why) continue;
    const better = !best
      || (why === "order" && bestWhy !== "order")
      || (why === bestWhy && text(other.createdAt) < text(best.createdAt));
    if (better) { best = other; bestWhy = why; }
  }
  return best;
}

// Every receipt that has a twin in the list → that twin's id.
// For a "Possible duplicate" label on both of them.
export function duplicateMap(list) {
  const items = (Array.isArray(list) ? list : []).filter((r) => r?.id);
  const out = new Map();
  for (const r of items) {
    const twin = findDuplicate(items, r);
    if (twin) out.set(r.id, twin.id);
  }
  return out;
}

// Which of two duplicates keeps its id when merged: the one linked to a bank
// charge, else the one with a file in Document, else the one saved first.
// hasFile(id) → boolean (optional).
export function mergeKeeper(a, b, hasFile = () => false) {
  const score = (r) => (r.financeTxnId ? 4 : 0) + (hasFile(r.id) ? 2 : 0);
  const sa = score(a), sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return text(b.createdAt) && text(b.createdAt) < text(a.createdAt) ? b : a;
}

// Two receipt records → one. The lines, store and amounts come from whichever was
// read in more detail (more priced lines; a hand-corrected one wins a tie); the
// id and date added from `keep`; anything one has and the other lacks is kept
// (charge link, card, tip, tax, order number, return and warranty dates).
// Personal wins over household: marking a receipt Personal is always on purpose.
export function mergeReceipts(keep, other) {
  const priced = (r) => (Array.isArray(r?.lineItems) ? r.lineItems : []).filter((l) => num(l?.totalPrice) > 0).length;
  const corrected = (r) => (Array.isArray(r?.lineItems) ? r.lineItems : []).some((l) => l?.userCorrected);
  const pk = priced(keep), po = priced(other);
  const richer = po > pk || (po === pk && corrected(other) && !corrected(keep)) ? other : keep;
  const poorer = richer === keep ? other : keep;
  const pick = (k) => (text(richer[k]) ? richer[k] : poorer[k]);
  const pickNum = (k) => (num(richer[k]) ? richer[k] : poorer[k]);
  const apart = new Set([...(keep.notDuplicateOf || []), ...(other.notDuplicateOf || [])]);
  apart.delete(keep.id); apart.delete(other.id);
  return {
    ...richer,
    id: keep.id,
    createdAt: [keep.createdAt, other.createdAt].map(text).filter(Boolean).sort()[0] || keep.createdAt,
    storeName: pick("storeName"),
    storeId: pick("storeId"),
    purchaseDate: pick("purchaseDate"),
    subtotal: pickNum("subtotal"),
    tax: pickNum("tax"),
    fees: pickNum("fees"),
    discounts: pickNum("discounts"),
    total: pickNum("total"),
    tip: pickNum("tip"),
    paymentLast4: pick("paymentLast4"),
    orderNumber: pick("orderNumber"),
    returnBy: pick("returnBy"),
    warrantyUntil: pick("warrantyUntil"),
    pantryAddedAt: pick("pantryAddedAt"),
    externalId: pick("externalId"),
    scannedBy: pick("scannedBy"),
    financeTxnId: text(keep.financeTxnId) || text(other.financeTxnId),
    view: keep.view === "personal" || other.view === "personal" ? "personal" : "",
    // Old-style scan photos are stored under their own receipt's id, so only the
    // kept receipt's still open; the receipt's file in Document is the copy that counts.
    imageRefs: keep.imageRefs || [],
    notDuplicateOf: [...apart],
    lineItems: (richer.lineItems || []).map((l) => ({ ...l, receiptId: keep.id })),
  };
}

// "Keep both": each remembers the other, so the pair is never asked about again.
export function keepBoth(a, b) {
  const add = (r, id) => ({ ...r, notDuplicateOf: [...new Set([...(r.notDuplicateOf || []), id])].slice(-20) });
  return [add(a, b.id), add(b, a.id)];
}

// Document after a merge: each file of the dropped receipt either points at the
// kept receipt ("relink") or, when the kept one already has a file, goes to
// Recently deleted ("trash"). files: Document rows with source.receiptId.
// → [{ id, action }].
export function mergedReceiptFileActions(files, keptId, droppedId) {
  const list = Array.isArray(files) ? files : [];
  const keptHasFile = list.some((f) => f?.source?.receiptId === keptId);
  return list.filter((f) => f?.id && f?.source?.receiptId === droppedId)
    .map((f) => ({ id: f.id, action: keptHasFile ? "trash" : "relink" }));
}
