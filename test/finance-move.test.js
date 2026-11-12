import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planFinanceMove, stripMovedOut, moveBalanceHistory, normalizeMovedOut, storeAccountIdsFor, FINANCE_MOVED_OUT_KEY, MIXED_KEY_MAPS, ACCOUNT_ID_LISTS } from "../finance-move.js";
import { FINANCE_TXN_ID_MAPS } from "../finance-transactions.js";

// A household finance section with two bank accounts and one manual account.
// "acc-card" (bank id BANK-CARD) is the one Luke marks Personal.
function household() {
  return {
    financeAccounts: [
      { id: "acc-joint", name: "Joint Checking", kind: "cash", linkedId: "BANK-JOINT", owner: "Family" },
      { id: "acc-card", name: "Luke Card", kind: "credit", linkedId: "BANK-CARD", owner: "Luke" },
      { id: "acc-jar", name: "Cash Jar", kind: "cash", manualBalance: 40, owner: "Luke" },
    ],
    financeCashAccountIds: ["acc-joint", "acc-jar"],
    financeRetirementAccountIds: [],
    financeAccountSubLabels: { "acc-card": "Travel card", "acc-joint": "Bills" },
    financeBudgetGroups: [
      { id: "grp-needs", label: "Needs", idealPct: 50, categories: [
        { id: "cat-groceries", name: "Groceries", mode: "single", activeItemId: "li-1", items: [{ id: "li-1", name: "Groceries", amount: 800, note: "weekly" }] },
        { id: "cat-gas", name: "Gas", mode: "single", activeItemId: "li-2", items: [{ id: "li-2", name: "Gas", amount: 120, note: "" }] },
      ] },
      { id: "grp-wants", label: "Wants", idealPct: 30, categories: [
        { id: "cat-hobby", name: "Hobbies", mode: "single", activeItemId: "li-3", items: [{ id: "li-3", name: "Hobbies", amount: 60, note: "" }] },
      ] },
    ],
    financeTxnLabels: {
      "TRN-j1": "cat:grp-needs:cat-groceries",
      "TRN-c1": "cat:grp-wants:cat-hobby",
      "TRN-c2": "cat:grp-needs:cat-groceries",
      "TRN-c3": "mgmt",
      "TRN-c4": "cat:grp-gone:cat-gone",
    },
    financeTxnNoteOverrides: { "TRN-c1": "sailing gloves", "TRN-j1": "big shop" },
    financeTxnSignFlips: { "TRN-c2": true },
    financeTxnConfirmed: { "TRN-c1": true },
    financeNotifDismissed: { "TRN-c3": true, "TRN-j2": true },
    financeTxnReceipts: { "TRN-c2": { path: "x/y.jpg" } },
    financeTxnLinks: { "TRN-c5": "TRN-c1", "TRN-j3": "TRN-c2" },
    financeTxnRules: {
      "west marine": { "cat:grp-wants:cat-hobby": 3 },
      "aldi minneapolis": { "cat:grp-needs:cat-groceries": 9, "cat:grp-needs:cat-gas": 1 },
      "shell oil": { "cat:grp-needs:cat-gas": 4 },
    },
    financeMerchantNames: { "west marine": "West Marine", "aldi minneapolis": "Aldi", "shell oil": "Shell" },
    financeTxnNoteCounts: { "west marine": { gloves: 2 }, "aldi minneapolis": { food: 5 } },
    financeLabelSkips: { "west marine": true, "id:TRN-c3": true, "shell oil": true },
    financeDismissedAlerts: { "large:TRN-c1": true, "large:TRN-j1": true },
    financeRecurring: [
      { id: "rec-1", merchantKey: "west marine", name: "West Marine", lastAmount: 30 },
      { id: "rec-2", merchantKey: "aldi minneapolis", name: "Aldi", lastAmount: 90 },
    ],
    financeManualTxns: [{ id: "man-1", account: "Cash Jar", amount: -5, description: "Lemonade stand" }],
    financeMonthActuals: { "2026-10": { cats: { "grp-needs:cat-groceries": 400 } } },
    financePeople: [{ id: "p-luke", name: "Luke" }],
    financeAnnualIncome: 1,
  };
}
const rows = [
  { id: "TRN-j1", account_id: "BANK-JOINT", description: "ALDI 123 MINNEAPOLIS" },
  { id: "TRN-j2", account_id: "BANK-JOINT", description: "SHELL OIL 5544" },
  { id: "TRN-j3", account_id: "BANK-JOINT", description: "ALDI 123 RETURN" },
  { id: "TRN-c1", account_id: "BANK-CARD", description: "WEST MARINE #88" },
  { id: "TRN-c2", account_id: "BANK-CARD", description: "ALDI 123 MINNEAPOLIS" },
  { id: "TRN-c3", account_id: "BANK-CARD", description: "PAYMENT THANK YOU" },
  { id: "TRN-c4", account_id: "BANK-CARD", description: "WEST MARINE #88" },
  { id: "TRN-c5", account_id: "BANK-CARD", description: "WEST MARINE REFUND" },
];
const move = (extra = {}) => planFinanceMove({ from: household(), to: {}, accountIds: ["acc-card"], storeRows: rows, ...extra });

describe("planFinanceMove — what follows an account", () => {
  it("moves the account entry, its card-list places and its sub-label", () => {
    const r = move();
    expect(r.ok).toBe(true);
    expect(r.from.financeAccounts.map((a) => a.id)).toEqual(["acc-joint", "acc-jar"]);
    expect(r.to.financeAccounts.map((a) => a.id)).toEqual(["acc-card"]);
    expect(r.from.financeAccountSubLabels).toEqual({ "acc-joint": "Bills" });
    expect(r.to.financeAccountSubLabels).toEqual({ "acc-card": "Travel card" });
    expect(r.linkedIds).toEqual(["BANK-CARD"]);
    expect(r.storeAccountIds).toEqual(["BANK-CARD"]);
    expect(r.txnIds.sort()).toEqual(["TRN-c1", "TRN-c2", "TRN-c3", "TRN-c4", "TRN-c5"]);
  });

  it("moves everything keyed by the account's transactions and leaves the rest", () => {
    const r = move();
    expect(Object.keys(r.from.financeTxnLabels)).toEqual(["TRN-j1"]);
    expect(r.to.financeTxnLabels).toEqual({ "TRN-c1": "cat:grp-wants:cat-hobby", "TRN-c2": "cat:grp-needs:cat-groceries", "TRN-c3": "mgmt" });
    expect(r.from.financeTxnNoteOverrides).toEqual({ "TRN-j1": "big shop" });
    expect(r.to.financeTxnNoteOverrides).toEqual({ "TRN-c1": "sailing gloves" });
    expect(r.from.financeTxnSignFlips).toEqual({});
    expect(r.to.financeTxnReceipts).toEqual({ "TRN-c2": { path: "x/y.jpg" } });
    expect(r.to.financeTxnConfirmed).toEqual({ "TRN-c1": true });
    expect(r.from.financeNotifDismissed).toEqual({ "TRN-j2": true });
    expect(r.to.financeNotifDismissed).toEqual({ "TRN-c3": true });
    expect(r.from.financeDismissedAlerts).toEqual({ "large:TRN-j1": true });
    expect(r.to.financeDismissedAlerts).toEqual({ "large:TRN-c1": true });
  });

  it("nothing about the moved transactions is left anywhere in the section they left", () => {
    const text = JSON.stringify({ ...move().from, [FINANCE_MOVED_OUT_KEY]: undefined });
    for (const id of ["TRN-c1", "TRN-c2", "TRN-c3", "TRN-c4", "TRN-c5", "acc-card", "BANK-CARD", "sailing gloves", "West Marine", "west marine"]) {
      expect(text.includes(id), id).toBe(false);
    }
  });

  it("a link between a return and a purchase in different views is dropped and reported", () => {
    const r = move();
    expect(r.to.financeTxnLinks).toEqual({ "TRN-c5": "TRN-c1" }); // both moved: kept
    expect(r.from.financeTxnLinks).toEqual({});                    // TRN-j3 → TRN-c2 crosses: dropped
    expect(r.report.problems.filter((p) => p.kind === "split-link").map((p) => p.txnId)).toEqual(["TRN-j3"]);
  });

  it("a label on a category that no longer exists arrives unlabelled, and is reported", () => {
    const r = move();
    expect(r.to.financeTxnLabels["TRN-c4"]).toBeUndefined();
    expect(r.report.problems.find((p) => p.kind === "dead-label").count).toBe(1);
  });
});

describe("planFinanceMove — budget categories (copy the ones in use, amounts blank)", () => {
  it("copies only the categories the moved transactions are labelled with, keeping ids", () => {
    const r = move();
    expect(r.to.financeBudgetGroups.map((g) => [g.id, g.categories.map((c) => c.id)])).toEqual([
      ["grp-wants", ["cat-hobby"]],
      ["grp-needs", ["cat-groceries"]],
    ]);
    expect(r.report.copiedCategories.map((c) => c.name).sort()).toEqual(["Groceries", "Hobbies"]);
  });
  it("blanks the amounts and notes; the household's budget is untouched", () => {
    const r = move();
    const items = r.to.financeBudgetGroups.flatMap((g) => g.categories.flatMap((c) => c.items));
    expect(items.every((i) => i.amount === 0 && i.note === "")).toBe(true);
    expect(r.from.financeBudgetGroups).toEqual(household().financeBudgetGroups);
  });
  it("keeps a category the receiving side already has", () => {
    const to = { financeBudgetGroups: [{ id: "grp-wants", label: "Mine", categories: [{ id: "cat-hobby", name: "My hobbies", items: [{ id: "x", amount: 25 }] }] }] };
    const r = move({ to });
    const wants = r.to.financeBudgetGroups.find((g) => g.id === "grp-wants");
    expect(wants.label).toBe("Mine");
    expect(wants.categories).toEqual(to.financeBudgetGroups[0].categories);
  });
});

describe("planFinanceMove — merchants", () => {
  it("a merchant seen only on the moved account takes its rule, name, counts, skip and recurring charge", () => {
    const r = move();
    expect(r.from.financeTxnRules["west marine"]).toBeUndefined();
    expect(r.to.financeTxnRules["west marine"]).toEqual({ "cat:grp-wants:cat-hobby": 3 });
    expect(r.from.financeMerchantNames["west marine"]).toBeUndefined();
    expect(r.to.financeMerchantNames["west marine"]).toBe("West Marine");
    expect(r.to.financeTxnNoteCounts).toEqual({ "west marine": { gloves: 2 } });
    expect(r.from.financeLabelSkips).toEqual({ "shell oil": true });
    expect(r.to.financeLabelSkips).toEqual({ "west marine": true, "id:TRN-c3": true });
    expect(r.from.financeRecurring.map((x) => x.id)).toEqual(["rec-2"]);
    expect(r.to.financeRecurring.map((x) => x.id)).toEqual(["rec-1"]);
  });
  it("a merchant on both sides stays, and its rule and name are copied — only labels that exist there", () => {
    const r = move();
    expect(r.from.financeTxnRules["aldi minneapolis"]).toEqual({ "cat:grp-needs:cat-groceries": 9, "cat:grp-needs:cat-gas": 1 });
    expect(r.to.financeTxnRules["aldi minneapolis"]).toEqual({ "cat:grp-needs:cat-groceries": 9 }); // Gas wasn't copied
    expect(r.to.financeMerchantNames["aldi minneapolis"]).toBe("Aldi");
    expect(r.from.financeTxnNoteCounts["aldi minneapolis"]).toEqual({ food: 5 });
    expect(r.to.financeTxnNoteCounts["aldi minneapolis"]).toBeUndefined();
  });
  it("a merchant never seen on the moved account is untouched", () => {
    const r = move();
    expect(r.from.financeTxnRules["shell oil"]).toEqual({ "cat:grp-needs:cat-gas": 4 });
    expect(r.to.financeTxnRules["shell oil"]).toBeUndefined();
  });
});

describe("planFinanceMove — manual accounts, totals, the record of what left", () => {
  it("a manual account takes its manual transactions", () => {
    const r = planFinanceMove({ from: household(), to: {}, accountIds: ["acc-jar"], storeRows: rows });
    expect(r.storeAccountIds).toEqual(["manual:cash-jar"]);
    expect(r.from.financeManualTxns).toEqual([]);
    expect(r.to.financeManualTxns.map((m) => m.id)).toEqual(["man-1"]);
    expect(r.from.financeCashAccountIds).toEqual(["acc-joint"]);
    expect(r.to.financeCashAccountIds).toEqual(["acc-jar"]);
    expect(r.linkedIds).toEqual([]);
  });
  it("refuses a manual account that shares its name with one that stays", () => {
    const from = household();
    from.financeAccounts.push({ id: "acc-jar2", name: "cash  jar", kind: "cash", manualBalance: 1 });
    const r = planFinanceMove({ from, to: {}, accountIds: ["acc-jar"], storeRows: rows });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/same name/);
  });
  it("both sides drop their month totals so the app rebuilds them", () => {
    const r = move({ to: { financeMonthActuals: { "2026-10": { cats: {} } } } });
    expect(r.from.financeMonthActuals).toEqual({});
    expect(r.to.financeMonthActuals).toEqual({});
  });
  it("leaves income, people and unrelated settings where they are", () => {
    const r = move();
    expect(r.from.financePeople).toEqual(household().financePeople);
    expect(r.from.financeAnnualIncome).toBe(1);
    expect(r.to.financePeople).toBeUndefined();
  });
  it("records what left, with a new epoch", () => {
    const r = move();
    expect(r.from[FINANCE_MOVED_OUT_KEY]).toEqual({ epoch: 1, accounts: ["acc-card"], linked: ["BANK-CARD"], txns: r.txnIds });
    expect(r.to[FINANCE_MOVED_OUT_KEY]).toEqual({ epoch: 1, accounts: [], linked: [], txns: [] });
  });
  it("doesn't change its inputs", () => {
    const from = household();
    const before = JSON.stringify(from);
    planFinanceMove({ from, to: {}, accountIds: ["acc-card"], storeRows: rows });
    expect(JSON.stringify(from)).toBe(before);
  });
  it("needs an account that is there", () => {
    expect(planFinanceMove({ from: household(), accountIds: [] }).ok).toBe(false);
    expect(planFinanceMove({ from: household(), accountIds: ["nope"] }).ok).toBe(false);
    expect(planFinanceMove({ from: null, accountIds: ["acc-card"] }).ok).toBe(false);
  });
  it("reports per account what it carries", () => {
    const a = move().report.accounts[0];
    expect(a).toMatchObject({ id: "acc-card", name: "Luke Card", linked: true, transactions: 5, labels: 4, notes: 1, links: 1, receipts: 1 });
  });
});

describe("planFinanceMove — the move back", () => {
  it("Household → Personal → Household returns the account, its labels and notes", () => {
    const out = move();
    const personalRows = rows.filter((r) => r.account_id === "BANK-CARD");
    const back = planFinanceMove({ from: out.to, to: out.from, accountIds: ["acc-card"], storeRows: personalRows });
    expect(back.ok).toBe(true);
    expect(back.to.financeAccounts.map((a) => a.id).sort()).toEqual(["acc-card", "acc-jar", "acc-joint"]);
    expect(back.to.financeTxnLabels["TRN-c1"]).toBe("cat:grp-wants:cat-hobby");
    expect(back.to.financeTxnNoteOverrides["TRN-c1"]).toBe("sailing gloves");
    expect(back.from.financeAccounts).toEqual([]);
    // Household no longer lists it as moved out; Personal now does.
    expect(back.to[FINANCE_MOVED_OUT_KEY]).toEqual({ epoch: 2, accounts: [], linked: [], txns: [] });
    expect(back.from[FINANCE_MOVED_OUT_KEY].accounts).toEqual(["acc-card"]);
    expect(back.from[FINANCE_MOVED_OUT_KEY].epoch).toBe(2);
  });
});

describe("stripMovedOut — an older copy can't show or save what moved", () => {
  it("removes moved accounts and everything keyed by moved transactions from a stale copy", () => {
    const stale = { ...household(), [FINANCE_MOVED_OUT_KEY]: move().from[FINANCE_MOVED_OUT_KEY] };
    const clean = stripMovedOut(stale);
    expect(clean.financeAccounts.map((a) => a.id)).toEqual(["acc-joint", "acc-jar"]);
    expect(Object.keys(clean.financeTxnLabels)).toEqual(["TRN-j1"]);
    expect(clean.financeTxnNoteOverrides).toEqual({ "TRN-j1": "big shop" });
    expect(clean.financeAccountSubLabels).toEqual({ "acc-joint": "Bills" });
    expect(clean.financeLabelSkips["id:TRN-c3"]).toBeUndefined();
    expect(clean.financeDismissedAlerts).toEqual({ "large:TRN-j1": true });
    expect(stale.financeAccounts.length).toBe(3); // input untouched
  });
  it("also catches a relinked copy of a moved bank account (same bank id, new entry id)", () => {
    const s = { financeAccounts: [{ id: "acc-new", linkedId: "BANK-CARD" }, { id: "acc-joint", linkedId: "BANK-JOINT" }], [FINANCE_MOVED_OUT_KEY]: { epoch: 1, accounts: ["acc-card"], linked: ["BANK-CARD"], txns: [] } };
    expect(stripMovedOut(s).financeAccounts.map((a) => a.id)).toEqual(["acc-joint"]);
  });
  it("is the same object when nothing has moved or nothing matches", () => {
    const a = household();
    expect(stripMovedOut(a)).toBe(a);
    const b = { ...move().from };
    expect(stripMovedOut(b)).toBe(b);
    expect(stripMovedOut(null)).toBe(null);
  });
});

describe("moveBalanceHistory", () => {
  const fromDays = {
    "2026-11-01": { netWorth: 1000, balances: { "acc-joint": 1500, "acc-card": -500 } },
    "2026-11-02": { netWorth: 900, balances: { "acc-joint": 1500, "acc-card": -600 } },
    "2026-11-03": { netWorth: 1500, balances: { "acc-joint": 1500 } },
    "2026-11-04": { netWorth: -50, balances: { "acc-card": -50 } },
  };
  it("moves the account's balances and recomputes each day's net worth", () => {
    const r = moveBalanceHistory({ fromDays, toDays: {}, accountIds: ["acc-card"] });
    expect(r.fromDays["2026-11-01"]).toEqual({ netWorth: 1500, balances: { "acc-joint": 1500 } });
    expect(r.fromDays["2026-11-02"]).toEqual({ netWorth: 1500, balances: { "acc-joint": 1500 } });
    expect(r.fromDays["2026-11-03"]).toEqual(fromDays["2026-11-03"]);
    expect(r.fromDays["2026-11-04"]).toBeUndefined(); // nothing left that day
    expect(r.toDays["2026-11-01"]).toEqual({ netWorth: -500, balances: { "acc-card": -500 } });
    expect(r.toDays["2026-11-04"]).toEqual({ netWorth: -50, balances: { "acc-card": -50 } });
    expect(r.daysTouched).toBe(3);
    expect(JSON.stringify(r.fromDays).includes("acc-card")).toBe(false);
  });
  it("adds to days the receiving side already has, and doesn't change its inputs", () => {
    const before = JSON.stringify(fromDays);
    const r = moveBalanceHistory({ fromDays, toDays: { "2026-11-01": { netWorth: 20, balances: { "acc-own": 20 } } }, accountIds: ["acc-card"] });
    expect(r.toDays["2026-11-01"]).toEqual({ netWorth: -480, balances: { "acc-own": 20, "acc-card": -500 } });
    expect(JSON.stringify(fromDays)).toBe(before);
  });
});

describe("helpers", () => {
  it("normalizeMovedOut tolerates anything", () => {
    expect(normalizeMovedOut(null)).toEqual({ epoch: 0, accounts: [], linked: [], txns: [] });
    expect(normalizeMovedOut({ epoch: "3", accounts: ["a", "a"], txns: [1] })).toEqual({ epoch: 3, accounts: ["a"], linked: [], txns: ["1"] });
  });
  it("storeAccountIdsFor: the bank's id, or manual:<slug>", () => {
    expect(storeAccountIdsFor({ linkedId: "B1", name: "X" })).toEqual(["B1"]);
    expect(storeAccountIdsFor({ name: "Cash Jar" })).toEqual(["manual:cash-jar"]);
  });
});

// The database trigger strips what moved using its own copies of these lists.
// A finance key added to the code but not to the trigger would be left behind
// in the household's row by a device with an old copy.
describe("the trigger's lists match the code's", () => {
  const sql = readFileSync(new URL("../migrations/2026-11-11-finance-move-guard.sql", import.meta.url), "utf8");
  const list = (name) => [...sql.match(new RegExp(`${name} text\\[\\] := array\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  it("maps keyed by a transaction id", () => expect(list("txn_keys")).toEqual([...FINANCE_TXN_ID_MAPS].sort()));
  it("maps with id:<txn> / <kind>:<txn> keys", () => expect(list("mixed_keys")).toEqual([...MIXED_KEY_MAPS].sort()));
  it("account id lists", () => expect(list("account_lists")).toEqual([...ACCOUNT_ID_LISTS].sort()));
});
