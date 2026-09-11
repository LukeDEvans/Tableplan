import { describe, it, expect } from "vitest";
import { financeEarliestTxnDate, financeMonthsToSnapshot, financeOffsettingPairIds } from "../finance-actuals.js";

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

describe("financeOffsettingPairIds", () => {
  // A simple merchant key that mirrors the app's (digits stripped) so
  // "ISHARES TRUST 4.04" and "ISHARES TRUST -4.04" share a key.
  const mkey = (d) => String(d || "").toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
  const t = (id, accountId, posted, amount, description) => ({ id, accountId, posted, amount, description });

  it("hides a same-account, same-day, same-merchant +X/-X pair", () => {
    const txns = [
      t("a", "acct1", "2026-09-08", 4.04, "ISHARES TRUST 4.04"),
      t("b", "acct1", "2026-09-08", -4.04, "ISHARES TRUST -4.04"),
    ];
    const hide = financeOffsettingPairIds(txns, mkey, () => false);
    expect(hide.has("a")).toBe(true);
    expect(hide.has("b")).toBe(true);
  });

  it("does NOT collapse an unrelated same-amount charge and refund (different merchants)", () => {
    const txns = [
      t("a", "acct1", "2026-09-08", -4.04, "BLUE BOTTLE COFFEE"),
      t("b", "acct1", "2026-09-08", 4.04, "TARGET REFUND"),
    ];
    expect(financeOffsettingPairIds(txns, mkey, () => false).size).toBe(0);
  });

  it("does not pair across different accounts or different days", () => {
    const txns = [
      t("a", "acct1", "2026-09-08", 4.04, "ISHARES TRUST 4.04"),
      t("b", "acct2", "2026-09-08", -4.04, "ISHARES TRUST -4.04"),
      t("c", "acct1", "2026-09-09", -4.04, "ISHARES TRUST -4.04"),
    ];
    expect(financeOffsettingPairIds(txns, mkey, () => false).size).toBe(0);
  });

  it("never hides a transaction the user has labeled", () => {
    const txns = [
      t("a", "acct1", "2026-09-08", 4.04, "ISHARES TRUST 4.04"),
      t("b", "acct1", "2026-09-08", -4.04, "ISHARES TRUST -4.04"),
    ];
    const hide = financeOffsettingPairIds(txns, mkey, (id) => id === "b");
    expect(hide.size).toBe(0); // b is labeled → a has no partner → neither hidden
  });

  it("pairs only min(credits, debits), leaving the extra visible", () => {
    const txns = [
      t("a", "acct1", "2026-09-08", 4.04, "ISHARES TRUST 4.04"),
      t("b", "acct1", "2026-09-08", 4.04, "ISHARES TRUST 4.04"),
      t("c", "acct1", "2026-09-08", -4.04, "ISHARES TRUST -4.04"),
    ];
    const hide = financeOffsettingPairIds(txns, mkey, () => false);
    expect(hide.size).toBe(2); // one +/- pair hidden, one +4.04 left
  });

  it("ignores zero amounts and undated rows", () => {
    const txns = [
      t("a", "acct1", "2026-09-08", 0, "ISHARES TRUST"),
      t("b", "acct1", "", -4.04, "ISHARES TRUST"),
    ];
    expect(financeOffsettingPairIds(txns, mkey, () => false).size).toBe(0);
  });
});
