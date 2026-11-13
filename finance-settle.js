// finance-settle.js — PURE: what each person owes the household for personal
// items on household-paid receipts (Luke, 2026-11-12: a Personal purchase is
// private, unless a household account paid for it; then the person's own money
// pays the household back for those items).
//
// A receipt line marked { owedBy: <user id> } is that person's, paid by the
// household. Settlements are { id, by, amount, at } — "paid back" records.
// Balance = owed lines − settlements, per person, never below zero.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(n * 100) / 100;

// receipts: as Finance sees them (receiptForFinance: items with { name, price, owedBy }).
// → Map userId → { owed, paid, balance, items: [{ receiptId, merchant, date, name, price }] }
export function financeOwedBalances(receipts, settlements = []) {
  const out = new Map();
  const get = (by) => {
    if (!out.has(by)) out.set(by, { owed: 0, paid: 0, balance: 0, items: [] });
    return out.get(by);
  };
  for (const r of receipts || []) {
    if (r?.view === "personal") continue; // paid personally: nothing owed
    for (const it of r?.items || []) {
      const by = String(it?.owedBy || "");
      const price = num(it?.price);
      if (!by || !(price > 0)) continue;
      const p = get(by);
      p.owed += price;
      p.items.push({ receiptId: r.id, merchant: r.merchant || "", date: r.date || "", name: it.name || "", price: round(price) });
    }
  }
  for (const s of settlements || []) {
    const by = String(s?.by || "");
    if (!by || !(num(s?.amount) > 0) || s?.deleted) continue;
    get(by).paid += num(s.amount);
  }
  for (const p of out.values()) {
    p.owed = round(p.owed);
    p.paid = round(p.paid);
    p.balance = round(Math.max(0, p.owed - p.paid));
    p.items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return out;
}
