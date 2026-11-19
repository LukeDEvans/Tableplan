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

// One-time repair for months backfilled by the OLD CSV import, which keyed
// `cats` by the full label ("cat:<gid>:<cid>") while every reader and the live
// snapshotter use "<gid>:<cid>" — so those months showed $0 per category.
// Strips the "cat:" prefix. If the plain key is already there, it wins and the
// prefixed one is dropped (never summed: the two can only coexist as copies of
// the same data, and adding them would double-count). Idempotent; returns the
// same object when nothing needed repair, so callers can skip a save.
export function normalizeFinanceMonthActuals(actuals) {
  if (!actuals || typeof actuals !== "object") return {};
  let out = actuals;
  for (const [month, entry] of Object.entries(actuals)) {
    const cats = entry?.cats;
    if (!cats || typeof cats !== "object") continue;
    const keys = Object.keys(cats);
    if (!keys.some((k) => k.startsWith("cat:"))) continue;
    const fixed = {};
    for (const k of keys) if (!k.startsWith("cat:")) fixed[k] = cats[k];
    for (const k of keys) {
      if (!k.startsWith("cat:")) continue;
      const plain = k.slice(4);
      if (!(plain in fixed)) fixed[plain] = cats[k];
    }
    if (out === actuals) out = { ...actuals };
    out[month] = { ...entry, cats: fixed };
  }
  return out;
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

// ── One month's totals from labelled transactions ───────────────────────────
// The entry financeMonthActuals keeps per month: { cats, income, incomeBy }.
// `portionsOf(t)` → [{ label, amount }] (finance-ui.js financeTxnPortions): spend
// portions are positive, labels are "cat:<group>:<category>", "income" or
// "income:<source>". Transfers ("mgmt") and unlabelled transactions add nothing.
// Used by the automatic snapshot and by the "Update saved totals" action, so both
// always compute a month the same way.
export function financeMonthEntry(txns, month, portionsOf) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const cats = {};
  const incomeBy = {};
  let income = 0;
  for (const t of txns || []) {
    if ((t?.posted || "").slice(0, 7) !== month || !t.label) continue;
    for (const p of portionsOf(t) || []) {
      if (p.label === "income" || p.label.startsWith("income:")) {
        income += p.amount;
        incomeBy[p.label] = round2((incomeBy[p.label] || 0) + p.amount);
      } else if (p.label.startsWith("cat:")) {
        const k = p.label.slice(4);
        cats[k] = round2((cats[k] || 0) + p.amount);
      }
    }
  }
  return { cats, income: round2(income), incomeBy };
}

// What a saved month adds up to, for showing "saved vs now" before an update.
export function financeMonthEntryTotals(entry) {
  const cats = entry && typeof entry.cats === "object" && entry.cats ? entry.cats : {};
  const values = Object.values(cats).map((v) => Number(v) || 0);
  return {
    spend: Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100,
    categories: values.filter((v) => v !== 0).length,
    income: Math.round((Number(entry?.income) || 0) * 100) / 100,
  };
}

// Same totals? (Key order and zero-value categories don't count as a difference.)
export function financeMonthEntriesMatch(a, b) {
  const flat = (e) => {
    const out = {};
    for (const [k, v] of Object.entries((e && e.cats) || {})) if (Math.abs(Number(v) || 0) >= 0.005) out[`c:${k}`] = Math.round(Number(v) * 100);
    for (const [k, v] of Object.entries((e && e.incomeBy) || {})) if (Math.abs(Number(v) || 0) >= 0.005) out[`i:${k}`] = Math.round(Number(v) * 100);
    out.income = Math.round((Number(e?.income) || 0) * 100);
    return out;
  };
  const x = flat(a), y = flat(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if ((x[k] || 0) !== (y[k] || 0)) return false;
  return true;
}

// Do these transactions reach back far enough to speak for the whole month?
// The current month always counts (it is the live edge). A past month counts
// only when the earliest bank transaction is on or before its first day; manual
// entries say nothing about coverage (see financeMonthsToSnapshot).
export function financeTxnsCoverMonth(txns, month, currentMonth) {
  if (!month) return false;
  if (month === currentMonth) return true;
  if (month > currentMonth) return false;
  const earliest = financeEarliestTxnDate((txns || []).filter((t) => !t?.isManual));
  return Boolean(earliest && earliest <= `${month}-01`);
}

// ── Spending that is in no category ─────────────────────────────────────────
// Money that left an account and has no label at all: not a category, not a
// transfer, not income. Every spending total is built from categories, so this is
// exactly what those totals leave out. → Map month → { spend, count }.
export function financeUncategorizedByMonth(txns) {
  const out = new Map();
  for (const t of txns || []) {
    const month = (t?.posted || "").slice(0, 7);
    if (!month || t.label || !((Number(t.amount) || 0) < 0)) continue;
    const e = out.get(month) || { spend: 0, count: 0 };
    e.spend = Math.round((e.spend - Number(t.amount)) * 100) / 100;
    e.count += 1;
    out.set(month, e);
  }
  return out;
}

// ── "At this rate" projection for one category ──────────────────────────────
// Spending so far ÷ day of month × days in month works for groceries and is
// wrong for a bill: a mortgage paid on the 7th is not on its way to four
// mortgages. So a charge is counted ONCE, not extrapolated, when it is a known
// recurring bill (`isRecurring(charge)`), or when it alone is at least half the
// category's budget (a rent-sized payment in a category that is mostly that
// payment). Everything else is paced. `charges`: [{ amount }] with spend
// positive and refunds negative; extra fields are passed to isRecurring.
export function financeProjectedSpend(charges, { budget = 0, dayOfMonth, daysInMonth, isRecurring = () => false } = {}) {
  let fixed = 0, paced = 0;
  for (const c of charges || []) {
    const amount = Number(c?.amount) || 0;
    if (!amount) continue;
    const lump = amount > 0 && (isRecurring(c) || (budget > 0 && amount >= budget * 0.5));
    if (lump) fixed += amount; else paced += amount;
  }
  const day = Math.max(1, Number(dayOfMonth) || 1);
  const days = Math.max(day, Number(daysInMonth) || day);
  const round2 = (n) => Math.round(n * 100) / 100;
  return { projected: round2(fixed + (paced / day) * days), fixed: round2(fixed), paced: round2(paced) };
}
