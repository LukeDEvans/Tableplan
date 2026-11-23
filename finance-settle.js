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

// ── Both directions, netted (Luke, 2026-11-23) ──────────────────────────────
// Decisions: an item can belong to the Household, Luke or Marijane; a personal
// item paid with household money leaves the household budget and goes on that
// person's balance; household things paid with a person's own money go the other
// way; the two net into one balance per person; settling up is suggested from a
// matching transfer and confirmed with a tap.
//
// Where amounts come from:
//   txns         household transactions with portions (label "owe:<uid>", or a
//                split with "owe:<uid>" portions): the person owes that amount
//                (tax included, as the split shares it)
//   receipts     receipt lines marked { owedBy } on receipts whose charge isn't
//                already counted above (not linked yet, or linked before a split)
//   manual       household manual transactions with { paidBy: <uid> }: the
//                household owes the person
//   settlements  { by, amount, at, txnId? }: amount > 0 the person paid the
//                household; amount < 0 the household paid the person
// → Map uid → { owes, owed, paidIn, paidOut, net, items } where net > 0 means the
//   person owes the household and net < 0 that the household owes the person.

export const OWE_PREFIX = "owe:";
export const oweLabel = (uid) => `${OWE_PREFIX}${uid}`;
export const owedByLabel = (label) => (typeof label === "string" && label.startsWith(OWE_PREFIX) ? label.slice(OWE_PREFIX.length) : "");

export function financeOwedLedger({ txns = [], portionsOf = () => [], receipts = [], manual = [], settlements = [] } = {}) {
  const out = new Map();
  const get = (by) => {
    if (!out.has(by)) out.set(by, { owes: 0, owed: 0, paidIn: 0, paidOut: 0, net: 0, items: [] });
    return out.get(by);
  };
  const counted = new Set(); // txn ids whose personal items are already counted
  for (const t of txns || []) {
    if (!t?.label) continue;
    for (const p of portionsOf(t) || []) {
      const by = owedByLabel(p?.label);
      const amount = num(p?.amount);
      if (!by || !(amount > 0)) continue;
      counted.add(t.id);
      const e = get(by);
      e.owes += amount;
      e.items.push({ kind: "owes", txnId: t.id, date: (t.posted || "").slice(0, 10), name: t.displayName || t.description || "", amount: round(amount) });
    }
  }
  for (const r of receipts || []) {
    if (r?.view === "personal") continue; // paid personally: nothing owed
    if (r?.financeTxnId && counted.has(r.financeTxnId)) continue;
    for (const it of r?.items || []) {
      const by = String(it?.owedBy || "");
      const price = num(it?.price);
      if (!by || !(price > 0)) continue;
      const e = get(by);
      e.owes += price;
      e.items.push({ kind: "owes", receiptId: r.id, date: r.date || "", name: `${it.name || "Item"}${r.merchant ? ` · ${r.merchant}` : ""}`, amount: round(price) });
    }
  }
  for (const m of manual || []) {
    const by = String(m?.paidBy || "");
    const amount = Math.abs(num(m?.amount));
    if (!by || !(amount > 0) || m?.deleted) continue;
    const e = get(by);
    e.owed += amount;
    e.items.push({ kind: "owed", txnId: m.id, date: (m.posted || "").slice(0, 10), name: m.description || "", amount: round(amount) });
  }
  for (const s of settlements || []) {
    const by = String(s?.by || "");
    const amount = num(s?.amount);
    if (!by || !amount || s?.deleted) continue;
    const e = get(by);
    if (amount > 0) e.paidIn += amount; else e.paidOut += -amount;
    e.items.push({ kind: amount > 0 ? "paid-in" : "paid-out", date: String(s.at || "").slice(0, 10), name: amount > 0 ? "Paid the household" : "Household paid back", amount: round(Math.abs(amount)) });
  }
  for (const e of out.values()) {
    e.owes = round(e.owes); e.owed = round(e.owed); e.paidIn = round(e.paidIn); e.paidOut = round(e.paidOut);
    e.net = round(e.owes - e.owed - e.paidIn + e.paidOut);
    e.items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return out;
}

// A recent household transfer that looks like the settle-up for this balance:
// money in of the same amount when the person owes, money out when the household
// owes. Already-used transfers (settlements with txnId) are skipped. → txn or null.
export function suggestSettlement(net, txns, settlements = [], { now = Date.now(), days = 45 } = {}) {
  const want = round(Math.abs(num(net)));
  if (!(want >= 0.01)) return null;
  const used = new Set((settlements || []).map((s) => s?.txnId).filter(Boolean));
  const since = now - days * 86400000;
  const fits = (txns || []).filter((t) => {
    if (!t?.id || used.has(t.id) || t.pending) return false;
    const a = num(t.amount);
    if (Math.abs(Math.abs(a) - want) > 0.02) return false;
    if (net > 0 ? a <= 0 : a >= 0) return false;
    const day = Date.parse(t.posted || "");
    return Number.isFinite(day) && day >= since && day <= now + 86400000;
  });
  fits.sort((a, b) => String(b.posted || "").localeCompare(String(a.posted || "")));
  return fits[0] || null;
}
