import { reviewGestureAxis, reviewGestureAction, REVIEW_GESTURE } from './finance-review-gesture.js';
import { financeMonthsToSnapshot, financeOffsettingPairIds } from './finance-actuals.js';
import { dedupeFinanceRecurring } from './finance-sync.js';
import { parseCsvRows, aggregateCsvBackfill } from './finance-csv.js';

// finance-ui.js — the Finance domain, being extracted from app.js in staged
// commits (see FINANCE_EXTRACTION.md). This is COMMIT 1: the pure normalizers,
// defaults, and stateless helpers, exported as top-level pure functions. The
// createId-using normalizers take `createId` as a parameter (the shell calls them
// at boot from defaultState). The stateful UI (createFinanceModule factory) and
// the rest of the finance surface arrive in later commits.
//
// The sync/hydration machinery (financeSectionHydrated, guardBootEmptyFinance, the
// mergeStates finance deep-merge, tp_protect_finance_merge) is NOT here — it stays
// in app.js's shared state-sync code. Receipts are deferred entirely.

// Fixed group ids keep the three budget groups merge-stable across devices.
export function defaultFinanceBudgetGroups() {
  return [
    { id: "fin-group-needs",   label: "Needs",   idealPct: 50, categories: [] },
    { id: "fin-group-wants",   label: "Wants",   idealPct: 30, categories: [] },
    { id: "fin-group-savings", label: "Savings", idealPct: 20, categories: [] },
  ];
}

// Age-based retirement savings benchmark — Fidelity's widely-cited "save N×
// your salary by this age" guideposts (1× by 30, 3× by 40, 6× by 50, 8× by 60,
// 10× by 67). Linearly interpolated between anchors so the target advances
// smoothly year to year rather than jumping. Returns the salary multiple.
const RETIREMENT_MULTIPLE_ANCHORS = [
  [25, 0], [30, 1], [35, 2], [40, 3], [45, 4], [50, 6], [55, 7], [60, 8], [67, 10],
];
export function retirementTargetMultiple(age) {
  if (!Number.isFinite(age)) return null;
  const A = RETIREMENT_MULTIPLE_ANCHORS;
  if (age <= A[0][0]) return A[0][1];
  if (age >= A[A.length - 1][0]) return A[A.length - 1][1];
  for (let i = 0; i < A.length - 1; i++) {
    const [a0, m0] = A[i], [a1, m1] = A[i + 1];
    if (age >= a0 && age <= a1) return m0 + (m1 - m0) * ((age - a0) / (a1 - a0));
  }
  return A[A.length - 1][1];
}

export function normalizeFinanceLineItems(items, createId) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    id: it?.id || createId("fin-item"),
    name: it?.name || "",
    amount: Number(it?.amount) || 0,
    note: it?.note || ""
  }));
}

export function normalizeFinancePeople(raw, createId) {
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    id: p?.id || createId("fin-person"),
    name: p?.name || "",
    activeScenarioId: p?.activeScenarioId || "",
    scenarios: (Array.isArray(p?.scenarios) ? p.scenarios : []).map((s) => ({
      id: s?.id || createId("fin-scenario"),
      label: s?.label || "",
      // Per PAY PERIOD when a pay frequency is set (a single paycheck); the whole
      // month when frequency is "monthly" (the default, = legacy behavior).
      amount: Number(s?.amount) || 0,
      // "monthly" | "biweekly" | "weekly". Biweekly/weekly multiply by the number
      // of paydays that land in the viewed month (2 vs 3 for biweekly).
      payFrequency: ["monthly", "biweekly", "weekly"].includes(s?.payFrequency) ? s.payFrequency : "monthly",
      // A known payday (YYYY-MM-DD) that anchors the biweekly/weekly cadence.
      payAnchor: (typeof s?.payAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.payAnchor)) ? s.payAnchor : "",
      // Pre-deposit paycheck deductions (insurance, taxes, 401k…), each per pay
      // period. Net = amount − Σ deductions; these ride this scenario's cadence,
      // so they vary with paycheck count and never touch the account-side budget.
      deductions: (Array.isArray(s?.deductions) ? s.deductions : []).map((d) => ({
        id: d?.id || createId("fin-deduction"),
        label: d?.label || "",
        amount: Number(d?.amount) || 0
      })),
      note: s?.note || ""
    }))
  }));
}

export function normalizeFinanceBudgetGroups(raw, createId) {
  const groups = (Array.isArray(raw) ? raw : []).map((g) => ({
    id: g?.id || createId("fin-group"),
    label: g?.label || "",
    idealPct: Number(g?.idealPct) || 0,
    categories: (Array.isArray(g?.categories) ? g.categories : []).map((c) => ({
      id: c?.id || createId("fin-cat"),
      name: c?.name || "",
      // "sum" totals every line; "pick" makes the lines exclusive options
      // (income-scenario style) and the category equals the selected one.
      mode: c?.mode === "pick" ? "pick" : "sum",
      activeItemId: c?.activeItemId || "",
      items: normalizeFinanceLineItems(c?.items, createId)
    }))
  }));
  return groups.length ? groups : defaultFinanceBudgetGroups();
}

export const FINANCE_ACCOUNT_KINDS = ["cash", "retirement", "investment", "debt", "other"];

// User-configurable finance alerts (Settings › Finance). Default ON; stored in
// the config section (state.financeAlertPrefs), NOT the schema-guarded finance
// section — these are preferences, not ledger data.
export const FINANCE_ALERTS = [
  { key: "overBudget", label: "Category over budget", desc: "Flag when a category's spending passes its budget this month." },
  { key: "largeTxn", label: "Large purchase", desc: "Flag any single transaction over $400." },
  { key: "lowBalance", label: "Low cash balance", desc: "Flag when a cash account drops below $100." },
  { key: "priceChange", label: "Subscription price change", desc: "Flag when a recurring charge's amount changes vs its budget line." },
];
export function normalizeFinanceAccounts(raw, createId) {
  return (Array.isArray(raw) ? raw : []).map((a) => ({
    id: a?.id || createId("fin-account"),
    owner: a?.owner || "",
    sub: a?.sub || "",     // sub-label within the owner group ("" = none)
    name: a?.name || "",
    linkedId: a?.linkedId || "", // SimpleFIN account id this row displays
    // Bucket for the top-of-page savings cards. "" = auto (inferred from the
    // sub-label/name); an explicit value is a user override.
    kind: FINANCE_ACCOUNT_KINDS.includes(a?.kind) ? a.kind : "",
    // For accounts no aggregator reaches (loans, small 401(k)s): a manually
    // kept balance, negative for debts. null = not tracked.
    manualBalance: Number.isFinite(Number(a?.manualBalance)) && a?.manualBalance !== null && a?.manualBalance !== "" ? Number(a.manualBalance) : null,
    // Debt payoff (optional, debt accounts only): annual % + monthly payment.
    interestRate: Number(a?.interestRate) || 0,
    minPayment: Number(a?.minPayment) || 0,
  }));
}

// Months to pay off a debt at a fixed monthly payment (standard amortization).
// null = no payment set; {neverPays} = payment ≤ monthly interest; {done} = paid.
export function financeDebtPayoff(balance, minPayment, annualRatePct) {
  const P = Math.abs(Number(balance) || 0);
  const M = Math.abs(Number(minPayment) || 0);
  if (P <= 0) return { done: true };
  if (M <= 0) return null;
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  if (r <= 0) return { months: Math.ceil(P / M) };
  if (M <= r * P) return { neverPays: true };
  return { months: Math.ceil(-Math.log(1 - (r * P) / M) / Math.log(1 + r)) };
}

// Savings goals: id-keyed (union-by-id + tombstone on sync, like financeAccounts).
export function normalizeFinanceGoals(raw) {
  return (Array.isArray(raw) ? raw : []).filter((g) => g && g.id).map((g) => ({
    id: String(g.id),
    name: String(g.name || "").slice(0, 60),
    target: Number(g.target) || 0,
    current: Number(g.current) || 0,
    targetDate: typeof g.targetDate === "string" ? g.targetDate : "",
  }));
}

// Auto-classification from the account's sub-label + name; overridable per
// account (a.kind). Feeds the emergency-savings / retirement / cash cards.
export function inferFinanceAccountKind(a) {
  const t = `${a.sub || ""} ${a.name || ""}`.toLowerCase();
  if (/\b(401|403|457|ira|roth|retire|retirement|pension|hsa)\b/.test(t)) return "retirement";
  if (/\b(credit|card|loan|debt|debts|mortgage|heloc|line of credit)\b/.test(t)) return "debt";
  if (/\b(invest|investment|brokerage|stock|etf|mutual|529|college|crypto)\b/.test(t)) return "investment";
  if (/\b(check|checking|saving|savings|cash|bank|money market|deposit|hysa)\b/.test(t)) return "cash";
  if (Number(a.manualBalance) < 0) return "debt"; // a negative balance smells like a debt
  return "cash";
}
export function financeAccountKind(a) {
  return a.kind || inferFinanceAccountKind(a);
}
export function financeAccountBalance(a, liveById) {
  const live = a.linkedId ? liveById.get(a.linkedId) : null;
  if (live && live.balance !== null && live.balance !== undefined) return live.balance;
  if (a.manualBalance !== null && a.manualBalance !== undefined) return a.manualBalance;
  return null;
}

// { ownerLabel: ["Sub-label", ...] } — persistent so empty sub-groups survive
export function normalizeFinanceSubLabels(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [owner, subs] of Object.entries(raw)) {
      const clean = [...new Set((Array.isArray(subs) ? subs : []).map((s) => String(s || "").trim()).filter(Boolean))];
      if (clean.length) out[owner] = clean;
    }
  }
  return out;
}

export function normalizeFinancePersonal(raw, createId) {
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    id: p?.id || createId("fin-personal"),
    person: p?.person || "",
    incomeItems: normalizeFinanceLineItems(p?.incomeItems, createId),
    expenseItems: normalizeFinanceLineItems(p?.expenseItems, createId)
  }));
}

// Receipt-image references kept per transaction: { txnId: {path,type,size,name,uploadedAt} }.
// The blob itself lives in the private "receipt-attachments" Storage bucket; only a
// path reference is persisted here, so a bad/oversized value can never bloat state.
export function normalizeFinanceTxnReceipts(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [id, r] of Object.entries(raw)) {
    if (!r || typeof r !== "object" || typeof r.path !== "string" || !r.path) continue;
    out[id] = {
      path: r.path,
      type: typeof r.type === "string" ? r.type : "",
      size: Number(r.size) || 0,
      name: typeof r.name === "string" ? r.name.slice(0, 120) : "",
      uploadedAt: typeof r.uploadedAt === "string" ? r.uploadedAt : new Date().toISOString()
    };
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// COMMIT 2 (whole-module): the Finance domain factory. The entire finance UI —
// services/data layer, transactions + review deck, receipts (txn-receipt images),
// budget/accounts/income, insights, tabs/menus/grid — moved verbatim from app.js.
// app.js keeps only showFinanceApp (nav entry) + the shared state-sync machinery
// (financeSectionHydrated/guardBootEmptyFinance/mergeStates) which is NOT here.
// Cross-domain (documented): Calendar reads financePaydaysInRange + formatFinMoney
// (payday dots / bill display); state-sync calls invalidateFinanceLabeled.
// ══════════════════════════════════════════════════════════════════════════
export function createFinanceModule(deps) {
  const { state, elements, persist, createId, escapeHtml, showMailToast, recordDeletion, callNetlifyFunction, trackUsage, dateKeyFromDate, setPageNotifCount, setWeekToolsMode, closeWeekJumpMenu, getCurrentProfileMember, renderContextSettingsDialog, openContextSettingsDialog, prepareScanImage, fileToDataUrl, getActiveAppArea, getSupabaseClient, getAuthSession, getContextSettingsKind } = deps;

// Download the viewed month's transactions as CSV (real app — blob download is
// fine here; this is not an artifact/sandbox).
function exportFinanceCsv(monthKey) {
  const txns = financeLabeledTxns().filter((t) => (t.posted || "").slice(0, 7) === monthKey);
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const header = ["Date", "Merchant", "Bank description", "Amount", "Category", "Account"];
  const lines = txns.map((t) => [
    t.posted ? new Date(t.posted).toISOString().slice(0, 10) : "",
    t.displayName || "",
    t.description || "",
    (t.amount || 0).toFixed(2),
    t.label ? financeTxnLabelName(t.label) : "",
    t.account || "",
  ].map(esc).join(","));
  const csv = [header.map(esc).join(","), ...lines].join("\n");
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `transactions-${monthKey}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { showMailToast?.("Couldn't export CSV on this device."); }
}

// Backfill months of spending history from a transaction CSV (a bank export, or
// a file exported from another device) so "Draft from history" has real data to
// work with. Aggregates rows into per-month category totals and fills ONLY the
// months state.financeMonthActuals doesn't already have — a month with real
// snapshot data is never clobbered. Negative amount = spending, positive =
// income (same as Export CSV). Pure parse/aggregate live in ./finance-csv.js.
function financeImportCsvBackfill(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) { alert("That file didn't look like a transaction CSV (no rows found)."); return; }
  // Map both "Group · Category" and the bare category name to the budget key.
  const nameToKey = new Map();
  for (const g of (state.financeBudgetGroups || [])) {
    for (const c of (g.categories || [])) {
      const key = `cat:${g.id}:${c.id}`;
      nameToKey.set(`${g.label} · ${c.name}`.toLowerCase(), key);
      nameToKey.set(String(c.name || "").toLowerCase(), key);
    }
  }
  const agg = aggregateCsvBackfill(rows, nameToKey);
  if (agg.error === "missing-columns") { alert("Couldn't find Date and Amount columns in that CSV. Export from your bank with at least Date, Amount, and (ideally) Category columns."); return; }
  if (!agg.applied) { alert("No usable rows found in that CSV (couldn't read dates/amounts)."); return; }

  if (!state.financeMonthActuals || typeof state.financeMonthActuals !== "object") state.financeMonthActuals = {};
  const filled = [];
  let skippedExisting = 0;
  for (const [month, entry] of Object.entries(agg.months)) {
    if (state.financeMonthActuals[month]) { skippedExisting++; continue; } // never clobber real data
    if (!Object.keys(entry.cats).length && !entry.income) continue; // nothing landed
    state.financeMonthActuals[month] = entry;
    filled.push(month);
  }
  // Keep the same 36-month cap the live snapshotter enforces.
  const months = Object.keys(state.financeMonthActuals).sort();
  for (let i = 0; i < months.length - 36; i++) delete state.financeMonthActuals[months[i]];
  persist();
  renderFinancePage();

  const parts = [];
  parts.push(filled.length ? `Backfilled ${filled.length} month${filled.length === 1 ? "" : "s"} (${filled.sort().join(", ")})` : "No new months added");
  if (skippedExisting) parts.push(`${skippedExisting} month${skippedExisting === 1 ? "" : "s"} already had data (left as-is)`);
  if (agg.uncategorized) parts.push(`${agg.uncategorized} row${agg.uncategorized === 1 ? "" : "s"} had no matching category${agg.unrecognized.length ? ` (e.g. ${agg.unrecognized.slice(0, 3).join(", ")})` : ""}`);
  if (agg.invalid) parts.push(`${agg.invalid} row${agg.invalid === 1 ? "" : "s"} skipped (bad date/amount)`);
  alert(parts.join(".\n") + ".\n\nNow open the Budget tab → “Draft from history” to set budgets from this.");
}

function startFinanceCsvImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv,text/plain";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { financeImportCsvBackfill(String(reader.result || "")); } catch (e) { alert("Couldn't import that CSV: " + (e?.message || "unknown error")); } };
    reader.onerror = () => alert("Couldn't read that file.");
    reader.readAsText(file);
  };
  input.click();
}

// Sum of current balances of accounts of the given kind(s).
function financeSumByKind(kinds, liveById) {
  const set = new Set([].concat(kinds));
  let sum = 0, any = false;
  for (const a of (state.financeAccounts || [])) {
    if (!set.has(financeAccountKind(a))) continue;
    const bal = financeAccountBalance(a, liveById);
    if (bal !== null) { sum += bal; any = true; }
  }
  return any ? sum : null;
}

// The accounts feeding a savings card ("cash" | "emergency" | "retirement").
// An explicit user pick (non-empty id list) wins; otherwise fall back to the
// accounts whose inferred/overridden kind matches (emergency shares "cash").
const FINANCE_CARD_ID_KEYS = {
  cash: "financeCashAccountIds",
  emergency: "financeEmergencyAccountIds",
  retirement: "financeRetirementAccountIds",
};
function financeCardAccountIds(card) {
  const key = FINANCE_CARD_ID_KEYS[card];
  const explicit = Array.isArray(state[key]) ? state[key] : [];
  if (explicit.length) {
    const valid = new Set((state.financeAccounts || []).map((a) => a.id));
    return explicit.filter((id) => valid.has(id));
  }
  const inferKind = card === "emergency" ? "cash" : card;
  return (state.financeAccounts || []).filter((a) => financeAccountKind(a) === inferKind).map((a) => a.id);
}
// Sum of current balances for an explicit set of account ids.
function financeSumByAccountIds(ids, liveById) {
  const set = new Set(ids || []);
  let sum = 0, any = false;
  for (const a of (state.financeAccounts || [])) {
    if (!set.has(a.id)) continue;
    const bal = financeAccountBalance(a, liveById);
    if (bal !== null) { sum += bal; any = true; }
  }
  return any ? sum : null;
}

let financeLinkStatus = null; // null = unknown yet
let financeLive = null;       // { accounts, errors, at }
let financeLiveLoading = false;
// Which month the finance page is showing ("YYYY-MM"). The budget is built to
// fit one calendar month, so the date bar pages through months — back to review
// past spend, forward to plan. Reset to the real current month on entry.
let financeViewMonth = new Date().toISOString().slice(0, 7);

function financeCurrentMonthKey() { return new Date().toISOString().slice(0, 7); }

function navigateFinanceMonth(delta) {
  const [y, m] = financeViewMonth.split("-").map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  financeViewMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  setWeekToolsMode("finance");
  renderFinancePage();
}
let financeLinkBusy = false;
let financeHistory = null;    // { "YYYY-MM-DD": { netWorth, balances } } from daily snapshots
let financeReceipts = null;   // email receipts extracted by the mail sweep

async function loadFinanceHistory() {
  const data = await callNetlifyFunction("simplefin", { action: "history" });
  financeHistory = (data?.days && typeof data.days === "object") ? data.days : {};
  if (getActiveAppArea() === "finance") renderFinancePage();
}

async function loadFinanceReceipts() {
  const data = await callNetlifyFunction("simplefin", { action: "receipts" });
  financeReceipts = Array.isArray(data?.receipts) ? data.receipts : [];
  if (getActiveAppArea() === "finance") renderFinancePage();
}

// Matches an email receipt to a spend transaction: same total (±2¢), dated
// within 4 days. Used to prefill the split editor with categorized portions.
function financeReceiptForTxn(t) {
  if (!financeReceipts || (t.amount || 0) >= 0) return null;
  const amt = Math.abs(t.amount);
  const tDate = new Date(t.posted || 0).getTime();
  return financeReceipts.find((r) => {
    if (Math.abs((Number(r.total) || 0) - amt) > 0.02) return false;
    if (!r.date) return true;
    return Math.abs(new Date(r.date).getTime() - tDate) <= 4 * 86400000;
  }) || null;
}

async function checkFinanceLinkStatus() {
  const data = await callNetlifyFunction("simplefin", { action: "status" });
  financeLinkStatus = data && !data.error ? data : { connected: false };
  if (getActiveAppArea() === "finance") renderFinancePage();
  refreshFinanceSettingsIfOpen();
  if (financeLinkStatus.connected && !financeLive) refreshFinanceLive();
}

// True when the app is served from a local dev host. Netlify functions then run
// on this machine, so any bridge call would go out from the home IP.
function isLocalDevHost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]" || h.endsWith(".local");
}

async function refreshFinanceLive(force = false) {
  if (financeLiveLoading) return;
  // Dev gate: never trigger a real SimpleFIN bridge fetch from localhost. In
  // local dev the "accounts" function runs on this machine, so a bridge fetch
  // would leave from the home IP and burn the bank's ~24-requests/day budget.
  // Instead read the Supabase cache (which production's daily cron keeps warm)
  // in cacheOnly mode: real balances show while developing, zero bridge risk.
  const devCacheOnly = isLocalDevHost();
  financeLiveLoading = true;
  if (getActiveAppArea() === "finance") renderFinancePage();
  refreshFinanceSettingsIfOpen();
  // 45 days so the current calendar month is always fully covered for actuals.
  // The server caches this (SimpleFIN expects ~24 req/day, not one per app
  // load) — force just requests a check against the 1h floor, it does not
  // guarantee a real bridge hit.
  const data = await callNetlifyFunction("simplefin", { action: "accounts", days: 45, force: devCacheOnly ? false : force, cacheOnly: devCacheOnly });
  financeLiveLoading = false;
  // Trust the server's fetchedAt (when the data actually came from the bank)
  // over the local clock, since a cache hit didn't just fetch anything.
  const at = data?.fetchedAt ? new Date(data.fetchedAt).getTime() : Date.now();
  financeLive = data?.accounts
    ? { accounts: data.accounts, errors: data.errors || [], at }
    : { accounts: [], errors: [data?.error || "Could not reach the bank bridge."], at: Date.now() };
  invalidateFinanceLabeled(); // fresh accounts payload — the cache (now decoupled from financeLive) needs a nudge
  updateFinanceMonthActuals();
  updateFinanceRecurring();
  setPageNotifCount("finance", financeBellCount());
  if (financeHistory === null) loadFinanceHistory();
  if (financeReceipts === null) loadFinanceReceipts();
  if (getActiveAppArea() === "finance") renderFinancePage();
  refreshFinanceSettingsIfOpen();
}

async function linkFinanceBanks() {
  const input = document.getElementById("finSetupToken");
  const setupToken = input?.value.trim();
  if (!setupToken || financeLinkBusy) return;
  financeLinkBusy = true;
  renderFinancePage();
  const data = await callNetlifyFunction("simplefin", { action: "setup", setupToken });
  financeLinkBusy = false;
  if (data?.ok) {
    financeLinkStatus = { connected: true, connectedAt: new Date().toISOString() };
    refreshFinanceLive();
  } else {
    alert("Bank link failed: " + (data?.error || "unknown error"));
  }
  renderFinancePage();
}

// ── Transaction budget labels ────────────────────────────────────────────────
// Label keys: "income", "mgmt" (account management — transfers/CC payments,
// invisible to budgeting), or "cat:<groupId>:<categoryId>". Explicit labels
// live in financeTxnLabels (txnId → key). financeTxnRules learns merchant →
// label counts from MANUAL labels only, so auto-labels never train themselves.
let financeNotifOpen = false;
const financeTxnFilter = { q: "", kind: "", account: "", sort: "date" };
let financeTxnFilterOpen = false;
// Redesigned finance page: an always-on Overview band + a working area switched
// between these tabs. "transactions" is the default (purchase tracking is primary).
let financeTab = "transactions";
const FINANCE_TABS = [
  { id: "transactions", label: "Transactions" },
  { id: "budget", label: "Budget" },
  { id: "accounts", label: "Accounts" },
  { id: "insights", label: "Insights" },
];
// Budget tab: live client-side filter over category names (applied without a
// full re-render; re-applied after each render so it survives edits).
let financeBudgetSearch = "";
// Budget groups are an accordion — one open at a time (null = all collapsed).
// A search overrides it (opens all so the filter can reach every category).
let financeBudgetOpenGroup = null;
// The transaction list renders a light default slice (FIN_TXN_LIST_CAP); a
// "Show all" toggle lifts it so months with more txns than the cap are fully
// reachable for labeling. Reset on month change so each month starts collapsed.
let financeTxnListExpanded = false;

const FIN_MERCHANT_STOPWORDS = new Set(["pos", "debit", "credit", "card", "purchase", "ach", "web", "id", "des", "co", "the", "of", "and", "inc", "llc", "com"]);
function financeMerchantTokens(desc) {
  return String(desc || "").toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !FIN_MERCHANT_STOPWORDS.has(t));
}
function financeMerchantKey(desc) { return financeMerchantTokens(desc).slice(0, 3).join(" "); }

// Majority-vote default for a merchant's purchase note — same shape as
// predictMailFolder's sender-count fallback and financeTxnRuleGuess's
// merchant→label learning: requires 2+ manually-saved notes and >=60%
// agreement before suggesting one, so a single one-off edit doesn't
// immediately become everyone else's default. "" is a valid, countable vote
// (explicitly clearing a note is a real signal too).
function financeSuggestedNote(counts) {
  if (!counts || typeof counts !== "object") return "";
  let best = "", n = 0, total = 0;
  for (const [note, c] of Object.entries(counts)) {
    total += Number(c) || 0;
    if (Number(c) > n) { n = Number(c); best = note; }
  }
  return (n >= 2 && n / total >= 0.6) ? best : "";
}

function financeTxnRuleGuess(desc) {
  const key = financeMerchantKey(desc);
  const counts = key && state.financeTxnRules?.[key];
  if (!counts || typeof counts !== "object") return null;
  let best = null, n = 0, total = 0;
  for (const [k, c] of Object.entries(counts)) {
    total += Number(c) || 0;
    if (Number(c) > n) { n = Number(c); best = k; }
  }
  return (n >= 2 && n / total >= 0.6) ? best : null;
}

const FIN_MGMT_KEYWORDS = /payment thank you|autopay|auto pay|online payment|internet transfer|online transfer|transfer (to|from)|crcardpmt|epay/i;
const FIN_INCOME_KEYWORDS = /payroll|direct dep|dir dep|dirdep|salary/i;

// Cache is decoupled from financeLive (rather than living on it, like it used
// to) so manually-entered transactions still get the same dedupe/labeling/
// caching treatment on households that haven't linked a bank yet.
let financeLabeledCache = null;
function invalidateFinanceLabeled() { financeLabeledCache = null; }

// Flattened transactions with resolved labels; cached per live payload +
// manual-entry list.
function financeLabeledTxns() {
  if (financeLabeledCache) return financeLabeledCache;
  // A handful of institutions/rails (seen with P2P "gift" deposits) report a
  // transaction's amount with the wrong sign — money received shows up as a
  // debit. financeTxnSignFlips holds manually-confirmed corrections; applied
  // here, first, so every downstream check (dedupe, mgmt-pair transfer
  // detection, income keywords, portions, return matching) sees the true sign.
  const flips = state.financeTxnSignFlips || {};
  const bankTxns = (financeLive?.accounts || []).flatMap((a) =>
    a.transactions.map((t) => ({
      ...t,
      accountId: a.id,
      account: `${a.org}${a.org && a.name ? " — " : ""}${a.name}`,
      amount: flips[t.id] ? -(t.amount || 0) : (t.amount || 0),
      signFlipped: Boolean(flips[t.id])
    })));
  // Manual entries (cash, an unlinked account, a gift, …) flow through the
  // exact same pipeline below — dedupe, labeling, notes, splits, return
  // linking — so they behave identically to a bank-sourced transaction
  // everywhere except they came from the "+ Add transaction" form instead of
  // SimpleFIN. Kept out of any real linked account's id (own "manual:<slug>"
  // pseudo-account) so they can never collide with or double-count a bank
  // transaction, and so mgmt-pair transfer detection can't pair them against
  // a real account by accident.
  const manualTxns = (state.financeManualTxns || []).map((m) => ({
    id: m.id,
    accountId: `manual:${(m.account || "cash").trim().toLowerCase().replace(/\s+/g, "-") || "cash"}`,
    account: m.account || "Cash",
    posted: m.posted,
    amount: Number(m.amount) || 0,
    description: m.description || "",
    pending: false,
    isManual: true
  }));
  if (!bankTxns.length && !manualTxns.length) return [];
  let txns = [...bankTxns, ...manualTxns];

  // Pending→posted dedupe: banks reissue transaction ids when a pending
  // charge posts, which would double-count anything labeled while pending.
  // Same account + same amount + shared merchant token + ≤7d apart → keep
  // the posted copy and migrate any label from the pending id.
  {
    const tokens = (d) => new Set(financeMerchantKey(d).split(" ").filter(Boolean));
    const byKey = new Map();
    for (const t of txns) {
      const k = `${t.accountId}|${(t.amount || 0).toFixed(2)}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(t);
    }
    const dropIds = new Set();
    let migrated = false;
    for (const group of byKey.values()) {
      const posted = group.filter((t) => !t.pending);
      for (const p of group.filter((t) => t.pending)) {
        const pTok = tokens(p.description);
        const match = posted.find((q) =>
          Math.abs(new Date(p.posted || 0) - new Date(q.posted || 0)) <= 7 * 86400000 &&
          [...pTok].some((tok) => tokens(q.description).has(tok)));
        if (!match) continue;
        dropIds.add(p.id);
        const ex = state.financeTxnLabels || {};
        if (ex[p.id] && !ex[match.id]) {
          ex[match.id] = ex[p.id];
          delete ex[p.id];
          migrated = true;
        }
      }
    }
    if (dropIds.size) txns = txns.filter((t) => !dropIds.has(t.id));
    if (migrated) persist();
  }

  // Self-canceling pairs (same account, same day, same amount, same merchant,
  // opposite signs — e.g. "ISHARES TRUST 4.04" + "ISHARES TRUST -4.04") net to
  // zero and are pure noise: hide them here so they're gone from the list AND
  // don't inflate the "to label" count. Never touches a user-labeled txn.
  const offsetting = financeOffsettingPairIds(txns, financeMerchantKey, (id) => Boolean((state.financeTxnLabels || {})[id]));
  if (offsetting.size) txns = txns.filter((t) => !offsetting.has(t.id));

  // Transfer pairs: same magnitude, opposite signs, different accounts, ≤5d apart
  const mgmtPairs = new Set();
  const byAmt = new Map();
  for (const t of txns) {
    if (!t.amount) continue;
    const k = Math.abs(t.amount).toFixed(2);
    if (!byAmt.has(k)) byAmt.set(k, []);
    byAmt.get(k).push(t);
  }
  for (const group of byAmt.values()) {
    for (const a of group) for (const b of group) {
      if (a === b || a.accountId === b.accountId) continue;
      if ((a.amount > 0) === (b.amount > 0)) continue;
      if (Math.abs(new Date(a.posted || 0) - new Date(b.posted || 0)) <= 5 * 86400000) {
        mgmtPairs.add(a.id); mgmtPairs.add(b.id);
      }
    }
  }
  const names = state.financeMerchantNames || {};
  const noteOverrides = state.financeTxnNoteOverrides || {};
  const noteCounts = state.financeTxnNoteCounts || {};
  const explicit = state.financeTxnLabels || {};
  for (const t of txns) {
    // Raw bank text stays on t.description; this is purely presentation, so
    // filters/rules/split-editor headers etc. can all just read displayName.
    // Format is "<store/account> - <what was purchased>": the store part is
    // shared across every transaction with the same merchant key (renaming
    // one Trader Joe's renames them all). The note is always a per-transaction
    // override (financeTxnNoteOverrides) — editing one transaction's note
    // never touches another's, exactly like mailMoveMemory's per-thread
    // memory. Transactions with no override of their own default to the
    // merchant's majority note (financeSuggestedNote), the same "sender
    // usually goes to X" fallback the Mail page uses for folder suggestions.
    const merchantKey = financeMerchantKey(t.description);
    const merchantPart = names[merchantKey] || t.description;
    const hasOverride = Object.prototype.hasOwnProperty.call(noteOverrides, t.id);
    const note = hasOverride ? noteOverrides[t.id] : financeSuggestedNote(noteCounts[merchantKey]);
    t.noteIsOverride = hasOverride;
    t.displayName = note ? `${merchantPart} - ${note}` : merchantPart;
    const ex = explicit[t.id];
    if (ex) {
      // A split stores { split: [{label, amount}] } — amounts are positive
      // magnitudes; portions land in their categories individually.
      if (typeof ex === "object" && Array.isArray(ex.split)) { t.label = "split"; t.split = ex.split; }
      else t.label = ex;
      t.labelSource = "manual";
      continue;
    }
    const rule = financeTxnRuleGuess(t.description);
    if (rule) { t.label = rule; t.labelSource = "auto"; continue; }
    if (mgmtPairs.has(t.id) || FIN_MGMT_KEYWORDS.test(t.description)) { t.label = "mgmt"; t.labelSource = "auto"; continue; }
    if ((t.amount || 0) > 0 && FIN_INCOME_KEYWORDS.test(t.description)) { t.label = "income"; t.labelSource = "auto"; continue; }
    t.label = ""; t.labelSource = "";
  }

  // Linked returns: a manually-confirmed return→purchase link (financeTxnLinks)
  // borrows the purchase's category label, so its positive credit amount nets
  // against that category via the ordinary (non-income) financeTxnPortions
  // formula below — no separate "refund" total to keep in sync elsewhere.
  // An explicit manual label on the return itself still wins over a link.
  const links = state.financeTxnLinks || {};
  const byId = new Map(txns.map((t) => [t.id, t]));
  for (const [retId, purchaseId] of Object.entries(links)) {
    const ret = byId.get(retId);
    const purchase = byId.get(purchaseId);
    if (!ret || !purchase || explicit[retId]) continue;
    if (!purchase.label || purchase.label === "split" || purchase.label === "mgmt" || purchase.label === "income" || purchase.label.startsWith("income:")) continue;
    ret.label = purchase.label;
    ret.labelSource = "linked";
    ret.linkedPurchaseId = purchaseId;
    (purchase.linkedReturnIds || (purchase.linkedReturnIds = [])).push(retId);
  }

  txns.sort((x, y) => (y.posted || "").localeCompare(x.posted || ""));
  financeLabeledCache = txns;
  return txns;
}

// Best-guess original purchase for a return/credit: same account, opposite
// sign, overlapping merchant tokens, purchase posted before the return within
// a 60-day window, and enough unreturned amount left on the purchase to cover
// it (accounts for earlier partial-return links). Suggestion only — nothing
// links until the user clicks "Link as return".
function financeLinkedReturnsTotal(purchaseId, allTxns) {
  const links = state.financeTxnLinks || {};
  let total = 0;
  for (const [retId, pid] of Object.entries(links)) {
    if (pid !== purchaseId) continue;
    const r = allTxns.find((x) => x.id === retId);
    if (r) total += r.amount || 0;
  }
  return total;
}

function financeSuggestReturnMatch(t, allTxns) {
  if ((t.amount || 0) <= 0 || state.financeTxnLinks?.[t.id]) return null;
  const retTokens = new Set(financeMerchantKey(t.description).split(" ").filter(Boolean));
  if (!retTokens.size) return null;
  const retTime = new Date(t.posted || 0).getTime();
  let best = null, bestScore = -Infinity;
  for (const p of allTxns) {
    if (p.id === t.id || p.accountId !== t.accountId || (p.amount || 0) >= 0) continue;
    if (!p.label || ["split", "mgmt", "income"].includes(p.label) || p.label.startsWith("income:")) continue;
    const pTokens = new Set(financeMerchantKey(p.description).split(" ").filter(Boolean));
    if (![...retTokens].some((tok) => pTokens.has(tok))) continue;
    const days = (retTime - new Date(p.posted || 0).getTime()) / 86400000;
    if (days < 0 || days > 60) continue;
    const available = Math.abs(p.amount) - financeLinkedReturnsTotal(p.id, allTxns);
    if (available < t.amount - 0.01) continue;
    const score = -days - Math.abs(available - t.amount) * 0.1;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// Manual fallback for when the auto-suggestion misses (different account,
// no merchant-token overlap, older than 60 days, etc.) — same eligibility
// rules as financeSuggestReturnMatch minus the account/token/date narrowing.
let financeReturnLinkSearch = null; // { txnId, q }

function financeReturnLinkCandidates(t, allTxns, query) {
  const q = String(query || "").trim().toLowerCase();
  return allTxns
    .filter((p) => p.id !== t.id && (p.amount || 0) < 0 && p.label && !["split", "mgmt", "income"].includes(p.label) && !p.label.startsWith("income:"))
    .filter((p) => Math.abs(p.amount) - financeLinkedReturnsTotal(p.id, allTxns) >= t.amount - 0.01)
    .filter((p) => !q || (p.displayName || p.description || "").toLowerCase().includes(q))
    .sort((a, b) => (b.posted || "").localeCompare(a.posted || ""))
    .slice(0, 8);
}

function recordFinanceTxnLink(returnId, purchaseId) {
  if (!state.financeTxnLinks || typeof state.financeTxnLinks !== "object") state.financeTxnLinks = {};
  delete state.financeTxnLinks[returnId]; // re-insert so the cap evicts least-recent
  state.financeTxnLinks[returnId] = purchaseId;
  const ids = Object.keys(state.financeTxnLinks);
  for (let i = 0; i < ids.length - 600; i++) delete state.financeTxnLinks[ids[i]];
  financeReturnLinkSearch = null;
  invalidateFinanceLabeled();
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
  renderFinancePage();
}

function clearFinanceTxnLink(returnId) {
  if (!state.financeTxnLinks) return;
  delete state.financeTxnLinks[returnId];
  invalidateFinanceLabeled();
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
  renderFinancePage();
}

// A handful of institutions report certain transactions (P2P "gift"
// deposits seen so far) with an inverted sign — money received posts as a
// debit. This is a manual, per-transaction correction; toggling it flips
// the effective sign everywhere (financeLabeledTxns applies it first, before
// dedupe/labeling/portions), so it behaves exactly as if the bank had
// reported it correctly.
function toggleFinanceTxnSignFlip(txnId) {
  if (!state.financeTxnSignFlips || typeof state.financeTxnSignFlips !== "object") state.financeTxnSignFlips = {};
  const flips = state.financeTxnSignFlips;
  if (flips[txnId]) {
    delete flips[txnId];
  } else {
    flips[txnId] = true;
    const ids = Object.keys(flips);
    for (let i = 0; i < ids.length - 600; i++) delete flips[ids[i]];
  }
  invalidateFinanceLabeled();
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
  renderFinancePage();
}

// ── Manually-entered transactions (cash, an unlinked account, …) ────────────
// Draft shape while the form is open: { id: null|existingId, date, desc,
// amount, account, label }. id is null while adding, or the existing
// financeManualTxns row's id while editing (openManualTxnForm(existing)).
let financeManualForm = null;

function openManualTxnForm(existing) {
  financeManualForm = existing
    ? { id: existing.id, date: (existing.posted || "").slice(0, 10), desc: existing.description || "", amount: String(existing.amount ?? ""), account: existing.account || "", label: (state.financeTxnLabels || {})[existing.id] || "" }
    : { id: null, date: new Date().toISOString().slice(0, 10), desc: "", amount: "", account: "", label: "" };
  financeTab = "transactions"; financeExpanded.add("card:txns");
  renderFinancePage();
}

function cancelManualTxnForm() {
  financeManualForm = null;
  renderFinancePage();
}

function saveManualTxnForm(fields) {
  const amount = parseFinAmount(fields.amount);
  const desc = String(fields.desc || "").trim().slice(0, 120);
  if (!desc || !Number.isFinite(amount) || !amount) { alert("Enter a description and a non-zero amount."); return; }
  if (!state.financeManualTxns) state.financeManualTxns = [];
  const entry = {
    id: fields.id || createId("fin-man"),
    posted: /^\d{4}-\d{2}-\d{2}$/.test(fields.date) ? `${fields.date}T12:00:00.000Z` : new Date().toISOString(),
    amount,
    description: desc,
    account: String(fields.account || "").trim().slice(0, 60) || "Cash"
  };
  const i = state.financeManualTxns.findIndex((m) => m.id === entry.id);
  if (i >= 0) state.financeManualTxns[i] = entry; else state.financeManualTxns.unshift(entry);
  if (fields.label) recordFinanceTxnLabel(entry.id, fields.label, desc);
  else if (state.financeTxnLabels) delete state.financeTxnLabels[entry.id];
  invalidateFinanceLabeled();
  financeManualForm = null;
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
  renderFinancePage();
}

function deleteManualTxn(id) {
  if (!state.financeManualTxns || !confirm("Delete this transaction?")) return;
  state.financeManualTxns = state.financeManualTxns.filter((m) => m.id !== id);
  if (state.financeTxnLabels) delete state.financeTxnLabels[id];
  if (state.financeTxnNoteOverrides) delete state.financeTxnNoteOverrides[id];
  if (state.financeTxnReceipts && state.financeTxnReceipts[id]) deleteReceiptImage(id).catch(() => {});
  if (state.financeTxnLinks) {
    delete state.financeTxnLinks[id]; // this txn as a return, linked to some purchase
    for (const [retId, purchaseId] of Object.entries(state.financeTxnLinks)) {
      if (purchaseId === id) delete state.financeTxnLinks[retId]; // this txn as the purchase a return pointed to
    }
  }
  invalidateFinanceLabeled();
  financeDetailTxnId = financeDetailTxnId === id ? null : financeDetailTxnId;
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
  renderFinancePage();
}

// Normalizes a labeled transaction into portions with signed amounts the
// aggregators expect: positive spend for cat portions, positive received for
// income portions. Splits contribute each portion; mgmt portions match no
// branch downstream and so stay out of every total by construction.
function financeTxnPortions(t) {
  if (t.label === "split" && Array.isArray(t.split)) {
    return t.split
      .filter((p) => p.label && Number(p.amount) > 0)
      .map((p) => ({ label: p.label, amount: Number(p.amount) }));
  }
  if (!t.label) return [];
  const isIncome = t.label === "income" || t.label.startsWith("income:");
  return [{ label: t.label, amount: isIncome ? (t.amount || 0) : -(t.amount || 0) }];
}

function financeTxnLabelName(key) {
  if (key === "income") return "Income";
  if (key === "mgmt") return "Account mgmt";
  const k = String(key || "");
  if (k.startsWith("income:")) {
    const p = (state.financePeople || []).find((x) => x.id === k.slice(7));
    return p ? `Income · ${p.name}` : "Income";
  }
  const [, gId, cId] = k.split(":");
  const g = (state.financeBudgetGroups || []).find((x) => x.id === gId);
  const c = g?.categories.find((x) => x.id === cId);
  return g && c ? `${g.label} · ${c.name}` : "";
}

function financeTxnLabelOptionsHtml(selected) {
  return `
    <optgroup label="Income">
      ${(state.financePeople || []).map((p) => {
        const key = `income:${p.id}`;
        return `<option value="${key}" ${selected === key ? "selected" : ""}>${escapeHtml(p.name)}</option>`;
      }).join("")}
      <option value="income" ${selected === "income" ? "selected" : ""}>Other income</option>
    </optgroup>
    <option value="mgmt" ${selected === "mgmt" ? "selected" : ""}>Account management</option>
    ${(state.financeBudgetGroups || []).map((g) => `
      <optgroup label="${escapeHtml(g.label)}">
        ${g.categories.map((c) => {
          const key = `cat:${g.id}:${c.id}`;
          return `<option value="${key}" ${selected === key ? "selected" : ""}>${escapeHtml(c.name)}</option>`;
        }).join("")}
      </optgroup>`).join("")}`;
}

// ── Recurring charges ────────────────────────────────────────────────────────
// Detected from the live window: two same-merchant spend charges 24–38 days
// apart with amounts within ±15% mark the merchant recurring. Entries can be
// linked to a budget LINE ITEM, enabling price-change and missing-bill alerts.
function financeResolveLineItem(key) {
  const [kind, gId, cId, itemId] = String(key || "").split(":");
  if (kind !== "item") return null;
  const g = (state.financeBudgetGroups || []).find((x) => x.id === gId);
  const c = g?.categories.find((x) => x.id === cId);
  const it = c?.items.find((x) => x.id === itemId);
  return it ? { g, c, it } : null;
}

function financeLineItemOptionsHtml(selected) {
  return (state.financeBudgetGroups || []).map((g) => `
    <optgroup label="${escapeHtml(g.label)}">
      ${g.categories.flatMap((c) => c.items.map((it) => {
        const key = `item:${g.id}:${c.id}:${it.id}`;
        return `<option value="${key}" ${key === selected ? "selected" : ""}>${escapeHtml(c.name)} · ${escapeHtml(it.name || "(unnamed)")}</option>`;
      })).join("")}
    </optgroup>`).join("");
}

// Collapse recurring-charge entries to one per merchantKey. Entries are meant to
// be unique per merchant, but the merge unioned them by id, so independent
// creation across devices/boots piled up hundreds of duplicates — each firing
// its own bell alert. Fold duplicates into the most-recently-seen entry while
// PRESERVING answers: once acknowledged/linked anywhere, it stays answered.
// dedupeFinanceRecurring lives in ./finance-sync.js (extracted, unit-tested):
// recurring charges collapse per merchantKey, not per id, so two devices'
// independently-created entries for the same merchant never pile up as duplicates.

function updateFinanceRecurring() {
  if (!financeLive?.accounts?.length) return;
  // Self-heal any accumulated duplicates before processing (and persist the
  // collapse so the bloat leaves the synced state for good).
  const deduped = dedupeFinanceRecurring(state.financeRecurring);
  if (Array.isArray(state.financeRecurring) && deduped.length !== state.financeRecurring.length) {
    state.financeRecurring = deduped;
    persist();
  }
  const byMerchant = new Map();
  for (const t of financeLabeledTxns()) {
    if ((t.amount || 0) >= 0 || t.pending) continue;
    const k = financeMerchantKey(t.description);
    if (!k) continue;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }
  if (!Array.isArray(state.financeRecurring)) state.financeRecurring = [];
  let changed = false;
  for (const [mk, list] of byMerchant) {
    list.sort((a, b) => (a.posted || "").localeCompare(b.posted || ""));
    const latest = list[list.length - 1];
    let isRecurring = false;
    for (let i = 1; i < list.length; i++) {
      const gap = (new Date(list[i].posted || 0) - new Date(list[i - 1].posted || 0)) / 86400000;
      const ratio = Math.abs(list[i].amount) / (Math.abs(list[i - 1].amount) || 1);
      if (gap >= 24 && gap <= 38 && Math.abs(list[i].amount) >= 3 && ratio >= 0.85 && ratio <= 1.15) isRecurring = true;
    }
    const entry = state.financeRecurring.find((r) => r.merchantKey === mk);
    const seenDate = (latest.posted || "").slice(0, 10);
    const amt = Math.round(Math.abs(latest.amount) * 100) / 100;
    if (entry) {
      if (entry.lastSeen !== seenDate || entry.lastAmount !== amt) {
        entry.lastSeen = seenDate;
        entry.lastAmount = amt;
        entry.expectedDay = new Date(latest.posted || 0).getDate() || entry.expectedDay;
        changed = true;
      }
    } else if (isRecurring) {
      state.financeRecurring.push({
        id: createId("fin-rec"),
        merchantKey: mk,
        name: String(latest.description || mk).slice(0, 48),
        lineItemKey: "",
        expectedDay: new Date(latest.posted || 0).getDate() || 1,
        lastAmount: amt,
        lastSeen: seenDate,
        active: true,
        ackAmount: null,
        missAck: "",
        newAck: false
      });
      changed = true;
    }
  }
  // Prune merchants not seen in a year — otherwise a one-off recurring-looking
  // charge (a gym trial, a seasonal purchase) sits in synced state forever.
  const cutoff = Date.now() - 365 * 86400000;
  const before = state.financeRecurring.length;
  state.financeRecurring = state.financeRecurring.filter((r) => !r.lastSeen || new Date(r.lastSeen).getTime() >= cutoff);
  if (state.financeRecurring.length !== before) changed = true;
  if (changed) persist();
}

// Recurring charges that haven't posted yet THIS month — the upcoming bills.
// Derived purely from the detected recurring list (no new data), sorted by the
// day of the month they're expected, with a flag for ones already past-due.
function financeUpcomingBills(now = new Date()) {
  const curMonth = now.toISOString().slice(0, 7);
  const today = now.getDate();
  const bills = (state.financeRecurring || [])
    .filter((r) => r.active !== false && (r.lastSeen || "").slice(0, 7) !== curMonth)
    .map((r) => {
      const dueDay = Math.min(Math.max(1, r.expectedDay || 1), 28);
      return { id: r.id, name: r.name, amount: r.lastAmount || 0, dueDay, overdue: dueDay < today };
    })
    .sort((a, b) => a.dueDay - b.dueDay);
  const total = bills.reduce((s, b) => s + (b.amount || 0), 0);
  return { bills, total };
}

// Spending trend from the persisted monthly snapshots (financeMonthActuals):
// total spend for the last 6 months + the categories that moved most vs their
// 3-month average. Pure derivation from data we already keep — no new state.
function financeSpendTrends(viewMonth) {
  const ma = (state.financeMonthActuals && typeof state.financeMonthActuals === "object") ? state.financeMonthActuals : {};
  const monthSpend = (m) => { const e = ma[m]; if (!e || !e.cats) return null; return Object.values(e.cats).reduce((s, v) => s + Math.abs(Number(v) || 0), 0); };
  const [y, mo] = viewMonth.split("-").map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(new Date(y, mo - 1 - i, 1).toISOString().slice(0, 7));
  const series = months.map((m) => ({ month: m, spend: monthSpend(m) }));
  const priorMonths = months.slice(2, 5); // the 3 months before the viewed one
  const curCats = ma[viewMonth]?.cats || {};
  const keys = new Set(Object.keys(curCats));
  for (const m of priorMonths) for (const k of Object.keys(ma[m]?.cats || {})) keys.add(k);
  const movers = [];
  for (const k of keys) {
    const cur = Math.abs(Number(curCats[k]) || 0);
    const priorVals = priorMonths.map((m) => ma[m]?.cats?.[k]).filter((v) => v != null).map((v) => Math.abs(Number(v) || 0));
    const avg = priorVals.length ? priorVals.reduce((s, v) => s + v, 0) / priorVals.length : 0;
    if (cur < 5 && avg < 5) continue;
    const delta = cur - avg;
    movers.push({ key: k, name: financeTxnLabelName(`cat:${k}`), cur, avg, delta, pct: avg > 0 ? Math.round((delta / avg) * 100) : null });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { series, movers: movers.slice(0, 5), hasData: series.some((s) => s.spend != null) };
}

// Average actual spend for one category over the last N complete months (from the
// persisted monthly snapshots). null when there's no history to average.
function financeCategoryHistoryAvg(gid, cid, months = 3) {
  const ma = (state.financeMonthActuals && typeof state.financeMonthActuals === "object") ? state.financeMonthActuals : {};
  const now = new Date();
  const vals = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = ma[d.toISOString().slice(0, 7)]?.cats?.[`${gid}:${cid}`];
    if (v != null) vals.push(Math.abs(Number(v) || 0));
  }
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
}
// Set a category's budget to a target WITHOUT deleting any line items (so the
// finance merge — which resurrects untombstoned items — stays safe): single-item
// → set it; multi-item → scale proportionally; pick → set the active option.
function financeSetCategoryBudget(c, target) {
  if (!c) return;
  if (c.mode === "pick") { const ai = financeCategoryActiveItem(c) || (c.items || [])[0]; if (ai) ai.amount = target; else c.items = [{ id: createId("fin-item"), name: "Monthly", amount: target }]; return; }
  if (!c.items || !c.items.length) { c.items = [{ id: createId("fin-item"), name: "Monthly", amount: target }]; return; }
  if (c.items.length === 1) { c.items[0].amount = target; return; }
  const cur = c.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  if (cur > 0) { const f = target / cur; c.items.forEach((it) => { it.amount = Math.round((Number(it.amount) || 0) * f); }); }
  else c.items[0].amount = target;
}

// Cash flow (money in vs out) for the last 6 months, from the monthly snapshots.
function financeCashFlow(viewMonth) {
  const ma = (state.financeMonthActuals && typeof state.financeMonthActuals === "object") ? state.financeMonthActuals : {};
  const [y, mo] = viewMonth.split("-").map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(new Date(y, mo - 1 - i, 1).toISOString().slice(0, 7));
  const series = months.map((m) => {
    const e = ma[m];
    const income = e && e.income != null ? Math.abs(Number(e.income) || 0) : null;
    const spend = e && e.cats ? Object.values(e.cats).reduce((s, v) => s + Math.abs(Number(v) || 0), 0) : null;
    return { month: m, income, spend };
  });
  return { series, hasData: series.some((s) => s.income != null || s.spend != null) };
}

// Alerts the bell surfaces. kinds: "new" (unlinked recurring found),
// "price" (charge differs from its budget line), "missing" (expected charge
// hasn't arrived this month).
function financeRecurringAlerts() {
  const out = [];
  const today = new Date();
  const monthKey = today.toISOString().slice(0, 7);
  for (const r of (state.financeRecurring || [])) {
    if (!r.active || !r.lastSeen) continue;
    if ((today - new Date(r.lastSeen)) / 86400000 > 75) continue; // stale — stop nagging
    if (!r.lineItemKey) {
      if (!r.newAck) out.push({ kind: "new", r });
      continue;
    }
    const li = financeResolveLineItem(r.lineItemKey);
    if (li) {
      const diff = Math.abs((r.lastAmount || 0) - (li.it.amount || 0));
      if (financeAlertPref("priceChange") && diff > Math.max(0.5, 0.02 * (li.it.amount || 0)) && r.ackAmount !== r.lastAmount) {
        out.push({ kind: "price", r, li });
      }
    }
    const seenMonth = r.lastSeen.slice(0, 7);
    if (seenMonth < monthKey && today.getDate() > Math.min(28, (r.expectedDay || 1) + 5) && r.missAck !== monthKey) {
      out.push({ kind: "missing", r });
    }
  }
  return out;
}

// Unlabeled transactions collapsed to one row per merchant. A recurring debit
// (e.g. a monthly loan withdrawal) otherwise shows up as one nag per month —
// eight "electronic withdrawal firstmark" lines when it should be a single
// "label this merchant" prompt. Labeling the representative learns a merchant
// rule (recordFinanceTxnLabel) that auto-labels every sibling, so the whole
// group clears at once. The newest posting represents the group.
function financeUnlabeledByMerchant(txns) {
  const skips = (state.financeLabelSkips && typeof state.financeLabelSkips === "object") ? state.financeLabelSkips : {};
  const snoozes = (state.financeLabelSnoozes && typeof state.financeLabelSnoozes === "object") ? state.financeLabelSnoozes : {};
  const dismissed = (state.financeNotifDismissed && typeof state.financeNotifDismissed === "object") ? state.financeNotifDismissed : {};
  const today = dateKeyFromDate(new Date());
  const byKey = new Map();
  for (const t of (txns || [])) {
    if (t.label) continue;
    if (dismissed[t.id]) continue; // swiped left out of the notifications deck (keeps its red list dot until confirmed)
    const k = financeMerchantKey(t.description) || `id:${t.id}`;
    if (skips[k]) continue; // user chose to skip labeling this merchant's charges
    if (snoozes[k] === today) continue; // snoozed for today — returns tomorrow
    const g = byKey.get(k);
    if (!g) { byKey.set(k, { key: k, rep: t, count: 1 }); continue; }
    g.count++;
    if ((t.posted || "") > (g.rep.posted || "")) g.rep = t;
  }
  return [...byKey.values()];
}
function financeUnlabeledCount() {
  return financeUnlabeledByMerchant(financeLabeledTxns()).length;
}

// ── Transaction review: full-window swipe deck for labeling ───────────────────
// One transaction (merchant group) per window; scroll up/down to browse, pick a
// category to label it (drops it from the queue), swipe RIGHT when done to
// advance, swipe LEFT to snooze it for the day (returns tomorrow). Modeled on
// the Meal Plan recipe swipe view.
function financeSnoozeLabelGroup(key) {
  if (!key) return;
  if (!state.financeLabelSnoozes || typeof state.financeLabelSnoozes !== "object") state.financeLabelSnoozes = {};
  const today = dateKeyFromDate(new Date());
  // Anything not from today is already inert — prune so the map stays tiny.
  for (const k of Object.keys(state.financeLabelSnoozes)) if (state.financeLabelSnoozes[k] !== today) delete state.financeLabelSnoozes[k];
  state.financeLabelSnoozes[key] = today;
  persist();
}

// Swipe LEFT on a transaction card: drop every unlabeled charge from this
// merchant group out of the notifications deck, but leave a red "needs
// confirming" dot on each one's row in the Transactions list. The dot persists
// (even once the txn is later labeled) until the row is explicitly confirmed.
function financeDismissNotifGroup(key, repId) {
  if (!state.financeNotifDismissed || typeof state.financeNotifDismissed !== "object") state.financeNotifDismissed = {};
  const ids = new Set();
  if (repId) ids.add(repId);
  for (const t of financeLabeledTxns()) {
    if (t.label) continue;
    const k = financeMerchantKey(t.description) || `id:${t.id}`;
    if (k === key) ids.add(t.id);
  }
  for (const id of ids) state.financeNotifDismissed[id] = true;
  persist();
  setPageNotifCount("finance", financeBellCount());
}

// Manual confirm from the Transactions list — clears the red "needs confirming"
// dot for one transaction (the dot only clears on an explicit confirm).
function financeConfirmTxn(id) {
  if (!id) return;
  if (!state.financeTxnConfirmed || typeof state.financeTxnConfirmed !== "object") state.financeTxnConfirmed = {};
  state.financeTxnConfirmed[id] = true;
  persist();
}

// A transaction that was swiped out of the deck and not yet confirmed → shows a
// red, click-to-confirm dot on its list row.
function financeTxnNeedsConfirm(t) {
  const d = state.financeNotifDismissed, c = state.financeTxnConfirmed;
  return !!(d && d[t.id]) && !(c && c[t.id]);
}

function financeReviewGroups() {
  return financeUnlabeledByMerchant(financeLabeledTxns());
}

function openFinanceTxnReview() {
  if (!financeReviewGroups().length && !financeNotifDeckAlertsHtml()) { showMailToast("You're all caught up."); return; }
  financeNotifOpen = false;
  document.getElementById("finReviewOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "finReviewOverlay";
  overlay.className = "fin-review-overlay";
  overlay.innerHTML = `
    <div class="fin-review-modal" role="dialog" aria-modal="true" aria-label="Finance notifications">
      <div class="fin-review-head">
        <span class="fin-review-title">Notifications</span>
        <span class="fin-review-count" data-fin-review-count aria-live="polite"></span>
        <button class="fin-review-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="fin-review-deck" data-fin-review-deck tabindex="0"></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { commitAllFinanceReviewCards(overlay); overlay.remove(); if (getActiveAppArea() === "finance") renderFinancePage(); };
  overlay.querySelector(".fin-review-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) return close();
    if (e.target.closest("[data-fin-review-close]")) return close();
  });
  renderFinanceReviewDeck();
  wireFinanceReviewDeck(overlay);
  overlay.querySelector("[data-fin-review-deck]")?.focus();
}

// Non-transaction notifications rendered as their own (non-swipeable) cards at
// the top of the deck. They reuse the finance page's own action/select handlers
// (delegated in wireFinanceReviewDeck), so their buttons behave exactly as before.
function financeNotifAlertCardWrap(kicker, body) {
  return `
    <div class="fin-notif-card fin-notif-alert-card">
      <div class="fin-review-card-inner">
        <div class="fin-review-body">
          <div class="fin-notif-alert-kicker">${escapeHtml(kicker)}</div>
          ${body}
        </div>
        <div class="fin-review-hint" aria-hidden="true"><span>↑ ↓ browse</span></div>
      </div>
    </div>`;
}
function financeRecurringAlertCardHtml(a) {
  let body;
  if (a.kind === "new") {
    body = `
      <div class="fin-alert-text">New recurring charge: <b>${escapeHtml(a.r.name)}</b> · ${formatFinMoney(a.r.lastAmount)} around day ${a.r.expectedDay}</div>
      <div class="fin-item-row fin-item-row--tools">
        <select class="fin-scenario-select fin-editor-select" data-fin-edit="recurring-link" data-id="${a.r.id}" aria-label="Budget line for ${escapeHtml(a.r.name)}">
          <option value="">link to budget line…</option>
          ${financeLineItemOptionsHtml("")}
        </select>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="recurring-ignore" data-id="${a.r.id}">Ignore</button>
        <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="recurring-not" data-id="${a.r.id}">Not recurring</button>
      </div>`;
  } else if (a.kind === "price") {
    body = `
      <div class="fin-alert-text"><b>${escapeHtml(a.r.name)}</b> charged ${formatFinMoney(a.r.lastAmount)} — the "${escapeHtml(a.li.c.name)} · ${escapeHtml(a.li.it.name)}" line budgets ${formatFinMoney(a.li.it.amount)}</div>
      <div class="fin-item-row fin-item-row--tools">
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="recurring-price-update" data-id="${a.r.id}">Update line to ${formatFinMoney(a.r.lastAmount)}</button>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="recurring-price-keep" data-id="${a.r.id}">Keep budget</button>
      </div>`;
  } else {
    body = `
      <div class="fin-alert-text"><b>${escapeHtml(a.r.name)}</b> (~day ${a.r.expectedDay}, usually ${formatFinMoney(a.r.lastAmount)}) hasn't appeared this month</div>
      <div class="fin-item-row fin-item-row--tools">
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="recurring-miss-dismiss" data-id="${a.r.id}">Dismiss</button>
      </div>`;
  }
  return financeNotifAlertCardWrap("Recurring charge", body);
}
function financeAttentionCardHtml(a) {
  const body = `
    <div class="fin-alert-text"><b>${escapeHtml(a.label)}</b> — ${escapeHtml(a.detail)}</div>
    <div class="fin-item-row fin-item-row--tools">
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="dismiss-alert" data-key="${escapeHtml(a.key)}">Dismiss</button>
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="open-finance-settings">Open bank settings</button>
    </div>`;
  return financeNotifAlertCardWrap("Account needs attention", body);
}
function financeNotifDeckAlertsHtml() {
  const attention = financeAccountsNeedingAttention();
  const recAlerts = financeRecurringAlerts();
  return [
    ...attention.slice(0, 8).map(financeAttentionCardHtml),
    ...recAlerts.slice(0, 8).map(financeRecurringAlertCardHtml),
  ].join("");
}

function renderFinanceReviewDeck() {
  const deck = document.querySelector("[data-fin-review-deck]");
  if (!deck) return;
  const groups = financeReviewGroups();
  const alertsHtml = financeNotifDeckAlertsHtml();
  if (!groups.length && !alertsHtml) { updateFinanceReviewProgress(deck); return; } // paints the caught-up state
  const names = state.financeMerchantNames || {};
  const noteOverrides = state.financeTxnNoteOverrides || {};
  deck.innerHTML = alertsHtml + groups.map((g) => {
    const t = g.rep;
    const mKey = financeMerchantKey(t.description);
    const nameVal = names[mKey] || "";
    const noteVal = Object.prototype.hasOwnProperty.call(noteOverrides, t.id) ? (noteOverrides[t.id] || "") : "";
    const date = t.posted ? new Date(t.posted).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    // Bank facts (read-only): account · date · status. Manual entries say so.
    const status = t.isManual ? "Manual" : (t.pending ? "Pending" : (t.posted ? "Posted" : ""));
    const facts = [t.account, date, status].filter(Boolean).join(" · ");
    const merchantTitle = nameVal || t.description || "Transaction";
    const showRaw = nameVal && nameVal !== t.description; // renamed → surface the original bank text
    return `
    <div class="fin-review-card fin-notif-card" data-review-key="${escapeHtml(g.key)}" data-txn-id="${escapeHtml(t.id)}">
      <div class="fin-review-action fin-review-action-dismiss" aria-hidden="true">Skip ✕</div>
      <div class="fin-review-action fin-review-action-done" aria-hidden="true">✓ Approve</div>
      <div class="fin-review-card-inner">
        <div class="fin-review-body">
          <div class="fin-review-amount${(t.amount || 0) < 0 ? " is-neg" : ""}">${formatFinMoney(t.amount || 0)}</div>
          <div class="fin-review-merchant">${escapeHtml(merchantTitle)}</div>
          ${facts ? `<div class="fin-review-facts">${escapeHtml(facts)}</div>` : ""}
          ${showRaw ? `<div class="fin-review-raw">Bank: ${escapeHtml(t.description)}</div>` : ""}
          ${g.count > 1 ? `<div class="fin-review-group"><strong>${g.count} matching transactions</strong> from this merchant. Approving applies the category to all of them.</div>` : ""}
          <label class="fin-review-field">Category
            <select class="fin-txn-label fin-review-label" data-review-label data-id="${escapeHtml(t.id)}" data-desc="${escapeHtml(t.description)}" aria-label="Budget category">
              <option value="">Pick a category…</option>
              ${financeTxnLabelOptionsHtml("")}
            </select>
          </label>
          <label class="fin-review-field">Name
            <input type="text" class="fin-review-input" data-review-name value="${escapeHtml(nameVal)}" placeholder="${escapeHtml(t.description || "Merchant")}" aria-label="Merchant display name" />
          </label>
          <label class="fin-review-field">Note
            <input type="text" class="fin-review-input" data-review-note value="${escapeHtml(noteVal)}" placeholder="Add a note (optional)" maxlength="60" aria-label="Purchase note" />
          </label>
          <div class="fin-review-quick">${financeReviewQuickChipsHtml(t)}</div>
          <div class="fin-review-actions">
            <button class="fin-review-approve" type="button" data-fin-review-approve>✓ Approve</button>
            <button class="fin-review-secondary" type="button" data-fin-review-more>Edit details…</button>
            <button class="fin-review-secondary" type="button" data-fin-review-skip title="Remove from notifications; keeps a red dot on the transaction until you confirm it">Skip</button>
          </div>
        </div>
        <div class="fin-review-hint" aria-hidden="true"><span>← skip</span><span>↑ ↓ browse</span><span>approve →</span></div>
      </div>
    </div>`;
  }).join("");
  updateFinanceReviewProgress(deck);
}

// Progress + completion. Cards are removed one at a time as they're approved or
// skipped (never a full re-render), so any edits typed on other cards survive.
function updateFinanceReviewProgress(deck) {
  deck = deck || document.querySelector("[data-fin-review-deck]");
  if (!deck) return;
  const cards = [...deck.querySelectorAll(".fin-notif-card")];
  const countEl = document.querySelector("[data-fin-review-count]");
  if (!cards.length) {
    deck.innerHTML = `<div class="fin-review-empty">
      <div class="fin-review-empty-check" aria-hidden="true">✓</div>
      <div class="fin-review-empty-title">All caught up</div>
      <div class="fin-review-empty-sub">You've cleared every finance notification.</div>
      <button class="fin-review-approve" type="button" data-fin-review-close>Back to Transactions</button>
    </div>`;
    if (countEl) countEl.textContent = "";
    return;
  }
  const idx = deck.clientHeight ? Math.round(deck.scrollTop / deck.clientHeight) : 0;
  if (countEl) countEl.textContent = `${Math.min(idx + 1, cards.length)} of ${cards.length}`;
}

const finReviewReduceMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fling/collapse the card off, then remove it and refresh progress. Approve
// flings right (matching the gesture); skip collapses in place.
function finishFinanceReviewCard(card, kind) {
  if (!card) return;
  const deck = card.closest("[data-fin-review-deck]");
  const inner = card.querySelector(".fin-review-card-inner");
  const done = () => { card.remove(); updateFinanceReviewProgress(deck); };
  if (inner && !finReviewReduceMotion()) {
    inner.style.transition = "transform 0.22s ease, opacity 0.22s ease";
    inner.style.transform = kind === "approve" ? "translateX(120%) rotate(6deg)"
      : kind === "dismiss" ? "translateX(-120%) rotate(-6deg)"
      : "scale(0.96)";
    inner.style.opacity = "0";
    setTimeout(done, 210);
  } else {
    done();
  }
}

// Swipe LEFT: drop this transaction group from the notifications deck. Its list
// rows keep a red "needs confirming" dot until each is explicitly confirmed.
function dismissFinanceReviewCard(card) {
  if (!card) return;
  financeDismissNotifGroup(card.dataset.reviewKey, card.dataset.txnId);
  finishFinanceReviewCard(card, "dismiss");
}

// Approve = commit this review card and drop it from the queue. Requires a
// category (the whole point of the queue is labeling); a bare approval nudges
// the picker instead of silently doing nothing. Reuses the existing persistence
// (saveRenameTxn for name/note, recordFinanceTxnLabel for the category + the
// learned merchant rule that clears the whole matching group).
// Commit a card's staged edits (category + name/note) exactly once, via the
// existing persistence. Guarded with a once-only flag so a commit can't run
// twice for the same card — e.g. a fast double-tap during the 210ms approve
// fling, or an approve immediately followed by a close — which would otherwise
// double-count the learned merchant/note majority votes. Returns true if
// anything was written. Called by both approve AND every close path, so a
// picked category / typed name / typed note is never silently discarded.
function commitFinanceReviewEdits(card) {
  if (!card || card.dataset.finReviewCommitted === "1") return false;
  const sel = card.querySelector("[data-review-label]");
  if (!sel) return false;
  const cat = sel.value || "";
  const nameInput = card.querySelector("[data-review-name]");
  const noteInput = card.querySelector("[data-review-note]");
  const nameChanged = nameInput && nameInput.value !== nameInput.defaultValue;
  const noteChanged = noteInput && noteInput.value !== noteInput.defaultValue;
  if (!cat && !nameChanged && !noteChanged) return false; // nothing staged → leave it reviewable
  card.dataset.finReviewCommitted = "1";
  if (nameChanged || noteChanged) saveRenameTxn(sel.dataset.id, sel.dataset.desc || "", nameInput.value, noteInput.value);
  if (cat) recordFinanceTxnLabel(sel.dataset.id, cat, sel.dataset.desc || ""); // labels + learns the merchant rule + updates the bell count
  return true;
}

function commitAllFinanceReviewCards(root) {
  (root || document).querySelectorAll?.(".fin-review-card").forEach(commitFinanceReviewEdits);
}

function approveFinanceReviewCard(card) {
  if (!card || card.dataset.finReviewCommitted === "1") return false; // already committed (mid-fling)
  const sel = card.querySelector("[data-review-label]");
  if (!(sel && sel.value)) { // approval requires a category — nudge instead of a silent no-op
    card.classList.add("fin-review-need-cat");
    setTimeout(() => card.classList.remove("fin-review-need-cat"), 1200);
    try { sel?.focus(); } catch { /* not focusable */ }
    return false;
  }
  commitFinanceReviewEdits(card);
  finishFinanceReviewCard(card, "approve");
  return true;
}

function skipFinanceReviewCard(card) {
  // The "Skip" button mirrors a left swipe: drop it from notifications and leave
  // a red confirming-dot on the list (not a same-day snooze).
  dismissFinanceReviewCard(card);
}

// "Edit details…" hands off to the existing main-list detail card, which owns
// the advanced editors (split, receipt scan, return linking, sign correction)
// — reused rather than duplicated inside the review deck.
function openFinanceTxnDetailFromReview(card) {
  const id = card?.dataset.txnId;
  if (!id) return;
  const overlay = document.getElementById("finReviewOverlay");
  commitAllFinanceReviewCards(overlay); // don't lose staged edits when handing off to the detail card
  overlay?.remove();
  financeDetailTxnId = id;
  financeTab = "transactions"; financeExpanded.add("card:txns");
  if (getActiveAppArea() === "finance") renderFinancePage();
}

// The quick-action chip row on a review card. Split/Receipt are spend-only and
// Return is credit-only, so the set depends on the (possibly flipped) sign —
// shared by the card template and the in-place sign-flip so they can't drift.
function financeReviewQuickChipsHtml(t) {
  const amt = t.amount || 0;
  return `
    <button class="fin-review-quick-btn${state.financeTxnSignFlips?.[t.id] ? " is-on" : ""}" type="button" data-fin-review-flip title="Flip the sign — this was actually income / a refund the bank posted as a charge (or vice-versa)">⇅ Sign</button>
    ${amt < 0 ? `<button class="fin-review-quick-btn" type="button" data-fin-review-split title="Split this across several budget categories">Split</button>` : ""}
    ${amt < 0 ? `<button class="fin-review-quick-btn" type="button" data-fin-review-receipt title="Scan a receipt to itemize + categorize this">Receipt</button>` : ""}
    ${amt > 0 ? `<button class="fin-review-quick-btn" type="button" data-fin-review-return title="Link this refund to the purchase it offsets">Return</button>` : ""}`;
}

// Sign flip is light enough to do in place: toggle the correction, then update
// this card's amount, chip row and button state without tearing down the review
// deck (so edits staged on other cards survive). The rest of the quick-actions
// (split, receipt, return) are full editors that live on the detail card, so
// they hand off there pre-armed — the same seam as "Edit details…", one deeper.
function flipFinanceReviewCardSign(card) {
  const id = card?.dataset.txnId;
  if (!id) return;
  toggleFinanceTxnSignFlip(id); // persists + invalidates the labeled cache
  const t = financeLabeledTxns().find((x) => x.id === id);
  const amtEl = card.querySelector(".fin-review-amount");
  if (t && amtEl) {
    amtEl.textContent = formatFinMoney(t.amount || 0);
    amtEl.classList.toggle("is-neg", (t.amount || 0) < 0);
  }
  // Rebuild the chips so split/receipt (spend) ↔ return (credit) match the new
  // sign and the flip's on-state is reflected.
  const quick = card.querySelector(".fin-review-quick");
  if (quick && t) quick.innerHTML = financeReviewQuickChipsHtml(t);
}

function handoffFinanceReviewCard(card, action) {
  const id = card?.dataset.txnId;
  if (!id) return;
  const overlay = document.getElementById("finReviewOverlay");
  commitAllFinanceReviewCards(overlay); // preserve staged edits across the handoff
  overlay?.remove();
  financeDetailTxnId = id;
  financeTab = "transactions"; financeExpanded.add("card:txns");
  if (action === "split") {
    startSplitTxn(id);           // opens the split editor (renders the page)
  } else if (action === "receipt") {
    startScanReceiptForTxn(id);  // opens split + pops the receipt scanner
  } else if (action === "return") {
    financeReturnLinkSearch = { txnId: id, q: "" };
    if (getActiveAppArea() === "finance") renderFinancePage();
    requestAnimationFrame(() => document.querySelector('[data-fin-edit="return-link-q"]')?.focus());
  } else if (getActiveAppArea() === "finance") {
    renderFinancePage();
  }
}

function wireFinanceReviewDeck(overlay) {
  const deck = overlay.querySelector("[data-fin-review-deck]");
  if (!deck) return;

  // Buttons (the non-gesture path — approval is always possible without swiping).
  deck.addEventListener("click", (e) => {
    const card = e.target.closest(".fin-review-card");
    if (e.target.closest("[data-fin-review-approve]")) { approveFinanceReviewCard(card); return; }
    if (e.target.closest("[data-fin-review-skip]")) { skipFinanceReviewCard(card); return; }
    if (e.target.closest("[data-fin-review-more]")) { openFinanceTxnDetailFromReview(card); return; }
    if (e.target.closest("[data-fin-review-flip]")) { flipFinanceReviewCardSign(card); return; }
    if (e.target.closest("[data-fin-review-split]")) { handoffFinanceReviewCard(card, "split"); return; }
    if (e.target.closest("[data-fin-review-receipt]")) { handoffFinanceReviewCard(card, "receipt"); return; }
    if (e.target.closest("[data-fin-review-return]")) { handoffFinanceReviewCard(card, "return"); return; }
  });

  // Alert cards (account/recurring) reuse the finance page's own handlers. After
  // an action resolves the alert, drop its card from the deck (advance). The
  // change path covers the "link to budget line" select.
  const advanceAlertCard = (e, handler) => {
    const alertCard = e.target.closest(".fin-notif-alert-card");
    if (!alertCard || !e.target.closest("[data-fin-action], [data-fin-edit]")) return;
    handler(e);
    alertCard.remove();
    updateFinanceReviewProgress(deck);
  };
  deck.addEventListener("click", (e) => advanceAlertCard(e, onFinanceGridClick));
  deck.addEventListener("change", (e) => advanceAlertCard(e, onFinanceGridChange));

  deck.addEventListener("scroll", () => updateFinanceReviewProgress(deck), { passive: true });

  // Keyboard: ↑/↓ browse (never approves); form controls keep their own arrow
  // behavior. Approval by keyboard is the focusable Approve button (Enter).
  deck.addEventListener("keydown", (e) => {
    if (e.target.closest("select, input, textarea")) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const idx = deck.clientHeight ? Math.round(deck.scrollTop / deck.clientHeight) : 0;
    const to = e.key === "ArrowDown" ? idx + 1 : idx - 1;
    deck.scrollTo({ top: Math.max(0, to) * deck.clientHeight, behavior: "smooth" });
    e.preventDefault();
  });

  // Touch swipe, axis-locked by the pure classifier so a vertical/diagonal drag
  // can never approve (see finance-review-gesture.js + its test).
  let card = null, sx = 0, sy = 0, axis = null;
  const parts = (c) => ({ inner: c.querySelector(".fin-review-card-inner"), done: c.querySelector(".fin-review-action-done"), dismiss: c.querySelector(".fin-review-action-dismiss") });
  const reset = (c) => { const { inner, done, dismiss } = parts(c); if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = ""; } if (done) done.style.opacity = 0; if (dismiss) dismiss.style.opacity = 0; };
  deck.addEventListener("touchstart", (e) => {
    card = e.target.closest(".fin-review-card") || null; // alert cards (.fin-notif-alert-card) aren't .fin-review-card → not swipeable
    if (!card) return;
    if (e.target.closest("input, select, textarea, button, a")) { card = null; return; } // let controls work
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; axis = null;
  }, { passive: true });
  deck.addEventListener("touchmove", (e) => {
    if (!card) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!axis) { axis = reviewGestureAxis(dx, dy); if (!axis) return; }
    if (axis !== "x") return; // vertical → let the deck scroll-snap (browse)
    e.preventDefault();
    const { inner, done, dismiss } = parts(card);
    if (inner) { inner.style.transition = "none"; inner.style.transform = `translateX(${dx}px) rotate(${dx * 0.02}deg)`; }
    if (done) done.style.opacity = dx > 0 ? Math.min(1, dx / REVIEW_GESTURE.approveThresholdPx) : 0;
    if (dismiss) dismiss.style.opacity = dx < 0 ? Math.min(1, -dx / REVIEW_GESTURE.dismissThresholdPx) : 0;
  }, { passive: false });
  deck.addEventListener("touchend", (e) => {
    if (!card) return;
    const c = card, ax = axis; card = null; axis = null;
    if (ax !== "x") return; // vertical was native scroll
    const dx = e.changedTouches[0].clientX - sx;
    const act = reviewGestureAction(ax, dx);
    if (act === "approve") {
      if (!approveFinanceReviewCard(c)) reset(c); // no category → snap back
    } else if (act === "dismiss") {
      dismissFinanceReviewCard(c); // remove from notifications, keep the red list dot
    } else {
      reset(c); // too-small → no state change
    }
  }, { passive: true });
}

// SimpleFIN connections/accounts that need attention: an explicit bridge error,
// or a linked account whose balance has gone stale (the feed silently stopped —
// e.g. a card that still reports a balance but stopped updating). Session-only,
// so it's empty until the live data has loaded.
const FINANCE_STALE_DAYS = 4;
function financeAccountsNeedingAttention() {
  if (!financeLive) return [];
  const raw = [];
  // Connection-level messages from the bridge ("Connection to X needs attention").
  for (const err of (financeLive.errors || [])) {
    const detail = String(err || "").trim();
    if (detail) raw.push({ kind: "error", key: `error:${detail}`, label: "Bank connection", detail });
  }
  // Per-account staleness — only meaningful once the fetch returned accounts.
  const live = financeLive.accounts || [];
  if (live.length) {
    const liveById = new Map(live.map((a) => [a.id, a]));
    const now = Date.now();
    for (const acct of (state.financeAccounts || [])) {
      if (!acct.linkedId) continue; // manual accounts don't sync
      const la = liveById.get(acct.linkedId);
      if (!la || !la.balanceDate) continue;
      const days = Math.floor((now - new Date(la.balanceDate).getTime()) / 86400000);
      if (days >= FINANCE_STALE_DAYS) {
        // Key is per-account (not per day count) so a dismissal sticks as the
        // days tick up, but clears if the account recovers.
        raw.push({ kind: "stale", key: `stale:${acct.linkedId}`, label: acct.name || la.name || "Account", detail: `Balance hasn't updated in ${days} days.` });
      }
    }
  }
  // Drop dismissals whose alert is no longer live (recovered) so a recurrence
  // re-alerts, then hide the ones still dismissed.
  const dismissed = (state.financeDismissedAlerts && typeof state.financeDismissedAlerts === "object") ? state.financeDismissedAlerts : {};
  const liveKeys = new Set(raw.map((r) => r.key));
  for (const k of Object.keys(dismissed)) { if (!liveKeys.has(k)) delete dismissed[k]; }
  return raw.filter((r) => !dismissed[r.key]);
}

// Per-account connection status — splits the two problems the notification count
// conflates so the Overview/Accounts UI can say WHICH account and WHY:
//   manual        — not bank-linked (a manual balance; nothing to sync)
//   fresh         — linked, balance updated within FINANCE_STALE_DAYS
//   stale         — linked and present, but the balance hasn't moved in N days
//   disconnected  — linked, yet the bridge no longer returns it (needs re-auth)
// Pure over its inputs (live account map + now), so it's easy to reason about.
function financeAccountStatus(acct, liveById, now = Date.now()) {
  if (!acct || !acct.linkedId) return { kind: "manual" };
  const la = liveById.get(acct.linkedId);
  if (!la) return { kind: "disconnected" };
  if (!la.balanceDate) return { kind: "fresh", days: null, since: null };
  const days = Math.floor((now - new Date(la.balanceDate).getTime()) / 86400000);
  return { kind: days >= FINANCE_STALE_DAYS ? "stale" : "fresh", days, since: la.balanceDate };
}

// All linked accounts that need attention (stale or disconnected), plus whether
// the bridge itself reported a connection-level error. Drives the Overview chips.
function financeAccountHealth() {
  const liveById = new Map((financeLive?.accounts || []).map((a) => [a.id, a]));
  const accounts = (state.financeAccounts || []).map((a) => ({ acct: a, status: financeAccountStatus(a, liveById) }));
  const needsAttention = accounts.filter((a) => a.status.kind === "stale" || a.status.kind === "disconnected");
  const bridgeError = Boolean((financeLive?.errors || []).length);
  return { accounts, needsAttention, bridgeError };
}

function financeAlertPref(key) { const p = state.financeAlertPrefs; return !p || p[key] !== false; }

// A small connection-status pill for an account row (from financeAccountStatus).
function financeAccountStatusPill(status) {
  if (!status) return "";
  if (status.kind === "manual") return `<span class="fin-acct-status is-manual" title="Manually kept balance — not bank-linked">Manual</span>`;
  if (status.kind === "disconnected") return `<span class="fin-acct-status is-bad" title="Linked, but the bank connection isn't returning this account — reconnect it">Disconnected</span>`;
  if (status.kind === "stale") return `<span class="fin-acct-status is-warn" title="Balance hasn't updated recently">Stale ${status.days}d</span>`;
  const d = status.days;
  const label = d == null ? "Linked" : d <= 0 ? "Updated today" : d === 1 ? "Updated 1d ago" : `Updated ${d}d ago`;
  return `<span class="fin-acct-status is-ok" title="Bank-linked and up to date">${label}</span>`;
}

// Net-worth trend from the server's daily snapshots (financeHistory). Reused by
// the Overview band and the Net-worth card. Bank-linked balances only, so it can
// differ slightly from live net worth that also counts manual accounts.
function financeHistoryDays() {
  return financeHistory ? Object.keys(financeHistory).sort() : [];
}
function financeTrendSparklineHtml(cls = "fin-trend") {
  const days = financeHistoryDays();
  if (days.length < 2) return "";
  const vals = days.map((d) => Number(financeHistory[d]?.netWorth) || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${26 - ((v - min) / span) * 22}`).join(" ");
  return `<svg class="${cls}" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Net worth over time"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function financeNetWorthDelta() {
  const days = financeHistoryDays();
  if (days.length < 2) return null;
  const first = Number(financeHistory[days[0]]?.netWorth) || 0;
  const last = Number(financeHistory[days[days.length - 1]]?.netWorth) || 0;
  return { delta: last - first, sinceLabel: new Date(days[0] + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
}

// The finance bell / home-tile badge total.
function financeBellCount() {
  return financeUnlabeledCount() + financeAccountsNeedingAttention().length;
}

// Persist this month's per-category totals (and income received) so history
// survives the rolling transaction window, device restarts, and bridge
// outages. Derived from labeled transactions; only written when values change.
function updateFinanceMonthActuals() {
  if (!financeLive?.accounts?.length) return;
  const txns = financeLabeledTxns();
  const currentMonth = new Date().toISOString().slice(0, 7);
  // Which months are safe to (re)snapshot from the live feed: always the current
  // month, plus any PAST month the feed fully covers — so a correction to an
  // older transaction still in the feed updates that month's totals, not only
  // the current month's, without a partial window undercounting a complete
  // historical snapshot. (Coverage guard is pure + tested in finance-actuals.js.)
  const monthsToWrite = financeMonthsToSnapshot(txns, currentMonth);
  if (!state.financeMonthActuals || typeof state.financeMonthActuals !== "object") state.financeMonthActuals = {};
  let changed = false;
  for (const month of monthsToWrite) {
    const cats = {};
    const incomeBy = {};
    let incomeGot = 0;
    for (const t of txns) {
      if ((t.posted || "").slice(0, 7) !== month || !t.label) continue;
      for (const p of financeTxnPortions(t)) {
        if (p.label === "income" || p.label.startsWith("income:")) {
          incomeGot += p.amount;
          incomeBy[p.label] = Math.round(((incomeBy[p.label] || 0) + p.amount) * 100) / 100;
        } else if (p.label.startsWith("cat:")) {
          const k = p.label.slice(4);
          cats[k] = Math.round(((cats[k] || 0) + p.amount) * 100) / 100;
        }
      }
    }
    const entry = { cats, income: Math.round(incomeGot * 100) / 100, incomeBy };
    if (JSON.stringify(state.financeMonthActuals[month]) === JSON.stringify(entry)) continue;
    state.financeMonthActuals[month] = entry;
    changed = true;
  }
  if (!changed) return;
  const months = Object.keys(state.financeMonthActuals).sort();
  for (let i = 0; i < months.length - 36; i++) delete state.financeMonthActuals[months[i]];
  persist();
}

// A split replaces a single label with portions; no merchant rule is learned
// (a mixed basket teaches nothing about the merchant's usual category).
let financeSplitDraft = null; // { txnId, portions: [{label, amount}] }
let financeScanBusy = false;
let financeBatchScanBusy = false;

function startSplitTxn(txnId) {
  const t = financeLabeledTxns().find((x) => x.id === txnId);
  if (!t) return;
  financeSplitDraft = {
    txnId: t.id,
    portions: (t.split && t.split.length ? t.split : [{ label: "", amount: "" }, { label: "", amount: "" }])
      .map((p) => ({ label: p.label || "", amount: p.amount ?? "" }))
  };
  financeTab = "transactions"; financeExpanded.add("card:txns");
  financeNotifOpen = false;
  renderFinancePage();
}

// Opens (or reuses) the split editor for a transaction and immediately pops
// the camera/file picker, so scanning a receipt is a single tap from the
// detail card instead of Split… → Scan receipt as two separate steps.
function startScanReceiptForTxn(txnId) {
  if (financeSplitDraft?.txnId !== txnId) startSplitTxn(txnId);
  requestAnimationFrame(() => {
    document.querySelector('.fin-split-editor [data-fin-edit="split-scan-file"]')?.click();
  });
}

// Photo of a paper receipt → server itemizes + categorizes → portions prefill
async function scanReceiptIntoSplit(file) {
  if (financeScanBusy || !financeSplitDraft || !file) return;
  financeScanBusy = true;
  renderFinancePage();
  try {
    trackUsage("claude_receipt_scan");
    const image = await fileToDataUrl(await prepareScanImage(file, undefined, { maxDimension: 1600, quality: 0.82 }));
    const data = await callNetlifyFunction("simplefin", { action: "scanReceipt", image });
    if (data?.receipt?.portions?.length && financeSplitDraft) {
      // Group the scanned line items BY CATEGORY so a Target run collapses to
      // "Groceries $X · Electronics $Y" instead of a long per-item list — the
      // split is category-level, which is what budgeting needs.
      const byLabel = new Map();
      for (const p of data.receipt.portions) {
        const amt = Math.abs(parseFinAmount(p.amount) || 0);
        if (!amt) continue;
        const label = p.label || "";
        byLabel.set(label, (byLabel.get(label) || 0) + amt);
      }
      const grouped = [...byLabel.entries()].map(([label, amount]) => ({ label, amount: Math.round(amount * 100) / 100 }));
      financeSplitDraft.portions = grouped.length ? grouped : data.receipt.portions.map((p) => ({ label: p.label || "", amount: p.amount }));
      // Keep the receipt image: best-effort upload + attach to this txn. Never
      // let a storage hiccup (missing bucket, offline, not signed in) undo the
      // split the user just got — the scan result stands on its own.
      const txnId = financeSplitDraft.txnId;
      uploadReceiptImage(txnId, file).catch((e) => console.warn("Receipt image not kept:", e?.message || e));
    } else {
      alert(data?.error ? `Scan failed: ${data.error}` : "Could not read a receipt from that photo — try a straighter, brighter shot.");
    }
  } catch (e) {
    alert("Scan failed: " + (e?.message || "unknown error"));
  }
  financeScanBusy = false;
  renderFinancePage();
}

// ── Receipt-image storage ─────────────────────────────────────────────────
// Mirrors the trip-attachment helpers: a PRIVATE per-user Supabase Storage
// bucket ("receipt-attachments", RLS-scoped to auth.uid()/…), signed URLs for
// viewing, and only a small {path,type,size,name,uploadedAt} reference kept in
// state.financeTxnReceipts. Financial receipts are private, so — unlike the
// public recipe-photos/event-files buckets — the bucket is not public and the
// path is prefixed with the user's id.
const RECEIPT_BUCKET = "receipt-attachments";

async function uploadReceiptImage(txnId, file) {
  if (!getSupabaseClient()) throw new Error("Not signed in");
  const userId = getAuthSession()?.user?.id;
  if (!userId) throw new Error("Not signed in");
  if (!file) throw new Error("No file");
  // Downscale before upload so kept receipts stay small (they're for reference,
  // not archival) — reuses the same pipeline the scanner feeds the model.
  const blob = await prepareScanImage(file, undefined, { maxDimension: 1600, quality: 0.82 });
  const type = blob.type || file.type || "image/jpeg";
  const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
  const path = `${userId}/${txnId}/${Date.now()}.${ext}`;
  const { error } = await getSupabaseClient().storage.from(RECEIPT_BUCKET).upload(path, blob, { upsert: true, contentType: type });
  if (error) throw error;
  // Replace any prior image for this txn (best-effort cleanup of the old blob).
  const prev = (state.financeTxnReceipts || {})[txnId];
  if (prev?.path && prev.path !== path) getSupabaseClient().storage.from(RECEIPT_BUCKET).remove([prev.path]).catch(() => {});
  if (!state.financeTxnReceipts || typeof state.financeTxnReceipts !== "object") state.financeTxnReceipts = {};
  state.financeTxnReceipts[txnId] = { path, type, size: blob.size || 0, name: file.name || "", uploadedAt: new Date().toISOString() };
  persist();
  renderFinancePage();
  return state.financeTxnReceipts[txnId];
}

async function getReceiptImageUrl(path) {
  if (!getSupabaseClient() || !path) throw new Error("Not signed in");
  const { data, error } = await getSupabaseClient().storage.from(RECEIPT_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

async function deleteReceiptImage(txnId) {
  const rec = (state.financeTxnReceipts || {})[txnId];
  if (rec?.path && getSupabaseClient()) {
    await getSupabaseClient().storage.from(RECEIPT_BUCKET).remove([rec.path]).catch(() => {});
  }
  if (state.financeTxnReceipts) delete state.financeTxnReceipts[txnId];
  persist();
  renderFinancePage();
}

// Opens the kept receipt image for a txn in a new tab via a short-lived signed URL.
async function viewReceiptImage(txnId) {
  const rec = (state.financeTxnReceipts || {})[txnId];
  if (!rec?.path) return;
  try {
    const url = await getReceiptImageUrl(rec.path);
    window.open(url, "_blank", "noopener");
  } catch (e) {
    alert("Couldn't open the receipt image: " + (e?.message || "unknown error"));
  }
}

// ── Batch receipt scan (scan a pile, auto-match by total + date) ────────────
// Finds the ONE spend transaction a scanned receipt belongs to: same total
// (±2¢), dated within 4 days, not already user-labeled/split, and not already
// claimed earlier in this same batch. Closest by date wins a tie. This is the
// reverse of financeReceiptForTxn (which matches an email receipt to a txn).
function financeBatchMatchTxn(receipt, claimed) {
  const total = Number(receipt?.total) || 0;
  if (!total) return null;
  const rDate = receipt.date ? new Date(receipt.date).getTime() : null;
  const cands = financeLabeledTxns().filter((t) => {
    if ((t.amount || 0) >= 0) return false;              // spend only
    if (claimed.has(t.id)) return false;                 // one receipt per txn
    if (t.labelSource === "manual") return false;        // never overwrite a user's own label/split
    if (Math.abs(Math.abs(t.amount) - total) > 0.02) return false;
    if (rDate == null) return true;
    return Math.abs(new Date(t.posted || 0).getTime() - rDate) <= 4 * 86400000;
  });
  if (!cands.length) return null;
  if (rDate != null) {
    cands.sort((a, b) => Math.abs(new Date(a.posted || 0).getTime() - rDate) - Math.abs(new Date(b.posted || 0).getTime() - rDate));
  }
  return cands[0];
}

// Scan a pile of receipt photos at once: each is itemized+categorized by the
// same server path the single scan uses, auto-matched to its transaction, then
// its category split is applied and the image kept. Fully non-destructive —
// only touches txns with no manual label, and every image is kept best-effort.
async function financeBatchScanReceipts(files) {
  const list = [...(files || [])].filter((f) => f && /^image\//.test(f.type || "")).slice(0, 20);
  if (!list.length || financeBatchScanBusy) return;
  financeBatchScanBusy = true;
  renderFinancePage();
  const res = { matched: 0, attached: 0, unmatched: 0, failed: 0 };
  const claimed = new Set();
  for (const file of list) {
    try {
      trackUsage("claude_receipt_scan");
      const image = await fileToDataUrl(await prepareScanImage(file, undefined, { maxDimension: 1600, quality: 0.82 }));
      const data = await callNetlifyFunction("simplefin", { action: "scanReceipt", image });
      const receipt = data?.receipt;
      if (!receipt || !Number(receipt.total)) { res.failed++; continue; }
      const txn = financeBatchMatchTxn(receipt, claimed);
      if (!txn) { res.unmatched++; continue; }
      claimed.add(txn.id);
      const total = Math.abs(txn.amount || 0);
      // Group the receipt's line items by category (labeled portions only).
      const byLabel = new Map();
      for (const p of (receipt.portions || [])) {
        const amt = Math.abs(parseFinAmount(p.amount) || 0);
        if (!amt || !p.label) continue;
        byLabel.set(p.label, (byLabel.get(p.label) || 0) + amt);
      }
      let portions = [...byLabel.entries()].map(([label, amount]) => ({ label, amount: Math.round(amount * 100) / 100 }));
      const labeledSum = portions.reduce((s, p) => s + p.amount, 0);
      const remainder = Math.round((total - labeledSum) * 100) / 100;
      // Only categorize when the labeled items cover the transaction (a small
      // tax/uncertain remainder is folded into the largest portion so the split
      // totals exactly). A large unlabeled remainder = can't categorize with
      // confidence, so keep the image and leave the category for the user.
      const canCategorize = portions.length >= 1 && Math.abs(remainder) <= Math.max(2, total * 0.05);
      if (canCategorize) {
        if (Math.abs(remainder) > 0.02) {
          portions.sort((a, b) => b.amount - a.amount);
          portions[0].amount = Math.round((portions[0].amount + remainder) * 100) / 100;
        }
        if (portions.length >= 2) recordFinanceTxnSplit(txn.id, portions);
        else recordFinanceTxnLabel(txn.id, portions[0].label, txn.description);
        res.matched++;
      } else {
        res.attached++;
      }
      await uploadReceiptImage(txn.id, file).catch((e) => console.warn("Receipt image not kept:", e?.message || e));
    } catch (e) {
      res.failed++;
    }
  }
  financeBatchScanBusy = false;
  invalidateFinanceLabeled();
  renderFinancePage();
  const parts = [];
  if (res.matched) parts.push(`${res.matched} matched & categorized`);
  if (res.attached) parts.push(`${res.attached} matched — image kept, add a category`);
  if (res.unmatched) parts.push(`${res.unmatched} with no matching transaction`);
  if (res.failed) parts.push(`${res.failed} unreadable`);
  alert(`Scanned ${list.length} receipt${list.length === 1 ? "" : "s"}: ${parts.join(" · ") || "nothing to apply"}.`);
}

// ── Merchant renaming ("Electronic Deposit Ur..." → "Urban Greens") ─────────
// Keyed off the same merchant grouping used for rule-learning and recurring
// detection, so a rename applies everywhere that merchant shows up — past
// and future transactions alike — without touching the raw bank text, which
// stays on t.description for reference (e.g. search still matches it).
let financeRenamingTxnId = null;
let financeDetailTxnId = null; // which transaction's detail card is open (main list only)

function startRenameTxn(txnId) {
  financeRenamingTxnId = txnId;
  renderFinancePage();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-fin-rename-id="${CSS.escape(txnId)}"][data-fin-rename-field="name"]`);
    input?.focus();
    input?.select();
  });
}

function cancelRenameTxn() {
  financeRenamingTxnId = null;
  renderFinancePage();
}

// name is shared across every transaction with the same merchant key (a
// rename applies everywhere that merchant shows up). note is always saved
// against this one transaction id only (financeTxnNoteOverrides) — editing
// one Trader Joe's charge never touches another. Every save also casts a
// vote in financeTxnNoteCounts for this merchant, so transactions the user
// hasn't touched yet default to whatever note clearly wins for that store.
function saveRenameTxn(txnId, rawDescription, newName, newNote) {
  const name = newName.trim().slice(0, 80);
  const note = String(newNote || "").trim().slice(0, 60);
  const key = financeMerchantKey(rawDescription);
  if (key) {
    if (!state.financeMerchantNames || typeof state.financeMerchantNames !== "object") state.financeMerchantNames = {};
    if (name) state.financeMerchantNames[key] = name;
    else delete state.financeMerchantNames[key]; // blank clears back to the raw text
    // Recurring entries snapshot a display name at detection time — keep it in sync.
    (state.financeRecurring || []).forEach((r) => { if (r.merchantKey === key) r.name = name || rawDescription.slice(0, 48); });
  }
  if (!state.financeTxnNoteOverrides || typeof state.financeTxnNoteOverrides !== "object") state.financeTxnNoteOverrides = {};
  delete state.financeTxnNoteOverrides[txnId]; // re-insert so the cap evicts least-recent
  state.financeTxnNoteOverrides[txnId] = note; // "" is meaningful: explicitly no note for this one
  const ids = Object.keys(state.financeTxnNoteOverrides);
  for (let i = 0; i < ids.length - 600; i++) delete state.financeTxnNoteOverrides[ids[i]];
  if (key) {
    if (!state.financeTxnNoteCounts || typeof state.financeTxnNoteCounts !== "object") state.financeTxnNoteCounts = {};
    const counts = (state.financeTxnNoteCounts[key] && typeof state.financeTxnNoteCounts[key] === "object") ? state.financeTxnNoteCounts[key] : {};
    counts[note] = (Number(counts[note]) || 0) + 1;
    delete state.financeTxnNoteCounts[key];
    state.financeTxnNoteCounts[key] = counts;
    const mKeys = Object.keys(state.financeTxnNoteCounts);
    for (let i = 0; i < mKeys.length - 400; i++) delete state.financeTxnNoteCounts[mKeys[i]];
  }
  invalidateFinanceLabeled(); // recompute displayName for every txn sharing this merchant/note
  financeRenamingTxnId = null;
  persist();
  renderFinancePage();
}

function saveRenameFromRow(row, txnId) {
  const nameInput = row?.querySelector('[data-fin-rename-field="name"]');
  const noteInput = row?.querySelector('[data-fin-rename-field="note"]');
  if (nameInput) saveRenameTxn(txnId, nameInput.dataset.finRenameRaw, nameInput.value, noteInput?.value || "");
}

function recordFinanceTxnSplit(txnId, portions) {
  if (!state.financeTxnLabels || typeof state.financeTxnLabels !== "object") state.financeTxnLabels = {};
  const labels = state.financeTxnLabels;
  delete labels[txnId];
  labels[txnId] = { split: portions };
  const ids = Object.keys(labels);
  for (let i = 0; i < ids.length - 600; i++) delete labels[ids[i]];
  invalidateFinanceLabeled();
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
}

function recordFinanceTxnLabel(txnId, labelKey, description) {
  if (!state.financeTxnLabels || typeof state.financeTxnLabels !== "object") state.financeTxnLabels = {};
  const labels = state.financeTxnLabels;
  delete labels[txnId]; // re-insert so the cap evicts least-recent
  if (labelKey) labels[txnId] = labelKey;
  const ids = Object.keys(labels);
  for (let i = 0; i < ids.length - 600; i++) delete labels[ids[i]];
  if (labelKey) {
    const key = financeMerchantKey(description);
    if (key) {
      if (!state.financeTxnRules || typeof state.financeTxnRules !== "object") state.financeTxnRules = {};
      const counts = (state.financeTxnRules[key] && typeof state.financeTxnRules[key] === "object") ? state.financeTxnRules[key] : {};
      counts[labelKey] = (Number(counts[labelKey]) || 0) + 1;
      delete state.financeTxnRules[key];
      state.financeTxnRules[key] = counts;
      const rKeys = Object.keys(state.financeTxnRules);
      for (let i = 0; i < rKeys.length - 400; i++) delete state.financeTxnRules[rKeys[i]];
    }
  }
  invalidateFinanceLabeled(); // recompute with the new label
  setPageNotifCount("finance", financeBellCount());
  updateFinanceMonthActuals();
  persist();
}

async function unlinkFinanceBanks() {
  if (!confirm("Disconnect SimpleFIN? Live balances stop updating; your budget data is unaffected.")) return;
  const data = await callNetlifyFunction("simplefin", { action: "disconnect" });
  if (data?.ok) {
    financeLinkStatus = { connected: false };
    financeLive = null;
    invalidateFinanceLabeled(); // manual transactions still need to reflect the disconnect
    financeDetailTxnId = null;
    financeRenamingTxnId = null;
    financeSplitDraft = null;
  } else {
    alert("Disconnect failed: " + (data?.error || "unknown error"));
  }
  renderFinancePage();
}

// ── Finance page ─────────────────────────────────────────────────────────────
const financeExpanded = new Set(); // ids of expanded categories/person editors
let financeGridWired = false;

function formatFinMoney(n) {
  const v = Number(n) || 0;
  const opts = Number.isInteger(v) ? { minimumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString(undefined, opts);
}

function parseFinAmount(str) {
  const n = parseFloat(String(str || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function financeActiveIncome(person) {
  return person.scenarios.find((s) => s.id === person.activeScenarioId) || person.scenarios[0] || null;
}

// ── Pay schedule → paydays per month ─────────────────────────────────────────
// A scenario's amount is per pay period. Biweekly/weekly cadences land 2 or 3
// (4 or 5 for weekly) paydays in a month depending on the calendar — that's what
// makes a month's income vary. Anchored to a known payday (payAnchor).
function payPeriodStepDays(freq) { return freq === "weekly" ? 7 : freq === "biweekly" ? 14 : 0; }

// Payday date-keys (YYYY-MM-DD) for a scenario within [startKey, endKey] inclusive.
// Steps by whole calendar days (not fixed ms) so a payday stays at local midnight
// across DST changes — otherwise the ±1h drift drops a payday on a month's last day.
function scenarioPaydaysInRange(scenario, startKey, endKey) {
  const step = payPeriodStepDays(scenario?.payFrequency);
  if (!step || !scenario?.payAnchor) return [];
  const start = new Date(startKey + "T00:00:00");
  const end = new Date(endKey + "T00:00:00");
  const cursor = new Date(scenario.payAnchor + "T00:00:00");
  if (isNaN(start) || isNaN(end) || isNaN(cursor)) return [];
  // Approximate-jump near the window, then land exactly on the first payday >= start.
  cursor.setDate(cursor.getDate() + Math.floor((start - cursor) / (step * 86400000)) * step);
  while (cursor < start) cursor.setDate(cursor.getDate() + step);
  for (;;) { // back up past any payday the jump overshot
    const prev = new Date(cursor); prev.setDate(prev.getDate() - step);
    if (prev < start) break;
    cursor.setTime(prev.getTime());
  }
  const out = [];
  let guard = 0;
  while (cursor <= end && guard++ < 800) {
    out.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + step);
  }
  return out;
}

// How many paydays fall in a given month (YYYY-MM) for this scenario.
function scenarioPaydaysInMonth(scenario, monthKey) {
  if ((scenario?.payFrequency || "monthly") === "monthly") return 1;
  if (!scenario?.payAnchor) return 2; // biweekly/weekly not yet anchored → assume a typical month
  const [y, m] = monthKey.split("-").map(Number);
  const endKey = dateKeyFromDate(new Date(y, m, 0)); // last day of the month
  return scenarioPaydaysInRange(scenario, `${monthKey}-01`, endKey).length;
}

// Pay periods (paychecks) that land in the viewed month for this scenario.
function scenarioPeriodsInMonth(scenario, monthKey) {
  return (scenario?.payFrequency || "monthly") === "monthly" ? 1 : scenarioPaydaysInMonth(scenario, monthKey);
}
function scenarioDeductionPerPeriod(scenario) {
  return (scenario?.deductions || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
}
// Gross (before deductions) for the month = per-period amount × paychecks.
function scenarioMonthlyGross(scenario, monthKey) {
  if (!scenario) return 0;
  return (scenario.amount || 0) * scenarioPeriodsInMonth(scenario, monthKey);
}
// Pre-deposit deductions for the month = per-period deductions × paychecks.
function scenarioMonthlyDeductions(scenario, monthKey) {
  if (!scenario) return 0;
  return scenarioDeductionPerPeriod(scenario) * scenarioPeriodsInMonth(scenario, monthKey);
}
// NET (what actually lands in the account) — this is what the budget spends.
function scenarioMonthlyIncome(scenario, monthKey) {
  return scenarioMonthlyGross(scenario, monthKey) - scenarioMonthlyDeductions(scenario, monthKey);
}

// Net income (Unallocated is built on money that actually reaches the account).
function financeIncomeTotal(monthKey) {
  const mk = monthKey || financeViewMonth;
  return (state.financePeople || []).reduce((sum, p) => sum + scenarioMonthlyIncome(financeActiveIncome(p), mk), 0);
}
function financeGrossIncomeTotal(monthKey) {
  const mk = monthKey || financeViewMonth;
  return (state.financePeople || []).reduce((sum, p) => sum + scenarioMonthlyGross(financeActiveIncome(p), mk), 0);
}
// All pre-deposit paycheck deductions for the month, per line — for the visible
// "Paycheck deductions" breakdown. [{ person, label, monthly, perPeriod, periods }]
function financeDeductionLines(monthKey) {
  const mk = monthKey || financeViewMonth;
  const out = [];
  for (const p of (state.financePeople || [])) {
    const s = financeActiveIncome(p);
    if (!s) continue;
    const periods = scenarioPeriodsInMonth(s, mk);
    for (const d of (s.deductions || [])) {
      out.push({ person: p.name || "", label: d.label || "Deduction", perPeriod: Number(d.amount) || 0, periods, monthly: (Number(d.amount) || 0) * periods });
    }
  }
  return out;
}
function financeDeductionsTotal(monthKey) {
  return financeDeductionLines(monthKey).reduce((s, d) => s + d.monthly, 0);
}

// Every earner's paydays in a date range: [{ date, person, amount }] — for the
// calendar's read-only payday dots.
function financePaydaysInRange(startKey, endKey) {
  const out = [];
  for (const p of (state.financePeople || [])) {
    const s = financeActiveIncome(p);
    const netPerCheck = (s?.amount || 0) - scenarioDeductionPerPeriod(s); // take-home that lands
    for (const date of scenarioPaydaysInRange(s, startKey, endKey)) {
      out.push({ date, person: p.name || "", amount: netPerCheck });
    }
  }
  return out;
}

function financeItemsTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
}

function financeCategoryActiveItem(c) {
  return (c.items || []).find((it) => it.id === c.activeItemId) || c.items?.[0] || null;
}

function financeCategoryTotal(c) {
  if (c.mode === "pick") return financeCategoryActiveItem(c)?.amount || 0;
  return financeItemsTotal(c.items);
}

function financeGroupTotal(group) {
  return (group.categories || []).reduce((s, c) => s + financeCategoryTotal(c), 0);
}

function financeExpensesTotal() {
  return (state.financeBudgetGroups || []).reduce((s, g) => s + financeGroupTotal(g), 0);
}

// The Accounts management UI. It used to be a card on the Finance page; it now
// lives in Settings › Finance. Returns the inner HTML; the same data-fin-edit /
// data-fin-action hooks route through onFinanceGridChange / onFinanceGridClick
// (delegated from the settings body). A visible ✎ button opens each account's
// editor, since the old right-click menu can't layer above a modal dialog.
function renderFinanceAccountsPanel() {
  const owners = [...new Set([
    ...(Array.isArray(state.financeAccountLabels) ? state.financeAccountLabels : []),
    ...(state.financeAccounts || []).map((a) => a.owner || "Other"),
  ])];
  const liveById = new Map((financeLive?.accounts || []).map((a) => [a.id, a]));
  const linkedIds = new Set((state.financeAccounts || []).map((a) => a.linkedId).filter(Boolean));
  const unlinkedLive = (financeLive?.accounts || []).filter((a) => !linkedIds.has(a.id));

  const linkBlock = financeLinkStatus?.connected ? `
      <div class="fin-subhead">Bank link · SimpleFIN</div>
      <div class="fin-item-row fin-item-row--tools">
        <span class="fin-hint">Connected${financeLive?.at ? ` · updated ${new Date(financeLive.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="refresh-live" ${financeLiveLoading ? "disabled" : ""}>${financeLiveLoading ? "Refreshing…" : "Refresh"}</button>
        <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="unlink-banks">Disconnect</button>
      </div>
      ${(financeLive?.errors || []).length ? `<p class="fin-hint">${escapeHtml(financeLive.errors.join(" · "))}</p>` : ""}`
    : financeLinkStatus ? `
      <div class="fin-subhead">Bank link · SimpleFIN</div>
      <p class="fin-hint">Paste a one-time setup token from <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noopener noreferrer">SimpleFIN Bridge</a>. Bank logins stay at the bridge — the app only ever receives read-only balances.</p>
      <div class="fin-account-add">
        <input class="fin-item-name" type="password" id="finSetupToken" placeholder="SimpleFIN setup token" autocomplete="off" />
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="link-banks" ${financeLinkBusy ? "disabled" : ""}>${financeLinkBusy ? "Connecting…" : "Connect"}</button>
      </div>`
    : `<p class="fin-hint">Checking bank link…</p>`;

  const ownerSubs = (owner) => [...new Set([
    ...(((state.financeAccountSubLabels || {})[owner]) || []),
    ...(state.financeAccounts || []).filter((x) => (x.owner || "Other") === owner && x.sub).map((x) => x.sub),
  ])];
  const finAcctRow = (a) => {
    const live = a.linkedId ? liveById.get(a.linkedId) : null;
    const editing = financeExpanded.has(`edit:${a.id}`);
    const subs = ownerSubs(a.owner || "Other");
    const shownBal = live ? (live.balance ?? 0) : a.manualBalance;
    return `
    <div class="fin-item-row fin-acct-row" data-fin-acct-id="${escapeHtml(a.id)}">
      <span class="fin-acct-name">${escapeHtml(a.name)}</span>
      ${financeAccountStatusPill(financeAccountStatus(a, liveById))}
      ${shownBal !== null && shownBal !== undefined ? `<span class="fin-live-bal${shownBal < 0 ? " is-neg" : ""}${live ? "" : " fin-bal-manual"}" ${live ? "" : `title="Manually kept balance"`}>${formatFinMoney(shownBal)}</span>` : ""}
      <button class="fin-acct-edit-btn" type="button" data-fin-action="toggle-expand" data-id="edit:${a.id}" aria-label="Edit ${escapeHtml(a.name)}">${editing ? "▴" : "✎"}</button>
    </div>
    ${editing ? `
    <div class="fin-acct-editor">
      <div class="fin-item-row">
        <input class="fin-item-name" type="text" value="${escapeHtml(a.name)}" data-fin-edit="account-name" data-id="${a.id}" aria-label="Account name" />
      </div>
      <div class="fin-item-row">
        <select class="fin-scenario-select fin-editor-select" data-fin-edit="account-owner" data-id="${a.id}" title="Label" aria-label="Label for ${escapeHtml(a.name)}">
          ${owners.map((o) => `<option value="${escapeHtml(o)}" ${o === (a.owner || "Other") ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          <option value="__new__">New label…</option>
        </select>
        <select class="fin-scenario-select fin-editor-select" data-fin-edit="account-sub" data-id="${a.id}" title="Sub-label" aria-label="Sub-label for ${escapeHtml(a.name)}">
          <option value="">no sub-label</option>
          ${subs.map((s) => `<option value="${escapeHtml(s)}" ${s === a.sub ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
          <option value="__new__">New sub-label…</option>
        </select>
      </div>
      <div class="fin-item-row">
        <select class="fin-scenario-select fin-editor-select" data-fin-edit="account-kind" data-id="${a.id}" title="Type — feeds the savings cards" aria-label="Type for ${escapeHtml(a.name)}">
          <option value="" ${a.kind ? "" : "selected"}>Auto (${escapeHtml(inferFinanceAccountKind(a))})</option>
          <option value="cash" ${a.kind === "cash" ? "selected" : ""}>Cash</option>
          <option value="retirement" ${a.kind === "retirement" ? "selected" : ""}>Retirement</option>
          <option value="investment" ${a.kind === "investment" ? "selected" : ""}>Investment</option>
          <option value="debt" ${a.kind === "debt" ? "selected" : ""}>Debt</option>
          <option value="other" ${a.kind === "other" ? "selected" : ""}>Other</option>
        </select>
      </div>
      ${financeLinkStatus?.connected ? `
      <div class="fin-item-row">
        <select class="fin-scenario-select fin-editor-select" data-fin-edit="account-link" data-id="${a.id}" title="Linked bank account" aria-label="Link ${escapeHtml(a.name)} to a bank account">
          <option value="">not linked</option>
          ${(financeLive?.accounts || []).map((la) => `<option value="${escapeHtml(la.id)}" ${la.id === a.linkedId ? "selected" : ""}>${escapeHtml(la.org)}${la.org && la.name ? " — " : ""}${escapeHtml(la.name)}</option>`).join("")}
          ${a.linkedId && !liveById.has(a.linkedId) ? `<option value="${escapeHtml(a.linkedId)}" selected>(linked — awaiting data)</option>` : ""}
        </select>
      </div>` : ""}
      ${!a.linkedId ? `
      <div class="fin-item-row">
        <input class="fin-item-amount fin-manual-bal" type="text" inputmode="decimal" value="${a.manualBalance === null ? "" : escapeHtml(String(a.manualBalance))}" placeholder="Balance (− for debts)" data-fin-edit="account-manual-balance" data-id="${a.id}" aria-label="Manual balance for ${escapeHtml(a.name)}" />
        <span class="fin-hint">manual balance — counts toward net worth</span>
      </div>` : ""}
      ${(financeAccountKind(a) === "debt" || (financeAccountBalance(a, liveById) || 0) < 0) ? (() => {
        const payoff = financeDebtPayoff(financeAccountBalance(a, liveById), a.minPayment, a.interestRate);
        let est = "Add APR + monthly payment to estimate payoff.";
        if (payoff?.done) est = "Paid off 🎉";
        else if (payoff?.neverPays) est = "⚠ Payment barely covers the interest — it won't pay down.";
        else if (payoff?.months != null) { const d = new Date(); d.setMonth(d.getMonth() + payoff.months); est = `~${payoff.months} month${payoff.months === 1 ? "" : "s"} · payoff ${d.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`; }
        return `
        <div class="fin-item-row">
          <input class="fin-item-amount" type="text" inputmode="decimal" value="${a.interestRate || ""}" placeholder="APR %" data-fin-edit="account-interest" data-id="${a.id}" aria-label="Interest rate APR percent for ${escapeHtml(a.name)}" />
          <input class="fin-item-amount" type="text" inputmode="decimal" value="${a.minPayment || ""}" placeholder="$/mo payment" data-fin-edit="account-minpayment" data-id="${a.id}" aria-label="Monthly payment for ${escapeHtml(a.name)}" />
        </div>
        <div class="fin-hint fin-payoff-note${payoff?.neverPays ? " is-warn" : ""}">${escapeHtml(est)}</div>`;
      })() : ""}
      <div class="fin-item-row fin-item-row--tools">
        <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="delete-account" data-id="${a.id}">Delete account</button>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="toggle-expand" data-id="edit:${a.id}">Done</button>
      </div>
    </div>` : ""}`;
  };

  const ownerBlocks = owners.map((owner) => {
    const ownerAccts = (state.financeAccounts || []).filter((x) => (x.owner || "Other") === owner);
    const subs = ownerSubs(owner);
    const noSub = ownerAccts.filter((x) => !x.sub);
    return `
    <div class="fin-label-head" data-fin-owner="${escapeHtml(owner)}">
      <span class="fin-subhead">${escapeHtml(owner)}</span>
      <span class="fin-label-actions">
        <button class="fin-label-btn" type="button" data-fin-action="add-sublabel" data-label="${escapeHtml(owner)}" title="Add sub-label" aria-label="Add a sub-label under ${escapeHtml(owner)}">＋</button>
        <button class="fin-label-btn" type="button" data-fin-action="rename-label" data-label="${escapeHtml(owner)}" title="Rename label" aria-label="Rename ${escapeHtml(owner)}">✎</button>
        <button class="fin-label-btn fin-danger" type="button" data-fin-action="delete-label" data-label="${escapeHtml(owner)}" title="Delete label" aria-label="Delete ${escapeHtml(owner)}">✕</button>
      </span>
    </div>
    ${noSub.map(finAcctRow).join("")}
    ${subs.map((sub) => `
      <div class="fin-label-head fin-sublabel-head" data-fin-owner="${escapeHtml(owner)}" data-fin-sub="${escapeHtml(sub)}">
        <span class="fin-sublabel">${escapeHtml(sub)}</span>
        <span class="fin-label-actions">
          <button class="fin-label-btn" type="button" data-fin-action="rename-sublabel" data-label="${escapeHtml(owner)}" data-sub="${escapeHtml(sub)}" title="Rename sub-label" aria-label="Rename sub-label ${escapeHtml(sub)}">✎</button>
          <button class="fin-label-btn fin-danger" type="button" data-fin-action="delete-sublabel" data-label="${escapeHtml(owner)}" data-sub="${escapeHtml(sub)}" title="Delete sub-label" aria-label="Delete sub-label ${escapeHtml(sub)}">✕</button>
        </span>
      </div>
      <div class="fin-sub-group">
        ${ownerAccts.filter((x) => x.sub === sub).map(finAcctRow).join("") || `<p class="fin-hint">Empty — open an account's ✎ and pick this sub-label.</p>`}
      </div>`).join("")}
    ${!ownerAccts.length && !subs.length ? `<p class="fin-hint">No accounts under this label yet — open an account's ✎ and pick this label.</p>` : ""}`;
  }).join("");

  return `
    ${linkBlock}
    ${ownerBlocks}
    ${unlinkedLive.length ? `
    <div class="fin-subhead">Live accounts not linked yet</div>
    ${unlinkedLive.map((a) => `
      <div class="fin-live-row">
        <span class="fin-live-name">${escapeHtml(a.org)}${a.org && a.name ? " — " : ""}${escapeHtml(a.name)}</span>
        <span class="fin-live-bal${(a.balance ?? 0) < 0 ? " is-neg" : ""}">${formatFinMoney(a.balance ?? 0)}</span>
      </div>`).join("")}` : ""}
    <div class="fin-account-add">
      <input class="fin-item-name" type="text" list="finOwnerList" data-fin-new="owner" placeholder="Label (e.g. Family)" />
      <datalist id="finOwnerList">${owners.map((o) => `<option value="${escapeHtml(o)}"></option>`).join("")}</datalist>
      <input class="fin-item-name" type="text" data-fin-new="name" placeholder="Institution — account" />
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-account">Add</button>
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-label">+ Label</button>
    </div>`;
}

// Live-filter the budget categories by name without a full re-render (so the
// search box keeps focus + caret as you type). Re-applied after each render.
function applyBudgetSearch() {
  const grid = elements.financePlannerGrid;
  if (!grid) return;
  const q = financeBudgetSearch.trim().toLowerCase();
  grid.querySelectorAll(".fin-budget-groups [data-fin-cat-name]").forEach((cat) => {
    cat.hidden = q ? !cat.dataset.finCatName.includes(q) : false;
  });
  grid.querySelectorAll('.fin-budget-groups [data-fin-card="group"]').forEach((card) => {
    const cats = [...card.querySelectorAll("[data-fin-cat-name]")];
    card.hidden = Boolean(q && cats.length && cats.every((c) => c.hidden));
  });
}

// Compact "when was this last synced" label. Bank data refreshes ~once a day,
// so exact minutes matter less than "today / yesterday / a date" — that's the
// low-cost freshness cue in place of a refresh button that would fetch nothing new.
function finUpdatedLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (d.toDateString() === now.toDateString()) return `today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderFinancePage() {
  const grid = elements.financePlannerGrid;
  if (!grid) return;
  const income = financeIncomeTotal();
  const expenses = financeExpensesTotal();
  const cashFlow = income - expenses;

  // Actual spend for the VIEWED month per category, from labeled transactions
  // (spend transactions are negative amounts; mgmt/income labels don't land
  // here). The viewed month can be the current one, a past one (to review), or
  // a future one (to plan). Live transactions cover roughly the last 45 days;
  // for anything outside that window (older months), fall back to the persisted
  // monthly snapshot in financeMonthActuals. Future months have neither, so
  // they show budget only.
  const allTxns = financeLabeledTxns();
  const monthKey = financeViewMonth;
  const isCurrentMonth = monthKey === financeCurrentMonthKey();
  const storedMonths = (state.financeMonthActuals && typeof state.financeMonthActuals === "object") ? state.financeMonthActuals : {};
  const storedThis = storedMonths[monthKey];
  const haveLive = Boolean(financeLive?.accounts?.length);
  const liveCoversMonth = haveLive && allTxns.some((t) => (t.posted || "").slice(0, 7) === monthKey);
  // Current month always reads live (freshest); other months prefer the saved
  // snapshot, but still use live txns if they happen to reach into that month.
  const useLive = haveLive && (isCurrentMonth || (!storedThis && liveCoversMonth));
  const showActuals = Boolean(financeLinkStatus?.connected && (useLive || storedThis));
  const catActuals = new Map();
  const incomeByKey = new Map();
  let incomeActual = 0;
  if (useLive) {
    for (const t of allTxns) {
      if (!t.label || (t.posted || "").slice(0, 7) !== monthKey) continue;
      for (const p of financeTxnPortions(t)) {
        if (p.label === "income" || p.label.startsWith("income:")) {
          incomeActual += p.amount;
          incomeByKey.set(p.label, (incomeByKey.get(p.label) || 0) + p.amount);
        } else if (p.label.startsWith("cat:")) {
          const k = p.label.slice(4); // "<groupId>:<categoryId>"
          catActuals.set(k, (catActuals.get(k) || 0) + p.amount);
        }
      }
    }
  } else if (storedThis) {
    for (const [k, v] of Object.entries(storedThis.cats || {})) catActuals.set(k, Number(v) || 0);
    for (const [k, v] of Object.entries(storedThis.incomeBy || {})) incomeByKey.set(k, Number(v) || 0);
    incomeActual = Number(storedThis.income) || 0;
  }
  const catActual = (g, c) => catActuals.get(`${g.id}:${c.id}`) || 0;
  const prevMonthKey = (() => { const [y, m] = monthKey.split("-").map(Number); const d = new Date(y, m - 1, 1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const lastMo = storedMonths[prevMonthKey];
  const lastMoGroupActual = (g) => lastMo?.cats
    ? g.categories.reduce((s, c) => s + (Number(lastMo.cats[`${g.id}:${c.id}`]) || 0), 0)
    : null;

  const finItemRow = (scope, it) => `
    <div class="fin-item-row">
      <input class="fin-item-name" type="text" value="${escapeHtml(it.name)}" data-fin-edit="item-name" data-scope="${scope}" data-id="${it.id}" placeholder="Name" />
      <input class="fin-item-amount" type="text" inputmode="decimal" value="${escapeHtml(String(it.amount || 0))}" data-fin-edit="item-amount" data-scope="${scope}" data-id="${it.id}" />
      <button class="icon-btn fin-del-btn" type="button" data-fin-action="delete-item" data-scope="${scope}" data-id="${it.id}" title="Delete" aria-label="Delete line">&times;</button>
    </div>`;

  const cardHead = (cardId, title, total) => `
    <div class="fin-card-head" data-fin-action="toggle-expand" data-id="${cardId}" role="button" tabindex="0" aria-expanded="${financeExpanded.has(cardId)}">
      <h3>${escapeHtml(title)}</h3>
      <span class="fin-card-total">${total}</span>
      <span class="fin-card-caret">${financeExpanded.has(cardId) ? "▴" : "▾"}</span>
    </div>`;

  const incomeOpen = financeExpanded.has("card:income");
  // Income detail (people + scenarios). Header-less: it renders under the
  // clickable Income KPI inside the Monthly budget card, which is its heading.
  const incomeBreakdown = `
    <div class="fin-card fin-income-detail" data-fin-card="income">
      ${(state.financePeople || []).map((p) => {
        const active = financeActiveIncome(p);
        const open = financeExpanded.has(p.id);
        const got = incomeByKey.get(`income:${p.id}`) || 0;
        const freq = active?.payFrequency || "monthly";
        const net = scenarioMonthlyIncome(active, financeViewMonth);
        const ded = scenarioMonthlyDeductions(active, financeViewMonth);
        const paydays = active ? scenarioPeriodsInMonth(active, financeViewMonth) : 0;
        // Show the paycheck count (so a 3-check month reads) and any deductions.
        const cadenceHint = [
          freq !== "monthly" ? `${paydays} check${paydays === 1 ? "" : "s"}` : "",
          ded ? `− ${formatFinMoney(ded)} ded` : ""
        ].filter(Boolean).join(" · ");
        return `
        <div class="fin-person">
          <div class="fin-person-row">
            <span class="fin-person-name">${escapeHtml(p.name)}</span>
            <select class="fin-scenario-select" data-fin-edit="active-scenario" data-person="${p.id}">
              ${p.scenarios.map((s) => `<option value="${s.id}" ${s.id === (active?.id || "") ? "selected" : ""}>${escapeHtml(s.label)}</option>`).join("")}
            </select>
            ${showActuals && got ? `<span class="fin-cat-actual" title="Received this month">${formatFinMoney(got)}</span><span class="fin-of">/</span>` : ""}
            ${cadenceHint ? `<span class="fin-payday-hint" title="${paydays} payday${paydays === 1 ? "" : "s"} this month">${escapeHtml(cadenceHint)}</span>` : ""}
            <span class="fin-person-amount" title="Take-home (net) this month">${formatFinMoney(net)}</span>
            <button class="icon-btn fin-expand-btn" type="button" data-fin-action="toggle-expand" data-id="${p.id}" title="Edit scenarios" aria-label="Edit scenarios for ${escapeHtml(p.name)}">${open ? "▴" : "▾"}</button>
          </div>
          ${open ? `
          <div class="fin-person-editor">
            ${p.scenarios.map((s) => {
              const sf = s.payFrequency || "monthly";
              return `
              <div class="fin-item-row">
                <input class="fin-item-name" type="text" value="${escapeHtml(s.label)}" data-fin-edit="scenario-label" data-person="${p.id}" data-id="${s.id}" placeholder="Scenario" />
                <input class="fin-item-amount" type="text" inputmode="decimal" value="${escapeHtml(String(s.amount || 0))}" data-fin-edit="scenario-amount" data-person="${p.id}" data-id="${s.id}" title="Gross ${sf === "monthly" ? "per month" : "per paycheck"} (before deductions)" />
                <button class="icon-btn fin-del-btn" type="button" data-fin-action="delete-scenario" data-person="${p.id}" data-id="${s.id}" title="Delete scenario" aria-label="Delete scenario">&times;</button>
              </div>
              <div class="fin-item-row fin-pay-schedule">
                <select class="fin-scenario-select" data-fin-edit="scenario-frequency" data-person="${p.id}" data-id="${s.id}" aria-label="Pay frequency">
                  <option value="monthly" ${sf === "monthly" ? "selected" : ""}>Monthly total</option>
                  <option value="biweekly" ${sf === "biweekly" ? "selected" : ""}>Every 2 weeks / paycheck</option>
                  <option value="weekly" ${sf === "weekly" ? "selected" : ""}>Weekly / paycheck</option>
                </select>
                ${sf !== "monthly" ? `<input type="date" class="fin-item-name fin-pay-anchor" data-fin-edit="scenario-anchor" data-person="${p.id}" data-id="${s.id}" value="${escapeHtml(s.payAnchor || "")}" title="A recent payday (anchors the cadence)" aria-label="A recent payday date" />` : ""}
              </div>
              ${sf !== "monthly" && !s.payAnchor ? `<div class="fin-item-note">Set a recent payday date to count paychecks per month.</div>` : ""}
              <div class="fin-deductions">
                <div class="fin-subhead">Pre-deposit deductions (per ${sf === "monthly" ? "month" : "paycheck"})</div>
                ${(s.deductions || []).map((d) => `
                <div class="fin-item-row fin-deduction-row">
                  <input class="fin-item-name" type="text" value="${escapeHtml(d.label)}" data-fin-edit="deduction-label" data-person="${p.id}" data-scenario="${s.id}" data-id="${d.id}" placeholder="e.g. Dental Insurance" />
                  <input class="fin-item-amount" type="text" inputmode="decimal" value="${escapeHtml(String(d.amount || 0))}" data-fin-edit="deduction-amount" data-person="${p.id}" data-scenario="${s.id}" data-id="${d.id}" />
                  <button class="icon-btn fin-del-btn" type="button" data-fin-action="delete-deduction" data-person="${p.id}" data-scenario="${s.id}" data-id="${d.id}" title="Delete deduction" aria-label="Delete deduction">&times;</button>
                </div>`).join("")}
                <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-deduction" data-person="${p.id}" data-scenario="${s.id}">+ Deduction</button>
                ${(s.deductions || []).length ? `<div class="fin-item-note">This month: gross ${formatFinMoney(scenarioMonthlyGross(s, financeViewMonth))} − deductions ${formatFinMoney(scenarioMonthlyDeductions(s, financeViewMonth))} = take-home <b>${formatFinMoney(scenarioMonthlyIncome(s, financeViewMonth))}</b></div>` : ""}
              </div>
              ${s.note ? `<div class="fin-item-note">${escapeHtml(s.note)}</div>` : ""}`;
            }).join("")}
            <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-scenario" data-person="${p.id}">+ Scenario</button>
            <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="delete-person" data-person="${p.id}">Remove ${escapeHtml(p.name)}</button>
          </div>` : ""}
        </div>`;
      }).join("") || `<div class="empty-state">No income sources yet.</div>`}
      ${(() => {
        const lines = financeDeductionLines(financeViewMonth);
        if (!lines.length) return "";
        const total = lines.reduce((s, d) => s + d.monthly, 0);
        return `
        <div class="fin-deductions-summary">
          <div class="fin-subhead">Paycheck deductions (pre-deposit) · ${formatFinMoney(total)}</div>
          ${lines.map((d) => `<div class="fin-item-row fin-recap-row"><span class="fin-acct-name">${escapeHtml(d.person)}${d.person ? " · " : ""}${escapeHtml(d.label)}${d.periods !== 1 ? ` <small>(${d.periods}×)</small>` : ""}</span><span class="fin-live-bal">${formatFinMoney(d.monthly)}</span></div>`).join("")}
          <p class="fin-hint">Taken out before the money reaches your account — shown so you can see what you pay, but not counted in Budgeted (that would double-count it).</p>
        </div>`;
      })()}
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-person">+ Person</button>
    </div>`;

  // Budget-vs-actual bar + optional pace note ("~$X over" for the current month).
  const bNow = new Date();
  const bDaysInMonth = new Date(bNow.getFullYear(), bNow.getMonth() + 1, 0).getDate();
  const bDayOfMonth = bNow.getDate();
  const budgetBar = (actual, budget) => {
    if (!(budget > 0)) return "";
    const pctb = Math.min(100, Math.round((Math.max(0, actual) / budget) * 100));
    return `<div class="fin-budget-bar"><i class="${actual > budget ? "is-over" : ""}" style="width:${pctb}%"></i></div>`;
  };
  const budgetPace = (actual, budget) => {
    if (!isCurrentMonth || !showActuals || !(budget > 0) || !(actual > 0) || bDayOfMonth < 3) return "";
    const projected = (actual / bDayOfMonth) * bDaysInMonth;
    const over = projected - budget;
    if (over > Math.max(1, budget * 0.03)) return `<span class="fin-budget-pace is-over">~${formatFinMoney(over)} over by month-end</span>`;
    if (actual > budget) return `<span class="fin-budget-pace is-over">over budget</span>`;
    return "";
  };

  // Budget groups: default-open on the Budget tab so category numbers are visible
  // without drilling (a "fold:" key optionally collapses a group). Each category
  // shows a budget-vs-actual bar; tapping it opens the line-item editor.
  const budgetSearchActive = Boolean(financeBudgetSearch.trim());
  const groupCards = (state.financeBudgetGroups || []).map((g) => {
    const total = financeGroupTotal(g);
    const pct = income > 0 ? (total / income) * 100 : 0;
    // Accordion: collapsed by default, one open at a time; a search opens all.
    const open = budgetSearchActive || financeBudgetOpenGroup === g.id;
    const gActual = g.categories.reduce((s, c) => s + catActual(g, c), 0);
    const headTotal = showActuals
      ? `<span class="fin-cat-actual${gActual > total ? " is-over" : ""}">${formatFinMoney(gActual)}</span> <span class="fin-of">of</span> ${formatFinMoney(total)}`
      : formatFinMoney(total);
    return `
    <div class="fin-card" data-fin-card="group">
      <div class="fin-card-head fin-group-head" data-fin-action="fin-budget-group" data-id="${g.id}" role="button" tabindex="0" aria-expanded="${open}">
        <h3>${escapeHtml(g.label)}</h3>
        <span class="fin-card-total">${headTotal}</span>
        <span class="fin-card-caret">${open ? "▴" : "▾"}</span>
      </div>
      ${showActuals ? budgetBar(gActual, total) : ""}
      ${!open ? "" : `
      <div class="fin-group-detail">
        <span class="fin-group-pct">${income > 0 ? `${pct.toFixed(1)}% of income` : "% of income shows once income is set"}${showActuals && lastMoGroupActual(g) !== null ? ` · last mo ${formatFinMoney(lastMoGroupActual(g))}` : ""}</span>
        <label class="fin-group-ideal">Ideal <input type="number" min="0" max="100" step="1" value="${g.idealPct}" data-fin-edit="group-ideal" data-id="${g.id}" aria-label="Ideal percent of income for ${escapeHtml(g.label)}" /> %</label>
      </div>
      ${g.categories.map((c) => {
        const open = financeExpanded.has(c.id);
        const scope = `cat:${g.id}:${c.id}`;
        const pick = c.mode === "pick";
        const activeItem = financeCategoryActiveItem(c);
        const budget = financeCategoryTotal(c);
        const actual = catActual(g, c);
        const actualHtml = showActuals
          ? `<span class="fin-cat-actual${actual > budget ? " is-over" : ""}">${formatFinMoney(actual)}</span><span class="fin-of">/</span>`
          : "";
        const rowHtml = pick ? `
          <div class="fin-category-row fin-category-row--pick">
            <button class="fin-category-pick-expand" type="button" data-fin-action="toggle-expand" data-id="${c.id}">
              <span class="fin-category-name">${escapeHtml(c.name)}</span>
            </button>
            <select class="fin-scenario-select" data-fin-edit="category-active" data-scope="${scope}" aria-label="${escapeHtml(c.name)} option">
              ${c.items.map((it) => `<option value="${it.id}" ${it.id === (activeItem?.id || "") ? "selected" : ""}>${escapeHtml(it.name || "(unnamed)")}</option>`).join("")}
            </select>
            ${actualHtml}<span class="fin-category-total">${formatFinMoney(budget)}</span>
            <button class="fin-category-pick-expand fin-category-caret" type="button" data-fin-action="toggle-expand" data-id="${c.id}" aria-label="Edit ${escapeHtml(c.name)} options">${open ? "▴" : "▾"}</button>
          </div>` : `
          <button class="fin-category-row" type="button" data-fin-action="toggle-expand" data-id="${c.id}">
            <span class="fin-category-name">${escapeHtml(c.name)}</span>
            ${actualHtml}<span class="fin-category-total">${formatFinMoney(budget)}</span>
            <span class="fin-category-caret">${open ? "▴" : "▾"}</span>
          </button>`;
        return `
        <div class="fin-category" data-fin-cat-name="${escapeHtml((c.name || "").toLowerCase())}">
          ${rowHtml}
          ${showActuals ? budgetBar(actual, budget) : ""}
          ${budgetPace(actual, budget)}
          ${open ? `
          <div class="fin-category-items">
            ${(() => {
              const avg = financeCategoryHistoryAvg(g.id, c.id);
              if (avg == null || (budget && Math.abs(avg - budget) <= Math.max(1, budget * 0.02))) return "";
              return `<div class="fin-cat-history">
                <span class="fin-cat-history-label">3-mo avg <b>${formatFinMoney(avg)}</b>${budget ? ` · budget ${formatFinMoney(budget)}` : ""}</span>
                <button class="secondary-btn fin-add-btn fin-set-avg-btn" type="button" data-fin-action="set-cat-budget" data-group="${g.id}" data-id="${c.id}" data-amount="${avg}">Set to avg</button>
              </div>`;
            })()}
            ${c.items.map((it) => finItemRow(scope, it)).join("")}
            <div class="fin-item-row fin-item-row--tools">
              <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-item" data-scope="${scope}">+ ${pick ? "Option" : "Line"}</button>
              <label class="fin-mode-toggle">
                <input type="checkbox" class="live-toggle" data-fin-edit="category-mode" data-scope="${scope}" ${pick ? "checked" : ""} />
                <span>Pick one</span>
              </label>
              <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="delete-category" data-group="${g.id}" data-id="${c.id}">Delete category</button>
            </div>
          </div>` : ""}
        </div>`;
      }).join("")}
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-category" data-group="${g.id}">+ Category</button>`}
    </div>`;
  }).join("");

  const personalOpen = financeExpanded.has("card:personal");
  const personalFree = (state.financePersonal || []).reduce((s, p) => s + financeItemsTotal(p.incomeItems) - financeItemsTotal(p.expenseItems), 0);
  const personalCard = `
    <div class="fin-card" data-fin-card="personal">
      ${cardHead("card:personal", "Personal", `${formatFinMoney(personalFree)}/mo free`)}
      ${!personalOpen ? "" : (state.financePersonal || []).map((p) => {
        const inc = financeItemsTotal(p.incomeItems);
        const exp = financeItemsTotal(p.expenseItems);
        return `
        <div class="fin-personal-block">
          <div class="fin-person-row">
            <span class="fin-person-name">${escapeHtml(p.person)}</span>
            <span class="fin-personal-flow${inc - exp < 0 ? " is-neg" : ""}">${formatFinMoney(inc - exp)}/mo free</span>
          </div>
          <div class="fin-personal-cols">
            <div>
              <div class="fin-subhead">Income · ${formatFinMoney(inc)}</div>
              ${p.incomeItems.map((it) => finItemRow(`pinc:${p.id}`, it)).join("")}
              <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-item" data-scope="pinc:${p.id}">+ Line</button>
            </div>
            <div>
              <div class="fin-subhead">Expenses · ${formatFinMoney(exp)}</div>
              ${p.expenseItems.map((it) => finItemRow(`pexp:${p.id}`, it)).join("")}
              <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-item" data-scope="pexp:${p.id}">+ Line</button>
            </div>
          </div>
        </div>`;
      }).join("") || `<div class="empty-state">No personal budgets yet.</div>`}
      ${!personalOpen ? "" : `<button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-personal">+ Personal budget</button>`}
    </div>`;

  // Owner labels: the explicit list (add/rename/delete) unioned with any
  // owner strings still present on accounts, so nothing ever disappears.
  const owners = [...new Set([
    ...(Array.isArray(state.financeAccountLabels) ? state.financeAccountLabels : []),
    ...(state.financeAccounts || []).map((a) => a.owner || "Other"),
  ])];
  const liveById = new Map((financeLive?.accounts || []).map((a) => [a.id, a]));
  const linkedIds = new Set((state.financeAccounts || []).map((a) => a.linkedId).filter(Boolean));
  const unlinkedLive = (financeLive?.accounts || []).filter((a) => !linkedIds.has(a.id));

  // Net worth: live balances for linked accounts + manual balances elsewhere
  let netWorth = null, nwAssets = 0, nwLiabilities = 0;
  {
    let sum = 0, any = false;
    for (const a of (state.financeAccounts || [])) {
      const bal = financeAccountBalance(a, liveById);
      if (bal !== null) { sum += bal; any = true; if (bal >= 0) nwAssets += bal; else nwLiabilities += -bal; }
    }
    if (any) netWorth = sum;
  }

  // Top-of-page savings snapshot. Each card sums the accounts the user picked
  // for it (or, until they pick, the accounts of the matching kind).
  const cashIds = financeCardAccountIds("cash");
  const emergencyIds = financeCardAccountIds("emergency");
  const retirementIds = financeCardAccountIds("retirement");
  const cashOnHand = financeSumByAccountIds(cashIds, liveById);
  const retirementTotal = financeSumByAccountIds(retirementIds, liveById);
  const investmentTotal = financeSumByKind("investment", liveById);
  const debtTotal = financeSumByKind("debt", liveById);
  const needsGroup = (state.financeBudgetGroups || []).find((g) => g.id === "fin-group-needs")
    || (state.financeBudgetGroups || []).find((g) => /needs/i.test(g.label || ""));
  const monthlyNeeds = needsGroup ? financeGroupTotal(needsGroup) : 0;
  const emergencyMonths = Number(state.financeEmergencyMonths) > 0 ? Number(state.financeEmergencyMonths) : 3;
  const emergencyTarget = monthlyNeeds * emergencyMonths;
  const emergencyHave = financeSumByAccountIds(emergencyIds, liveById) || 0;

  // Retirement progress toward an age-based multiple of annual income
  // (configured right in the card's dropdown). No config → target is unknown.
  // Birth year: an explicit finance override wins; otherwise auto-fill from the
  // profile birthday (dob) so the retirement target works without re-entering
  // it. Clearing the card's input drops the override and falls back here again.
  const profileDob = getCurrentProfileMember()?.dob || "";
  const profileBirthYear = (() => {
    const y = profileDob ? Number(String(profileDob).slice(0, 4)) : NaN;
    return (y >= 1900 && y <= new Date().getFullYear()) ? y : null;
  })();
  const retBirthYear = Number(state.financeBirthYear) || profileBirthYear;
  const retBirthYearFromProfile = !state.financeBirthYear && profileBirthYear;
  const retAge = retBirthYear ? (new Date().getFullYear() - retBirthYear) : null;
  const retIncome = Number(state.financeAnnualIncome) > 0 ? Number(state.financeAnnualIncome) : 0;
  const retMultiple = retAge !== null ? retirementTargetMultiple(retAge) : null;
  const retTarget = (retMultiple !== null && retIncome > 0) ? retIncome * retMultiple : 0;
  const retHave = retirementTotal || 0;
  const retConfigured = retTarget > 0;

  // A "which accounts feed this card" editor, shown when the card is expanded
  // via its ▾ caret. The included accounts appear as removable rows; a dropdown
  // + "+" button adds one more at a time. Making any pick materializes the set.
  const savingsAccountEditor = (card, activeIds) => {
    const accts = state.financeAccounts || [];
    if (!accts.length) return `<p class="fin-hint">Add accounts in Settings › Finance first.</p>`;
    const byId = new Map(accts.map((a) => [a.id, a]));
    const active = activeIds.filter((id) => byId.has(id));
    const remaining = accts.filter((a) => !active.includes(a.id));
    const rows = active.map((id) => {
      const a = byId.get(id);
      const bal = financeAccountBalance(a, liveById);
      return `
        <div class="fin-savings-acct">
          <span class="fin-savings-acct-name">${escapeHtml(a.name || "Untitled")}</span>
          <span class="fin-savings-acct-bal${(bal || 0) < 0 ? " is-neg" : ""}">${bal === null ? "—" : formatFinMoney(bal)}</span>
          <button class="fin-savings-acct-rm" type="button" data-fin-action="remove-card-account" data-card="${card}" data-id="${escapeHtml(a.id)}" aria-label="Remove ${escapeHtml(a.name || "account")}">×</button>
        </div>`;
    }).join("");
    const adder = remaining.length ? `
      <div class="fin-savings-add">
        <select class="fin-savings-add-select" data-card-add="${card}" aria-label="Choose an account to add">
          ${remaining.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name || "Untitled")}</option>`).join("")}
        </select>
        <button class="fin-savings-add-btn" type="button" data-fin-action="add-card-account" data-card="${card}" aria-label="Add the selected account">+</button>
      </div>` : `<p class="fin-hint">Every account is already included.</p>`;
    return `<div class="fin-savings-accts">${rows || `<p class="fin-hint">None selected yet — add one below.</p>`}</div>${adder}`;
  };
  const savingsCaret = (id) => `<button class="fin-savings-caret" type="button" data-fin-action="toggle-expand" data-id="${id}" aria-expanded="${financeExpanded.has(id)}" aria-label="Show details">${financeExpanded.has(id) ? "▴" : "▾"}</button>`;
  // "$have / $target" (target omitted for cash-on-hand, which has no goal).
  const savingsValue = (have, target, isNull) => isNull
    ? `<div class="fin-savings-value">—</div>`
    : `<div class="fin-savings-value${have < 0 ? " is-neg" : ""}">${formatFinMoney(have)}${target != null ? `<span class="fin-savings-goal"> / ${formatFinMoney(target)}</span>` : ""}</div>`;

  const cashOpen = financeExpanded.has("savings:cash");
  const emergencyOpen = financeExpanded.has("savings:emergency");
  const retirementOpen = financeExpanded.has("savings:retirement");
  const savingsRow = !(state.financeAccounts || []).length ? "" : `
    <div class="fin-savings-row">
      <div class="fin-savings-card">
        <div class="fin-savings-head">
          <span class="fin-savings-label">Cash on hand</span>
          ${savingsCaret("savings:cash")}
        </div>
        ${savingsValue(cashOnHand || 0, null, cashOnHand === null)}
        ${cashOpen ? `<div class="fin-savings-editor">
          <p class="fin-hint">Accounts counted as cash on hand.</p>
          ${savingsAccountEditor("cash", cashIds)}
        </div>` : ""}
      </div>
      <div class="fin-savings-card fin-savings-emergency">
        <div class="fin-savings-head">
          <span class="fin-savings-label">Emergency savings</span>
          ${savingsCaret("savings:emergency")}
        </div>
        ${savingsValue(emergencyHave, emergencyTarget > 0 ? emergencyTarget : null, false)}
        ${emergencyOpen ? `<div class="fin-savings-editor">
          <p class="fin-hint">Target = ${emergencyMonths} month${emergencyMonths === 1 ? "" : "s"} of Needs${monthlyNeeds > 0 ? ` (${formatFinMoney(monthlyNeeds)}/mo)` : ""}${emergencyTarget > 0 ? ` = ${formatFinMoney(emergencyTarget)}` : ""}. Adjust the number of months in Settings › Finance.</p>
          <p class="fin-hint">Accounts counted as emergency savings.</p>
          ${savingsAccountEditor("emergency", emergencyIds)}
        </div>` : ""}
      </div>
      <div class="fin-savings-card fin-savings-retirement">
        <div class="fin-savings-head">
          <span class="fin-savings-label">Retirement savings</span>
          ${savingsCaret("savings:retirement")}
        </div>
        ${savingsValue(retHave, retConfigured ? retTarget : null, retirementTotal === null && !retConfigured)}
        ${retirementOpen ? `<div class="fin-savings-editor">
          <div class="fin-savings-fields">
            <label class="fin-savings-field">
              <span>Birth year</span>
              <input type="number" min="1900" max="${new Date().getFullYear()}" step="1" placeholder="e.g. 1988" value="${retBirthYear || ""}" data-fin-edit="ret-birth-year" />
              ${retBirthYearFromProfile ? `<span class="fin-hint">From your profile birthday</span>` : ""}
            </label>
            <label class="fin-savings-field">
              <span>Annual income</span>
              <input type="number" min="0" step="1000" placeholder="e.g. 90000" value="${retIncome || ""}" data-fin-edit="ret-annual-income" />
            </label>
          </div>
          <p class="fin-hint">${retAge !== null ? `At age ${retAge}, the benchmark is ${retMultiple.toFixed(1)}× income${retConfigured ? ` = ${formatFinMoney(retTarget)}` : ""} (Fidelity's guideposts: 1× by 30, 3× by 40, 6× by 50, 10× by 67).` : "Add your birth year and income for an age-based target."}</p>
          <p class="fin-hint">Accounts counted as retirement.</p>
          ${savingsAccountEditor("retirement", retirementIds)}
        </div>` : ""}
      </div>
    </div>`;

  // The Accounts management UI moved to Settings › Finance (see
  // renderFinanceAccountsPanel); it no longer renders as a card here.

  const f = financeTxnFilter;
  // Trim only at point-of-use so live typing keeps spaces (f.q holds the raw box
  // value, which stays the <input> value across the per-keystroke re-render).
  const query = (f.q || "").trim().toLowerCase();
  // Keep the ledger to the viewed month: in August you see August's charges, and
  // paging to July shows July's (and only July's), not a rolling 45-day blur.
  const monthTxns = allTxns.filter((t) => (t.posted || "").slice(0, 7) === monthKey);
  // A search looks across the WHOLE loaded window (~45 days), not just the viewed
  // month — otherwise searching in September silently can't find an August charge,
  // which reads as "it's gone." No query = the viewed month's ledger as before.
  let shownTxns = (query ? allTxns : monthTxns).slice(); // copy — sorting below must never mutate the cached/shared array
  if (query) shownTxns = shownTxns.filter((t) => `${t.description || ""} ${t.displayName || ""}`.toLowerCase().includes(query));
  if (f.account) shownTxns = shownTxns.filter((t) => t.accountId === f.account);
  if (f.kind === "unlabeled") shownTxns = shownTxns.filter((t) => !t.label);
  else if (f.kind === "auto") shownTxns = shownTxns.filter((t) => t.labelSource === "auto");
  else if (f.kind === "split") shownTxns = shownTxns.filter((t) => t.label === "split");
  else if (f.kind === "mgmt") shownTxns = shownTxns.filter((t) => t.label === "mgmt");
  else if (f.kind === "income") shownTxns = shownTxns.filter((t) => t.label === "income" || (t.label || "").startsWith("income:"));
  else if (f.kind.startsWith("group:")) shownTxns = shownTxns.filter((t) => (t.label || "").startsWith(`cat:${f.kind.slice(6)}`));
  if (f.sort === "label") {
    shownTxns.sort((x, y) => {
      const lx = x.label ? financeTxnLabelName(x.label) : "￿", ly = y.label ? financeTxnLabelName(y.label) : "￿";
      return lx.localeCompare(ly) || (y.posted || "").localeCompare(x.posted || "");
    });
  } else if (f.sort === "account") {
    shownTxns.sort((x, y) => (x.account || "").localeCompare(y.account || "") || (y.posted || "").localeCompare(x.posted || ""));
  }
  const FIN_TXN_LIST_CAP = 60; // keep the default render light; "Show all" lifts it
  const txnsTruncated = !financeTxnListExpanded && shownTxns.length > FIN_TXN_LIST_CAP;
  const txns = financeTxnListExpanded ? shownTxns : shownTxns.slice(0, FIN_TXN_LIST_CAP);
  const needsLabelGroups = financeUnlabeledByMerchant(allTxns); // one row per merchant, not one per repeat charge
  const unlabeledTxnCount = monthTxns.filter((t) => !t.label).length; // to-label count for the viewed month
  const recAlerts = financeRecurringAlerts();
  // "Scan receipt" — a phone with a receipt on its screen (torn bottom, logo,
  // line items), drawn in the app's stroke-icon style (currentColor, no fill)
  // to match the bell/other icons rather than a raw 📷 emoji.
  const scanReceiptSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="1.5" width="14" height="21" rx="2.5"/><path d="M9 4h4"/><path d="M10 20h2"/><path d="M7.5 7H14.5V15l-1 1-1-1-1 1-1-1-1 1-1-1-1 1V7Z"/><circle cx="9.4" cy="9.3" r="1.1"/><path d="M11.4 9.3h3M8 11.7h3.2M12.3 11.7h2M8 13.4h3.2M12.3 13.4h2"/></svg>`;
  // Quick-label chips: the user's most-used budget categories, so an unlabeled
  // spend can be filed in one tap without opening the detail dropdown.
  const quickLabelFreq = new Map();
  for (const t of allTxns) { if (t.label && t.label.startsWith("cat:")) quickLabelFreq.set(t.label, (quickLabelFreq.get(t.label) || 0) + 1); }
  const quickLabels = [...quickLabelFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label]) => ({ label, name: financeTxnLabelName(label) }));

  const txnSelect = (t) => {
    const isSplit = t.label === "split";
    const placeholder = isSplit ? `Split (${(t.split || []).length})` : t.labelSource === "auto" ? `auto: ${escapeHtml(financeTxnLabelName(t.label))}` : "label…";
    return `
    <select class="fin-txn-label${!t.label ? " is-unlabeled" : t.labelSource === "auto" ? " is-auto" : ""}" data-fin-edit="txn-label" data-id="${escapeHtml(t.id)}" data-desc="${escapeHtml(t.description)}" aria-label="Budget label for ${escapeHtml(t.displayName)}">
      <option value="" ${t.labelSource !== "manual" || isSplit ? "selected" : ""}>${placeholder}</option>
      ${financeTxnLabelOptionsHtml(t.labelSource === "manual" && !isSplit ? t.label : "")}
      ${(t.amount || 0) < 0 ? `<option value="__split__">Split…</option>` : ""}
    </select>`;
  };
  const splitEditorHtml = (t) => {
    const total = Math.abs(t.amount || 0);
    const assigned = financeSplitDraft.portions.reduce((s, p) => s + (parseFinAmount(p.amount) || 0), 0);
    const remaining = Math.round((total - assigned) * 100) / 100;
    const ok = Math.abs(remaining) <= 0.02 && financeSplitDraft.portions.some((p) => p.label && parseFinAmount(p.amount) > 0);
    const receipt = financeReceiptForTxn(t);
    const pctAssigned = total > 0 ? Math.min(100, Math.round((assigned / total) * 100)) : 0;
    const over = assigned - total > 0.02;
    const balanced = Math.abs(remaining) <= 0.02;
    return `
    <div class="fin-split-editor fin-split-card">
      <div class="fin-split-head"><span class="fin-split-title">Split ${formatFinMoney(total)}</span><span class="fin-hint">${escapeHtml(t.displayName)}</span></div>
      <div class="fin-split-scan-row">
        ${receipt ? `<button class="fin-txn-act" type="button" data-fin-action="split-prefill" data-id="${escapeHtml(t.id)}"><span>📧 Use email receipt${(receipt.items || []).length ? ` · ${receipt.items.length} items` : ""}</span></button>` : ""}
        <button class="fin-txn-act fin-scan-btn" type="button" data-fin-action="split-scan" ${financeScanBusy ? "disabled" : ""}>${financeScanBusy ? "<span>Reading receipt…</span>" : `${scanReceiptSvg}<span>Scan receipt</span>`}</button>
        <input type="file" accept="image/*" capture="environment" data-fin-edit="split-scan-file" hidden />
      </div>
      <div class="fin-split-portions">
        ${financeSplitDraft.portions.map((p, i) => `
          <div class="fin-split-portion">
            <select class="fin-txn-label fin-split-select" data-fin-edit="split-label" data-idx="${i}" aria-label="Portion category">
              <option value="">category…</option>
              ${financeTxnLabelOptionsHtml(p.label)}
            </select>
            <input class="fin-item-amount fin-split-amt-in" type="text" inputmode="decimal" value="${escapeHtml(String(p.amount ?? ""))}" placeholder="0.00" data-fin-edit="split-amount" data-idx="${i}" aria-label="Portion amount" />
            <button class="icon-btn fin-del-btn" type="button" data-fin-action="split-remove-row" data-idx="${i}" title="Remove" aria-label="Remove portion">&times;</button>
          </div>`).join("")}
      </div>
      <div class="fin-split-meter"><i class="${over ? "is-over" : ""}" style="width:${pctAssigned}%"></i></div>
      <div class="fin-split-status">
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="split-add-row">+ Category</button>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="split-even">Even</button>
        ${!balanced ? `<button class="secondary-btn fin-add-btn" type="button" data-fin-action="split-remainder">Assign ${formatFinMoney(remaining)}</button>` : ""}
        <span class="fin-split-remaining ${balanced ? "is-done" : over ? "is-over" : "is-under"}">${balanced ? "✓ balanced" : over ? `${formatFinMoney(-remaining)} over` : `${formatFinMoney(remaining)} left`}</span>
      </div>
      <div class="fin-item-row fin-item-row--tools">
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="split-cancel">Cancel</button>
        <button class="secondary-btn fin-add-btn fin-split-save" type="button" data-fin-action="split-save" data-id="${escapeHtml(t.id)}" ${ok ? "" : "disabled"}>Save split</button>
      </div>
    </div>`;
  };
  const txnRow = (t, { compact = false, dupCount = 1, grouped = false } = {}) => {
    // When the detail card is open for this txn, the rename UI lives there
    // instead of swapping the row, so the row stays a normal clickable row.
    const renaming = financeRenamingTxnId === t.id && financeDetailTxnId !== t.id;
    const raw = String(t.description || "");
    const rawEsc = escapeHtml(raw);
    const descTitle = t.displayName !== raw ? `${escapeHtml(t.account)} · was: ${rawEsc}` : escapeHtml(t.account);
    if (renaming) {
      const merchantKey = financeMerchantKey(raw);
      const currentMerchant = (state.financeMerchantNames || {})[merchantKey] || raw;
      const overrides = state.financeTxnNoteOverrides || {};
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, t.id);
      const currentNote = hasOverride ? overrides[t.id] : financeSuggestedNote((state.financeTxnNoteCounts || {})[merchantKey]);
      return `
      <div class="fin-txn-row fin-txn-row--renaming${t.pending ? " is-pending" : ""}">
        <span class="fin-txn-date">${t.posted ? escapeHtml(new Date(t.posted).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "—"}</span>
        <div class="fin-rename-fields">
          <input class="fin-item-name fin-txn-rename-input" type="text" value="${escapeHtml(currentMerchant)}" placeholder="${rawEsc}" data-fin-rename-id="${escapeHtml(t.id)}" data-fin-rename-raw="${rawEsc}" data-fin-rename-field="name" aria-label="Store or account name" />
          <span class="fin-rename-sep">–</span>
          <input class="fin-item-name fin-txn-rename-input" type="text" value="${escapeHtml(currentNote)}" placeholder="what was purchased (optional)" data-fin-rename-id="${escapeHtml(t.id)}" data-fin-rename-raw="${rawEsc}" data-fin-rename-field="note" aria-label="What was purchased on this transaction" />
        </div>
        <button class="icon-btn fin-del-btn" type="button" data-fin-action="rename-txn-save" data-id="${escapeHtml(t.id)}" title="Save" aria-label="Save">✓</button>
        <button class="icon-btn fin-del-btn" type="button" data-fin-action="rename-txn-cancel" title="Cancel" aria-label="Cancel">&times;</button>
      </div>`;
    }
    if (compact) {
      return `
      <div class="fin-txn-row${t.pending ? " is-pending" : ""}" data-fin-txn-id="${escapeHtml(t.id)}">
        <span class="fin-txn-date">${t.posted ? escapeHtml(new Date(t.posted).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "—"}</span>
        <span class="fin-txn-desc" title="${descTitle}">${escapeHtml(t.displayName)}${t.pending ? " · pending" : ""}${dupCount > 1 ? ` <span class="fin-txn-dup" title="${dupCount} unlabeled charges from this merchant — labeling this one labels them all">×${dupCount}</span>` : ""}</span>
        <span class="fin-txn-amt${(t.amount || 0) < 0 ? " is-neg" : ""}">${formatFinMoney(t.amount || 0)}</span>
        ${txnSelect(t)}
      </div>`;
    }
    // Status distinction: pending / unlabeled / auto-labeled / labeled.
    const statusClass = t.pending ? " is-pending" : !t.label ? " is-unlabeled" : t.labelSource === "auto" ? " is-auto" : " is-labeled";
    const labelPill = t.label && t.label !== "split"
      ? `<span class="fin-txn-label-pill${t.labelSource === "auto" ? " is-auto" : ""}" title="${t.labelSource === "auto" ? "Auto-labeled — tap to change" : "Labeled"}">${escapeHtml(financeTxnLabelName(t.label))}</span>`
      : (t.label === "split" ? `<span class="fin-txn-label-pill is-split" title="Split across categories">Split</span>` : "");
    // Inline quick-labels for an unlabeled SPEND — one tap to file it.
    const showQuick = !t.label && (t.amount || 0) < 0 && quickLabels.length > 0;
    return `
    <div class="fin-txn-row fin-txn-row--clickable${statusClass}${financeDetailTxnId === t.id ? " is-open" : ""}" data-fin-action="open-txn-detail" data-id="${escapeHtml(t.id)}" data-fin-txn-id="${escapeHtml(t.id)}" role="button" tabindex="0" aria-expanded="${financeDetailTxnId === t.id}">
      ${grouped ? "" : `<span class="fin-txn-date">${t.posted ? escapeHtml(new Date(t.posted).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "—"}</span>`}
      ${financeTxnNeedsConfirm(t)
        ? `<button class="fin-txn-dot fin-txn-dot--confirm" type="button" data-fin-action="confirm-txn" data-id="${escapeHtml(t.id)}" title="Skipped in notifications — click to confirm" aria-label="Confirm this transaction"></button>`
        : (!t.label ? `<span class="fin-txn-dot" title="Needs a label" aria-label="Needs a label"></span>` : "")}
      <span class="fin-txn-desc" title="${descTitle}">${escapeHtml(t.displayName)}</span>
      ${t.isManual ? `<span class="fin-txn-flag fin-txn-flag--manual" title="Manually entered">manual</span>` : ""}
      ${t.pending ? `<span class="fin-txn-flag fin-txn-flag--pending" title="Pending — the amount may still change">pending</span>` : ""}
      ${labelPill}
      <span class="fin-txn-amt${(t.amount || 0) < 0 ? " is-neg" : ""}">${formatFinMoney(t.amount || 0)}</span>
    </div>
    ${showQuick ? `<div class="fin-txn-quick">
      ${quickLabels.map((q) => `<button class="fin-quick-chip" type="button" data-fin-action="quick-label" data-id="${escapeHtml(t.id)}" data-label="${escapeHtml(q.label)}" data-desc="${escapeHtml(t.description)}">${escapeHtml(q.name)}</button>`).join("")}
      <button class="fin-quick-chip fin-quick-more" type="button" data-fin-action="open-txn-detail" data-id="${escapeHtml(t.id)}">More…</button>
    </div>` : ""}`;
  };
  const returnLinkHtml = (t) => {
    if (t.linkedPurchaseId) {
      const purchase = allTxns.find((x) => x.id === t.linkedPurchaseId);
      if (!purchase) return "";
      const pDate = purchase.posted ? new Date(purchase.posted).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
      return `
      <div class="fin-return-box fin-return-linked">
        <span class="fin-hint">Linked return</span>
        <div>Offsets <strong>${escapeHtml(purchase.displayName)}</strong> · ${escapeHtml(pDate)} · ${formatFinMoney(purchase.amount || 0)}</div>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="unlink-return" data-id="${escapeHtml(t.id)}">Unlink</button>
      </div>`;
    }
    if (t.linkedReturnIds?.length) {
      const total = t.linkedReturnIds.reduce((s, id) => s + (allTxns.find((x) => x.id === id)?.amount || 0), 0);
      return `
      <div class="fin-return-box">
        <span class="fin-hint">${t.linkedReturnIds.length} linked return${t.linkedReturnIds.length > 1 ? "s" : ""} · ${formatFinMoney(total)} offsetting this category</span>
      </div>`;
    }
    if ((t.amount || 0) <= 0) return "";
    const searching = financeReturnLinkSearch?.txnId === t.id;
    if (searching) {
      const q = financeReturnLinkSearch.q || "";
      const candidates = financeReturnLinkCandidates(t, allTxns, q);
      return `
      <div class="fin-return-box fin-return-search">
        <span class="fin-hint">Find the original purchase</span>
        <input type="search" class="fin-item-name" placeholder="Search by merchant…" value="${escapeHtml(q)}" data-fin-edit="return-link-q" data-id="${escapeHtml(t.id)}" aria-label="Search for the original purchase" />
        ${candidates.length ? candidates.map((p) => {
          const pDate = p.posted ? new Date(p.posted).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
          return `
          <div class="fin-return-result">
            <span>${escapeHtml(p.displayName)} · ${escapeHtml(pDate)} · ${formatFinMoney(p.amount || 0)}</span>
            <button class="secondary-btn fin-add-btn" type="button" data-fin-action="link-return" data-id="${escapeHtml(t.id)}" data-purchase-id="${escapeHtml(p.id)}">Link</button>
          </div>`;
        }).join("") : `<span class="fin-hint">No matching purchases.</span>`}
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="return-link-search-cancel">Cancel</button>
      </div>`;
    }
    const suggestion = financeSuggestReturnMatch(t, allTxns);
    if (suggestion) {
      const sDate = suggestion.posted ? new Date(suggestion.posted).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
      return `
      <div class="fin-return-box fin-return-suggest">
        <span class="fin-hint">Possible return for</span>
        <div><strong>${escapeHtml(suggestion.displayName)}</strong> · ${escapeHtml(sDate)} · ${formatFinMoney(suggestion.amount || 0)}</div>
        <div class="fin-item-row">
          <button class="secondary-btn fin-add-btn" type="button" data-fin-action="link-return" data-id="${escapeHtml(t.id)}" data-purchase-id="${escapeHtml(suggestion.id)}">Link as return</button>
          <button class="secondary-btn fin-add-btn" type="button" data-fin-action="return-link-search-start" data-id="${escapeHtml(t.id)}">Not this one…</button>
        </div>
      </div>`;
    }
    return `
    <div class="fin-return-box">
      <span class="fin-hint">Is this a return?</span>
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="return-link-search-start" data-id="${escapeHtml(t.id)}">Find the purchase…</button>
    </div>`;
  };
  const txnDetailHtml = (t) => {
    const raw = String(t.description || "");
    const rawEsc = escapeHtml(raw);
    const renaming = financeRenamingTxnId === t.id;
    const merchantKey = financeMerchantKey(raw);
    const currentMerchant = (state.financeMerchantNames || {})[merchantKey] || raw;
    const noteOverrides = state.financeTxnNoteOverrides || {};
    const hasNote = Object.prototype.hasOwnProperty.call(noteOverrides, t.id);
    const currentNote = hasNote ? noteOverrides[t.id] : financeSuggestedNote((state.financeTxnNoteCounts || {})[merchantKey]);
    const facts = [
      t.posted ? new Date(t.posted).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—",
      t.account,
      t.pending ? "Pending" : "Posted",
    ].filter(Boolean).join(" · ");
    const isSplit = t.label === "split" && Array.isArray(t.split);
    const rc = financeReceiptForTxn(t);
    const keptReceipt = (state.financeTxnReceipts || {})[t.id];
    return `
    <div class="fin-txn-detail fin-txn-card" data-fin-txn-id="${escapeHtml(t.id)}">
      <div class="fin-txn-card-head">
        ${renaming ? `
        <div class="fin-rename-fields">
          <input class="fin-item-name fin-txn-rename-input" type="text" value="${escapeHtml(currentMerchant)}" placeholder="${rawEsc}" data-fin-rename-id="${escapeHtml(t.id)}" data-fin-rename-raw="${rawEsc}" data-fin-rename-field="name" aria-label="Store or person name" />
          <input class="fin-item-name fin-txn-rename-input" type="text" value="${escapeHtml(currentNote)}" placeholder="what was purchased (optional)" data-fin-rename-id="${escapeHtml(t.id)}" data-fin-rename-raw="${rawEsc}" data-fin-rename-field="note" aria-label="What was purchased" />
          <button class="icon-btn fin-del-btn" type="button" data-fin-action="rename-txn-save" data-id="${escapeHtml(t.id)}" title="Save" aria-label="Save">✓</button>
          <button class="icon-btn fin-del-btn" type="button" data-fin-action="rename-txn-cancel" title="Cancel" aria-label="Cancel">&times;</button>
        ` : `
        <div class="fin-txn-card-title">
          <span class="fin-txn-card-merchant">${escapeHtml(t.displayName)}</span>
          ${currentNote ? `<span class="fin-txn-card-note-sub">${escapeHtml(currentNote)}</span>` : ""}
        </div>
        ${t.isManual
          ? `<button class="icon-btn fin-del-btn" type="button" data-fin-action="manual-txn-edit" data-id="${escapeHtml(t.id)}" title="Edit" aria-label="Edit transaction">✎</button>
             <button class="icon-btn fin-del-btn" type="button" data-fin-action="manual-txn-delete" data-id="${escapeHtml(t.id)}" title="Delete" aria-label="Delete transaction">🗑</button>`
          : `<button class="icon-btn fin-del-btn" type="button" data-fin-action="rename-txn-start" data-id="${escapeHtml(t.id)}" title="Rename / add note" aria-label="Rename or add a note">✎</button>`}
        <button class="icon-btn fin-del-btn" type="button" data-fin-action="close-txn-detail" title="Close" aria-label="Close">&times;</button>
        `}
      </div>

      <div class="fin-txn-card-amount${(t.amount || 0) < 0 ? " is-neg" : ""}">
        <span>${formatFinMoney(t.amount || 0)}</span>
        <button class="icon-btn fin-sign-flip-btn" type="button" data-fin-action="flip-txn-sign" data-id="${escapeHtml(t.id)}" title="${t.signFlipped ? "Restore the original sign" : "Flip the sign — bank reported it backwards"}" aria-label="Flip sign">⇄</button>
      </div>
      <div class="fin-txn-card-facts">${escapeHtml(facts)}${t.signFlipped ? ` · sign corrected` : ""}${t.displayName !== raw ? ` · <span class="fin-txn-raw" title="Original bank text">${rawEsc}</span>` : ""}</div>

      ${isSplit ? `
      <div class="fin-txn-card-section">
        <span class="fin-hint">Split across ${t.split.length} categories</span>
        <div class="fin-split-chips">
          ${t.split.map((p) => `<span class="fin-split-chip"><span class="fin-split-cat">${escapeHtml(financeTxnLabelName(p.label))}</span><span class="fin-split-amt">${formatFinMoney(-Math.abs(p.amount || 0))}</span></span>`).join("")}
        </div>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="start-split" data-id="${escapeHtml(t.id)}">Edit split</button>
      </div>` : `
      <div class="fin-txn-card-section">
        <span class="fin-hint">Category</span>
        <div class="fin-item-row">${txnSelect(t)}</div>
      </div>
      <div class="fin-txn-card-actions">
        ${(t.amount || 0) < 0 ? `<button class="fin-txn-act" type="button" data-fin-action="start-split" data-id="${escapeHtml(t.id)}"><span class="fin-txn-act-ic" aria-hidden="true">⑂</span><span>Split into categories</span></button>` : ""}
        ${(t.amount || 0) < 0 ? `<button class="fin-txn-act" type="button" data-fin-action="detail-scan-receipt" data-id="${escapeHtml(t.id)}">${scanReceiptSvg}<span>Scan receipt</span></button>` : ""}
      </div>`}

      ${returnLinkHtml(t)}
      ${rc?.id ? `
      <div class="fin-return-box fin-receipt-email">
        <span class="fin-hint">Order email${rc.merchant ? ` · ${escapeHtml(rc.merchant)}` : ""}${(rc.items || []).length ? ` · ${rc.items.length} item${rc.items.length === 1 ? "" : "s"}` : ""}</span>
        ${!isSplit && (rc.portions || rc.items || []).length > 1 ? `<button class="secondary-btn fin-add-btn" type="button" data-fin-action="itemize-email" data-id="${escapeHtml(t.id)}">Itemize</button>` : ""}
        <a class="secondary-btn fin-add-btn" href="https://mail.google.com/mail/u/0/#all/${encodeURIComponent(rc.id)}" target="_blank" rel="noopener noreferrer">View email</a>
      </div>` : ""}
      ${keptReceipt ? `
      <div class="fin-return-box fin-receipt-kept">
        <span class="fin-hint">📎 Receipt image kept${keptReceipt.uploadedAt ? ` · ${new Date(keptReceipt.uploadedAt).toLocaleDateString()}` : ""}</span>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="view-receipt-image" data-id="${escapeHtml(t.id)}">View</button>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="attach-receipt-image" data-id="${escapeHtml(t.id)}">Replace</button>
        <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="remove-receipt-image" data-id="${escapeHtml(t.id)}">Remove</button>
      </div>`
      : ((t.amount || 0) < 0 ? `
      <div class="fin-return-box fin-receipt-kept">
        <span class="fin-hint">No receipt image yet</span>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="attach-receipt-image" data-id="${escapeHtml(t.id)}">Attach image</button>
      </div>` : "")}
    </div>`;
  };
  // A brand-new user (nothing connected, no manual accounts) gets the connect
  // prompt instead of the Transactions/Budget/Accounts/Insights content — so
  // tapping any tab first still guides them to set up instead of showing blank
  // cards. A user with manual-only accounts (no bank link, by choice) still
  // counts as set up: they have real transactions/budget to see, just no live
  // bank feed. An existing user with a transient disconnect keeps their
  // planning views too.
  const showOnboard = !financeLinkStatus?.connected && !(state.financeAccounts || []).length;
  // Finance notifications — the bell lives in the Transactions card head (in
  // place of the old "N to label · M" subtitle) and its panel nests inside the
  // Transactions card. Defined here so the Transactions card can embed them.
  const bellSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const attention = financeAccountsNeedingAttention();
  const notifCount = needsLabelGroups.length + recAlerts.length + attention.length;
  const notifBell = showOnboard ? "" : `
    <button class="icon-btn fin-notif-btn" type="button" data-fin-action="toggle-notifs" title="Finance items that need attention" aria-label="Finance notifications">
      ${bellSvg}
      ${notifCount ? `<span class="fin-notif-badge">${notifCount}</span>` : ""}
    </button>`;
  // The bell now opens the single-card notifications deck (openFinanceTxnReview)
  // instead of an inline list — so no panel is embedded in the card head.
  const notifPanel = "";

  const filterActive = Boolean(query || f.kind || f.account);
  // Build the list: grouped by day for the default (date) sort, flat otherwise.
  const renderTxnBlock = (t) => txnRow(t, { grouped: f.sort === "date" }) + (financeDetailTxnId === t.id ? txnDetailHtml(t) : "") + (financeSplitDraft?.txnId === t.id ? splitEditorHtml(t) : "");
  const txnDayLabel = (dayStr) => {
    if (!dayStr || dayStr === "nodate") return "No date";
    const d = new Date(dayStr + "T12:00:00");
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
  let txnListHtml;
  if (f.sort === "date") {
    const days = [];
    for (const t of txns) {
      const day = (t.posted || "").slice(0, 10) || "nodate";
      if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
      days[days.length - 1].items.push(t);
    }
    txnListHtml = days.map((g) => {
      const spend = g.items.reduce((s, t) => s + Math.min(0, t.amount || 0), 0);
      return `<div class="fin-txn-day">
        <div class="fin-txn-day-head"><span>${escapeHtml(txnDayLabel(g.day))}</span>${spend < 0 ? `<span class="fin-txn-day-total">${formatFinMoney(spend)}</span>` : ""}</div>
        ${g.items.map(renderTxnBlock).join("")}
      </div>`;
    }).join("");
  } else {
    txnListHtml = txns.map(renderTxnBlock).join("");
  }
  // While the first live fetch is in flight (and nothing cached to show yet),
  // a skeleton makes "loading" distinct from a genuinely empty month or a
  // failed load — the three used to look identical.
  txnListHtml = txnListHtml || (financeLiveLoading && financeLinkStatus?.connected && !(financeLive?.errors || []).length
    ? `<div class="fin-txn-loading" aria-live="polite" aria-busy="true"><span class="fin-txn-skel"></span><span class="fin-txn-skel"></span><span class="fin-txn-skel"></span><span class="fin-hint">Loading your transactions…</span></div>`
    : `<div class="empty-state">${filterActive ? "Nothing matches the filters." : `No transactions for ${escapeHtml(new Date(monthKey + "-15T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }))}.`}</div>`);

  // On its own tab the Transactions list is the primary content — always shown
  // (no card collapse to drill through).
  const txnsOpen = true;
  const sortActive = f.sort !== "date";
  const accountOptions = [...new Map(allTxns.map((t) => [t.accountId, t.account])).entries()];
  const manualFormHtml = !financeManualForm ? "" : `
    <div class="fin-split-editor">
      <div class="fin-subhead">${financeManualForm.id ? "Edit transaction" : "Add transaction"}</div>
      <div class="fin-item-row">
        <input class="fin-item-name" type="date" value="${escapeHtml(financeManualForm.date)}" data-fin-manual="date" aria-label="Date" />
        <input class="fin-item-name" type="text" value="${escapeHtml(financeManualForm.desc)}" placeholder="Description" data-fin-manual="desc" aria-label="Description" />
      </div>
      <div class="fin-item-row">
        <input class="fin-item-amount" type="text" inputmode="decimal" value="${escapeHtml(financeManualForm.amount)}" placeholder="-12.34" data-fin-manual="amount" aria-label="Amount" />
        <input class="fin-item-name" type="text" value="${escapeHtml(financeManualForm.account)}" placeholder="Cash" data-fin-manual="account" aria-label="Account or source" />
      </div>
      <select class="fin-txn-label" data-fin-manual="label" aria-label="Budget label">
        <option value="">label…</option>
        ${financeTxnLabelOptionsHtml(financeManualForm.label)}
      </select>
      <div class="fin-item-row fin-item-row--tools">
        <span class="fin-hint">Negative = spent, positive = received</span>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="manual-txn-cancel">Cancel</button>
        <button class="secondary-btn fin-add-btn" type="button" data-fin-action="manual-txn-save">Save</button>
      </div>
    </div>`;
  const txnsCard = showOnboard ? "" : `
    <div class="fin-card" data-fin-card="txns">
      <div class="fin-card-head fin-txns-head">
        <h3>Transactions</h3>
        ${notifBell}
      </div>
      <div class="fin-txn-status">${financeLiveLoading ? `<span class="fin-txn-status-load">Updating…</span>` : (financeLive?.at ? `Updated ${escapeHtml(finUpdatedLabel(financeLive.at))}` : "")}</div>
      ${notifPanel}
      ${!txnsOpen ? "" : `
      <div class="fin-txn-filters">
        <input type="search" class="fin-item-name fin-txn-search" placeholder="Search…" value="${escapeHtml(f.q)}" data-fin-edit="txn-filter-q" aria-label="Search transactions" />
        <select class="fin-scenario-select fin-txn-sort" data-fin-edit="txn-filter-sort" aria-label="Sort transactions">
          <option value="date" ${f.sort === "date" ? "selected" : ""}>Sort: Date</option>
          <option value="label" ${f.sort === "label" ? "selected" : ""}>Sort: Label</option>
          <option value="account" ${f.sort === "account" ? "selected" : ""}>Sort: Account</option>
        </select>
        <button class="secondary-btn fin-add-btn${filterActive ? " is-active" : ""}" type="button" data-fin-action="txn-filter-toggle" aria-expanded="${financeTxnFilterOpen}">Filter${filterActive ? " •" : ""}</button>
        <button class="icon-btn fin-txn-icon-btn" type="button" data-fin-action="batch-scan-receipts" ${financeBatchScanBusy ? "disabled" : ""} aria-label="Scan receipts" title="Scan receipts to auto-file">${financeBatchScanBusy ? `<span class="fin-txn-icon-busy" aria-hidden="true">…</span>` : scanReceiptSvg}</button>
        <button class="icon-btn std-add-btn" type="button" data-fin-action="manual-txn-open" aria-label="Add transaction" title="Add a transaction"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      </div>
      ${query ? `<div class="fin-hint fin-txn-search-scope">Searching all loaded transactions (~45 days). Older months keep saved category totals only.</div>` : ""}
      ${!financeTxnFilterOpen ? "" : `
      <div class="fin-txn-filter-panel">
        <select class="fin-scenario-select" data-fin-edit="txn-filter-kind" aria-label="Filter by label">
          <option value="">All labels</option>
          <option value="unlabeled" ${f.kind === "unlabeled" ? "selected" : ""}>Unlabeled</option>
          <option value="auto" ${f.kind === "auto" ? "selected" : ""}>Auto-labeled</option>
          <option value="income" ${f.kind === "income" ? "selected" : ""}>Income</option>
          <option value="mgmt" ${f.kind === "mgmt" ? "selected" : ""}>Account mgmt</option>
          <option value="split" ${f.kind === "split" ? "selected" : ""}>Splits</option>
          ${(state.financeBudgetGroups || []).map((g) => `<option value="group:${g.id}" ${f.kind === `group:${g.id}` ? "selected" : ""}>${escapeHtml(g.label)}</option>`).join("")}
        </select>
        <select class="fin-scenario-select" data-fin-edit="txn-filter-account" aria-label="Filter by account">
          <option value="">All accounts</option>
          ${accountOptions.map(([id, name]) => `<option value="${escapeHtml(id)}" ${f.account === id ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
        ${filterActive || sortActive ? `<button class="secondary-btn fin-add-btn" type="button" data-fin-action="txn-filter-clear">Clear</button>` : ""}
        <span class="fin-hint fin-txn-window-hint">Search covers the loaded window (~45 days + the viewed month); older months keep saved category totals, not individual transactions.</span>
      </div>`}
      ${(financeLive?.errors || []).length ? `<div class="fin-txn-error" role="alert">Couldn't load some transactions — ${escapeHtml(financeLive.errors.join(" · "))}</div>` : ""}
      ${manualFormHtml}
      ${txnListHtml}
      ${txnsTruncated ? `<button class="secondary-btn fin-add-btn fin-txn-showall" type="button" data-fin-action="toggle-txn-expand">Show all ${shownTxns.length}</button>`
        : (financeTxnListExpanded && shownTxns.length > FIN_TXN_LIST_CAP ? `<button class="secondary-btn fin-add-btn fin-txn-showall" type="button" data-fin-action="toggle-txn-expand">Show fewer</button>` : "")}`}
    </div>`;

  // Net-worth detail — only rendered when the user clicks the Net worth stat.
  // Absorbs the old standalone trend card: a composition breakdown by account
  // kind plus the daily-snapshot sparkline.
  const netWorthCard = netWorth === null ? "" : (() => {
    const nwOpen = financeExpanded.has("card:networth");
    const histDays = financeHistory ? Object.keys(financeHistory).sort() : [];
    let trend = "";
    if (histDays.length >= 2) {
      const vals = histDays.map((d) => Number(financeHistory[d]?.netWorth) || 0);
      const min = Math.min(...vals), max = Math.max(...vals);
      const span = (max - min) || 1;
      const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${26 - ((v - min) / span) * 22}`).join(" ");
      const delta = vals[vals.length - 1] - vals[0];
      const sinceLabel = new Date(histDays[0] + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
      trend = `
        <div class="fin-nw-trend-head"><span class="fin-cat-actual${delta < 0 ? " is-over" : ""}">${delta >= 0 ? "+" : ""}${formatFinMoney(delta)}</span> <span class="fin-of">since ${escapeHtml(sinceLabel)}</span></div>
        <svg class="fin-trend" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Net worth over time">
          <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="fin-group-pct">${histDays.length} daily snapshots · ${formatFinMoney(vals[0])} → ${formatFinMoney(vals[vals.length - 1])}</div>`;
    } else {
      trend = `<div class="fin-hint">A trend line appears here once a couple of daily balance snapshots have been recorded.</div>`;
    }
    const breakdownRow = (label, val) => val === null ? "" :
      `<div class="fin-item-row fin-nw-row"><span class="fin-acct-name">${label}</span><span class="fin-live-bal${val < 0 ? " is-neg" : ""}">${formatFinMoney(val)}</span></div>`;
    return `
    <div class="fin-card fin-networth-line" data-fin-card="networth">
      ${cardHead("card:networth", "Net worth", `<span class="fin-cat-actual${netWorth < 0 ? " is-over" : ""}">${formatFinMoney(netWorth)}</span>`)}
      ${!nwOpen ? "" : `
      <div class="fin-nw-split">
        <div class="fin-nw-split-item"><span class="fin-nw-split-label">Assets</span><span class="fin-nw-split-val is-pos">${formatFinMoney(nwAssets)}</span></div>
        <div class="fin-nw-split-item"><span class="fin-nw-split-label">Liabilities</span><span class="fin-nw-split-val${nwLiabilities > 0 ? " is-neg" : ""}">${formatFinMoney(-nwLiabilities)}</span></div>
      </div>
      ${breakdownRow("Cash", cashOnHand)}
      ${breakdownRow("Investments", investmentTotal)}
      ${breakdownRow("Retirement", retirementTotal)}
      ${breakdownRow("Debt", debtTotal)}
      <div class="fin-nw-trend">${trend}</div>`}
    </div>`;
  })();

  // Budget view (Budget tab) — the KPI figures are always visible, Income expands
  // to its detail, and the budget groups + categories render directly below with
  // budget-vs-actual bars (no drilling to see a category number). A search box
  // filters categories live.
  const budgetKpiBtn = (id, label, value, open) => `
        <button class="fin-stat fin-stat-btn fin-budget-toggle${open ? " is-open" : ""}" type="button" data-fin-action="toggle-expand" data-id="${id}" aria-expanded="${open}">
          <span class="fin-stat-label">${label} <span class="fin-budget-caret">${open ? "▴" : "▾"}</span></span>
          <span class="fin-stat-value">${value}</span>
        </button>`;
  const budgetView = `
    <div class="fin-card fin-monthly-budget" data-fin-card="monthly-budget">
      <div class="fin-budget-kpis">
        ${budgetKpiBtn("card:income", "Income", formatFinMoney(income), incomeOpen)}
        <div class="fin-stat"><span class="fin-stat-label">Budgeted</span><span class="fin-stat-value">${formatFinMoney(expenses)}</span></div>
        <div class="fin-stat"><span class="fin-stat-label">Unallocated</span><span class="fin-stat-value${cashFlow < 0 ? " is-neg" : ""}">${formatFinMoney(cashFlow)}</span></div>
      </div>
      ${incomeOpen ? `<div class="fin-cards fin-budget-nested">${incomeBreakdown}</div>` : ""}
      <div class="fin-budget-search-row">
        <input type="search" class="fin-item-name fin-budget-search" placeholder="Search categories…" value="${escapeHtml(financeBudgetSearch)}" data-fin-budget-search aria-label="Search budget categories" />
        <button class="secondary-btn fin-add-btn fin-draft-budget-btn" type="button" data-fin-action="draft-budget-from-history" title="Set each category to its recent average spend">✨ Draft from history</button>
      </div>
    </div>
    <div class="fin-budget-groups">${groupCards}</div>`;

  // ── Overview band: the always-on "state of our finances" summary ──────────
  const health = financeAccountHealth();
  const reviewCount = financeUnlabeledCount();
  // This month's actual net spend (spend portions are negative) vs total budgeted.
  const monthActualSpend = showActuals ? -[...catActuals.values()].reduce((s, v) => s + v, 0) : null;
  const nowD = new Date();
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
  const dayOfMonth = nowD.getDate();
  const projectedSpend = (isCurrentMonth && monthActualSpend != null && dayOfMonth > 0) ? (monthActualSpend / dayOfMonth) * daysInMonth : null;
  const paceOver = (projectedSpend != null && expenses > 0) ? projectedSpend - expenses : null;
  const monthPct = (monthActualSpend != null && expenses > 0) ? Math.min(100, Math.round((monthActualSpend / expenses) * 100)) : 0;
  const monthOver = monthActualSpend != null && expenses > 0 && monthActualSpend > expenses;
  const nwDelta = financeNetWorthDelta();

  // Attention flags — drive the tab dots and whether the "all clear" line shows.
  // Unaddressed = still to review OR swiped-out-but-not-yet-confirmed (red-dot).
  const unconfirmedCount = allTxns.filter(financeTxnNeedsConfirm).length;
  const hasTxnAttention = reviewCount > 0 || unconfirmedCount > 0;
  const hasAcctAttention = health.needsAttention.length > 0 || Boolean(health.bridgeError);

  // Forward-looking: recurring bills not yet posted this month, and what's left
  // of cash once they clear ("safe to spend").
  const upcoming = financeUpcomingBills();
  const safeToSpend = cashOnHand != null ? cashOnHand - upcoming.total : null;

  // Email receipts: match each harvested order email to a spend transaction (the
  // reverse of financeReceiptForTxn). Drives the receipts inbox + itemize prompt.
  const rSpendTxns = allTxns.filter((t) => (t.amount || 0) < 0);
  const rMatched = [], rUnmatched = [];
  for (const r of (financeReceipts || [])) {
    const amt = Number(r.total) || 0;
    const rDate = new Date(r.date || 0).getTime();
    const t = rSpendTxns.find((x) => Math.abs(Math.abs(x.amount || 0) - amt) <= 0.02 && (!r.date || Math.abs(new Date(x.posted || 0).getTime() - rDate) <= 4 * 86400000));
    if (t) rMatched.push({ r, t }); else rUnmatched.push(r);
  }
  const itemizable = rMatched.filter(({ r, t }) => t.label !== "split" && (r.portions || r.items || []).length > 1);

  const chips = [];
  if (reviewCount) chips.push(`<button class="fin-chip fin-chip-review" type="button" data-fin-action="review-txns">${reviewCount} to review</button>`);
  if (health.bridgeError) chips.push(`<button class="fin-chip fin-chip-bad" type="button" data-fin-action="fin-tab" data-tab="accounts">Bank connection error</button>`);
  for (const { acct, status } of health.needsAttention) {
    const nm = escapeHtml(acct.name || "Account");
    chips.push(status.kind === "disconnected"
      ? `<button class="fin-chip fin-chip-bad" type="button" data-fin-action="fin-tab" data-tab="accounts">${nm} · disconnected</button>`
      : `<button class="fin-chip fin-chip-warn" type="button" data-fin-action="fin-tab" data-tab="accounts">${nm} · stale ${status.days}d</button>`);
  }
  // Configurable alert chips (Settings › Finance › Alerts; default on).
  if (showActuals && financeAlertPref("overBudget")) {
    let overCount = 0;
    for (const g of (state.financeBudgetGroups || [])) for (const c of g.categories) { const b = financeCategoryTotal(c); if (b > 0 && -catActual(g, c) > b) overCount++; }
    if (overCount) chips.push(`<button class="fin-chip fin-chip-warn" type="button" data-fin-action="fin-tab" data-tab="budget">${overCount} over budget</button>`);
  }
  if (financeAlertPref("largeTxn")) {
    const big = monthTxns.filter((t) => (t.amount || 0) <= -400).sort((a, b) => (a.amount || 0) - (b.amount || 0))[0];
    if (big) chips.push(`<button class="fin-chip fin-chip-warn" type="button" data-fin-action="fin-tab" data-tab="transactions">Large: ${escapeHtml(big.displayName)} ${formatFinMoney(big.amount)}</button>`);
  }
  if (financeAlertPref("lowBalance")) {
    for (const a of (state.financeAccounts || [])) {
      if (financeAccountKind(a) !== "cash") continue;
      const bal = financeAccountBalance(a, liveById);
      if (bal != null && bal >= 0 && bal < 100) { chips.push(`<button class="fin-chip fin-chip-bad" type="button" data-fin-action="fin-tab" data-tab="accounts">Low: ${escapeHtml(a.name)} ${formatFinMoney(bal)}</button>`); break; }
    }
  }
  if (itemizable.length) chips.push(`<button class="fin-chip fin-chip-review" type="button" data-fin-action="fin-tab" data-tab="insights">${itemizable.length} to itemize</button>`);

  const overviewBand = `
    <section class="fin-overview">
      <div class="fin-ov-grid">
        <div class="fin-ov-card fin-ov-networth">
          <div class="fin-ov-label">Net worth</div>
          <div class="fin-ov-value${netWorth != null && netWorth < 0 ? " is-neg" : ""}">${netWorth == null ? "—" : formatFinMoney(netWorth)}</div>
          <div class="fin-ov-trend">
            ${nwDelta ? `<span class="fin-ov-delta${nwDelta.delta < 0 ? " is-neg" : ""}">${nwDelta.delta >= 0 ? "+" : ""}${formatFinMoney(nwDelta.delta)}</span><span class="fin-of">since ${escapeHtml(nwDelta.sinceLabel)}</span>` : `<span class="fin-hint">Trend builds as balances are recorded.</span>`}
            ${financeTrendSparklineHtml("fin-ov-spark")}
          </div>
        </div>
        <div class="fin-ov-card">
          <div class="fin-ov-label">Cash on hand</div>
          <div class="fin-ov-value">${cashOnHand == null ? "—" : formatFinMoney(cashOnHand)}</div>
          ${safeToSpend != null && upcoming.total > 0 ? `<div class="fin-ov-sub">${formatFinMoney(safeToSpend)} safe after bills</div>` : ""}
        </div>
        <div class="fin-ov-card fin-ov-month">
          <div class="fin-ov-label">This month${isCurrentMonth ? "" : ` · ${escapeHtml(monthKey)}`}</div>
          ${monthActualSpend == null
            ? `<div class="fin-ov-value">${formatFinMoney(expenses)}</div><div class="fin-ov-sub">budgeted</div>`
            : `<div class="fin-ov-value">${formatFinMoney(monthActualSpend)} <span class="fin-of">/ ${formatFinMoney(expenses)}</span></div>
               <div class="fin-gauge"><i class="${monthOver ? "is-over" : ""}" style="width:${monthPct}%"></i></div>
               ${paceOver != null ? `<div class="fin-ov-pace${paceOver > 0 ? " is-over" : ""}">${paceOver > 0 ? `~${formatFinMoney(paceOver)} over by month-end` : `on pace · ~${formatFinMoney(-paceOver)} under`}</div>` : ""}`}
        </div>
      </div>
      ${chips.length
        ? `<div class="fin-ov-chips">${chips.join("")}</div>`
        : (hasTxnAttention || hasAcctAttention ? "" : `<div class="fin-ov-chips fin-ov-clear">✓ Accounts fresh · nothing to review</div>`)}
    </section>`;

  const financeTabNav = `
    <div class="fin-tabs" role="tablist" aria-label="Finance sections">
      ${FINANCE_TABS.map((t) => {
        const dot = (t.id === "transactions" && hasTxnAttention) || (t.id === "accounts" && hasAcctAttention);
        return `<button class="fin-tab${financeTab === t.id ? " is-active" : ""}" type="button" role="tab" id="fin-tab-${t.id}" aria-controls="fin-tabpanel" aria-selected="${financeTab === t.id}" data-fin-action="fin-tab" data-tab="${t.id}">${t.label}${dot ? ` <span class="fin-tab-dot" aria-label="Needs attention"></span>` : ""}</button>`;
      }).join("")}
    </div>`;

  const connectPrompt = `
    <div class="fin-card fin-empty-onboard">
      <div class="fin-empty-title">${(state.financeAccounts || []).length ? "No bank connected" : "Set up your finances"}</div>
      <div class="fin-empty-sub">Link a bank (read-only, via SimpleFIN) or add a manual account to track balances, spending, and net worth here.</div>
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="open-finance-settings">Open finance settings</button>
    </div>`;

  // Insights tab — forward-looking & trend surfaces (upcoming bills first).
  const upcomingBillsCard = `
    <div class="fin-card fin-insights-card">
      <div class="fin-subhead fin-accounts-title">Upcoming bills</div>
      ${upcoming.bills.length ? `
        ${upcoming.bills.map((b) => `
          <div class="fin-bill-row${b.overdue ? " is-overdue" : ""}">
            <span class="fin-bill-day">${b.overdue ? "Due now" : `Day ${b.dueDay}`}</span>
            <span class="fin-bill-name">${escapeHtml(b.name)}</span>
            <span class="fin-bill-amt">${formatFinMoney(-Math.abs(b.amount))}</span>
          </div>`).join("")}
        <div class="fin-bill-total"><span>Total upcoming</span><span>${formatFinMoney(-upcoming.total)}</span></div>
        ${safeToSpend != null ? `
        <div class="fin-safe-block">
          <div class="fin-safe-row"><span>Cash on hand</span><span>${formatFinMoney(cashOnHand)}</span></div>
          <div class="fin-safe-row"><span>Upcoming bills</span><span>${formatFinMoney(-upcoming.total)}</span></div>
          <div class="fin-safe-row fin-safe-final"><span>Safe to spend</span><span class="${safeToSpend < 0 ? "is-neg" : ""}">${formatFinMoney(safeToSpend)}</span></div>
        </div>` : ""}
      ` : `<div class="fin-hint">No upcoming recurring bills for the rest of this month${!financeLinkStatus?.connected ? " — connect a bank so recurring charges can be detected" : ""}.</div>`}
    </div>`;
  const trends = financeSpendTrends(monthKey);
  const trendMax = Math.max(1, ...trends.series.map((s) => s.spend || 0));
  const trendsCard = trends.hasData ? `
    <div class="fin-card fin-insights-card">
      <div class="fin-subhead fin-accounts-title">Spending trend</div>
      <div class="fin-trend-bars">
        ${trends.series.map((s) => `
          <div class="fin-tbar${s.month === monthKey ? " is-current" : ""}" title="${escapeHtml(s.month)}${s.spend != null ? ` · ${formatFinMoney(s.spend)}` : ""}">
            <div class="fin-tbar-col"><i style="height:${s.spend != null ? Math.round((s.spend / trendMax) * 100) : 0}%"></i></div>
            <span class="fin-tbar-label">${new Date(s.month + "-15T12:00:00").toLocaleDateString(undefined, { month: "short" })}</span>
          </div>`).join("")}
      </div>
      ${trends.movers.length ? `
        <div class="fin-subhead" style="margin-top:14px;">Vs your recent average</div>
        ${trends.movers.map((m) => `
          <div class="fin-mover-row">
            <span class="fin-mover-name">${escapeHtml(m.name)}</span>
            <span class="fin-mover-cur">${formatFinMoney(m.cur)}</span>
            ${m.pct != null
              ? `<span class="fin-mover-delta ${m.delta > 0 ? "is-over" : "is-under"}" title="3-month average ${formatFinMoney(m.avg)}">${m.delta > 0 ? "▲" : "▼"} ${Math.abs(m.pct)}%</span>`
              : `<span class="fin-mover-delta is-over">new</span>`}
          </div>`).join("")}` : ""}
    </div>` : "";
  const cashflow = financeCashFlow(monthKey);
  const cfMax = Math.max(1, ...cashflow.series.flatMap((s) => [s.income || 0, s.spend || 0]));
  const cfIn = showActuals ? incomeActual : null;
  const cfOut = monthActualSpend;
  const cfNet = (cfIn != null && cfOut != null) ? cfIn - cfOut : null;
  const cashFlowCard = cashflow.hasData ? `
    <div class="fin-card fin-insights-card">
      <div class="fin-subhead fin-accounts-title">Cash flow</div>
      ${cfIn != null || cfOut != null ? `
      <div class="fin-cf-summary">
        <div class="fin-cf-stat"><span class="fin-cf-label">In</span><span class="fin-cf-val is-in">${formatFinMoney(cfIn || 0)}</span></div>
        <div class="fin-cf-stat"><span class="fin-cf-label">Out</span><span class="fin-cf-val is-out">${formatFinMoney(-(cfOut || 0))}</span></div>
        <div class="fin-cf-stat"><span class="fin-cf-label">Net</span><span class="fin-cf-val ${cfNet >= 0 ? "is-in" : "is-out"}">${cfNet >= 0 ? "+" : ""}${formatFinMoney(cfNet || 0)}</span></div>
      </div>` : ""}
      <div class="fin-cf-bars">
        ${cashflow.series.map((s) => `
          <div class="fin-cf-col${s.month === monthKey ? " is-current" : ""}" title="${escapeHtml(s.month)}${s.income != null ? ` · in ${formatFinMoney(s.income)}` : ""}${s.spend != null ? ` · out ${formatFinMoney(s.spend)}` : ""}">
            <div class="fin-cf-pair">
              <i class="fin-cf-in" style="height:${s.income != null ? Math.round((s.income / cfMax) * 100) : 0}%"></i>
              <i class="fin-cf-out" style="height:${s.spend != null ? Math.round((s.spend / cfMax) * 100) : 0}%"></i>
            </div>
            <span class="fin-tbar-label">${new Date(s.month + "-15T12:00:00").toLocaleDateString(undefined, { month: "short" })}</span>
          </div>`).join("")}
      </div>
      <div class="fin-cf-legend"><span class="fin-cf-key in">Money in</span><span class="fin-cf-key out">Money out</span></div>
    </div>` : "";
  const subs = (state.financeRecurring || []).filter((r) => r.active !== false).sort((a, b) => (b.lastAmount || 0) - (a.lastAmount || 0));
  const subsTotal = subs.reduce((s, r) => s + (r.lastAmount || 0), 0);
  const subsCard = subs.length ? `
    <div class="fin-card fin-insights-card">
      <div class="fin-subhead fin-accounts-title">Subscriptions &amp; recurring</div>
      <div class="fin-subs-total"><span>${subs.length} recurring charge${subs.length === 1 ? "" : "s"}</span><span>${formatFinMoney(subsTotal)}<span class="fin-of">/mo</span></span></div>
      ${subs.map((r) => `
        <div class="fin-sub-row">
          <span class="fin-sub-name">${escapeHtml(r.name)}</span>
          <span class="fin-sub-day">day ${Math.min(28, Math.max(1, r.expectedDay || 1))}</span>
          <span class="fin-sub-amt">${formatFinMoney(r.lastAmount || 0)}</span>
        </div>`).join("")}
    </div>` : "";
  // Reports: where the viewed month's spend went (category breakdown) + CSV export.
  const catSpend = [...catActuals.entries()]
    .map(([k, v]) => ({ key: k, name: financeTxnLabelName(`cat:${k}`), amount: Math.abs(Number(v) || 0) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const catTotal = catSpend.reduce((s, c) => s + c.amount, 0);
  const reportRows = (() => {
    const top = catSpend.slice(0, 8);
    const restTotal = catSpend.slice(8).reduce((s, c) => s + c.amount, 0);
    const rows = [...top];
    if (restTotal > 0) rows.push({ key: "__other", name: "Other", amount: restTotal });
    return rows;
  })();
  const reportMax = reportRows[0]?.amount || 1;
  const reportsCard = financeLinkStatus?.connected ? `
    <div class="fin-card fin-insights-card">
      <div class="fin-report-head">
        <div class="fin-subhead fin-accounts-title">Where it went${isCurrentMonth ? "" : ` · ${escapeHtml(monthKey)}`}</div>
        <div class="fin-report-head-btns">
          <button class="secondary-btn fin-add-btn" type="button" data-fin-action="import-csv" title="Backfill past months from a transaction CSV">Import history</button>
          <button class="secondary-btn fin-add-btn" type="button" data-fin-action="export-csv">Export CSV</button>
        </div>
      </div>
      ${reportRows.length ? reportRows.map((c) => `
        <div class="fin-report-row">
          <div class="fin-report-top"><span class="fin-report-name">${escapeHtml(c.name)}</span><span class="fin-report-amt">${formatFinMoney(c.amount)} <span class="fin-of">· ${catTotal > 0 ? Math.round((c.amount / catTotal) * 100) : 0}%</span></span></div>
          <div class="fin-report-bar"><i style="width:${Math.round((c.amount / reportMax) * 100)}%"></i></div>
        </div>`).join("") : `<div class="fin-hint">No categorized spending yet this month.</div>`}
    </div>` : "";
  // Notable this month: the biggest spends + merchants first seen this month
  // (within the loaded window — live txns cover ~45 days).
  const largestTxns = monthTxns.filter((t) => (t.amount || 0) < 0).sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0)).slice(0, 5);
  const priorMerchantKeys = new Set(allTxns.filter((t) => (t.posted || "").slice(0, 7) !== monthKey).map((t) => financeMerchantKey(t.description)).filter(Boolean));
  const newMerchants = [];
  const seenNewKeys = new Set();
  for (const t of monthTxns) {
    const k = financeMerchantKey(t.description);
    if (!k || priorMerchantKeys.has(k) || seenNewKeys.has(k) || (t.amount || 0) >= 0) continue;
    seenNewKeys.add(k); newMerchants.push(t);
  }
  const notableRow = (t) => `<div class="fin-notable-row"><span class="fin-notable-name">${escapeHtml(t.displayName)}</span><span class="fin-notable-amt is-neg">${formatFinMoney(t.amount || 0)}</span></div>`;
  const notableCard = (largestTxns.length || newMerchants.length) ? `
    <div class="fin-card fin-insights-card">
      <div class="fin-subhead fin-accounts-title">Notable this month</div>
      ${largestTxns.length ? `<div class="fin-notable-sub">Largest</div>${largestTxns.map(notableRow).join("")}` : ""}
      ${newMerchants.length ? `<div class="fin-notable-sub">New merchants</div>${newMerchants.slice(0, 5).map(notableRow).join("")}` : ""}
    </div>` : "";
  // Email receipts inbox — matched (itemizable) + unmatched order emails.
  const receiptsCard = (financeReceipts || []).length ? `
    <div class="fin-card fin-insights-card">
      <div class="fin-subhead fin-accounts-title">Email receipts</div>
      ${itemizable.length ? `<div class="fin-hint fin-receipts-prompt">${itemizable.length} transaction${itemizable.length === 1 ? "" : "s"} can be itemized from a matching order email — one tap builds the split.</div>` : ""}
      ${rMatched.length ? rMatched.map(({ r, t }) => `
        <div class="fin-receipt-row">
          <span class="fin-receipt-tag${t.label === "split" ? " is-done" : ""}">${t.label === "split" ? "✓ split" : "matched"}</span>
          <span class="fin-receipt-name">${escapeHtml(r.merchant || t.displayName)}${(r.items || []).length ? ` · ${r.items.length} items` : ""}</span>
          <span class="fin-receipt-amt">${formatFinMoney(-Math.abs(r.total || 0))}</span>
          ${t.label !== "split" && (r.portions || r.items || []).length > 1 ? `<button class="fin-quick-chip fin-receipt-itemize" type="button" data-fin-action="itemize-email" data-id="${escapeHtml(t.id)}">Itemize</button>` : ""}
        </div>`).join("") : ""}
      ${rUnmatched.length ? `<div class="fin-notable-sub">Unmatched — no transaction found yet</div>${rUnmatched.slice(0, 8).map((r) => `
        <div class="fin-receipt-row">
          <span class="fin-receipt-tag is-muted">${r.date ? escapeHtml(new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "—"}</span>
          <span class="fin-receipt-name">${escapeHtml(r.merchant || "Receipt")}</span>
          <span class="fin-receipt-amt">${formatFinMoney(-Math.abs(r.total || 0))}</span>
          ${r.id ? `<a class="fin-quick-chip" href="https://mail.google.com/mail/u/0/#all/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">Email</a>` : ""}
        </div>`).join("")}` : ""}
    </div>` : "";
  const insightsView = `${upcomingBillsCard}${receiptsCard}${subsCard}${cashFlowCard}${trendsCard}${reportsCard}${notableCard}`;

  // Savings goals (Accounts tab). Tap a goal to edit target/saved/date; progress
  // bar + on-track note derived on the fly.
  const goals = state.financeGoals || [];
  const goalMonthsUntil = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T12:00:00"); if (isNaN(d.getTime())) return null;
    const now = new Date();
    return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
  };
  const goalRow = (g) => {
    const editing = financeExpanded.has(`goal:${g.id}`);
    const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
    const reached = g.target > 0 && g.current >= g.target;
    let note = "";
    if (reached) note = "Reached 🎉";
    else if (g.targetDate) {
      const m = goalMonthsUntil(g.targetDate);
      if (m != null) note = m <= 0 ? "Target date passed" : `${formatFinMoney((g.target - g.current) / m)}/mo to reach by ${new Date(g.targetDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
    } else if (g.target > 0) note = `${formatFinMoney(g.target - g.current)} to go`;
    return `
      <div class="fin-goal">
        <button class="fin-goal-row" type="button" data-fin-action="toggle-expand" data-id="goal:${escapeHtml(g.id)}" aria-expanded="${editing}">
          <div class="fin-goal-head-row"><span class="fin-goal-name">${escapeHtml(g.name || "Untitled goal")}</span><span class="fin-goal-nums">${formatFinMoney(g.current)} <span class="fin-of">/ ${formatFinMoney(g.target)}</span></span></div>
          <div class="fin-gauge"><i class="${reached ? "is-done" : ""}" style="width:${pct}%"></i></div>
          ${note ? `<div class="fin-goal-note${reached ? " is-done" : ""}">${escapeHtml(note)}</div>` : ""}
        </button>
        ${editing ? `
        <div class="fin-goal-editor">
          <div class="fin-item-row"><input class="fin-item-name" type="text" value="${escapeHtml(g.name)}" placeholder="Goal name (e.g. Vacation fund)" data-fin-edit="goal-name" data-id="${escapeHtml(g.id)}" aria-label="Goal name" /></div>
          <div class="fin-item-row">
            <input class="fin-item-amount" type="text" inputmode="decimal" value="${g.current || ""}" placeholder="Saved" data-fin-edit="goal-current" data-id="${escapeHtml(g.id)}" aria-label="Amount saved" />
            <input class="fin-item-amount" type="text" inputmode="decimal" value="${g.target || ""}" placeholder="Target" data-fin-edit="goal-target" data-id="${escapeHtml(g.id)}" aria-label="Target amount" />
          </div>
          <div class="fin-item-row fin-item-row--tools">
            <input type="date" class="fin-item-name fin-goal-date" value="${escapeHtml(g.targetDate || "")}" data-fin-edit="goal-date" data-id="${escapeHtml(g.id)}" aria-label="Target date (optional)" />
            <button class="secondary-btn fin-add-btn fin-danger" type="button" data-fin-action="delete-goal" data-id="${escapeHtml(g.id)}">Delete goal</button>
          </div>
        </div>` : ""}
      </div>`;
  };
  const goalsCard = `
    <div class="fin-card fin-goals-card">
      <div class="fin-subhead fin-accounts-title">Savings goals</div>
      ${goals.length ? goals.map(goalRow).join("") : `<div class="fin-hint">No goals yet — set a savings target to track your progress.</div>`}
      <button class="secondary-btn fin-add-btn" type="button" data-fin-action="add-goal">+ Goal</button>
    </div>`;

  // Route the existing cards into tabs (they keep their own internals + wiring).
  // Overview stays pinned above.
  const accountsPanel = `<div class="fin-card fin-accounts-card"><div class="fin-subhead fin-accounts-title">Accounts</div>${renderFinanceAccountsPanel()}</div>`;
  const tabBody =
    financeTab === "budget" ? `${showOnboard ? connectPrompt : ""}${budgetView}${personalCard}`
    : financeTab === "accounts" ? `${showOnboard ? connectPrompt : ""}${goalsCard}${savingsRow}${netWorthCard}${accountsPanel}`
    : financeTab === "insights" ? `${showOnboard ? connectPrompt : ""}${insightsView}`
    : (txnsCard || connectPrompt);

  grid.innerHTML = `
    <section class="fin-panel">
      ${overviewBand}
      ${financeTabNav}
      <div class="fin-tab-body" id="fin-tabpanel" role="tabpanel" aria-labelledby="fin-tab-${financeTab}" tabindex="0" data-fin-tab-body="${financeTab}">${tabBody}</div>
    </section>`;

  if (!financeGridWired) {
    financeGridWired = true;
    grid.addEventListener("click", onFinanceGridClick);
    grid.addEventListener("change", onFinanceGridChange);
    grid.addEventListener("input", (e) => {
      if (e.target.matches?.("[data-fin-budget-search]")) {
        financeBudgetSearch = e.target.value;
        applyBudgetSearch(); // live filter, no re-render (keeps the box focused)
        return;
      }
      // Live transaction search: re-render on each keystroke (the list can pull
      // in cross-month results, so a DOM-only filter won't do), then restore
      // focus + caret to the search box so typing is unbroken.
      if (e.target.matches?.('[data-fin-edit="txn-filter-q"]')) {
        financeTxnFilter.q = e.target.value; // raw (untrimmed) so spaces survive
        const caret = e.target.selectionStart;
        renderFinancePage();
        const box = grid.querySelector('[data-fin-edit="txn-filter-q"]');
        if (box) { box.focus(); try { box.setSelectionRange(caret, caret); } catch {} }
      }
    });
    grid.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[data-fin-action][role="button"]')) {
        e.preventDefault();
        onFinanceGridClick(e);
      }
      if (e.target.matches?.("[data-fin-rename-id]")) {
        if (e.key === "Enter") { e.preventDefault(); saveRenameFromRow(e.target.closest(".fin-txn-row, .fin-txn-detail"), e.target.dataset.finRenameId); }
        else if (e.key === "Escape") { e.preventDefault(); cancelRenameTxn(); }
      }
    });
    document.addEventListener("click", (e) => {
      if (!financeNotifOpen) return;
      // The bell and its panel now live inside the Transactions card head/body
      // rather than a shared .fin-notif-wrap; keep the panel open for clicks on
      // either, and for the toggle-expand card head (so opening the txn list
      // doesn't also dismiss the notifications).
      if (e.target.closest(".fin-notif-btn, .fin-notif-panel, .fin-txns-head")) return;
      financeNotifOpen = false;
      renderFinancePage();
    }, { capture: true });
    document.addEventListener("click", (e) => {
      if (!financeTxnFilterOpen) return;
      if (e.target.closest(".fin-txn-filters, .fin-txn-filter-panel")) return;
      financeTxnFilterOpen = false;
      renderFinancePage();
    }, { capture: true });
    grid.addEventListener("contextmenu", (e) => {
      const row = e.target.closest("[data-fin-txn-id]");
      if (row) { e.preventDefault(); showFinTxnMenu(e.clientX, e.clientY, row.dataset.finTxnId); return; }
      const acct = e.target.closest("[data-fin-acct-id]");
      if (acct) { e.preventDefault(); showFinAcctMenu(e.clientX, e.clientY, { type: "account", id: acct.dataset.finAcctId }); return; }
      const sub = e.target.closest("[data-fin-sub]");
      if (sub) { e.preventDefault(); showFinAcctMenu(e.clientX, e.clientY, { type: "sub", label: sub.dataset.finOwner, sub: sub.dataset.finSub }); return; }
      const owner = e.target.closest("[data-fin-owner]");
      if (owner) { e.preventDefault(); showFinAcctMenu(e.clientX, e.clientY, { type: "owner", label: owner.dataset.finOwner }); return; }
    });
  }

  // Keep the Accounts panel (Settings › Finance) in sync when the finance page
  // re-renders — e.g. after an async bank refresh updates live balances.
  refreshFinanceSettingsIfOpen();
  // Re-apply the budget category filter after a render (edits rebuild the list).
  if (financeTab === "budget" && financeBudgetSearch) applyBudgetSearch();
}

// Right-click menu for the Accounts card — the edit/delete/label actions used
// to be inline buttons on every row; moving them here keeps the standard view
// to just names and balances. Each item routes through onFinanceGridClick by
// synthesizing the same data-fin-action element the old buttons carried, so
// all the existing confirm/prompt logic is reused unchanged.
function showFinAcctMenu(x, y, opts) {
  document.getElementById("finAcctMenu")?.remove();
  let items = [];
  if (opts.type === "account") {
    items = [
      { label: "Edit account", action: "toggle-expand", data: { id: `edit:${opts.id}` } },
      { label: "Delete account", danger: true, action: "delete-account", data: { id: opts.id } },
    ];
  } else if (opts.type === "owner") {
    items = [
      { label: "Add sub-label", action: "add-sublabel", data: { label: opts.label } },
      { label: "Rename label", action: "rename-label", data: { label: opts.label } },
      { label: "Delete label", danger: true, action: "delete-label", data: { label: opts.label } },
    ];
  } else {
    items = [
      { label: "Rename sub-label", action: "rename-sublabel", data: { label: opts.label, sub: opts.sub } },
      { label: "Delete sub-label", danger: true, action: "delete-sublabel", data: { label: opts.label, sub: opts.sub } },
    ];
  }
  const menu = document.createElement("div");
  menu.id = "finAcctMenu";
  menu.className = "fin-txn-menu";
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 180)) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 40 - items.length * 34) + "px";
  menu.innerHTML = items.map((it, i) => `<button class="fin-txn-menu-option${it.danger ? " fin-danger" : ""}" type="button" data-i="${i}">${escapeHtml(it.label)}</button>`).join("");
  menu.querySelectorAll("button").forEach((btn, i) => btn.addEventListener("click", () => {
    menu.remove();
    const it = items[i];
    const el = document.createElement("button");
    el.dataset.finAction = it.action;
    for (const [k, v] of Object.entries(it.data || {})) el.dataset[k] = v;
    onFinanceGridClick({ target: el });
    refreshFinanceSettingsIfOpen();
  }));
  // A modal <dialog> sits in the top layer; a menu on document.body would hide
  // behind it. Append to the open dialog so the menu shows above it.
  const host = elements.contextSettingsDialog?.open ? elements.contextSettingsDialog : document.body;
  host.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true, capture: true }), 0);
}

// Right-click menu on a transaction row — currently just Rename, but gives
// merchant-level actions a home off the row itself so the list stays clean.
function showFinTxnMenu(x, y, txnId) {
  document.getElementById("finTxnMenu")?.remove();
  const isManual = financeLabeledTxns().find((t) => t.id === txnId)?.isManual;
  const menu = document.createElement("div");
  menu.id = "finTxnMenu";
  menu.className = "fin-txn-menu";
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 180)) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 90) + "px";
  menu.innerHTML = `
    <button class="fin-txn-menu-option" type="button" data-menu-action="rename">Rename / add note</button>
    ${isManual ? `
    <button class="fin-txn-menu-option" type="button" data-menu-action="edit">Edit transaction</button>
    <button class="fin-txn-menu-option fin-danger" type="button" data-menu-action="delete">Delete transaction</button>` : ""}`;
  menu.querySelector('[data-menu-action="rename"]').addEventListener("click", () => {
    menu.remove();
    startRenameTxn(txnId);
  });
  menu.querySelector('[data-menu-action="edit"]')?.addEventListener("click", () => {
    menu.remove();
    openManualTxnForm((state.financeManualTxns || []).find((m) => m.id === txnId));
  });
  menu.querySelector('[data-menu-action="delete"]')?.addEventListener("click", () => {
    menu.remove();
    deleteManualTxn(txnId);
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true, capture: true }), 0);
}

// Resolves a "cat:<group>:<category>" scope to the live category object.
function financeScopeCategory(scope) {
  const [kind, a, b] = String(scope || "").split(":");
  if (kind !== "cat") return null;
  const group = (state.financeBudgetGroups || []).find((g) => g.id === a);
  return group?.categories.find((c) => c.id === b) || null;
}

// Resolves a data-scope string to the live items array it addresses.
function financeScopeItems(scope) {
  const [kind, a, b] = String(scope || "").split(":");
  if (kind === "cat") {
    return financeScopeCategory(scope)?.items || null;
  }
  const personal = (state.financePersonal || []).find((p) => p.id === a);
  if (!personal) return null;
  if (kind === "pinc") return personal.incomeItems;
  if (kind === "pexp") return personal.expenseItems;
  return null;
}

function onFinanceGridClick(e) {
  const btn = e.target.closest("[data-fin-action]");
  if (!btn) return;
  const action = btn.dataset.finAction;
  // Bank-link actions are async and don't touch budget state
  if (action === "link-banks") { linkFinanceBanks(); return; }
  if (action === "refresh-live") { refreshFinanceLive(true); return; }
  if (action === "unlink-banks") { unlinkFinanceBanks(); return; }
  if (action === "toggle-notifs") { openFinanceTxnReview(); return; }
  if (action === "review-txns") { openFinanceTxnReview(); return; }
  if (action === "fin-tab") { financeTab = btn.dataset.tab || "transactions"; renderFinancePage(); return; }
  if (action === "fin-budget-group") { financeBudgetOpenGroup = financeBudgetOpenGroup === btn.dataset.id ? null : btn.dataset.id; renderFinancePage(); return; }
  if (action === "export-csv") { exportFinanceCsv(financeViewMonth); return; }
  if (action === "import-csv") { startFinanceCsvImport(); return; }
  if (action === "set-cat-budget") {
    const g = (state.financeBudgetGroups || []).find((x) => x.id === btn.dataset.group);
    const c = g?.categories.find((x) => x.id === btn.dataset.id);
    if (c) { financeSetCategoryBudget(c, Number(btn.dataset.amount) || 0); persist(); renderFinancePage(); }
    return;
  }
  if (action === "draft-budget-from-history") {
    const targets = [];
    for (const g of (state.financeBudgetGroups || [])) for (const c of (g.categories || [])) {
      const avg = financeCategoryHistoryAvg(g.id, c.id);
      if (avg != null) targets.push({ c, avg });
    }
    if (!targets.length) { alert("No spending history yet to draft a budget from — it fills in as months of transactions are recorded, or import past months now via Insights → Reports → “Import history”."); return; }
    if (!confirm(`Set ${targets.length} categor${targets.length === 1 ? "y" : "ies"} to recent-average spend? This replaces their current budget amounts (you can still tweak each afterward).`)) return;
    targets.forEach(({ c, avg }) => financeSetCategoryBudget(c, avg));
    persist(); renderFinancePage(); return;
  }
  if (action === "start-split") { startSplitTxn(btn.dataset.id); return; }
  if (action === "itemize-email") {
    const t = financeLabeledTxns().find((x) => x.id === btn.dataset.id);
    const receipt = t && financeReceiptForTxn(t);
    startSplitTxn(btn.dataset.id);
    if (receipt && financeSplitDraft) {
      const src = (receipt.portions || []).length ? receipt.portions : null;
      if (src) financeSplitDraft.portions = src.map((p) => ({ label: p.label || "", amount: p.amount }));
      renderFinancePage();
    }
    return;
  }
  if (action === "confirm-txn") { financeConfirmTxn(btn.dataset.id); renderFinancePage(); return; }
  if (action === "quick-label") { recordFinanceTxnLabel(btn.dataset.id, btn.dataset.label, btn.dataset.desc || ""); renderFinancePage(); return; }
  if (action === "add-goal") {
    if (!Array.isArray(state.financeGoals)) state.financeGoals = [];
    const id = createId("fin-goal");
    state.financeGoals.push({ id, name: "", target: 0, current: 0, targetDate: "" });
    financeExpanded.add(`goal:${id}`); // open the new goal's editor
    persist(); renderFinancePage(); return;
  }
  if (action === "delete-goal") {
    state.financeGoals = (state.financeGoals || []).filter((g) => g.id !== btn.dataset.id);
    recordDeletion("financeGoals", btn.dataset.id); // tombstone so the delete survives sync
    persist(); renderFinancePage(); return;
  }
  if (action === "toggle-txn-expand") { financeTxnListExpanded = !financeTxnListExpanded; renderFinancePage(); return; }
  if (action === "open-finance-settings") { openContextSettingsDialog("finance-accounts"); return; }
  if (action === "dismiss-alert") {
    if (!state.financeDismissedAlerts || typeof state.financeDismissedAlerts !== "object") state.financeDismissedAlerts = {};
    if (btn.dataset.key) state.financeDismissedAlerts[btn.dataset.key] = true;
    btn.closest(".fin-alert")?.remove(); // clear it right away, don't wait on the re-render
    persist();
    renderFinancePage();
    setPageNotifCount("finance", financeBellCount());
    return;
  }
  if (action === "skip-label-group") {
    if (!state.financeLabelSkips || typeof state.financeLabelSkips !== "object") state.financeLabelSkips = {};
    if (btn.dataset.key) state.financeLabelSkips[btn.dataset.key] = true;
    btn.closest(".fin-notif-labelrow")?.remove(); // clear it right away, don't wait on the re-render
    invalidateFinanceLabeled();
    persist();
    renderFinancePage();
    setPageNotifCount("finance", financeBellCount());
    return;
  }
  if (action === "rename-txn-start") { startRenameTxn(btn.dataset.id); return; }
  if (action === "rename-txn-cancel") { cancelRenameTxn(); return; }
  if (action === "rename-txn-save") { saveRenameFromRow(btn.closest(".fin-txn-row, .fin-txn-detail"), btn.dataset.id); return; }
  if (action === "link-return") { recordFinanceTxnLink(btn.dataset.id, btn.dataset.purchaseId); return; }
  if (action === "unlink-return") { clearFinanceTxnLink(btn.dataset.id); return; }
  if (action === "return-link-search-start") {
    financeReturnLinkSearch = { txnId: btn.dataset.id, q: "" };
    renderFinancePage();
    requestAnimationFrame(() => document.querySelector('[data-fin-edit="return-link-q"]')?.focus());
    return;
  }
  if (action === "return-link-search-cancel") { financeReturnLinkSearch = null; renderFinancePage(); return; }
  if (action === "detail-scan-receipt") { startScanReceiptForTxn(btn.dataset.id); return; }
  if (action === "view-receipt-image") { viewReceiptImage(btn.dataset.id); return; }
  if (action === "remove-receipt-image") {
    if (confirm("Remove the kept receipt image for this transaction?")) deleteReceiptImage(btn.dataset.id);
    return;
  }
  if (action === "attach-receipt-image") {
    const txnId = btn.dataset.id;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) uploadReceiptImage(txnId, file).catch((e) => alert("Couldn't keep that image: " + (e?.message || "unknown error")));
    };
    input.click();
    return;
  }
  if (action === "batch-scan-receipts") {
    if (financeBatchScanBusy) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => financeBatchScanReceipts(input.files);
    input.click();
    return;
  }
  if (action === "flip-txn-sign") { toggleFinanceTxnSignFlip(btn.dataset.id); return; }
  if (action === "open-txn-detail") {
    financeDetailTxnId = financeDetailTxnId === btn.dataset.id ? null : btn.dataset.id;
    renderFinancePage();
    return;
  }
  if (action === "close-txn-detail") { financeDetailTxnId = null; renderFinancePage(); return; }
  if (action === "txn-filter-clear") {
    financeTxnFilter.q = ""; financeTxnFilter.kind = ""; financeTxnFilter.account = ""; financeTxnFilter.sort = "date";
    renderFinancePage();
    return;
  }
  if (action === "txn-filter-toggle") { financeTxnFilterOpen = !financeTxnFilterOpen; renderFinancePage(); return; }
  if (action === "manual-txn-open") { openManualTxnForm(null); return; }
  if (action === "manual-txn-edit") {
    const t = financeLabeledTxns().find((x) => x.id === btn.dataset.id);
    if (t?.isManual) openManualTxnForm((state.financeManualTxns || []).find((m) => m.id === t.id));
    return;
  }
  if (action === "manual-txn-delete") { deleteManualTxn(btn.dataset.id); return; }
  if (action === "manual-txn-cancel") { cancelManualTxnForm(); return; }
  if (action === "manual-txn-save") {
    const box = btn.closest(".fin-split-editor");
    const field = (name) => box?.querySelector(`[data-fin-manual="${name}"]`)?.value || "";
    saveManualTxnForm({ id: financeManualForm?.id || null, date: field("date"), desc: field("desc"), amount: field("amount"), account: field("account"), label: field("label") });
    return;
  }
  if (action.startsWith("recurring-")) {
    const r = (state.financeRecurring || []).find((x) => x.id === btn.dataset.id);
    if (!r) return;
    if (action === "recurring-not") r.active = false;
    else if (action === "recurring-ignore") r.newAck = true;
    else if (action === "recurring-price-update") {
      const li = financeResolveLineItem(r.lineItemKey);
      if (li) li.it.amount = r.lastAmount;
      r.ackAmount = r.lastAmount;
    } else if (action === "recurring-price-keep") r.ackAmount = r.lastAmount;
    else if (action === "recurring-miss-dismiss") r.missAck = new Date().toISOString().slice(0, 7);
    setPageNotifCount("finance", financeBellCount());
    persist();
    renderFinancePage();
    return;
  }
  if (action === "split-add-row") { financeSplitDraft?.portions.push({ label: "", amount: "" }); renderFinancePage(); return; }
  if (action === "split-remove-row") { financeSplitDraft?.portions.splice(Number(btn.dataset.idx), 1); renderFinancePage(); return; }
  if (action === "split-remainder") {
    if (!financeSplitDraft) return;
    const t = financeLabeledTxns().find((x) => x.id === financeSplitDraft.txnId);
    const total = Math.abs(t?.amount || 0);
    const assigned = financeSplitDraft.portions.reduce((s, p) => s + Math.abs(parseFinAmount(p.amount) || 0), 0);
    const remaining = Math.round((total - assigned) * 100) / 100;
    if (Math.abs(remaining) <= 0.02) return;
    const empty = financeSplitDraft.portions.find((p) => !parseFinAmount(p.amount));
    if (empty) empty.amount = String(Math.abs(remaining));
    else financeSplitDraft.portions.push({ label: "", amount: String(Math.abs(remaining)) });
    renderFinancePage(); return;
  }
  if (action === "split-even") {
    if (!financeSplitDraft) return;
    const t = financeLabeledTxns().find((x) => x.id === financeSplitDraft.txnId);
    const total = Math.abs(t?.amount || 0);
    if (financeSplitDraft.portions.length < 2) financeSplitDraft.portions = [{ label: financeSplitDraft.portions[0]?.label || "", amount: "" }, { label: "", amount: "" }];
    const n = financeSplitDraft.portions.length;
    const per = Math.floor((total / n) * 100) / 100;
    let acc = 0;
    financeSplitDraft.portions.forEach((p, i) => { p.amount = String(i === n - 1 ? Math.round((total - acc) * 100) / 100 : per); acc += per; });
    renderFinancePage(); return;
  }
  if (action === "split-cancel") { financeSplitDraft = null; renderFinancePage(); return; }
  if (action === "split-save") {
    const portions = (financeSplitDraft?.portions || [])
      .map((p) => ({ label: p.label, amount: parseFinAmount(p.amount) }))
      .filter((p) => p.label && p.amount > 0);
    if (!portions.length) return;
    // Defense in depth: the Save button is disabled unless the portions total
    // the transaction, but re-assert here so no state drift can persist a split
    // that silently mis-totals its categories.
    const splitTxn = financeLabeledTxns().find((x) => x.id === btn.dataset.id);
    const assigned = portions.reduce((s, p) => s + p.amount, 0);
    if (splitTxn && Math.abs(Math.abs(splitTxn.amount || 0) - assigned) > 0.02) return;
    recordFinanceTxnSplit(btn.dataset.id, portions);
    financeSplitDraft = null;
    renderFinancePage();
    return;
  }
  if (action === "split-scan") {
    btn.closest(".fin-split-editor")?.querySelector('[data-fin-edit="split-scan-file"]')?.click();
    return;
  }
  if (action === "split-prefill") {
    const t = financeLabeledTxns().find((x) => x.id === btn.dataset.id);
    const receipt = t && financeReceiptForTxn(t);
    if (receipt && financeSplitDraft) {
      financeSplitDraft.portions = (receipt.portions || []).map((p) => ({ label: p.label || "", amount: p.amount }));
      if (!financeSplitDraft.portions.length) financeSplitDraft.portions = [{ label: "", amount: "" }];
      renderFinancePage();
    }
    return;
  }
  if (action === "toggle-expand") {
    const id = btn.dataset.id;
    financeExpanded.has(id) ? financeExpanded.delete(id) : financeExpanded.add(id);
    renderFinancePage();
    return;
  }
  if (action === "add-card-account") {
    const card = btn.dataset.card;
    const key = FINANCE_CARD_ID_KEYS[card];
    if (!key) return;
    const id = btn.parentElement?.querySelector("select[data-card-add]")?.value;
    if (!id) return;
    const ids = financeCardAccountIds(card).slice();
    if (!ids.includes(id)) ids.push(id);
    state[key] = ids;
    persist();
    renderFinancePage();
    return;
  }
  if (action === "remove-card-account") {
    const card = btn.dataset.card;
    const key = FINANCE_CARD_ID_KEYS[card];
    if (!key) return;
    state[key] = financeCardAccountIds(card).filter((x) => x !== btn.dataset.id);
    persist();
    renderFinancePage();
    return;
  }
  if (action === "add-person") {
    const name = prompt("Name?");
    if (!name?.trim()) return;
    const sid = createId("fin-scenario");
    state.financePeople.push({ id: createId("fin-person"), name: name.trim(), activeScenarioId: sid, scenarios: [{ id: sid, label: "Take-home pay", amount: 0, note: "" }] });
  } else if (action === "delete-person") {
    const p = state.financePeople.find((x) => x.id === btn.dataset.person);
    if (!p || !confirm(`Remove ${p.name} and their scenarios?`)) return;
    state.financePeople = state.financePeople.filter((x) => x.id !== p.id);
    recordDeletion("financePeople", p.id);
  } else if (action === "add-scenario") {
    const p = state.financePeople.find((x) => x.id === btn.dataset.person);
    if (!p) return;
    p.scenarios.push({ id: createId("fin-scenario"), label: "New scenario", amount: 0, payFrequency: "monthly", payAnchor: "", deductions: [], note: "" });
  } else if (action === "delete-scenario") {
    const p = state.financePeople.find((x) => x.id === btn.dataset.person);
    if (!p) return;
    p.scenarios = p.scenarios.filter((s) => s.id !== btn.dataset.id);
    recordDeletion("financeScenarios", btn.dataset.id); // tombstone so the delete survives a union merge
    if (p.activeScenarioId === btn.dataset.id) p.activeScenarioId = p.scenarios[0]?.id || "";
  } else if (action === "add-deduction") {
    const p = state.financePeople.find((x) => x.id === btn.dataset.person);
    const s = p?.scenarios.find((x) => x.id === btn.dataset.scenario);
    if (!s) return;
    if (!Array.isArray(s.deductions)) s.deductions = [];
    s.deductions.push({ id: createId("fin-deduction"), label: "", amount: 0 });
  } else if (action === "delete-deduction") {
    const p = state.financePeople.find((x) => x.id === btn.dataset.person);
    const s = p?.scenarios.find((x) => x.id === btn.dataset.scenario);
    if (!s) return;
    s.deductions = (s.deductions || []).filter((d) => d.id !== btn.dataset.id);
  } else if (action === "add-category") {
    const g = state.financeBudgetGroups.find((x) => x.id === btn.dataset.group);
    const name = g && prompt("Category name?");
    if (!name?.trim()) return;
    const cat = { id: createId("fin-cat"), name: name.trim(), items: [] };
    g.categories.push(cat);
    financeExpanded.add(cat.id);
  } else if (action === "delete-category") {
    const g = state.financeBudgetGroups.find((x) => x.id === btn.dataset.group);
    const c = g?.categories.find((x) => x.id === btn.dataset.id);
    if (!g || !c || !confirm(`Delete "${c.name}" and its ${c.items.length} lines?`)) return;
    g.categories = g.categories.filter((x) => x.id !== c.id);
    recordDeletion("financeCategories", c.id); // tombstone so the delete survives a union merge
  } else if (action === "add-item") {
    const items = financeScopeItems(btn.dataset.scope);
    if (!items) return;
    items.push({ id: createId("fin-item"), name: "", amount: 0, note: "" });
  } else if (action === "delete-item") {
    const items = financeScopeItems(btn.dataset.scope);
    if (!items) return;
    const idx = items.findIndex((it) => it.id === btn.dataset.id);
    if (idx >= 0) items.splice(idx, 1);
    recordDeletion("financeLineItems", btn.dataset.id); // tombstone so the delete survives a union merge
  } else if (action === "add-personal") {
    const name = prompt("Whose personal budget?");
    if (!name?.trim()) return;
    state.financePersonal.push({ id: createId("fin-personal"), person: name.trim(), incomeItems: [], expenseItems: [] });
  } else if (action === "add-account") {
    // Read from the clicked form's own inputs (the panel can render both on the
    // Accounts tab and in Settings, so a global id would grab the wrong one).
    const box = btn.closest(".fin-account-add");
    const owner = box?.querySelector('[data-fin-new="owner"]')?.value.trim();
    const name = box?.querySelector('[data-fin-new="name"]')?.value.trim();
    if (!name) return;
    state.financeAccounts.push({ id: createId("fin-account"), owner: owner || "Other", name });
  } else if (action === "delete-account") {
    state.financeAccounts = state.financeAccounts.filter((a) => a.id !== btn.dataset.id);
    recordDeletion("financeAccounts", btn.dataset.id);
  } else if (action === "add-label") {
    const name = prompt("New label name?");
    if (!name?.trim()) return;
    if (!Array.isArray(state.financeAccountLabels)) state.financeAccountLabels = [];
    if (!state.financeAccountLabels.includes(name.trim())) state.financeAccountLabels.push(name.trim());
  } else if (action === "rename-label") {
    const old = btn.dataset.label;
    const name = prompt(`Rename "${old}" to:`, old);
    if (!name?.trim() || name.trim() === old) return;
    const label = name.trim();
    if (!Array.isArray(state.financeAccountLabels)) state.financeAccountLabels = [];
    state.financeAccountLabels = state.financeAccountLabels.filter((l) => l !== old && l !== label);
    state.financeAccountLabels.push(label);
    state.financeAccounts.forEach((a) => { if ((a.owner || "Other") === old) a.owner = label; });
  } else if (action === "delete-label") {
    const old = btn.dataset.label;
    const count = state.financeAccounts.filter((a) => (a.owner || "Other") === old).length;
    const msg = count
      ? `Delete the label "${old}"? Its ${count} account${count === 1 ? "" : "s"} will move to "Other".`
      : `Delete the label "${old}"?`;
    if (!confirm(msg)) return;
    state.financeAccountLabels = (state.financeAccountLabels || []).filter((l) => l !== old);
    if (state.financeAccountSubLabels) delete state.financeAccountSubLabels[old];
    state.financeAccounts.forEach((a) => { if ((a.owner || "Other") === old) a.owner = "Other"; });
  } else if (action === "add-sublabel") {
    const owner = btn.dataset.label;
    const name = prompt(`New sub-label under "${owner}"?`);
    if (!name?.trim()) return;
    if (!state.financeAccountSubLabels || typeof state.financeAccountSubLabels !== "object") state.financeAccountSubLabels = {};
    const list = state.financeAccountSubLabels[owner] || [];
    if (!list.includes(name.trim())) state.financeAccountSubLabels[owner] = [...list, name.trim()];
  } else if (action === "rename-sublabel") {
    const owner = btn.dataset.label;
    const old = btn.dataset.sub;
    const name = prompt(`Rename "${old}" to:`, old);
    if (!name?.trim() || name.trim() === old) return;
    const label = name.trim();
    if (!state.financeAccountSubLabels || typeof state.financeAccountSubLabels !== "object") state.financeAccountSubLabels = {};
    const list = (state.financeAccountSubLabels[owner] || []).filter((s) => s !== old && s !== label);
    state.financeAccountSubLabels[owner] = [...list, label];
    state.financeAccounts.forEach((a) => { if ((a.owner || "Other") === owner && a.sub === old) a.sub = label; });
  } else if (action === "delete-sublabel") {
    const owner = btn.dataset.label;
    const sub = btn.dataset.sub;
    const count = state.financeAccounts.filter((a) => (a.owner || "Other") === owner && a.sub === sub).length;
    if (!confirm(count ? `Delete "${sub}"? Its ${count} account${count === 1 ? "" : "s"} stay under ${owner}, unfiled.` : `Delete the sub-label "${sub}"?`)) return;
    if (state.financeAccountSubLabels?.[owner]) {
      state.financeAccountSubLabels[owner] = state.financeAccountSubLabels[owner].filter((s) => s !== sub);
      if (!state.financeAccountSubLabels[owner].length) delete state.financeAccountSubLabels[owner];
    }
    state.financeAccounts.forEach((a) => { if ((a.owner || "Other") === owner && a.sub === sub) a.sub = ""; });
  } else {
    return;
  }
  persist();
  renderFinancePage();
}

function onFinanceGridChange(e) {
  const el = e.target.closest("[data-fin-edit]");
  if (!el) return;
  const kind = el.dataset.finEdit;
  if (kind === "txn-label") {
    if (!el.value) return; // picked the placeholder — nothing to record
    if (el.value === "__split__") { startSplitTxn(el.dataset.id); return; }
    recordFinanceTxnLabel(el.dataset.id, el.value, el.dataset.desc || "");
    renderFinancePage();
    return;
  }
  if (kind === "goal-name" || kind === "goal-target" || kind === "goal-current" || kind === "goal-date") {
    const g = (state.financeGoals || []).find((x) => x.id === el.dataset.id);
    if (!g) return;
    if (kind === "goal-name") g.name = el.value.slice(0, 60);
    else if (kind === "goal-target") g.target = parseFinAmount(el.value) || 0;
    else if (kind === "goal-current") g.current = parseFinAmount(el.value) || 0;
    else if (kind === "goal-date") g.targetDate = el.value || "";
    persist();
    renderFinancePage();
    return;
  }
  if (kind === "txn-filter-q" || kind === "txn-filter-kind" || kind === "txn-filter-account" || kind === "txn-filter-sort") {
    if (kind === "txn-filter-q") financeTxnFilter.q = el.value.trim();
    else if (kind === "txn-filter-kind") financeTxnFilter.kind = el.value;
    else if (kind === "txn-filter-sort") financeTxnFilter.sort = el.value;
    else financeTxnFilter.account = el.value;
    renderFinancePage();
    return;
  }
  if (kind === "return-link-q") {
    if (financeReturnLinkSearch?.txnId === el.dataset.id) financeReturnLinkSearch.q = el.value.trim();
    renderFinancePage();
    return;
  }
  if (kind === "recurring-link") {
    const r = (state.financeRecurring || []).find((x) => x.id === el.dataset.id);
    if (!r) return;
    r.lineItemKey = el.value;
    r.newAck = true; // linked (or explicitly unlinked) — the "new" alert is answered
    r.ackAmount = null; // fresh link: let a price mismatch surface
    setPageNotifCount("finance", financeBellCount());
    persist();
    renderFinancePage();
    return;
  }
  if (kind === "split-scan-file") {
    const file = el.files?.[0];
    el.value = "";
    if (file) scanReceiptIntoSplit(file);
    return;
  }
  if (kind === "split-amount" || kind === "split-label") {
    const p = financeSplitDraft?.portions[Number(el.dataset.idx)];
    if (!p) return;
    if (kind === "split-amount") p.amount = el.value;
    else p.label = el.value;
    renderFinancePage();
    return;
  }
  if (kind === "active-scenario") {
    const p = state.financePeople.find((x) => x.id === el.dataset.person);
    if (p) p.activeScenarioId = el.value;
  } else if (kind === "scenario-label" || kind === "scenario-amount" || kind === "scenario-frequency" || kind === "scenario-anchor") {
    const p = state.financePeople.find((x) => x.id === el.dataset.person);
    const s = p?.scenarios.find((x) => x.id === el.dataset.id);
    if (!s) return;
    if (kind === "scenario-label") s.label = el.value.trim();
    else if (kind === "scenario-amount") s.amount = parseFinAmount(el.value);
    else if (kind === "scenario-frequency") s.payFrequency = ["monthly", "biweekly", "weekly"].includes(el.value) ? el.value : "monthly";
    else if (kind === "scenario-anchor") s.payAnchor = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : "";
  } else if (kind === "deduction-label" || kind === "deduction-amount") {
    const p = state.financePeople.find((x) => x.id === el.dataset.person);
    const s = p?.scenarios.find((x) => x.id === el.dataset.scenario);
    const d = s?.deductions?.find((x) => x.id === el.dataset.id);
    if (!d) return;
    if (kind === "deduction-label") d.label = el.value.trim();
    else d.amount = parseFinAmount(el.value);
  } else if (kind === "item-name" || kind === "item-amount") {
    const items = financeScopeItems(el.dataset.scope);
    const it = items?.find((x) => x.id === el.dataset.id);
    if (!it) return;
    if (kind === "item-name") it.name = el.value.trim();
    else it.amount = parseFinAmount(el.value);
  } else if (kind === "emergency-months") {
    const n = Math.max(1, Math.min(24, Math.round(Number(el.value) || 3)));
    state.financeEmergencyMonths = n;
  } else if (kind === "account-kind") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (a) a.kind = FINANCE_ACCOUNT_KINDS.includes(el.value) ? el.value : "";
  } else if (kind === "account-interest") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (a) a.interestRate = parseFinAmount(el.value) || 0;
  } else if (kind === "account-minpayment") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (a) a.minPayment = parseFinAmount(el.value) || 0;
  } else if (kind === "account-name") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (a) a.name = el.value.trim();
  } else if (kind === "account-link") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (a) a.linkedId = el.value;
  } else if (kind === "account-manual-balance") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    const raw = el.value.trim();
    a.manualBalance = raw === "" ? null : (() => {
      const neg = /^[-−(]/.test(raw);
      const n = parseFinAmount(raw);
      return neg ? -Math.abs(n) : n;
    })();
  } else if (kind === "account-owner") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    if (el.value === "__new__") {
      const name = prompt("New label name?");
      if (!name?.trim()) { renderFinancePage(); return; } // reset the select
      const label = name.trim();
      if (!Array.isArray(state.financeAccountLabels)) state.financeAccountLabels = [];
      if (!state.financeAccountLabels.includes(label)) state.financeAccountLabels.push(label);
      a.owner = label;
    } else {
      a.owner = el.value;
    }
    a.sub = ""; // sub-labels belong to an owner; moving owners unfiles it
  } else if (kind === "account-sub") {
    const a = state.financeAccounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    if (el.value === "__new__") {
      const name = prompt("New sub-label name?");
      if (!name?.trim()) { renderFinancePage(); return; }
      const sub = name.trim();
      const owner = a.owner || "Other";
      if (!state.financeAccountSubLabels || typeof state.financeAccountSubLabels !== "object") state.financeAccountSubLabels = {};
      const list = state.financeAccountSubLabels[owner] || [];
      if (!list.includes(sub)) state.financeAccountSubLabels[owner] = [...list, sub];
      a.sub = sub;
    } else {
      a.sub = el.value;
    }
  } else if (kind === "category-mode") {
    const c = financeScopeCategory(el.dataset.scope);
    if (!c) return;
    c.mode = el.checked ? "pick" : "sum";
    if (c.mode === "pick" && !c.items.some((it) => it.id === c.activeItemId)) {
      c.activeItemId = c.items[0]?.id || "";
    }
  } else if (kind === "category-active") {
    const c = financeScopeCategory(el.dataset.scope);
    if (c) c.activeItemId = el.value;
  } else if (kind === "group-ideal") {
    const grp = (state.financeBudgetGroups || []).find((x) => x.id === el.dataset.id);
    if (!grp) return;
    grp.idealPct = Math.max(0, Math.min(100, Math.round(Number(el.value) || 0)));
  } else if (kind === "ret-birth-year") {
    const y = Math.round(Number(el.value) || 0);
    state.financeBirthYear = (y >= 1900 && y <= new Date().getFullYear()) ? y : null;
  } else if (kind === "ret-annual-income") {
    state.financeAnnualIncome = Math.max(0, Number(el.value) || 0);
  } else {
    return;
  }
  persist();
  renderFinancePage();
}

function renderFinanceMonthMenu() {
  const now = new Date();
  const currentKey = financeCurrentMonthKey();
  const options = [];
  for (let i = -24; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  elements.weekJumpMenu.innerHTML = `
    <div class="week-jump-panel">
      <div class="week-jump-list">
        ${options.map((key) => {
          const [y, m] = key.split("-").map(Number);
          const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
          const isViewed = key === financeViewMonth;
          const isCurrent = key === currentKey;
          return `
          <button class="week-jump-option ${isViewed ? "is-current" : ""}" type="button" data-month-jump="${escapeHtml(key)}" ${isViewed ? "data-viewed-week" : ""} ${isCurrent ? "data-current-week" : ""}>
            <span>${escapeHtml(label)}</span>
            ${isCurrent ? `<small>Current month</small>` : ""}
          </button>`;
        }).join("")}
      </div>
    </div>
  `;
}

function jumpToFinanceMonth(key) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return;
  financeViewMonth = key;
  financeTxnListExpanded = false; // each month starts collapsed at the light default
  closeWeekJumpMenu();
  setWeekToolsMode("finance");
  renderFinancePage();
}

function refreshFinanceSettingsIfOpen() {
  if (elements.contextSettingsDialog?.open && getContextSettingsKind() === "finance-accounts") {
    renderContextSettingsDialog("finance-accounts");
  }
}

  // ── Nav-entry glue (showFinanceApp stays in app.js and calls these) ──────────
  // The finance-enter sequence, kept in the module so the shared state (financeViewMonth,
  // financeLinkStatus, financeLive) stays private. resetFinanceViewMonth runs BEFORE
  // setWeekToolsMode in app.js (which reads the month via getFinanceViewMonth), matching
  // the original order exactly.
  function resetFinanceViewMonth() { financeViewMonth = financeCurrentMonthKey(); }
  function onEnterFinancePage() {
    renderFinancePage();
    if (financeLinkStatus === null) checkFinanceLinkStatus();
    else if (financeLinkStatus.connected && !financeLive) refreshFinanceLive();
  }
  function getFinanceViewMonth() { return financeViewMonth; }
  function getFinanceLinkStatus() { return financeLinkStatus; }

  return { checkFinanceLinkStatus, financeAlertPref, financeCurrentMonthKey, financePaydaysInRange, formatFinMoney, invalidateFinanceLabeled, jumpToFinanceMonth, navigateFinanceMonth, onFinanceGridChange, onFinanceGridClick, refreshFinanceLive, refreshFinanceSettingsIfOpen, renderFinanceAccountsPanel, renderFinanceMonthMenu, renderFinancePage, showFinAcctMenu, onEnterFinancePage, resetFinanceViewMonth, getFinanceViewMonth, getFinanceLinkStatus };
}
