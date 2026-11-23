import { describe, it, expect } from "vitest";
import { receiptsToLink, receiptForMatching } from "../netlify/functions/_receipt-link.js";

const row = (id, data) => ({ id, data: { source: "email", ...data } });
const t = (id, amount, description, posted) => ({ id, amount, description, posted, account: "" });

describe("nightly receipt linking", () => {
  it("maps the table's fields", () => {
    expect(receiptForMatching(row("r1", { storeName: "Spyhouse", purchaseDate: "2026-10-12", total: 9.75, paymentLast4: "4417" })))
      .toMatchObject({ id: "r1", merchant: "Spyhouse", date: "2026-10-12", total: 9.75, last4: "4417", source: "email" });
  });
  it("links only sure fits", () => {
    const rows = [
      row("sure", { storeName: "Spyhouse Coffee", purchaseDate: "2026-10-12", total: 9.75 }),
      row("nostore", { storeName: "Unknown Shop", purchaseDate: "2026-10-12", total: 31.4 }),
      row("done", { storeName: "Aldi", purchaseDate: "2026-10-10", total: 41.33, financeTxnId: "t-aldi" }),
    ];
    const txns = [t("t-spy", -9.75, "SPYHOUSE COFFEE", "2026-10-13T12:00:00Z"), t("t-x", -31.4, "SQ *DANGEROUS MAN", "2026-10-12T12:00:00Z"), t("t-aldi", -41.33, "ALDI 72031", "2026-10-10T12:00:00Z")];
    expect(receiptsToLink(rows, txns)).toEqual([{ id: "sure", txnId: "t-spy" }]);
  });
  it("leaves a receipt alone when two identical charges fit", () => {
    const rows = [row("r", { storeName: "Spyhouse Coffee", purchaseDate: "2026-10-12", total: 9.75 })];
    const txns = [t("a", -9.75, "SPYHOUSE COFFEE", "2026-10-12T12:00:00Z"), t("b", -9.75, "SPYHOUSE COFFEE", "2026-10-12T12:00:00Z")];
    expect(receiptsToLink(rows, txns)).toEqual([]);
  });
});
