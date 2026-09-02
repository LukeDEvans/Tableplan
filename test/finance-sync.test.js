import { describe, it, expect } from "vitest";
import {
  financeDeadSet,
  unionFinanceChildren,
  mergeFinanceCategories,
  mergeFinanceBudgetGroups,
  mergeFinancePeople,
  mergeFinancePersonal,
  dedupeFinanceRecurring,
  guardBootEmptyFinance,
  FINANCE_LOCAL_AUTHORITATIVE_KEYS,
} from "../finance-sync.js";

// These tests pin the finance sync-safety CONTRACT — the invariants that exist
// because finance already lost data once. The overarching guarantees:
//   (1) empty-never-erases: a just-booted (empty) record can never wipe populated
//       cloud data, at either the record or the nested-child level;
//   (2) tombstones are the ONLY way a delete wins (absence alone re-supplies).
// A regression in any assertion below is a potential budget/annotation data-loss.

const cat = (id, items = []) => ({ id, name: `cat-${id}`, items });
const item = (id, amount = 0) => ({ id, amount });
const group = (id, categories = [], extra = {}) => ({ id, name: `grp-${id}`, categories, ...extra });

describe("financeDeadSet", () => {
  it("stringifies tombstoned ids for a key; missing → empty set", () => {
    const dead = financeDeadSet({ financeCategories: ["a", 2] }, "financeCategories");
    expect(dead.has("a")).toBe(true);
    expect(dead.has("2")).toBe(true); // numeric id stringified
    expect(financeDeadSet({}, "financeCategories").size).toBe(0);
    expect(financeDeadSet(null, "financeCategories").size).toBe(0);
  });
});

describe("unionFinanceChildren", () => {
  it("unions both sides, newer wins on id clash, older order first", () => {
    const older = [item("a", 1), item("b", 2)];
    const newer = [item("b", 99), item("c", 3)];
    const out = unionFinanceChildren(newer, older, new Set());
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]); // existing (older) order first
    expect(out.find((x) => x.id === "b").amount).toBe(99); // newer wins on clash
  });

  it("drops tombstoned ids and id-less records", () => {
    const out = unionFinanceChildren(
      [item("a", 1), { amount: 5 /* no id */ }],
      [item("b", 2)],
      new Set(["b"]),
    );
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("empty newer keeps all of older (empty never erases)", () => {
    const older = [item("a"), item("b")];
    expect(unionFinanceChildren([], older, new Set()).map((x) => x.id)).toEqual(["a", "b"]);
    expect(unionFinanceChildren(undefined, older, new Set()).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("mergeFinanceCategories", () => {
  it("boot-empty category items never wipe the populated side", () => {
    const cloud = [cat("c1", [item("i1"), item("i2")])];
    const bootEmpty = [cat("c1", [])]; // same id, empty items (just-booted)
    const merged = mergeFinanceCategories(bootEmpty, cloud, new Set(), new Set());
    expect(merged[0].items.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("newer wins on a category's scalar fields while items union", () => {
    const cloud = [cat("c1", [item("i1")])];
    const newer = [{ ...cat("c1", [item("i2")]), name: "renamed" }];
    const merged = mergeFinanceCategories(newer, cloud, new Set(), new Set());
    expect(merged[0].name).toBe("renamed");
    expect(merged[0].items.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("tombstoned category / line item drop out (parent present on the editing side)", () => {
    // A category-level tombstone (c2) drops unconditionally; an item-level
    // tombstone (i2) drops when its parent category is present on the newer side
    // — the realistic "device deleted a line item inside an existing category"
    // path (unionFinanceChildren runs). See the wholesale-empty note below.
    const cloud = [cat("c1", [item("i1"), item("i2")]), cat("c2")];
    const merged = mergeFinanceCategories([cat("c1", [])], cloud, new Set(["c2"]), new Set(["i2"]));
    expect(merged.map((c) => c.id)).toEqual(["c1"]);
    expect(merged[0].items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("a wholesale-empty newer side does NOT delete children (empty-never-erases dominates)", () => {
    // Intentional: when the parent isn't present on the newer side, its children
    // pass through unfiltered. This is the boot-empty case — we must not delete
    // anything from a side that simply hasn't loaded. Real deletes carry the
    // parent (the device edited within it), which the test above covers.
    const cloud = [cat("c1", [item("i1"), item("i2")])];
    const merged = mergeFinanceCategories([], cloud, new Set(), new Set(["i2"]));
    expect(merged[0].items.map((i) => i.id)).toEqual(["i1", "i2"]); // i2 survives
  });
});

describe("mergeFinanceBudgetGroups — the core data-loss guard", () => {
  it("REGRESSION: a just-booted empty group must not wipe the cloud's categories", () => {
    // The exact historical bug: boot state (mirror strips finance) has the group
    // id present but categories empty; a plain id-union would replace the cloud
    // record and blank every category.
    const cloud = [group("g1", [cat("c1", [item("i1")])])];
    const bootEmpty = [group("g1", [])];
    const merged = mergeFinanceBudgetGroups(bootEmpty, cloud, {});
    expect(merged).toHaveLength(1);
    expect(merged[0].categories.map((c) => c.id)).toEqual(["c1"]);
    expect(merged[0].categories[0].items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("unions additions from both devices", () => {
    const older = [group("g1", [cat("c1")])];
    const newer = [group("g1", [cat("c2")]), group("g2")];
    const merged = mergeFinanceBudgetGroups(newer, older, {});
    expect(merged.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(merged.find((g) => g.id === "g1").categories.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("newer wins on a group's scalar fields", () => {
    const older = [group("g1", [cat("c1")], { name: "old" })];
    const newer = [group("g1", [], { name: "new" })];
    expect(mergeFinanceBudgetGroups(newer, older, {})[0].name).toBe("new");
  });

  it("tombstoned group is removed and does not resurrect from the other side", () => {
    const older = [group("g1"), group("g2")];
    const newer = [group("g1")]; // g2 absent here but present in older
    const merged = mergeFinanceBudgetGroups(newer, older, { financeBudgetGroups: ["g2"] });
    expect(merged.map((g) => g.id)).toEqual(["g1"]);
  });

  it("tombstones cascade to categories and line items (parent chain present)", () => {
    const cloud = [group("g1", [cat("c1", [item("i1"), item("i2")]), cat("c2")])];
    // newer carries g1 → c1 (empty items) so the item-level tombstone applies.
    const merged = mergeFinanceBudgetGroups([group("g1", [cat("c1", [])])], cloud, {
      financeCategories: ["c2"],
      financeLineItems: ["i2"],
    });
    expect(merged[0].categories.map((c) => c.id)).toEqual(["c1"]);
    expect(merged[0].categories[0].items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("drops id-less groups defensively", () => {
    const merged = mergeFinanceBudgetGroups([{ categories: [] }], [group("g1")], {});
    expect(merged.map((g) => g.id)).toEqual(["g1"]);
  });
});

describe("mergeFinancePeople", () => {
  const person = (id, scenarios = [], extra = {}) => ({ id, scenarios, ...extra });

  it("unions each person's scenarios; boot-empty never wipes cloud scenarios", () => {
    const cloud = [person("p1", [item("s1"), item("s2")])];
    const merged = mergeFinancePeople([person("p1", [])], cloud, {});
    expect(merged[0].scenarios.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("tombstoned person and scenario drop out (person present on the editing side)", () => {
    const cloud = [person("p1", [item("s1"), item("s2")]), person("p2")];
    const merged = mergeFinancePeople([person("p1", [])], cloud, {
      financePeople: ["p2"],       // person-level tombstone: unconditional
      financeScenarios: ["s2"],    // scenario-level: applies via present parent p1
    });
    expect(merged.map((p) => p.id)).toEqual(["p1"]);
    expect(merged[0].scenarios.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("mergeFinancePersonal", () => {
  const personal = (id, income = [], expense = []) => ({ id, incomeItems: income, expenseItems: expense });

  it("unions income and expense items; boot-empty never wipes cloud items", () => {
    const cloud = [personal("u1", [item("in1")], [item("ex1")])];
    const merged = mergeFinancePersonal([personal("u1", [], [])], cloud, {});
    expect(merged[0].incomeItems.map((i) => i.id)).toEqual(["in1"]);
    expect(merged[0].expenseItems.map((i) => i.id)).toEqual(["ex1"]);
  });

  it("tombstoned personal record and line items drop out (record present on editing side)", () => {
    const cloud = [
      personal("u1", [item("in1"), item("in2")], [item("ex1")]),
      personal("u2"),
    ];
    // newer carries u1 (empty items) so income/expense line-item tombstones apply;
    // u2's record-level tombstone drops unconditionally.
    const merged = mergeFinancePersonal([personal("u1", [], [])], cloud, {
      financePersonal: ["u2"],
      financeLineItems: ["in2", "ex1"],
    });
    expect(merged.map((p) => p.id)).toEqual(["u1"]);
    expect(merged[0].incomeItems.map((i) => i.id)).toEqual(["in1"]);
    expect(merged[0].expenseItems).toEqual([]);
  });
});

describe("dedupeFinanceRecurring", () => {
  it("collapses two devices' same-merchant entries into one", () => {
    const out = dedupeFinanceRecurring([
      { merchantKey: "netflix", lastSeen: "2026-01-01", lastAmount: 15 },
      { merchantKey: "netflix", lastSeen: "2026-02-01", lastAmount: 16 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].lastAmount).toBe(16); // most-recent lastSeen wins the base
  });

  it("OR-s newAck and keeps the later missAck across the merge", () => {
    const out = dedupeFinanceRecurring([
      { merchantKey: "spotify", lastSeen: "2026-01-01", newAck: true, missAck: "2026-01-05" },
      { merchantKey: "spotify", lastSeen: "2026-02-01", newAck: false, missAck: "2026-03-01" },
    ]);
    expect(out[0].newAck).toBe(true);
    expect(out[0].missAck).toBe("2026-03-01");
  });

  it("prefers an ackAmount that matches the base's lastAmount, else the first ack", () => {
    const matched = dedupeFinanceRecurring([
      { merchantKey: "gym", lastSeen: "2026-02-01", lastAmount: 40, ackAmount: 40 },
      { merchantKey: "gym", lastSeen: "2026-01-01", lastAmount: 40, ackAmount: 99 },
    ]);
    expect(matched[0].ackAmount).toBe(40); // matches base.lastAmount

    const unmatched = dedupeFinanceRecurring([
      { merchantKey: "gym", lastSeen: "2026-02-01", lastAmount: 40, ackAmount: null },
      { merchantKey: "gym", lastSeen: "2026-01-01", lastAmount: 40, ackAmount: 99 },
    ]);
    expect(unmatched[0].ackAmount).toBe(99); // no match → first defined ack
  });

  it("inherits lineItemKey from whichever side has one", () => {
    const out = dedupeFinanceRecurring([
      { merchantKey: "x", lastSeen: "2026-02-01", lineItemKey: "" },
      { merchantKey: "x", lastSeen: "2026-01-01", lineItemKey: "budget:rent" },
    ]);
    expect(out[0].lineItemKey).toBe("budget:rent");
  });

  it("drops key-less junk and handles non-arrays", () => {
    expect(dedupeFinanceRecurring([{ lastSeen: "x" }, { merchantKey: "" }])).toEqual([]);
    expect(dedupeFinanceRecurring(null)).toEqual([]);
    expect(dedupeFinanceRecurring(undefined)).toEqual([]);
  });
});

describe("guardBootEmptyFinance — boot-empty write/merge protection", () => {
  // A representative slice of STATE_SECTIONS.finance: some non-authoritative
  // (wholesale-merged / can boot empty) and some locally-authoritative keys.
  const financeKeys = [
    "financeBudgetGroups", "financeCashAccountIds", // non-authoritative
    "financeTxnLabels", "financeManualTxns",        // locally authoritative
  ];

  it("NOT hydrated: restores non-authoritative keys from the cloud copy", () => {
    const merged = { financeBudgetGroups: [], financeCashAccountIds: [] }; // boot-empty
    const cloud = { financeBudgetGroups: [group("g1")], financeCashAccountIds: ["acct-1"] };
    guardBootEmptyFinance(merged, cloud, financeKeys, false);
    expect(merged.financeBudgetGroups).toBe(cloud.financeBudgetGroups); // cloud restored
    expect(merged.financeCashAccountIds).toEqual(["acct-1"]);
  });

  it("NOT hydrated: NEVER overwrites locally-authoritative per-txn metadata", () => {
    const localLabels = { txn1: "Groceries" };
    const merged = { financeTxnLabels: localLabels, financeManualTxns: [item("m1")] };
    const cloud = { financeTxnLabels: { txn1: "STALE" }, financeManualTxns: [] };
    guardBootEmptyFinance(merged, cloud, financeKeys, false);
    expect(merged.financeTxnLabels).toBe(localLabels); // local edit preserved
    expect(merged.financeManualTxns.map((m) => m.id)).toEqual(["m1"]);
  });

  it("hydrated: no-op (local finance is authoritative)", () => {
    const merged = { financeBudgetGroups: [], financeCashAccountIds: [] };
    const cloud = { financeBudgetGroups: [group("g1")], financeCashAccountIds: ["acct-1"] };
    guardBootEmptyFinance(merged, cloud, financeKeys, true);
    expect(merged.financeBudgetGroups).toEqual([]); // untouched
    expect(merged.financeCashAccountIds).toEqual([]);
  });

  it("only restores keys the cloud copy actually has", () => {
    const merged = { financeBudgetGroups: [], financeCashAccountIds: [] };
    const cloud = { financeBudgetGroups: [group("g1")] }; // no cash-account key
    guardBootEmptyFinance(merged, cloud, financeKeys, false);
    expect(merged.financeBudgetGroups).toEqual([group("g1")]);
    expect(merged.financeCashAccountIds).toEqual([]); // left as-is (not in cloud)
  });

  it("the authoritative-keys set matches the per-txn metadata it must protect", () => {
    // Guards against someone adding a locally-edited key to the section without
    // adding it here (which would let a boot-empty merge revert their edits).
    for (const k of [
      "financeTxnLabels", "financeTxnRules", "financeMonthActuals", "financeMerchantNames",
      "financeTxnLinks", "financeTxnSignFlips", "financeTxnNoteOverrides", "financeTxnNoteCounts",
      "financeManualTxns", "financeRecurring",
    ]) {
      expect(FINANCE_LOCAL_AUTHORITATIVE_KEYS.has(k)).toBe(true);
    }
  });
});
