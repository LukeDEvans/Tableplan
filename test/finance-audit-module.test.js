// Audit fixes FIN-1/6/9/11/12 — driven through the REAL finance module
// (createFinanceModule) with a stubbed bank feed, same harness style as
// finance-store-mode.test.js. UI rendering is not covered (no DOM grid).
import { describe, it, expect, beforeAll } from "vitest";
import { createFinanceModule } from "../finance-ui.js";

beforeAll(() => {
  globalThis.location = { hostname: "app.example" };
  globalThis.confirm = () => true;
});

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

function build(state, { responses }) {
  const calls = { deletions: [], bell: [], simplefin: [] };
  const fin = createFinanceModule({
    state, elements: {}, persist: () => {}, createId: (p) => `${p}-${Math.random()}`, escapeHtml: (s) => String(s),
    showMailToast: () => {}, recordDeletion: (k, id) => calls.deletions.push([k, id]), trackUsage: () => {},
    callNetlifyFunction: async (_fn, body) => { calls.simplefin.push(body.action); return responses[body.action]?.shift?.() ?? {}; },
    dateKeyFromDate: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    setPageNotifCount: (_p, n) => calls.bell.push(n), setWeekToolsMode: () => {}, closeWeekJumpMenu: () => {},
    getCurrentProfileMember: () => null, renderContextSettingsDialog: () => {}, openContextSettingsDialog: () => {},
    prepareScanImage: async () => null, fileToDataUrl: async () => "",
    getActiveAppArea: () => "home", getSupabaseClient: () => null, getAuthSession: () => null, getContextSettingsKind: () => "",
    getFinanceStoreGroupId: () => null, canUseFinanceStore: () => false,
    fetchSupabaseJson: async () => [],
  });
  return { fin, calls };
}

const baseState = () => ({
  financeBudgetGroups: [{ id: "g", label: "Needs", categories: [{ id: "c", name: "Food", items: [] }] }],
  financeAccounts: [{ id: "acc", name: "Checking", linkedId: "A1" }],
  financeTxnLabels: {},
  financeMonthActuals: {},
  financeManualTxns: [],
});
const okAccounts = (txns) => ({ accounts: [{ id: "A1", org: "Bank", name: "Checking", balance: 100, balanceDate: new Date().toISOString(), transactions: txns }], errors: [], fetchedAt: new Date().toISOString() });

describe("FIN-1 deleting a manual transaction records a tombstone", () => {
  it("calls recordDeletion('financeManualTxns', id)", () => {
    const state = { ...baseState(), financeManualTxns: [{ id: "m1", posted: iso(1), amount: -5, description: "CASH" }] };
    const { fin, calls } = build(state, { responses: {} });
    const btn = { dataset: { finAction: "manual-txn-delete", id: "m1" } };
    fin.onFinanceGridClick({ target: { closest: () => btn } });
    expect(state.financeManualTxns).toEqual([]);
    expect(calls.deletions).toContainEqual(["financeManualTxns", "m1"]);
  });
});

describe("FIN-6 a failed link-status call stays 'unknown' (retryable)", () => {
  it("error → null, next call retries and succeeds", async () => {
    const state = baseState();
    const { fin } = build(state, { responses: { status: [{ error: "HTTP 502" }, { connected: false }] } });
    await fin.checkFinanceLinkStatus();
    expect(fin.getFinanceLinkStatus()).toBeNull();
    await fin.checkFinanceLinkStatus();
    expect(fin.getFinanceLinkStatus()).toEqual({ connected: false });
  });
});

describe("FIN-12 / FIN-11 a failed refresh keeps the last good data and dismissals", () => {
  it("accounts/transactions survive a failed force refresh", async () => {
    const state = { ...baseState(), financeTxnLabels: {} };
    const txns = [{ id: "t1", posted: iso(1), amount: -40, description: "NEW PLACE", pending: false }];
    const { fin, calls } = build(state, { responses: { accounts: [okAccounts(txns), { error: "bridge down" }] } });
    await fin.refreshFinanceLive();
    await settle();
    const before = (await fin.financeExportTransactions()).transactions.map((t) => t.id);
    expect(before).toEqual(["t1"]);
    await fin.refreshFinanceLive(true);
    await settle();
    const after = (await fin.financeExportTransactions()).transactions.map((t) => t.id);
    expect(after).toEqual(["t1"]); // not wiped
    // The bell surfaces the bridge error (1 unlabeled txn + 1 connection error).
    expect(calls.bell.at(-1)).toBe(2);
  });
  it("FIN-11: a failed pull with no accounts doesn't prune dismissals", async () => {
    const state = baseState();
    state.financeDismissedAlerts = { "stale:A1": true };
    const { fin } = build(state, { responses: { accounts: [{ error: "bridge down" }] } });
    await fin.refreshFinanceLive();
    await settle();
    expect((await fin.financeExportTransactions()).transactions).toEqual([]);
    expect(state.financeDismissedAlerts).toEqual({ "stale:A1": true });
  });
});

describe("FIN-9 a label to a deleted category reads as unlabeled", () => {
  it("resurfaces in the to-label count and export; stored label untouched", async () => {
    const txns = [
      { id: "ok", posted: iso(1), amount: -10, description: "GOOD SHOP", pending: false },
      { id: "dead", posted: iso(1), amount: -20, description: "OTHER SHOP", pending: false },
    ];
    const state = { ...baseState(), financeTxnLabels: { ok: "cat:g:c", dead: "cat:g:gone" } };
    const { fin, calls } = build(state, { responses: { accounts: [okAccounts(txns)] } });
    await fin.refreshFinanceLive();
    await settle();
    const rows = (await fin.financeExportTransactions()).transactions;
    expect(rows.find((r) => r.id === "dead").category).toBe("");
    expect(rows.find((r) => r.id === "ok").category).toBe("Needs · Food");
    expect(calls.bell.at(-1)).toBe(1); // the dead-labeled txn is back in the queue
    expect(state.financeTxnLabels.dead).toBe("cat:g:gone"); // read-side only
  });
  it("a boot-empty budget (no categories yet) does not discard labels", async () => {
    const txns = [{ id: "x", posted: iso(1), amount: -10, description: "SHOP", pending: false }];
    const state = { ...baseState(), financeBudgetGroups: [{ id: "g", label: "Needs", categories: [] }], financeTxnLabels: { x: "cat:g:c" } };
    const { fin, calls } = build(state, { responses: { accounts: [okAccounts(txns)] } });
    await fin.refreshFinanceLive();
    await settle();
    expect(calls.bell.at(-1)).toBe(0);
  });
});
