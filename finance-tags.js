// finance-tags.js — PURE: tax-time tags and trip tags on transactions.
//
// Tax tags (Luke 2026-11-12: rules first, by hand where the app can't know):
//   a transaction's tag is what was picked by hand (financeTxnTax[id]), else what
//   its category's name says (a "Childcare" category → childcare), else none.
//   "none" picked by hand clears a rule's tag.
// Trip tags: a charge counts toward an Explore trip only when tagged
//   (financeTxnTrip[id] = trip id). Charges dated during a trip are offered.

export const TAX_KINDS = [
  { key: "donation", label: "Charitable donation", words: ["donation", "donations", "charity", "charitable", "giving", "tithe", "church"] },
  { key: "medical", label: "Medical", words: ["medical", "health", "healthcare", "doctor", "dental", "dentist", "vision", "pharmacy", "prescription", "prescriptions", "hsa", "fsa"] },
  { key: "childcare", label: "Childcare", words: ["childcare", "daycare", "preschool", "babysitter", "babysitting", "nanny"] },
  { key: "529", label: "529 contribution", words: ["529", "college"] },
  { key: "business", label: "Business expense", words: ["business"] },
];
const BY_KEY = new Map(TAX_KINDS.map((k) => [k.key, k]));
export const taxLabel = (key) => BY_KEY.get(key)?.label || "";

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

// The rule: a tax kind from a category's display name ("Needs · Childcare").
export function taxKindForCategory(categoryName) {
  const w = words(categoryName);
  for (const k of TAX_KINDS) if (k.words.some((x) => w.includes(x))) return k.key;
  return "";
}

// → { kind, source: "hand" | "rule" | "" }
export function taxTagFor(txn, { picked = {}, categoryName = "" } = {}) {
  const hand = picked?.[txn?.id];
  if (hand === "none") return { kind: "", source: "hand" };
  if (hand && BY_KEY.has(hand)) return { kind: hand, source: "hand" };
  const rule = taxKindForCategory(categoryName);
  return rule ? { kind: rule, source: "rule" } : { kind: "", source: "" };
}

// A tax year's tagged transactions and totals. txns: [{ id, posted, amount, name, receipt }]
// categoryNameOf(txn) → the category's display name. Money out counts as positive.
// → { year, totals: { kind: amount }, rows: [{ date, name, amount, kind, source, receipt }] }
export function taxYearSummary(txns, { year, picked = {}, categoryNameOf = () => "" }) {
  const totals = {};
  const rows = [];
  for (const t of txns || []) {
    if (String(t?.posted || "").slice(0, 4) !== String(year)) continue;
    const { kind, source } = taxTagFor(t, { picked, categoryName: categoryNameOf(t) });
    if (!kind) continue;
    const amount = Math.round(-Number(t.amount || 0) * 100) / 100;
    totals[kind] = Math.round(((totals[kind] || 0) + amount) * 100) / 100;
    rows.push({ date: String(t.posted).slice(0, 10), name: t.name || "", amount, kind, source, receipt: t.receipt || "" });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { year: Number(year), totals, rows };
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function taxYearCsv(summary) {
  const lines = [["Date", "Description", "Amount", "Tax category", "Tagged", "Receipt"].join(",")];
  for (const r of summary.rows) lines.push([r.date, r.name, r.amount.toFixed(2), taxLabel(r.kind), r.source === "hand" ? "by hand" : "by category", r.receipt].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

// ---- trips ----------------------------------------------------------------------

// Charges dated within a trip (a day of slack each side, for late posting) that
// aren't tagged to any trip yet. trip: { id, startDate, endDate }.
export function tripCandidates(txns, trip, tagged = {}) {
  if (!trip?.startDate || !trip?.endDate) return [];
  const from = new Date(`${trip.startDate}T00:00:00`); from.setDate(from.getDate() - 1);
  const to = new Date(`${trip.endDate}T23:59:59`); to.setDate(to.getDate() + 2);
  return (txns || []).filter((t) => {
    if (!(Number(t?.amount) < 0) || tagged[t.id]) return false;
    const at = Date.parse(t.posted || "");
    return Number.isFinite(at) && at >= from.getTime() && at <= to.getTime();
  });
}
export function tripCharges(txns, tripId, tagged = {}) {
  return (txns || []).filter((t) => tagged[t.id] === tripId && Number(t.amount) < 0);
}
