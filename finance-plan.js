// finance-plan.js — PURE planning helpers for the Finance page: the subscriptions
// review, the 30-day cash-flow forecast, and savings goals tied to accounts.
// No DOM, no state, no network: finance-ui.js passes plain values in.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);

// ---- Subscriptions ------------------------------------------------------------------

// Where to manage or cancel well-known services (official account pages). Matched
// on a word of the recurring charge's name. Anything else gets no link.
export const CANCEL_LINKS = [
  ["netflix", "https://www.netflix.com/cancelplan"],
  ["spotify", "https://www.spotify.com/account/subscription/"],
  ["hulu", "https://secure.hulu.com/account"],
  ["disney", "https://www.disneyplus.com/account/subscription"],
  ["max", "https://auth.max.com/subscription"],
  ["peacock", "https://www.peacocktv.com/account/plans"],
  ["paramount", "https://www.paramountplus.com/account/"],
  ["youtube", "https://www.youtube.com/paid_memberships"],
  ["apple", "https://apps.apple.com/account/subscriptions"],
  ["amazon", "https://www.amazon.com/yourmembershipsandsubscriptions"],
  ["prime", "https://www.amazon.com/yourmembershipsandsubscriptions"],
  ["audible", "https://www.audible.com/account/overview"],
  ["nytimes", "https://myaccount.nytimes.com/seg/subscription"],
  ["adobe", "https://account.adobe.com/plans"],
  ["dropbox", "https://www.dropbox.com/account/plan"],
  ["google", "https://myaccount.google.com/subscriptions"],
  ["microsoft", "https://account.microsoft.com/services"],
  ["xfinity", "https://customer.xfinity.com/#/services"],
  ["sling", "https://www.sling.com/my-account"],
  ["siriusxm", "https://care.siriusxm.com/"],
  ["patreon", "https://www.patreon.com/settings/memberships"],
];
export function cancelLinkFor(name) {
  const w = words(name);
  return CANCEL_LINKS.find(([k]) => w.some((x) => x === k || x.startsWith(k)))?.[1] || "";
}

// recurring: state.financeRecurring entries (active ones are reviewed).
// → { rows: [{ id, name, monthly, yearly, day, link, priceFrom, dupOf }], monthly, yearly }
//   priceFrom: the earlier amount when the charge changed since it was last accepted.
//   dupOf: the id of another charge that looks like the same thing (same amount ±2%
//   and a shared word in the name), so it can be checked.
export function subscriptionReview(recurring) {
  const active = (recurring || []).filter((r) => r && r.active !== false && num(r.lastAmount) > 0);
  const rows = active.map((r) => {
    const monthly = round(num(r.lastAmount));
    const ack = r.ackAmount == null ? null : num(r.ackAmount);
    const prev = r.prevAmount == null ? null : num(r.prevAmount);
    const from = ack != null && Math.abs(ack - monthly) > Math.max(0.5, monthly * 0.02) ? ack
      : prev != null && Math.abs(prev - monthly) > Math.max(0.5, monthly * 0.02) ? prev : null;
    return { id: r.id, name: r.name || "Recurring charge", monthly, yearly: round(monthly * 12), day: Math.min(28, Math.max(1, num(r.expectedDay) || 1)), link: cancelLinkFor(r.name), priceFrom: from, dupOf: "" };
  });
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = rows[i], b = rows[j];
      const close = Math.abs(a.monthly - b.monthly) <= Math.max(0.02, b.monthly * 0.02);
      const shared = words(a.name).some((w) => words(b.name).includes(w));
      if (close && shared) { a.dupOf = b.id; break; }
    }
  }
  rows.sort((a, b) => b.monthly - a.monthly);
  const monthly = round(rows.reduce((s, r) => s + r.monthly, 0));
  return { rows, monthly, yearly: round(monthly * 12) };
}

// ---- 30-day cash-flow forecast --------------------------------------------------------

// startBalance: today's balance of the spending accounts.
// paydays: [{ date: "YYYY-MM-DD", amount }] (net, in the window).
// bills: [{ name, day (1–28), amount, paidThisMonth }] — recurring charges.
// dailySpend: everyday spending per day (not bills), as a positive number.
// → { points: [{ date, balance, in, out, events: [string] }], low: { date, balance }, end }
export function cashForecast({ startBalance, today = new Date(), days = 30, paydays = [], bills = [], dailySpend = 0 }) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const payByDay = new Map();
  for (const p of paydays || []) if (num(p?.amount) > 0) payByDay.set(p.date, (payByDay.get(p.date) || 0) + num(p.amount));
  let bal = num(startBalance);
  const points = [];
  let low = { date: dayKey(start), balance: bal };
  for (let i = 1; i <= days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const key = dayKey(d);
    const events = [];
    let inn = payByDay.get(key) || 0;
    if (inn) events.push(`Payday +${inn.toFixed(2)}`);
    let out = Math.max(0, num(dailySpend));
    for (const b of bills || []) {
      if (num(b?.day) !== d.getDate()) continue;
      // This month's bill already went out: it next comes due next month.
      if (b.paidThisMonth && d.getMonth() === start.getMonth() && d.getFullYear() === start.getFullYear()) continue;
      out += num(b.amount);
      events.push(`${b.name} −${num(b.amount).toFixed(2)}`);
    }
    bal = round(bal + inn - out);
    points.push({ date: key, balance: bal, in: round(inn), out: round(out), events });
    if (bal < low.balance) low = { date: key, balance: bal };
  }
  return { points, low, end: bal };
}

// Everyday spending per day: money out over the last `windowDays`, leaving out
// recurring bills (they're scheduled separately) and transfers / card payments.
// txns: [{ posted, amount, merchantKey, isTransfer }]
export function everydaySpendPerDay(txns, { now = new Date(), windowDays = 60, recurringKeys = new Set() } = {}) {
  const from = now.getTime() - windowDays * DAY;
  let total = 0;
  for (const t of txns || []) {
    const at = Date.parse(t?.posted || "");
    if (!Number.isFinite(at) || at < from || at > now.getTime()) continue;
    if (!(num(t.amount) < 0) || t.isTransfer || recurringKeys.has(t.merchantKey)) continue;
    total += -num(t.amount);
  }
  return round(total / windowDays);
}

// ---- Goals tied to accounts -----------------------------------------------------------

// goal: { target, current, targetDate, accountId }. balanceNow: that account's
// balance today (or null when the goal isn't tied to one). history: { "YYYY-MM-DD":
// { balances: { [accountId]: number } } } — the daily snapshots.
// → { current, linked, perMonth (recent pace, or null), etaMonths, etaDate, needPerMonth }
export function goalProgress(goal, { balanceNow = null, history = {}, today = new Date() } = {}) {
  const linked = Boolean(goal?.accountId) && balanceNow != null;
  const current = round(linked ? num(balanceNow) : num(goal?.current));
  const target = num(goal?.target);
  let perMonth = null;
  if (linked) {
    // Pace from the oldest snapshot within the last ~120 days (at least 30 days back).
    const cutoff = dayKey(new Date(today.getTime() - 120 * DAY));
    const recent = dayKey(new Date(today.getTime() - 30 * DAY));
    const keys = Object.keys(history || {}).filter((k) => k >= cutoff && k <= recent && history[k]?.balances?.[goal.accountId] != null).sort();
    if (keys.length) {
      const k = keys[0];
      const months = (today.getTime() - Date.parse(`${k}T12:00:00`)) / (30.44 * DAY);
      if (months >= 0.9) perMonth = round((current - num(history[k].balances[goal.accountId])) / months);
    }
  }
  const remaining = Math.max(0, target - current);
  let etaMonths = null, etaDate = "";
  if (remaining === 0 && target > 0) etaMonths = 0;
  else if (perMonth && perMonth > 0) {
    etaMonths = Math.ceil(remaining / perMonth);
    const d = new Date(today.getFullYear(), today.getMonth() + etaMonths, 1);
    etaDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  let needPerMonth = null;
  if (goal?.targetDate && remaining > 0) {
    const t = new Date(`${goal.targetDate}T12:00:00`);
    const m = (t.getFullYear() - today.getFullYear()) * 12 + (t.getMonth() - today.getMonth());
    if (m > 0) needPerMonth = round(remaining / m);
  }
  return { current, linked, perMonth, etaMonths, etaDate, needPerMonth };
}
