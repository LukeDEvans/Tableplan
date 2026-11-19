// receipt-matcher.js — PURE: which bank transaction a receipt belongs to.
// No DOM, no network, no app state. Used by Finance (finance-ui.js) to show a
// receipt on its transaction, to link the two when the match is certain, and by
// Document to say whether a receipt file is matched.
//
// receipt: { id, merchant, date ("YYYY-MM-DD"), total, tip?, last4?, financeTxnId? }
// txn:     { id, amount (spend negative), posted (ISO), description, account? }
//
// What counts:
//   amount   the charge equals the total (±2¢); or equals total + the printed tip;
//            or, for a receipt with no tip printed, sits up to 30% above the total
//            (a tip written in afterwards) — that last one only with the store
//            name matching, and never certain.
//   date     the charge posts from 1 day before to 5 days after the receipt's date
//            (banks post late; a receipt's clock can be a day off).
//   store    the receipt's store and the bank's description share a word.
//   card     the receipt's last 4 digits appear in the account's name.
// "sure" = same amount, right dates, same store. Everything else that still fits
// is "likely": shown as a match, never linked on its own.
import { financeMerchantTokens } from "./finance-transactions.js";

const DAY_MS = 86400000;
const CENTS = 0.02;
export const RECEIPT_MATCH_DAYS_BEFORE = 1;
export const RECEIPT_MATCH_DAYS_AFTER = 5;
export const RECEIPT_TIP_MAX = 0.3;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dayOf = (iso) => {
  const s = String(iso || "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T12:00:00`) : Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

// Words worth comparing: 3+ letters (the bank's "sq", "tst", "pos" prefixes say nothing).
function storeWords(text) {
  return financeMerchantTokens(text).filter((w) => w.length >= 3);
}
export function receiptStoreMatches(merchant, description) {
  const a = storeWords(merchant);
  if (!a.length) return false;
  const b = storeWords(description);
  // A word matches when one starts with the other ("costco" / "costcowhse"), 4+ letters shared.
  return a.some((x) => b.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

// How well one receipt fits one transaction. → null (doesn't fit) or
// { score, confidence: "sure" | "likely", amount: "exact" | "tip" | "tip-guess", dayGap }.
export function scoreReceiptTxn(receipt, txn) {
  const total = num(receipt?.total);
  const charge = -num(txn?.amount);
  if (!(total > 0) || !(charge > 0)) return null;
  const tip = Math.max(0, num(receipt?.tip));
  const store = receiptStoreMatches(receipt?.merchant, txn?.description);

  let amount = "";
  if (Math.abs(charge - total) <= CENTS) amount = "exact";
  else if (tip > 0 && Math.abs(charge - (total + tip)) <= CENTS) amount = "tip";
  else if (!tip && store && charge > total + CENTS && charge <= total * (1 + RECEIPT_TIP_MAX) + CENTS) amount = "tip-guess";
  if (!amount) return null;

  const rDay = dayOf(receipt?.date);
  const tDay = dayOf(txn?.posted);
  let dayGap = null;
  if (rDay != null && tDay != null) {
    dayGap = Math.round((tDay - rDay) / DAY_MS);
    if (dayGap < -RECEIPT_MATCH_DAYS_BEFORE || dayGap > RECEIPT_MATCH_DAYS_AFTER) return null;
  }
  const last4 = String(receipt?.last4 || "").replace(/\D/g, "");
  const card = last4.length === 4 && String(txn?.account || "").includes(last4);

  let score = amount === "tip-guess" ? 1 : 3;
  if (store) score += 2;
  if (card) score += 1;
  if (dayGap != null) score += dayGap >= 0 && dayGap <= 3 ? 2 : 1;
  const confidence = amount !== "tip-guess" && store && dayGap != null ? "sure" : "likely";
  return { score, confidence, amount, dayGap };
}

// One receipt per transaction and one transaction per receipt.
// → Map receiptId → { txn, confidence: "linked" | "sure" | "likely", amount, dayGap }.
// A receipt already linked (financeTxnId) keeps its transaction and takes it out of
// the running. The rest are paired best fit first; a "sure" fit that ties with
// another transaction for the same receipt (two identical charges) drops to "likely".
export function matchReceipts(receipts, txns) {
  const out = new Map();
  const byId = new Map((txns || []).map((t) => [t.id, t]));
  const taken = new Set();
  const open = [];
  for (const r of receipts || []) {
    if (!r?.id) continue;
    const linked = r.financeTxnId && byId.get(r.financeTxnId);
    if (linked) { out.set(r.id, { txn: linked, confidence: "linked", amount: "exact", dayGap: null }); taken.add(linked.id); }
    else if (r.financeTxnId) taken.add(r.financeTxnId); // linked to a transaction not loaded: leave it alone
    else open.push(r);
  }
  const pairs = [];
  for (const r of open) {
    for (const t of txns || []) {
      if (!t?.id || taken.has(t.id) || !(num(t.amount) < 0)) continue;
      const fit = scoreReceiptTxn(r, t);
      if (fit) pairs.push({ r, t, ...fit });
    }
  }
  pairs.sort((a, b) => b.score - a.score || Math.abs(a.dayGap ?? 9) - Math.abs(b.dayGap ?? 9) || String(a.t.id).localeCompare(String(b.t.id)));
  const best = new Map(); // receiptId → top score, to spot ties
  const ties = new Map();
  for (const p of pairs) {
    if (!best.has(p.r.id)) { best.set(p.r.id, p.score); ties.set(p.r.id, 1); }
    else if (best.get(p.r.id) === p.score) ties.set(p.r.id, ties.get(p.r.id) + 1);
  }
  for (const p of pairs) {
    if (out.has(p.r.id) || taken.has(p.t.id)) continue;
    const tied = p.score === best.get(p.r.id) && ties.get(p.r.id) > 1;
    out.set(p.r.id, { txn: p.t, confidence: p.confidence === "sure" && tied ? "likely" : p.confidence, amount: p.amount, dayGap: p.dayGap });
    taken.add(p.t.id);
  }
  return out;
}

// What to show for a receipt, in one word. `fit` is its entry from matchReceipts.
//   reading   no store or total yet        needs-look  the read flagged a problem
//   itemized  linked and every line has a category
//   matched   linked or fits a transaction  unmatched   nothing fits yet
export function receiptStatus(receipt, fit = null) {
  if (!receipt) return "reading";
  if (receipt.needsReview) return "needs-look";
  if (!(num(receipt.total) > 0)) return "needs-look";
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  if (fit?.confidence === "linked" && items.length && items.every((i) => i.category)) return "itemized";
  return fit ? "matched" : "unmatched";
}
export const RECEIPT_STATUS_LABEL = { reading: "Reading…", "needs-look": "Needs a look", itemized: "Itemized", matched: "Matched", unmatched: "Unmatched" };

// The split a matched receipt can fill in on its own: every line has a category,
// the categories add up to the charge (±2¢), and the transaction hasn't been
// categorized by hand. → [{ label, amount }] (positive amounts), or null when any
// of that isn't true. One category → null too: that's a plain label, which the
// merchant rules already handle, not an itemization.
export function receiptAutoSplit(receipt, txn) {
  if (!receipt || !txn || txn.labelSource === "manual") return null;
  const charge = -num(txn.amount);
  const portions = Array.isArray(receipt.portions) ? receipt.portions : [];
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  if (!(charge > 0) || portions.length < 2 || !items.length) return null;
  if (items.some((i) => !i?.category) || portions.some((p) => !p?.label || !(num(p.amount) > 0))) return null;
  const sum = portions.reduce((s, p) => s + num(p.amount), 0);
  if (Math.abs(sum - charge) > CENTS) return null;
  return portions.map((p) => ({ label: String(p.label), amount: Math.round(num(p.amount) * 100) / 100 }));
}
