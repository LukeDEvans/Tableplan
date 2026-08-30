import { describe, it, expect } from "vitest";
import { financeEarliestTxnDate, financeMonthsToSnapshot } from "../finance-actuals.js";

const tx = (posted, label = "cat:g:c") => ({ posted, label });

describe("financeEarliestTxnDate", () => {
  it("returns the earliest YYYY-MM-DD, ignoring blanks", () => {
    expect(financeEarliestTxnDate([tx("2026-08-10"), tx("2026-06-02"), tx("")])).toBe("2026-06-02");
  });
  it("is null with no dated transactions", () => {
    expect(financeEarliestTxnDate([{ label: "cat:g:c" }])).toBe(null);
    expect(financeEarliestTxnDate([])).toBe(null);
  });
});

describe("financeMonthsToSnapshot — coverage guard", () => {
  const CUR = "2026-08";

  it("always includes the current month, even with no transactions", () => {
    expect([...financeMonthsToSnapshot([], CUR)]).toEqual([CUR]);
  });

  it("includes a PAST month the feed fully covers (earliest txn on/before its 1st)", () => {
    // Feed reaches back to Jun 2 → July is fully covered.
    const txns = [tx("2026-06-02"), tx("2026-07-15"), tx("2026-08-03")];
    const months = financeMonthsToSnapshot(txns, CUR);
    expect(months.has("2026-07")).toBe(true);
    expect(months.has("2026-08")).toBe(true);
  });

  it("EXCLUDES a past month the feed only partially covers (guards a complete snapshot)", () => {
    // Earliest txn is Jul 10 → July's first 9 days are outside the window, so
    // re-snapshotting July from live would undercount it. Must be excluded.
    const txns = [tx("2026-07-10"), tx("2026-08-03")];
    const months = financeMonthsToSnapshot(txns, CUR);
    expect(months.has("2026-07")).toBe(false);
    expect(months.has("2026-08")).toBe(true); // current month always eligible
  });

  it("includes a past month whose own 1st-day txn is the earliest (boundary)", () => {
    const txns = [tx("2026-07-01"), tx("2026-08-03")];
    expect(financeMonthsToSnapshot(txns, CUR).has("2026-07")).toBe(true);
  });

  it("does not add a month that only has unlabeled transactions", () => {
    // Apr 20 (earliest) establishes coverage back before June; June is labeled
    // and fully covered; July has only an unlabeled txn so it must not be added.
    const txns = [tx("2026-04-20"), tx("2026-06-05"), tx("2026-07-04", "")];
    const months = financeMonthsToSnapshot(txns, CUR);
    expect(months.has("2026-07")).toBe(false);
    expect(months.has("2026-06")).toBe(true);
  });

  it("conservatively excludes the EARLIEST month (its own window may be partial)", () => {
    // The earliest txn sits inside the earliest month, so we can't tell the feed
    // covered that month's start — keep its complete historical snapshot intact.
    const txns = [tx("2026-05-05"), tx("2026-06-05")];
    expect(financeMonthsToSnapshot(txns, CUR).has("2026-05")).toBe(false);
    expect(financeMonthsToSnapshot(txns, CUR).has("2026-06")).toBe(true);
  });
});
