// finance-actuals.js — pure helpers for the persisted month-actuals snapshot.
//
// financeMonthActuals preserves each month's category/income totals so history
// survives the rolling transaction window (older transactions eventually drop
// out of the live feed, but their month's totals must not). The snapshot is
// (re)written from live transactions, which means a correction to an older
// transaction still in the feed should update that month too — not only the
// current month.
//
// The trap: re-snapshotting a PAST month from a feed whose window only partially
// covers it would replace a complete historical snapshot with an undercount. So
// a month is only eligible to be (re)written when the feed's earliest transaction
// reaches back to at least that month's first day. The current month is always
// eligible — it is the live edge and has no complete prior snapshot to protect.

export function financeEarliestTxnDate(txns) {
  let earliest = null;
  for (const t of txns || []) {
    const d = (t.posted || "").slice(0, 10);
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  return earliest;
}

// The set of "YYYY-MM" months it is safe to (re)snapshot from these labeled
// transactions, given the current month. Always includes currentMonth; includes
// a past month only when the feed fully covers it (earliest txn <= its 1st day).
export function financeMonthsToSnapshot(txns, currentMonth) {
  const earliest = financeEarliestTxnDate(txns);
  const months = new Set([currentMonth]);
  for (const t of txns || []) {
    const m = (t.posted || "").slice(0, 7);
    if (!m || !t.label) continue;
    if (m === currentMonth || (earliest && earliest <= `${m}-01`)) months.add(m);
  }
  return months;
}

// Self-canceling transaction pairs are pure ledger noise: a +X and a −X from
// the SAME account, SAME day, SAME merchant that net to zero (a brokerage
// sweep, a dividend reinvest, a same-day reversal — e.g. "ISHARES TRUST 4.04"
// and "ISHARES TRUST -4.04"). Returns the set of transaction ids to hide.
//
// Deliberately conservative so it can never eat a real transaction:
//   • same account + same posted day + same absolute amount + same merchant key
//     (so an unrelated $4.04 charge and $4.04 refund are never collapsed);
//   • only min(#credits, #debits) per group are paired off, leaving any extra;
//   • a transaction the user has labeled/split (isLabeled) is never hidden.
// `merchantKey(description)` and `isLabeled(id)` are injected to keep this pure.
export function financeOffsettingPairIds(txns, merchantKey, isLabeled) {
  const mkey = typeof merchantKey === "function" ? merchantKey : (d) => String(d || "");
  const labeled = typeof isLabeled === "function" ? isLabeled : () => false;
  const groups = new Map();
  for (const t of txns || []) {
    const amt = Number(t.amount) || 0;
    if (!amt) continue;
    if (labeled(t.id)) continue;
    const day = (t.posted || "").slice(0, 10);
    if (!day) continue;
    const k = `${t.accountId}|${day}|${Math.abs(amt).toFixed(2)}|${mkey(t.description)}`;
    let g = groups.get(k);
    if (!g) { g = { pos: [], neg: [] }; groups.set(k, g); }
    (amt > 0 ? g.pos : g.neg).push(t.id);
  }
  const hide = new Set();
  for (const { pos, neg } of groups.values()) {
    const n = Math.min(pos.length, neg.length);
    for (let i = 0; i < n; i++) { hide.add(pos[i]); hide.add(neg[i]); }
  }
  return hide;
}
