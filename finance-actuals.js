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
