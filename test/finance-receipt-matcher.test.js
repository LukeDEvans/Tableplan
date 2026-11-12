import { describe, it, expect } from "vitest";
import { scoreReceiptTxn, matchReceipts, receiptStoreMatches, receiptStatus } from "../receipt-matcher.js";

const txn = (id, amount, posted, description, account = "") => ({ id, amount, posted: `${posted}T15:00:00Z`, description, account });
const rc = (id, merchant, date, total, extra = {}) => ({ id, merchant, date, total, ...extra });

describe("receiptStoreMatches", () => {
  it("shares a word, ignoring the bank's prefixes and numbers", () => {
    expect(receiptStoreMatches("Costco", "COSTCO WHSE #377")).toBe(true);
    expect(receiptStoreMatches("Trader Joe's", "TRADER JOE S #712 MINNEAPOLIS")).toBe(true);
    expect(receiptStoreMatches("Revival", "TST* REVIVAL MPLS")).toBe(true);
    expect(receiptStoreMatches("Target", "ALDI 72")).toBe(false);
    expect(receiptStoreMatches("", "ALDI 72")).toBe(false);
  });
});

describe("scoreReceiptTxn", () => {
  it("same total, same store, posted two days later: sure", () => {
    expect(scoreReceiptTxn(rc("r", "Costco", "2026-11-03", 214.18), txn("t", -214.18, "2026-11-05", "COSTCO WHSE #377"))).toMatchObject({ confidence: "sure", amount: "exact", dayGap: 2 });
  });
  it("same total, a store the bank names differently: likely, not sure", () => {
    expect(scoreReceiptTxn(rc("r", "Corner Cafe", "2026-11-03", 12.5), txn("t", -12.5, "2026-11-03", "SQ *CC LLC"))).toMatchObject({ confidence: "likely" });
  });
  it("a printed tip makes the charge exact", () => {
    expect(scoreReceiptTxn(rc("r", "Revival", "2026-11-06", 48.6, { tip: 9.72 }), txn("t", -58.32, "2026-11-07", "TST* REVIVAL"))).toMatchObject({ confidence: "sure", amount: "tip" });
  });
  it("a tip written in afterwards fits only with the store, and is never sure", () => {
    expect(scoreReceiptTxn(rc("r", "Revival", "2026-11-06", 48.6), txn("t", -58.3, "2026-11-07", "TST* REVIVAL"))).toMatchObject({ confidence: "likely", amount: "tip-guess" });
    expect(scoreReceiptTxn(rc("r", "Revival", "2026-11-06", 48.6), txn("t", -58.3, "2026-11-07", "SHELL OIL"))).toBeNull();
    expect(scoreReceiptTxn(rc("r", "Revival", "2026-11-06", 48.6), txn("t", -70, "2026-11-07", "TST* REVIVAL"))).toBeNull(); // over 30%
  });
  it("outside the dates, a refund, a deposit or a receipt with no total never fits", () => {
    expect(scoreReceiptTxn(rc("r", "Costco", "2026-11-03", 20), txn("t", -20, "2026-11-10", "COSTCO"))).toBeNull();
    expect(scoreReceiptTxn(rc("r", "Costco", "2026-11-03", 20), txn("t", -20, "2026-11-01", "COSTCO"))).toBeNull();
    expect(scoreReceiptTxn(rc("r", "Costco", "2026-11-03", 20), txn("t", 20, "2026-11-03", "COSTCO"))).toBeNull();
    expect(scoreReceiptTxn(rc("r", "Costco", "2026-11-03", 0), txn("t", -20, "2026-11-03", "COSTCO"))).toBeNull();
  });
  it("a receipt with no date still fits on amount, as likely", () => {
    expect(scoreReceiptTxn(rc("r", "Costco", "", 20), txn("t", -20, "2026-11-03", "COSTCO"))).toMatchObject({ confidence: "likely" });
  });
});

describe("matchReceipts", () => {
  it("pairs one to one, best fit first", () => {
    const receipts = [rc("r1", "Target", "2026-11-03", 20), rc("r2", "Aldi", "2026-11-03", 20)];
    const txns = [txn("a", -20, "2026-11-04", "ALDI 72"), txn("b", -20, "2026-11-04", "TARGET 0012")];
    const m = matchReceipts(receipts, txns);
    expect(m.get("r1").txn.id).toBe("b");
    expect(m.get("r2").txn.id).toBe("a");
    expect(m.get("r1").confidence).toBe("sure");
  });
  it("a linked receipt keeps its transaction; nothing else can take it", () => {
    const m = matchReceipts([rc("r1", "Aldi", "2026-11-03", 20, { financeTxnId: "a" }), rc("r2", "Aldi", "2026-11-03", 20)], [txn("a", -20, "2026-11-03", "ALDI")]);
    expect(m.get("r1")).toMatchObject({ confidence: "linked" });
    expect(m.has("r2")).toBe(false);
  });
  it("a link to a transaction that isn't loaded is left alone", () => {
    const m = matchReceipts([rc("r1", "Aldi", "2026-11-03", 20, { financeTxnId: "gone" })], [txn("a", -20, "2026-11-03", "ALDI")]);
    expect(m.has("r1")).toBe(false);
  });
  it("two identical charges: matched, but not sure which", () => {
    const m = matchReceipts([rc("r1", "Aldi", "2026-11-03", 20)], [txn("a", -20, "2026-11-03", "ALDI 72"), txn("b", -20, "2026-11-03", "ALDI 72")]);
    expect(m.get("r1").confidence).toBe("likely");
  });
  it("the card's last 4 breaks a tie between accounts", () => {
    const m = matchReceipts([rc("r1", "Aldi", "2026-11-03", 20, { last4: "4417" })], [txn("a", -20, "2026-11-03", "ALDI 72", "Visa 9001"), txn("b", -20, "2026-11-03", "ALDI 72", "Visa ··4417")]);
    expect(m.get("r1")).toMatchObject({ confidence: "sure" });
    expect(m.get("r1").txn.id).toBe("b");
  });
});

describe("receiptStatus", () => {
  it("names the state", () => {
    expect(receiptStatus(null)).toBe("reading");
    expect(receiptStatus({ total: 0 })).toBe("needs-look");
    expect(receiptStatus({ total: 5, needsReview: true })).toBe("needs-look");
    expect(receiptStatus({ total: 5, items: [] })).toBe("unmatched");
    expect(receiptStatus({ total: 5, items: [{ category: "" }] }, { confidence: "sure" })).toBe("matched");
    expect(receiptStatus({ total: 5, items: [{ category: "cat:a:b" }] }, { confidence: "linked" })).toBe("itemized");
  });
});
