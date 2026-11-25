import { describe, it, expect } from "vitest";
import { financeMonthsToBackfill } from "../finance-actuals.js";

const t = (posted, extra = {}) => ({ id: posted, posted, amount: -10, label: "", ...extra });

describe("financeMonthsToBackfill", () => {
  const txns = [t("2026-06-30"), t("2026-07-04"), t("2026-08-02"), t("2026-09-09"), t("2026-10-10"), t("2026-11-02")];
  it("fills covered past months that have no saved totals, oldest first", () => {
    // Store history starts Jun 30, so June isn't covered; November is the current month.
    expect(financeMonthsToBackfill(txns, {}, "2026-11")).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });
  it("leaves months saved by hand alone, refreshes ones it rebuilt", () => {
    const saved = { "2026-07": { cats: {} }, "2026-08": { cats: {}, rebuilt: true } };
    expect(financeMonthsToBackfill(txns, saved, "2026-11")).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
  it("never touches a closed month", () => {
    expect(financeMonthsToBackfill(txns, {}, "2026-11", (m) => m === "2026-09")).toEqual(["2026-07", "2026-08", "2026-10"]);
  });
  it("manual entries don't count as coverage", () => {
    expect(financeMonthsToBackfill([t("2026-03-01", { isManual: true }), t("2026-10-15")], {}, "2026-11")).toEqual([]);
  });
});
