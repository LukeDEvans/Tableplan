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
