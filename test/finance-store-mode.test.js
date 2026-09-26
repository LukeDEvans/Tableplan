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

describe("CSV import → durable rows (through the real finance module)", () => {
  function harness({ storeRows = [], writeFails = false } = {}) {
    const writes = [];
    let table = storeRows.map((r) => ({ ...r }));
    let clock = 0;
    const stamp = () => `t${String(++clock).padStart(6, "0")}`;
    const state = { ...makeState(), financeTxnSource: "store" };
    const toasts = [];
    const fin = createFinanceModule({
      state, elements: {}, persist: () => {}, createId: (p) => `${p}-1`, escapeHtml: (s) => String(s),
      showMailToast: (msg, undo) => toasts.push({ msg, undo }), recordDeletion: () => {}, trackUsage: () => {},
      callNetlifyFunction: async (_fn, body) => (body.action === "accounts"
        ? { accounts: [{ id: "A1", org: "Bank", name: "Checking", balance: 1, transactions: [] }], errors: [], fetchedAt: new Date().toISOString() }
        : {}),
      dateKeyFromDate: (d) => d.toISOString().slice(0, 10),
      setPageNotifCount: () => {}, setWeekToolsMode: () => {}, closeWeekJumpMenu: () => {},
      getCurrentProfileMember: () => null, renderContextSettingsDialog: () => {}, openContextSettingsDialog: () => {},
      prepareScanImage: async () => null, fileToDataUrl: async () => "",
      getActiveAppArea: () => "home", getSupabaseClient: () => null, getAuthSession: () => null, getContextSettingsKind: () => "",
      getFinanceStoreGroupId: () => "g1", canUseFinanceStore: () => true,
      // Honors the (updated_at, id) keyset cursor like PostgREST would.
      fetchSupabaseJson: async (q) => {
        const sorted = [...table].sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : a.updated_at < b.updated_at ? -1 : 1));
        const m = decodeURIComponent(q).match(/updated_at\.gt\."([^"]+)",and\(updated_at\.eq\."[^"]+",id\.gt\."(.*)"\)\)/);
        return m ? sorted.filter((r) => r.updated_at > m[1] || (r.updated_at === m[1] && r.id > m[2])) : sorted;
      },
      writeSupabaseJson: async (path, opts) => {
        if (writeFails) throw new Error("Supabase 403");
        writes.push({ path, ...opts });
        const at = stamp();
        if (opts.method === "POST") for (const r of opts.body) table = [...table.filter((x) => x.id !== r.id), { ...r, updated_at: at }];
        if (opts.method === "PATCH") table = table.map((r) => (r.import_batch && path.includes(`import_batch=eq.${r.import_batch}`) ? { ...r, ...opts.body, updated_at: at } : r));
      },
    });
    // Stub the browser file picker + FileReader for startFinanceCsvImport.
    globalThis.FileReader = class { readAsText(f) { this.result = f.text; this.onload(); } };
    globalThis.document = { createElement: () => { const input = { files: null, click() { input.files = [globalThis.__csvFile]; input.onchange(); } }; return input; } };
    globalThis.confirm = () => true;
    const click = (action, id) => fin.onFinanceGridClick({ target: { closest: () => ({ dataset: { finAction: action, id } }) } });
    return { fin, state, writes, toasts, click, table: () => table };
  }
  const CSV = [
    "Date,Description,Amount,Category",
    `${iso(400).slice(0, 10)},OLD GROCER,-30.00,Food`,
    `${iso(399).slice(0, 10)},OLD GROCER,-31.00,Food`,
    `${iso(2).slice(0, 10)},COFFEE SHOP,-12.50,Food`,
  ].join("\n");

  it("saves new rows once, skips a charge the bank already gave us, and a re-import inserts nothing", async () => {
    const bankRow = { id: "cur2", account_id: "A1", origin: "simplefin", status: "active", posted: iso(2), amount: -12.5, description: "COFFEE SHOP", pending: false, updated_at: "t000000" };
    const h = harness({ storeRows: [bankRow] });
    await h.fin.refreshFinanceLive(); await settle();
    globalThis.__csvFile = { name: "visa.csv", text: CSV };
    h.click("import-csv"); await settle();
    h.click("csv-import-confirm"); await settle();
    const posted = h.writes.filter((w) => w.method === "POST").flatMap((w) => w.body);
    expect(posted.map((r) => r.description).sort()).toEqual(["OLD GROCER", "OLD GROCER"]);
    expect(posted.every((r) => r.origin === "csv" && r.account_id === "A1" && r.import_label === "cat:g:c" && r.status === "active")).toBe(true);
    expect(h.toasts.at(-1).msg).toMatch(/2 transactions saved · 1 already from the bank/);

    // Same file again → nothing new.
    h.click("import-csv"); await settle();
    h.click("csv-import-confirm"); await settle();
    expect(h.writes.filter((w) => w.method === "POST")).toHaveLength(1);
    expect(h.toasts.at(-1).msg).toMatch(/2 already imported · 1 already from the bank/);
  });

  it("undo soft-deletes the batch; importing the file again revives it", async () => {
    const h = harness();
    await h.fin.refreshFinanceLive(); await settle();
    globalThis.__csvFile = { name: "visa.csv", text: CSV };
    h.click("import-csv"); await settle();
    h.click("csv-import-confirm"); await settle();
    await h.toasts.at(-1).undo(); await settle();
    const patch = h.writes.find((w) => w.method === "PATCH");
    expect(patch.body).toEqual({ status: "deleted" });
    expect(patch.path).toMatch(/origin=eq\.csv/);
    expect(h.table().filter((r) => r.origin === "csv").every((r) => r.status === "deleted")).toBe(true);
    h.click("import-csv"); await settle();
    h.click("csv-import-confirm"); await settle();
    expect(h.table().filter((r) => r.origin === "csv" && r.status === "active")).toHaveLength(3);
  });

  it("a failed save still backfills month totals as before and says the rows weren't saved", async () => {
    const h = harness({ writeFails: true });
    await h.fin.refreshFinanceLive(); await settle();
    globalThis.__csvFile = { name: "visa.csv", text: CSV };
    h.click("import-csv"); await settle();
    h.click("csv-import-confirm"); await settle();
    // Backfilled under the SAME "<gid>:<cid>" key the budget view reads (was "cat:…").
    expect(h.state.financeMonthActuals[monthOf(400)].cats["g:c"]).toBe(monthOf(400) === monthOf(399) ? 61 : 30);
    expect(Object.keys(h.state.financeMonthActuals[monthOf(400)].cats)).toEqual(["g:c"]);
    expect(h.toasts.at(-1).msg).toMatch(/couldn't save rows: Supabase 403/);
    expect(h.toasts.at(-1).undo).toBeUndefined();
  });
});

describe("manual transactions ⇄ store (through the real finance module)", () => {
  function harness(state, table) {
    const writes = [];
    let clock = 0;
    const fin = createFinanceModule({
      state, elements: {}, persist: () => {}, createId: (p) => `${p}-new`, escapeHtml: (s) => String(s),
      showMailToast: () => {}, recordDeletion: () => {}, trackUsage: () => {},
      callNetlifyFunction: async (_fn, body) => (body.action === "accounts"
        ? { accounts: [{ id: "A1", org: "Bank", name: "Checking", balance: 1, transactions: feedTxns.map((t) => ({ ...t })) }], errors: [], fetchedAt: new Date().toISOString() }
        : {}),
      dateKeyFromDate: (d) => d.toISOString().slice(0, 10),
      setPageNotifCount: () => {}, setWeekToolsMode: () => {}, closeWeekJumpMenu: () => {},
      getCurrentProfileMember: () => null, renderContextSettingsDialog: () => {}, openContextSettingsDialog: () => {},
      prepareScanImage: async () => null, fileToDataUrl: async () => "",
      getActiveAppArea: () => "home", getSupabaseClient: () => null, getAuthSession: () => null, getContextSettingsKind: () => "",
      getFinanceStoreGroupId: () => "g1", canUseFinanceStore: () => true,
      fetchSupabaseJson: async (q) => {
        const sorted = [...table.rows].sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : a.updated_at < b.updated_at ? -1 : 1));
        const m = decodeURIComponent(q).match(/updated_at\.gt\."([^"]+)",and\(updated_at\.eq\."[^"]+",id\.gt\."(.*)"\)\)/);
        return m ? sorted.filter((r) => r.updated_at > m[1] || (r.updated_at === m[1] && r.id > m[2])) : sorted;
      },
      writeSupabaseJson: async (path, opts) => {
        writes.push({ path, ...opts });
        const at = `t${String(++clock).padStart(6, "0")}`;
        if (opts.method === "POST") for (const r of opts.body) table.rows = [...table.rows.filter((x) => x.id !== r.id), { ...r, updated_at: at }];
        if (opts.method === "PATCH") {
          const id = decodeURIComponent(path.match(/[?&]id=eq\.([^&]+)/)[1]);
          table.rows = table.rows.map((r) => (r.id === id ? { ...r, ...opts.body, updated_at: at } : r));
        }
      },
    });
    globalThis.confirm = () => true;
    const click = (action, id) => fin.onFinanceGridClick({ target: { closest: () => ({ dataset: { finAction: action, id } }) } });
    return { fin, writes, click };
  }
  const manual = (id, o = {}) => ({ id, posted: iso(2), amount: -8, description: "Cash lunch", account: "Cash", ...o });

  it("enabling the store copies JSONB manual entries once (idempotent)", async () => {
    const table = { rows: feedTxns.map((t) => ({ ...t, account_id: "A1", origin: "simplefin", status: "active", updated_at: "t000000" })) };
    const state = { ...makeState(), financeTxnSource: "store", financeManualTxns: [manual("fin-man-1"), manual("fin-man-2")] };
    const h = harness(state, table);
    await h.fin.refreshFinanceLive(); await settle();
    expect(table.rows.filter((r) => r.origin === "manual").map((r) => r.id).sort()).toEqual(["fin-man-1", "fin-man-2"]);
    await h.fin.refreshFinanceLive(); await settle();
    expect(h.writes.filter((w) => w.method === "POST")).toHaveLength(1); // no second copy
  });

  it("a delete is final in store mode even if a device merge resurrects the JSONB entry", async () => {
    const table = { rows: feedTxns.map((t) => ({ ...t, account_id: "A1", origin: "simplefin", status: "active", updated_at: "t000000" })) };
    const state = { ...makeState(), financeTxnSource: "store", financeManualTxns: [manual("fin-man-1")] };
    state.financeTxnLabels["fin-man-1"] = "cat:g:c";
    const h = harness(state, table);
    await h.fin.refreshFinanceLive(); await settle();
    const withManual = state.financeMonthActuals[monthOf(1)].cats["g:c"];
    h.click("manual-txn-delete", "fin-man-1"); await settle();
    expect(table.rows.find((r) => r.id === "fin-man-1").status).toBe("deleted");
    // Another device's stale copy merges the JSONB entry back in…
    state.financeManualTxns = [manual("fin-man-1")];
    state.financeTxnLabels["fin-man-1"] = "cat:g:c";
    h.fin.invalidateFinanceLabeled();
    await h.fin.refreshFinanceLive(); await settle();
    // …but it stays gone: this month's actuals no longer include the $8.
    expect(state.financeMonthActuals[monthOf(1)].cats["g:c"]).toBeCloseTo(withManual - (monthOf(2) === monthOf(1) ? 8 : 0), 2);
  });

  it("deletes reach the store even while reading from the feed (no later resurrection)", async () => {
    const table = { rows: [{ ...manualTxnRow("fin-man-1"), updated_at: "t000000" }] };
    const state = { ...makeState(), financeTxnSource: "feed", financeManualTxns: [manual("fin-man-1")] };
    const h = harness(state, table);
    await h.fin.refreshFinanceLive(); await settle();
    h.click("manual-txn-delete", "fin-man-1"); await settle();
    expect(table.rows[0].status).toBe("deleted");
  });
  function manualTxnRow(id) { return { id, group_id: "g1", origin: "manual", account_id: "manual:cash", posted: iso(2), amount: -8, description: "Cash lunch", pending: false, status: "active" }; }
});
