import { describe, it, expect } from "vitest";
import { planAccountRemap, remapCandidateAccounts, suggestRemapTarget, carrySupersededAnnotations } from "../finance-transactions.js";

const row = (id, account_id, posted, amount, description, extra = {}) =>
  ({ id, account_id, posted, amount, description, origin: "simplefin", status: "active", pending: false, ...extra });

// Old connection: history from July; new connection: last 90 days from August.
const rows = [
  row("o1", "OLD", "2026-07-02T12:00:00Z", -12.5, "POS CHIPOTLE 1234"),           // older than new history → move
  row("o2", "OLD", "2026-08-10T12:00:00Z", -40, "TARGET 000123 MINNEAPOLIS"),     // matches n2
  row("o3", "OLD", "2026-08-11T12:00:00Z", -4.5, "STARBUCKS #99"),                // matches n3 (renamed merchant text)
  row("o4", "OLD", "2026-08-11T15:00:00Z", -4.5, "STARBUCKS #99"),                // second identical coffee → n4
  row("o5", "OLD", "2026-08-20T12:00:00Z", -9, "PENDING SHELL OIL", { pending: true }), // no match, pending → vanish
  row("o6", "OLD", "2026-08-15T12:00:00Z", -77, "SOMETHING ODD"),                 // overlap, unmatched → move (counted)
  row("n2", "NEW", "2026-08-11T12:00:00Z", -40, "Target Minneapolis"),
  row("n3", "NEW", "2026-08-11T12:00:00Z", -4.5, "Starbucks Coffee"),
  row("n4", "NEW", "2026-08-12T12:00:00Z", -4.5, "Starbucks Coffee"),
  row("n9", "NEW", "2026-08-01T12:00:00Z", -3, "NEW ONLY"),
  row("x1", "OTHER", "2026-08-10T12:00:00Z", -40, "TARGET 000123 MINNEAPOLIS"),
  row("c1", "OLD", "2026-08-10T12:00:00Z", -40, "csv copy", { origin: "csv" }),     // not a bank row → ignored
  row("s1", "OLD", "2026-08-10T12:00:00Z", -40, "gone", { status: "superseded" }),  // already inactive → ignored
];

describe("planAccountRemap", () => {
  it("supersedes matching charges, moves older history, vanishes stale pendings", () => {
    const plan = planAccountRemap(rows, "OLD", "NEW");
    expect(plan.supersede).toEqual([
      { id: "o2", superseded_by: "n2" },
      { id: "o3", superseded_by: "n3" },
      { id: "o4", superseded_by: "n4" },
    ]);
    expect(plan.move.sort()).toEqual(["o1", "o6"]);
    expect(plan.vanish).toEqual(["o5"]);
    expect(plan.overlapUnmatched).toBe(1); // o6 is inside the new account's window
  });

  it("pairs one-to-one (never two old rows onto one new row)", () => {
    const plan = planAccountRemap([
      row("a", "OLD", "2026-08-11T10:00:00Z", -4.5, "STARBUCKS"),
      row("b", "OLD", "2026-08-11T11:00:00Z", -4.5, "STARBUCKS"),
      row("n", "NEW", "2026-08-11T10:30:00Z", -4.5, "STARBUCKS"),
    ], "OLD", "NEW");
    expect(plan.supersede).toEqual([{ id: "a", superseded_by: "n" }]);
    expect(plan.move).toEqual(["b"]);
  });

  it("won't pair different merchants when the match is ambiguous", () => {
    const plan = planAccountRemap([
      row("a", "OLD", "2026-08-11T10:00:00Z", -5, "SUBWAY"),
      row("n1", "NEW", "2026-08-11T10:00:00Z", -5, "PARKING"),
      row("n2", "NEW", "2026-08-11T12:00:00Z", -5, "VENDING"),
    ], "OLD", "NEW");
    expect(plan.supersede).toEqual([]);
    expect(plan.move).toEqual(["a"]);
  });

  it("is a no-op for the same account, missing ids, or an already-merged account", () => {
    expect(planAccountRemap(rows, "NEW", "NEW").supersede).toEqual([]);
    expect(planAccountRemap(rows, "", "NEW").move).toEqual([]);
    expect(planAccountRemap(rows.filter((r) => r.account_id !== "OLD"), "OLD", "NEW")).toMatchObject({ supersede: [], move: [], vanish: [] });
  });
});

describe("remapCandidateAccounts / suggestRemapTarget", () => {
  it("offers only store accounts missing from the live feed", () => {
    const c = remapCandidateAccounts(rows, ["NEW", "OTHER"]);
    expect(c.map((x) => x.accountId)).toEqual(["OLD"]);
    expect(c[0]).toMatchObject({ count: 6, from: "2026-07-02", to: "2026-08-20" });
    expect(remapCandidateAccounts(rows, ["OLD", "NEW", "OTHER"])).toEqual([]);
  });

  it("suggests the live account most charges match", () => {
    expect(suggestRemapTarget(rows, "OLD", ["OTHER", "NEW"])).toEqual({ accountId: "NEW", matched: 3 });
    expect(suggestRemapTarget(rows, "OLD", ["NOPE"])).toBeNull();
  });
});

describe("carrySupersededAnnotations", () => {
  it("moves every txn-id annotation to the successor, keeping one the successor already has", () => {
    const state = {
      financeTxnLabels: { o2: "cat:g:food", o3: "cat:g:coffee", n3: "cat:g:treats" },
      financeTxnNoteOverrides: { o2: "birthday" },
      financeTxnReceipts: { o2: { id: "r1" } },
      financeTxnSignFlips: { o4: true },
      financeTxnConfirmed: { o2: 1 },
      financeNotifDismissed: {},
      financeTxnLinks: { refund1: "o2", o3: "p9" },
      financeMerchantNames: { o2: "untouched: keyed by merchant, not txn id" },
    };
    const stored = [
      { id: "o2", status: "superseded", superseded_by: "n2" },
      { id: "o3", status: "superseded", superseded_by: "n3" },
      { id: "o4", status: "superseded", superseded_by: "n4" },
      { id: "o6", status: "active" },
    ];
    expect(carrySupersededAnnotations(state, stored)).toBe(true);
    expect(state.financeTxnLabels).toEqual({ n2: "cat:g:food", n3: "cat:g:treats" });
    expect(state.financeTxnNoteOverrides).toEqual({ n2: "birthday" });
    expect(state.financeTxnReceipts).toEqual({ n2: { id: "r1" } });
    expect(state.financeTxnSignFlips).toEqual({ n4: true });
    expect(state.financeTxnConfirmed).toEqual({ n2: 1 });
    expect(state.financeTxnLinks).toEqual({ refund1: "n2", n3: "p9" });
    expect(state.financeMerchantNames).toEqual({ o2: "untouched: keyed by merchant, not txn id" });
    expect(carrySupersededAnnotations(state, stored)).toBe(false); // idempotent
  });
});
