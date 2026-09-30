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
// Coverage is measured from BANK-FEED transactions only: a manual entry (any age)
// says nothing about what the feed covers, and letting two old labelled manual
// entries mark an old month "covered" re-snapshotted it from manual rows alone,
// shrinking a complete historical snapshot. With no feed transactions at all,
// only the current month is eligible.
//
// `partial`: the pull reported per-account errors (some institutions missing).
// A past month's snapshot is then NOT rewritten — an account absent from this
// pull would drop its whole contribution and shrink a complete snapshot. The
// current month is still refreshed (it's re-derived on every later pull).
export function financeMonthsToSnapshot(txns, currentMonth, { partial = false } = {}) {
  const earliest = financeEarliestTxnDate((txns || []).filter((t) => !t?.isManual));
  const months = new Set([currentMonth]);
  if (partial) return months;
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

// Local-calendar month key ("YYYY-MM"). `Date#toISOString()` is UTC, so in a
// negative-offset timezone the evening of the last day of a month already reads
// as NEXT month (and new Date(y, m, 1) — local midnight — reads as the PREVIOUS
// month east of UTC). Every "which month is it / N months back" key the finance
// UI derives from the clock must use local getters instead.
export function localMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "YYYY-MM" shifted by `delta` months (negative = earlier), in local time.
export function monthKeyOffset(monthKey, delta) {
  const [y, m] = String(monthKey).split("-").map(Number);
  return localMonthKey(new Date(y, m - 1 + (Number(delta) || 0), 1));
}

// Transfer pairs (account management): same magnitude, opposite signs,
// different accounts, ≤5 days apart → both ids auto-label "mgmt". Manual
// entries (isManual) never participate: a hand-entered cash purchase that
// happens to match a bank deposit's magnitude is not a transfer between them.
export function financeTransferPairIds(txns) {
  const pairs = new Set();
  const byAmt = new Map();
  for (const t of txns || []) {
    if (!t.amount || t.isManual) continue;
    const k = Math.abs(t.amount).toFixed(2);
    if (!byAmt.has(k)) byAmt.set(k, []);
    byAmt.get(k).push(t);
  }
  for (const group of byAmt.values()) {
    for (const a of group) for (const b of group) {
      if (a === b || a.accountId === b.accountId) continue;
      if ((a.amount > 0) === (b.amount > 0)) continue;
      if (Math.abs(new Date(a.posted || 0) - new Date(b.posted || 0)) <= 5 * 86400000) {
        pairs.add(a.id); pairs.add(b.id);
      }
    }
  }
  return pairs;
}

// Pending→posted dedupe: banks reissue ids when a pending charge posts. Same
// account + same amount + a shared merchant token + ≤7d apart → the pending
// row is a duplicate of that posted row. Each posted row absorbs at most ONE
// pending row (two identical pending coffees must not both collapse onto one
// posted charge). Returns Map<pendingId, postedId>. `merchantKey` injected.
export function financePendingDuplicates(txns, merchantKey) {
  const mkey = typeof merchantKey === "function" ? merchantKey : (d) => String(d || "");
  const tokens = (d) => new Set(String(mkey(d) || "").split(" ").filter(Boolean));
  const byKey = new Map();
  for (const t of txns || []) {
    const k = `${t.accountId}|${(t.amount || 0).toFixed(2)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const out = new Map();
  for (const group of byKey.values()) {
    const posted = group.filter((t) => !t.pending);
    const claimed = new Set();
    for (const p of group.filter((t) => t.pending)) {
      const pTok = tokens(p.description);
      const match = posted.find((q) =>
        !claimed.has(q.id) &&
        Math.abs(new Date(p.posted || 0) - new Date(q.posted || 0)) <= 7 * 86400000 &&
        [...pTok].some((tok) => tokens(q.description).has(tok)));
      if (!match) continue;
      claimed.add(match.id);
      out.set(p.id, match.id);
    }
  }
  return out;
}
