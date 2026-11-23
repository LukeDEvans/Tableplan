// Nightly receipt linking (FINANCE_JOURNEY_AUDIT.md R1, Luke 2026-11-23): a receipt
// that surely fits a bank charge is linked even when nobody opens Finance. Until
// now linking only ran on a device with Finance loaded, so receipts that arrived by
// email waited for weeks.
//
// Same rules as the app (receipt-matcher.js): only a "sure" fit is linked (same
// amount, store name in the bank text, right dates, no twin charge); "likely" fits
// still wait for a tap. The link is written to fin_receipts.data.financeTxnId; the
// app's receipts sync reads it (table wins on pull). Categories and splits are
// left to the app (it itemizes a linked receipt the next time Finance opens).
//
// Runtime-neutral (fetch only): runs inside the finance-nightly Edge Function.
// Reports counts only — no ids, names or amounts.

import { matchReceipts } from "../../receipt-matcher.js";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const WINDOW_DAYS = 120; // receipts and charges this recent are considered
const SCOPE_RE = /^[A-Za-z0-9_-]{1,80}$/;

// fin_receipts.data → the shape receipt-matcher reads (as receiptForFinance builds it).
export function receiptForMatching(row) {
  const d = row?.data || {};
  return {
    id: row?.id,
    merchant: d.storeName || "",
    date: d.purchaseDate || "",
    total: Number(d.total) || 0,
    tip: Number(d.tip) || 0,
    source: d.source || "",
    last4: d.paymentLast4 || "",
    financeTxnId: d.financeTxnId || "",
  };
}

// → the receipt ids to link and the transaction each gets: [{ id, txnId }].
export function receiptsToLink(rows, txns) {
  const list = (rows || []).filter((r) => r?.id && !r.deleted_at).map(receiptForMatching);
  const fits = matchReceipts(list, txns);
  const out = [];
  for (const r of list) {
    const fit = fits.get(r.id);
    if (!r.financeTxnId && fit?.confidence === "sure") out.push({ id: r.id, txnId: fit.txn.id });
  }
  return out;
}

// One scope: the household's group id or a person's "u-<uid>".
export async function linkReceiptsForScope({ serviceKey, scope, now = Date.now() }) {
  if (!SCOPE_RE.test(String(scope || ""))) return { scope: "skipped", linked: 0 };
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json" };
  const since = new Date(now - WINDOW_DAYS * 86400000).toISOString();
  const enc = encodeURIComponent;
  const rRes = await fetch(`${SUPABASE_URL}/rest/v1/fin_receipts?scope=eq.${enc(scope)}&deleted_at=is.null&select=id,data,deleted_at&limit=1000`, { headers });
  if (!rRes.ok) throw new Error(`receipts ${rRes.status}`);
  const rows = (await rRes.json()) || [];
  const recent = rows.filter((r) => {
    const day = String(r?.data?.purchaseDate || "");
    return r?.data?.financeTxnId || !day || day >= since.slice(0, 10);
  });
  if (!recent.some((r) => !r?.data?.financeTxnId)) return { linked: 0, open: 0 };
  const tRes = await fetch(`${SUPABASE_URL}/rest/v1/finance_transactions?group_id=eq.${enc(scope)}&superseded_by=is.null&amount=lt.0&posted=gte.${enc(since)}&select=id,amount,description,posted,account_id&limit=5000`, { headers });
  if (!tRes.ok) throw new Error(`transactions ${tRes.status}`);
  const txns = ((await tRes.json()) || []).map((t) => ({ id: t.id, amount: Number(t.amount) || 0, description: t.description || "", posted: t.posted, account: t.account_id || "" }));
  const toLink = receiptsToLink(recent, txns);
  let linked = 0;
  for (const { id, txnId } of toLink) {
    const row = recent.find((r) => r.id === id);
    const data = { ...(row?.data || {}), financeTxnId: txnId };
    // Only if it's still unlinked: a device that linked it meanwhile wins.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fin_receipts?id=eq.${enc(id)}&scope=eq.${enc(scope)}&or=(data->>financeTxnId.is.null,data->>financeTxnId.eq.)`, {
      method: "PATCH",
      headers: { ...headers, prefer: "return=minimal" },
      body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
    });
    if (res.ok) linked += 1;
    else console.error(`[receipt-link] save ${res.status}`);
  }
  return { linked, open: recent.filter((r) => !r?.data?.financeTxnId).length };
}
