import { describe, it, expect } from "vitest";
import { parseCsvRows, parseCsvAmount, parseCsvMonth, aggregateCsvBackfill } from "../finance-csv.js";

describe("parseCsvRows", () => {
  it("parses simple rows", () => {
    expect(parseCsvRows("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsvRows('Date,Merchant\n"2026-01-02","Joe, the ""Big"" one"');
    expect(rows[1]).toEqual(["2026-01-02", 'Joe, the "Big" one']);
  });
  it("handles CRLF and a final row with no trailing newline", () => {
    expect(parseCsvRows("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
  it("drops fully-blank lines", () => {
    expect(parseCsvRows("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseCsvAmount", () => {
  it("parses plain, signed, currency, and paren-negative forms", () => {
    expect(parseCsvAmount("12.34")).toBe(12.34);
    expect(parseCsvAmount("-12.34")).toBe(-12.34);
    expect(parseCsvAmount("$1,234.56")).toBe(1234.56);
    expect(parseCsvAmount("(12.34)")).toBe(-12.34);
    expect(parseCsvAmount("+9")).toBe(9);
  });
  it("returns null for junk", () => {
    expect(parseCsvAmount("")).toBeNull();
    expect(parseCsvAmount("abc")).toBeNull();
    expect(parseCsvAmount(null)).toBeNull();
  });
});

describe("parseCsvMonth", () => {
  it("reads ISO and US date orderings", () => {
    expect(parseCsvMonth("2026-09-08")).toBe("2026-09");
    expect(parseCsvMonth("09/08/2026")).toBe("2026-09");
    expect(parseCsvMonth("9/8/26")).toBe("2026-09");
  });
  it("returns null for unparseable", () => {
    expect(parseCsvMonth("")).toBeNull();
    expect(parseCsvMonth("not a date")).toBeNull();
  });
});

describe("aggregateCsvBackfill", () => {
  const nameToKey = { "needs · groceries": "cat:g1:c1", "groceries": "cat:g1:c1", "wants · dining out": "cat:g2:c2", "dining out": "cat:g2:c2" };
  const header = "Date,Merchant,Amount,Category";

  it("aggregates spend by month + category as positive magnitudes", () => {
    const csv = [header,
      "2026-01-03,Store,-40.00,Groceries",
      "2026-01-20,Store,-10.00,Groceries",
      "2026-02-05,Cafe,-25.00,Dining out",
    ].join("\n");
    const out = aggregateCsvBackfill(parseCsvRows(csv), nameToKey);
    expect(out.months["2026-01"].cats["cat:g1:c1"]).toBe(50);
    expect(out.months["2026-02"].cats["cat:g2:c2"]).toBe(25);
    expect(out.applied).toBe(2);
    expect(out.matched).toBe(3);
  });

  it("routes positive amounts to income", () => {
    const csv = [header, "2026-01-01,Payroll,3000,"].join("\n");
    const out = aggregateCsvBackfill(parseCsvRows(csv), nameToKey);
    expect(out.months["2026-01"].income).toBe(3000);
    expect(out.income).toBe(1);
  });

  it("tallies spend with no matching category as uncategorized (not applied to cats)", () => {
    const csv = [header, "2026-01-01,Mystery,-15.00,Weird Category"].join("\n");
    const out = aggregateCsvBackfill(parseCsvRows(csv), nameToKey);
    expect(out.uncategorized).toBe(1);
    expect(out.unrecognized).toContain("weird category");
    expect(Object.keys(out.months["2026-01"].cats)).toHaveLength(0);
  });

  it("counts invalid rows (bad date/amount/zero) separately", () => {
    const csv = [header,
      "not-a-date,Store,-40.00,Groceries",
      "2026-01-03,Store,abc,Groceries",
      "2026-01-03,Store,0,Groceries",
    ].join("\n");
    const out = aggregateCsvBackfill(parseCsvRows(csv), nameToKey);
    expect(out.invalid).toBe(3);
    expect(out.applied).toBe(0);
  });

  it("matches the full 'Group · Category' export name", () => {
    const csv = [header, "2026-03-03,Store,-40.00,Needs · Groceries"].join("\n");
    const out = aggregateCsvBackfill(parseCsvRows(csv), nameToKey);
    expect(out.months["2026-03"].cats["cat:g1:c1"]).toBe(40);
  });

  it("flags a CSV missing required columns", () => {
    const out = aggregateCsvBackfill(parseCsvRows("Foo,Bar\n1,2"), nameToKey);
    expect(out.error).toBe("missing-columns");
  });

  it("accepts an object nameToKey as well as a Map", () => {
    const csv = [header, "2026-01-03,Store,-40.00,Groceries"].join("\n");
    const out = aggregateCsvBackfill(parseCsvRows(csv), new Map(Object.entries(nameToKey)));
    expect(out.months["2026-01"].cats["cat:g1:c1"]).toBe(40);
  });
});
