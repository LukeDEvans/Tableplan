import { describe, it, expect } from "vitest";
import { taxKindForCategory, taxTagFor, taxYearSummary, taxYearCsv, tripCandidates, tripCharges } from "../finance-tags.js";

describe("tax tags", () => {
  it("rules come from the category's name", () => {
    expect(taxKindForCategory("Needs · Childcare")).toBe("childcare");
    expect(taxKindForCategory("Wants · Giving")).toBe("donation");
    expect(taxKindForCategory("Savings · 529")).toBe("529");
    expect(taxKindForCategory("Wants · Dining out")).toBe("");
  });
  it("a tag picked by hand wins, including clearing a rule's tag", () => {
    expect(taxTagFor({ id: "t" }, { categoryName: "Childcare" })).toEqual({ kind: "childcare", source: "rule" });
    expect(taxTagFor({ id: "t" }, { picked: { t: "medical" }, categoryName: "Childcare" })).toEqual({ kind: "medical", source: "hand" });
    expect(taxTagFor({ id: "t" }, { picked: { t: "none" }, categoryName: "Childcare" })).toEqual({ kind: "", source: "hand" });
  });
  it("a year's totals and a CSV for the accountant", () => {
    const txns = [
      { id: "a", posted: "2026-03-02T00:00:00Z", amount: -550, name: "Little Sprouts", receipt: "" },
      { id: "b", posted: "2026-05-10T00:00:00Z", amount: -100, name: "Red Cross", receipt: "Red Cross · 2026-05-10" },
      { id: "c", posted: "2025-12-31T00:00:00Z", amount: -100, name: "Red Cross" },
      { id: "d", posted: "2026-06-01T00:00:00Z", amount: -40, name: "Chipotle" },
    ];
    const s = taxYearSummary(txns, { year: 2026, picked: { b: "donation" }, categoryNameOf: (t) => (t.id === "a" ? "Needs · Childcare" : "") });
    expect(s.totals).toEqual({ childcare: 550, donation: 100 });
    expect(s.rows.map((r) => r.name)).toEqual(["Little Sprouts", "Red Cross"]);
    expect(taxYearCsv(s).split("\n")[2]).toBe("2026-05-10,Red Cross,100.00,Charitable donation,by hand,Red Cross · 2026-05-10");
  });
});

describe("trips", () => {
  const trip = { id: "duluth", startDate: "2026-07-10", endDate: "2026-07-12" };
  const t = (id, posted, amount = -20) => ({ id, posted: `${posted}T15:00:00Z`, amount });
  it("offers charges during the trip (a day before to two after), not deposits or tagged ones", () => {
    const txns = [t("early", "2026-07-08"), t("eve", "2026-07-09"), t("mid", "2026-07-11"), t("late", "2026-07-14"), t("after", "2026-07-16"), t("refund", "2026-07-11", 20), t("done", "2026-07-11")];
    expect(tripCandidates(txns, trip, { done: "other" }).map((x) => x.id)).toEqual(["eve", "mid", "late"]);
    expect(tripCandidates(txns, { id: "x" })).toEqual([]);
  });
  it("a trip's charges are the ones tagged to it", () => {
    expect(tripCharges([t("a", "2026-07-11"), t("b", "2026-07-11")], "duluth", { a: "duluth", b: "other" }).map((x) => x.id)).toEqual(["a"]);
  });
});
