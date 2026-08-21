import { describe, it, expect } from "vitest";
import * as S from "../grocery-sources.js";

// A trivial identity merge + keyer standing in for the real catalog merge, so we
// test the source-reconciliation logic in isolation.
const keyOf = (r) => r.key;
const mergeRows = (rows) => {
  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, { key: r.key, item: r.item || r.key, quantities: [] });
    if (r.quantity) byKey.get(r.key).quantities.push(r.quantity);
  }
  return [...byKey.values()].map((g) => ({ ...g, quantity: g.quantities.join(" + ") }));
};
const deps = { mergeRows, keyOf };

describe("reconcileSources — one need, multiple sources", () => {
  it("collapses the same item from Meal Plan + Checklist into ONE active need tagged with both sources", () => {
    const { rows } = S.reconcileSources([
      { source: S.SOURCE.MEALPLAN, rows: [{ key: "banana", item: "Bananas", quantity: "6" }] },
      { source: S.SOURCE.CHECKLIST, rows: [{ key: "banana", item: "Bananas" }] }
    ], deps);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("banana");
    expect(rows[0].sources.sort()).toEqual(["checklist", "mealplan"]);
  });

  it("keeps the need active while ANY source remains (source independence: checklist satisfied, manual stays)", () => {
    // Shampoo required by Manual only now (Checklist source dropped its contribution).
    const { rows } = S.reconcileSources([
      { source: S.SOURCE.MANUAL, rows: [{ key: "shampoo", item: "Shampoo" }] }
    ], deps);
    expect(S.isNeedActive(rows[0])).toBe(true);
    // Removing the last source ⇒ no active need.
    const empty = S.reconcileSources([{ source: S.SOURCE.MANUAL, rows: [] }], deps);
    expect(empty.rows).toHaveLength(0);
  });

  it("records a per-source count for subtle context labels without summing quantities", () => {
    const { rows } = S.reconcileSources([
      { source: S.SOURCE.MEALPLAN, rows: [
        { key: "onion", item: "Onion", quantity: "2" },
        { key: "onion", item: "Onion", quantity: "1" }
      ] }
    ], deps);
    expect(rows[0].sourceMeta.mealplan.count).toBe(2);
    // Quantities are merged by the injected merge, not blindly summed here.
    expect(rows[0].quantity).toBe("2 + 1");
  });
});

describe("checklist reconciliation", () => {
  const config = [
    { id: "a", name: "Paper towels" },
    { id: "b", name: "Shampoo" },
    { id: "c", name: "Toilet paper" }
  ];

  it("no submission this cycle ⇒ no contribution (fresh Friday cycle starts empty)", () => {
    expect(S.checklistContribution(config, null)).toEqual([]);
    expect(S.checklistContribution(config, { checked: { a: true } /* no submittedAt */ })).toEqual([]);
  });

  it("unchecked items become needs; checked (not-needed) items do not", () => {
    const submission = S.buildChecklistSubmission(config, { b: true }, "2026-08-18T00:00:00Z");
    const contrib = S.checklistContribution(config, submission);
    expect(contrib.map((c) => c.name).sort()).toEqual(["Paper towels", "Toilet paper"]);
  });

  it("all checked + submit ⇒ zero contribution (marked complete, nothing added)", () => {
    const submission = S.buildChecklistSubmission(config, { a: true, b: true, c: true }, "2026-08-18T00:00:00Z");
    expect(submission.submittedAt).toBeTruthy();
    expect(S.checklistContribution(config, submission)).toEqual([]);
  });

  it("resubmission reconciles to the NEW answers (does not duplicate)", () => {
    const first = S.buildChecklistSubmission(config, { b: true }, "t1");
    expect(S.checklistContribution(config, first).map((c) => c.id).sort()).toEqual(["a", "c"]);
    const second = S.buildChecklistSubmission(config, { a: true, b: true }, "t2");
    expect(S.checklistContribution(config, second).map((c) => c.id)).toEqual(["c"]);
  });

  it("drops answers for config items that no longer exist", () => {
    const submission = S.buildChecklistSubmission(config, { a: true, zzz: true }, "t1");
    expect(submission.checked).toEqual({ a: true });
  });

  it("pending-change detection gates the Submit button correctly", () => {
    // Never submitted, user checked something ⇒ pending.
    expect(S.checklistHasPendingChanges(config, null, { a: true })).toBe(true);
    expect(S.checklistHasPendingChanges(config, null, {})).toBe(false);
    // Submitted, provisional matches ⇒ not pending.
    const sub = S.buildChecklistSubmission(config, { a: true }, "t1");
    expect(S.checklistHasPendingChanges(config, sub, { a: true })).toBe(false);
    // Submitted, provisional diverges ⇒ pending.
    expect(S.checklistHasPendingChanges(config, sub, { a: true, b: true })).toBe(true);
    expect(S.checklistHasPendingChanges(config, sub, {})).toBe(true);
  });
});

describe("moveDestinations — store ordering for the move sheet", () => {
  const stores = [{ id: "cost", name: "Costco" }, { id: "tj", name: "Trader Joe's" }, { id: "tgt", name: "Target" }];
  it("lists preferred stores first (rank order), then remaining stores, then Other", () => {
    const d = S.moveDestinations({ stores, rank: ["tj", "cost"], currentStoreId: "tj" });
    expect(d.map((x) => x.id)).toEqual(["tj", "cost", "tgt", ""]);
    expect(d.find((x) => x.id === "tj").current).toBe(true);
    expect(d.at(-1)).toMatchObject({ id: "", name: "Other" });
  });
  it("handles no rank (all stores in given order + Other)", () => {
    expect(S.moveDestinations({ stores, rank: [], currentStoreId: "" }).map((x) => x.id)).toEqual(["cost", "tj", "tgt", ""]);
  });
  it("ignores rank ids that are not enabled stores", () => {
    expect(S.moveDestinations({ stores, rank: ["gone", "tgt"] }).map((x) => x.id)).toEqual(["tgt", "cost", "tj", ""]);
  });
});

describe("moveNeedsConfirmation — temp/permanent gate", () => {
  it("confirms only when reassigning an already-assigned item to a different store", () => {
    expect(S.moveNeedsConfirmation({ currentStoreId: "cost", targetStoreId: "tj" })).toBe(true);
  });
  it("no confirmation from Other (no current store) — direct assign", () => {
    expect(S.moveNeedsConfirmation({ currentStoreId: "", targetStoreId: "tj" })).toBe(false);
  });
  it("no confirmation when moving to Other, or to the same store", () => {
    expect(S.moveNeedsConfirmation({ currentStoreId: "cost", targetStoreId: "" })).toBe(false);
    expect(S.moveNeedsConfirmation({ currentStoreId: "cost", targetStoreId: "cost" })).toBe(false);
  });
});

describe("autoscrollVelocity — reliable drag-scroll math", () => {
  const rect = { top: 100, bottom: 500 };
  it("is zero in the middle of the container", () => {
    expect(S.autoscrollVelocity(300, rect)).toBe(0);
  });
  it("scrolls up (negative) near the top edge, faster the closer to the edge", () => {
    const nearTop = S.autoscrollVelocity(110, rect);
    const atTop = S.autoscrollVelocity(100, rect);
    expect(nearTop).toBeLessThan(0);
    expect(atTop).toBeLessThanOrEqual(nearTop);
  });
  it("scrolls down (positive) near the bottom edge", () => {
    expect(S.autoscrollVelocity(495, rect)).toBeGreaterThan(0);
  });
  it("respects maxSpeed and returns 0 with no rect", () => {
    expect(Math.abs(S.autoscrollVelocity(100, rect, 64, 18))).toBeLessThanOrEqual(18);
    expect(S.autoscrollVelocity(100, null)).toBe(0);
  });
});

describe("normalizeNextStopItems", () => {
  it("accepts strings and objects, dedupes by name, assigns ids", () => {
    const out = S.normalizeNextStopItems(["Sriracha", { name: "Batteries", quantity: "AA" }, "sriracha"]);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Sriracha");
    expect(out[0].id).toBeTruthy();
    expect(out[1]).toMatchObject({ name: "Batteries", quantity: "AA" });
  });
  it("ignores blanks and non-objects", () => {
    expect(S.normalizeNextStopItems(["", null, 3, {}])).toEqual([]);
    expect(S.normalizeNextStopItems("nope")).toEqual([]);
  });
});
