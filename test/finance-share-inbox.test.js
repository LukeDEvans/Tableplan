import { describe, it, expect } from "vitest";
import { receiptFromFinanceInbox, shareReceiptUpgrade, normalizeReceipt, receiptForFinance } from "../receipt-domain.js";

// Share-sheet receipts (source "share") join the one receipts list like
// email / extension receipts, and a better re-read of the same order upgrades it.
const inbox = (items, extra = {}) => ({ id: "shr_abc", source: "share", merchant: "Amazon", date: "2026-10-10", total: 31.47, items, at: "2026-10-12T10:00:00Z", ...extra });
let n = 0;
const createId = (p) => `${p}-${++n}`;

describe("share-sheet receipts", () => {
  it("keep their source and id from the inbox", () => {
    const r = receiptFromFinanceInbox(inbox([{ name: "Paper towels", price: 24.99, category: "cat:home:sup" }]), createId);
    expect(r.id).toBe("receipt-share-shr_abc");
    expect(r.source).toBe("share");
    expect(r.externalId).toBe("");
    expect(r.lineItems[0].budgetCategory).toBe("cat:home:sup");
    expect(receiptForFinance(r).source).toBe("share");
  });

  it("source survives normalization", () => {
    expect(normalizeReceipt({ id: "x", source: "share" }).source).toBe("share");
  });

  it("upgrade when a re-read prices more items", () => {
    const listRead = { ...receiptFromFinanceInbox(inbox([{ name: "Towels", price: 0 }, { name: "Soap", price: 0 }]), createId), financeTxnId: "t1" };
    const detailRead = receiptFromFinanceInbox(inbox([{ name: "Towels", price: 24.99 }, { name: "Soap", price: 4.5 }], { at: "2026-10-13T10:00:00Z" }), createId);
    const up = shareReceiptUpgrade(listRead, detailRead);
    expect(up.lineItems.map((l) => l.totalPrice)).toEqual([24.99, 4.5]);
    expect(up.financeTxnId).toBe("t1");
    expect(up.createdAt).toBe(listRead.createdAt);
  });

  it("don't upgrade when the re-read is no better, was corrected by hand, or isn't a share receipt", () => {
    const priced = receiptFromFinanceInbox(inbox([{ name: "Towels", price: 24.99 }]), createId);
    expect(shareReceiptUpgrade(priced, priced)).toBe(null);
    const unpriced = receiptFromFinanceInbox(inbox([{ name: "Towels", price: 0 }]), createId);
    const corrected = { ...unpriced, lineItems: unpriced.lineItems.map((l) => ({ ...l, userCorrected: true })) };
    expect(shareReceiptUpgrade(corrected, priced)).toBe(null);
    expect(shareReceiptUpgrade({ ...unpriced, source: "email" }, priced)).toBe(null);
  });
});
