// Drives the REAL finance module (createFinanceModule) with a stubbed bank feed
// and a stubbed finance_transactions table, to verify the store read-flip
// (FINANCE_TRANSACTIONS_DESIGN.md §5) end-to-end through the module's own code:
//   • "feed" mode is untouched;
//   • "store" mode with years of history leaves past-month budget snapshots
//     byte-identical and computes the current month exactly like the feed;
//   • old unlabeled history doesn't flood the bell (60-day deck window);
//   • a label made on a pending pre-auth follows it to the posted charge;
//   • an unreachable store falls back to the feed.
import { describe, it, expect, beforeAll } from "vitest";
import { createFinanceModule } from "../finance-ui.js";

beforeAll(() => { globalThis.location = { hostname: "app.example" }; });

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const monthOf = (daysAgo) => iso(daysAgo).slice(0, 7);

// Feed = the bank's 45-day window. Store = the same rows + years of history.
const feedTxns = [
  { id: "cur1", posted: iso(1), amount: -40, description: "TRADER JOES 552", pending: false },
  { id: "cur2", posted: iso(2), amount: -12.5, description: "COFFEE SHOP", pending: false },
  { id: "new-unlabeled", posted: iso(3), amount: -9, description: "NEW PLACE", pending: false },
];
const oldRows = [];
for (let d = 60; d < 3 * 365; d += 7) {
  oldRows.push({ id: `old${d}`, account_id: "A1", origin: "simplefin", status: "active", posted: iso(d), amount: -20, description: `SHOP${d % 5} STORE`, pending: false, updated_at: "2026-01-01T00:00:00Z" });
}

function makeState() {
  const pastMonth = monthOf(200);
  return {
    financeBudgetGroups: [{ id: "g", label: "Needs", categories: [{ id: "c", name: "Food", items: [] }] }],
    financeAccounts: [{ id: "acc", name: "Checking", linkedId: "A1" }],
    financeTxnLabels: {
      cur1: "cat:g:c", cur2: "cat:g:c",
      // labels on OLD txns — some evicted in reality; here we keep one so a
      // wrongful re-snapshot of an old month would be visible as a change.
      old203: "cat:g:c",
    },
    financeMonthActuals: { [pastMonth]: { cats: { "g:c": 999.99 }, income: 0, incomeBy: {} } },
    financeManualTxns: [],
  };
}

function build(state, { storeRows = null, storeThrows = false } = {}) {
  const bell = [];
  const fin = createFinanceModule({
    state, elements: {}, persist: () => {}, createId: (p) => `${p}-${Math.random()}`, escapeHtml: (s) => String(s),
    showMailToast: () => {}, recordDeletion: () => {}, trackUsage: () => {},
    callNetlifyFunction: async (_fn, body) => (body.action === "accounts"
      ? { accounts: [{ id: "A1", org: "Bank", name: "Checking", balance: 100, transactions: feedTxns.map((t) => ({ ...t })) }], errors: [], fetchedAt: new Date().toISOString() }
      : {}),
    dateKeyFromDate: (d) => d.toISOString().slice(0, 10),
    setPageNotifCount: (_p, n) => bell.push(n), setWeekToolsMode: () => {}, closeWeekJumpMenu: () => {},
    getCurrentProfileMember: () => null, renderContextSettingsDialog: () => {}, openContextSettingsDialog: () => {},
    prepareScanImage: async () => null, fileToDataUrl: async () => "",
    getActiveAppArea: () => "home", getSupabaseClient: () => null, getAuthSession: () => null, getContextSettingsKind: () => "",
    getFinanceStoreGroupId: () => "g1",
    canUseFinanceStore: () => true,
    fetchSupabaseJson: async (q) => {
      if (storeThrows) throw new Error("Supabase 404");
      return q.includes("or=") ? [] : (storeRows || []);
    },
  });
  return { fin, bell };
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("finance store mode — through the real finance module", () => {
  it("feed mode (default) is unchanged by this work", async () => {
    const state = makeState();
    const { fin } = build(state);
    await fin.refreshFinanceLive();
    await settle();
    expect(state.financeTxnSource).toBeUndefined(); // module never sets it on its own
    expect(state.financeMonthActuals[monthOf(1)].cats["g:c"]).toBe(52.5);
  });

  it("store mode: past snapshots byte-identical, current month identical to feed, bell not flooded", async () => {
    const feedState = makeState();
    const feedRun = build(feedState);
    await feedRun.fin.refreshFinanceLive();
    await settle();

    const storeRows = [
      ...feedTxns.map((t) => ({ ...t, account_id: "A1", origin: "simplefin", status: "active", updated_at: "2026-01-02T00:00:00Z" })),
      ...oldRows,
    ];
    const state = { ...makeState(), financeTxnSource: "store" };
    const before = JSON.stringify(state.financeMonthActuals[monthOf(200)]);
    const storeRun = build(state, { storeRows });
    await storeRun.fin.refreshFinanceLive();
    await settle();

    // Past month: untouched even though the store now fully "covers" it.
    expect(JSON.stringify(state.financeMonthActuals[monthOf(200)])).toBe(before);
    // Only months the feed would have written exist.
    expect(Object.keys(state.financeMonthActuals).sort()).toEqual(Object.keys(feedState.financeMonthActuals).sort());
    expect(state.financeMonthActuals[monthOf(1)]).toEqual(feedState.financeMonthActuals[monthOf(1)]);
    // ~150 old unlabeled txns exist, but the bell counts the same as the feed.
    expect(storeRun.bell.at(-1)).toBe(feedRun.bell.at(-1));
  });

  it("a label made on a pending pre-auth follows it to the posted charge (amount changed)", async () => {
    const storeRows = [
      { id: "pend", account_id: "A1", origin: "simplefin", status: "superseded", superseded_by: "post", posted: iso(4), amount: -1, description: "SHELL OIL", pending: true, updated_at: "x" },
      { id: "post", account_id: "A1", origin: "simplefin", status: "active", posted: iso(3), amount: -48.12, description: "SHELL OIL", pending: false, updated_at: "x" },
      ...feedTxns.map((t) => ({ ...t, account_id: "A1", origin: "simplefin", status: "active", updated_at: "x" })),
    ];
    const state = { ...makeState(), financeTxnSource: "store" };
    state.financeTxnLabels.pend = "cat:g:c";
    const { fin } = build(state, { storeRows });
    await fin.refreshFinanceLive();
    await settle();
    expect(state.financeTxnLabels.post).toBe("cat:g:c");
    expect(state.financeTxnLabels.pend).toBeUndefined();
    // …and the posted amount lands in this month's actuals.
    expect(state.financeMonthActuals[monthOf(1)].cats["g:c"]).toBeCloseTo(52.5 + (monthOf(3) === monthOf(1) ? 48.12 : 0), 2);
  });

  it("store enabled but unreachable (migration not applied) → feed behavior, no crash", async () => {
    const feedState = makeState();
    const feedRun = build(feedState);
    await feedRun.fin.refreshFinanceLive();
    await settle();
    const state = { ...makeState(), financeTxnSource: "store" };
    const { fin, bell } = build(state, { storeThrows: true });
    await fin.refreshFinanceLive();
    await settle();
    expect(state.financeMonthActuals).toEqual(feedState.financeMonthActuals);
    expect(bell.at(-1)).toBe(feedRun.bell.at(-1));
  });
});
