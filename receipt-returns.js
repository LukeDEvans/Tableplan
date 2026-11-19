// receipt-returns.js — PURE: return windows and warranties on receipts.
//
// Store return windows for the suggestion button in the receipt editor. Only a
// suggestion: policies vary by item (electronics, opened items), so the date is
// always the person's to set. Stores with no fixed window aren't listed.
export const STORE_RETURN_DAYS = [
  ["target", 90], ["walmart", 90], ["amazon", 30], ["best buy", 15], ["bestbuy", 15],
  ["home depot", 90], ["lowe", 90], ["kohl", 180], ["ikea", 365], ["rei", 365],
  ["old navy", 30], ["gap", 30], ["nordstrom", 45], ["macy", 30], ["apple", 14],
  ["cub", 30], ["menards", 90], ["michaels", 60], ["dick", 60],
];
export function storeReturnDays(storeName) {
  const s = String(storeName || "").toLowerCase();
  return STORE_RETURN_DAYS.find(([k]) => s.includes(k))?.[1] || 0;
}
export function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// What's coming up. receipts: { id, merchant|storeName, returnBy, warrantyUntil }.
// → { returns: [{ id, store, date, daysLeft }] (from today, next 45 days),
//     warranties: [{ id, store, date, daysLeft }] (still in force) }
export function upcomingReturns(receipts, today = new Date()) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const left = (k) => Math.round((Date.parse(`${k}T00:00:00`) - t0) / 86400000);
  const returns = [], warranties = [];
  for (const r of receipts || []) {
    const store = r?.merchant || r?.storeName || "Receipt";
    if (r?.returnBy) { const d = left(r.returnBy); if (d >= 0 && d <= 45) returns.push({ id: r.id, store, date: r.returnBy, daysLeft: d }); }
    if (r?.warrantyUntil) { const d = left(r.warrantyUntil); if (d >= 0) warranties.push({ id: r.id, store, date: r.warrantyUntil, daysLeft: d }); }
  }
  returns.sort((a, b) => a.daysLeft - b.daysLeft);
  warranties.sort((a, b) => a.daysLeft - b.daysLeft);
  return { returns, warranties };
}

// Phone reminders: 3 days before a return window closes (or the morning after
// it's set when that's already later), 09:00 local. → [{ id, fireAt, title, body, kind }]
export const RETURN_REMINDER_ID_BASE = 2100000000;
export function returnReminderInstances(receipts, now = Date.now()) {
  const out = [];
  for (const r of receipts || []) {
    if (!r?.returnBy || !r.id) continue;
    const at = new Date(`${r.returnBy}T09:00:00`);
    if (Number.isNaN(at.getTime())) continue;
    at.setDate(at.getDate() - 3);
    if (at.getTime() < now + 10 * 60000) { const close = new Date(`${r.returnBy}T09:00:00`).getTime(); if (close < now + 10 * 60000) continue; at.setTime(Math.max(now + 15 * 60000, at.getTime())); }
    let h = 0; for (const c of String(r.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    out.push({ id: RETURN_REMINDER_ID_BASE + (h % 9000000), fireAt: at.getTime(), title: "Return window closing", body: `${r.merchant || r.storeName || "A purchase"}: return by ${new Date(`${r.returnBy}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, kind: "finance" });
  }
  return out;
}
