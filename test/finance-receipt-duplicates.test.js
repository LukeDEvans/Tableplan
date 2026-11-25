// Possible duplicate receipts (Luke, 2026-11-22): the same purchase saved twice is
// found, never merged on its own, and Merge / Keep both do what they say.
import { describe, it, expect } from "vitest";
import { sameReceipt, findDuplicate, duplicateMap, mergeKeeper, mergeReceipts, keepBoth, mergedReceiptFileActions } from "../receipt-duplicates.js";
import { normalizeReceipt, receiptForFinance } from "../receipt-domain.js";

let n = 0;
const createId = (p) => `${p}-${++n}`;
const rc = (id, extra = {}) => normalizeReceipt({ id, storeName: "Target", purchaseDate: "2026-11-20", total: 21.5, createdAt: "2026-11-20T18:00:00Z", ...extra }, createId);
const line = (id, name, price, extra = {}) => ({ id, rawText: name, normalizedName: name, totalPrice: price, quantity: 1, ...extra });

describe("finding the same purchase", () => {
  it("same store, total and nearby date", () => {
    expect(sameReceipt(rc("a"), rc("b", { storeName: "TARGET T-1234", purchaseDate: "2026-11-22" }))).toBe("match");
    expect(sameReceipt(rc("a"), rc("b", { purchaseDate: "2026-11-23" }))).toBe(""); // 3 days apart
    expect(sameReceipt(rc("a"), rc("b", { total: 21.6 }))).toBe("");
    expect(sameReceipt(rc("a"), rc("b", { storeName: "Costco" }))).toBe("");
    expect(sameReceipt(rc("a", { storeName: "Lunds Market" }), rc("b", { storeName: "Whole Foods Market" }))).toBe(""); // only a shared generic word
    expect(sameReceipt(rc("a", { storeName: "Costco Wholesale" }), rc("b", { storeName: "COSTCO WHSE #1023" }))).toBe("match");
    expect(sameReceipt(rc("a", { storeName: "Amazon.com" }), rc("b", { storeName: "Amazon" }))).toBe("match");
    expect(sameReceipt(rc("a"), rc("a"))).toBe("");
  });
  it("same order number, whatever the amounts (a confirmation and a shipped email)", () => {
    expect(sameReceipt(rc("a", { orderNumber: "#902-1133" }), rc("b", { orderNumber: "9021133", total: 9, storeName: "Target.com" }))).toBe("order");
    expect(sameReceipt(rc("a", { orderNumber: "12" }), rc("b", { orderNumber: "12", total: 9 }))).toBe(""); // too short
  });
  it("never after Keep both, nor when each is linked to a different charge", () => {
    const [a, b] = keepBoth(rc("a"), rc("b"));
    expect(sameReceipt(a, b)).toBe("");
    expect(sameReceipt(normalizeReceipt(a, createId), normalizeReceipt(b, createId))).toBe(""); // survives normalizing
    expect(sameReceipt(rc("a", { financeTxnId: "t1" }), rc("b", { financeTxnId: "t2" }))).toBe("");
    expect(sameReceipt(rc("a", { financeTxnId: "t1" }), rc("b"))).toBe("match");
  });
  it("works on Finance's view of receipts too", () => {
    expect(sameReceipt(receiptForFinance(rc("a")), receiptForFinance(rc("b")))).toBe("match");
  });
  it("finds the order match first, else the one saved first; maps both sides", () => {
    const list = [rc("old", { createdAt: "2026-11-01T00:00:00Z" }), rc("new", { createdAt: "2026-11-21T00:00:00Z" }), rc("ord", { orderNumber: "5551234", total: 3 }), rc("other", { storeName: "Aldi" })];
    expect(findDuplicate(list, rc("x"))?.id).toBe("old");
    expect(findDuplicate(list, rc("x", { orderNumber: "555-1234" }))?.id).toBe("ord");
    const map = duplicateMap(list);
    expect(map.get("old")).toBe("new");
    expect(map.get("new")).toBe("old");
    expect(map.has("other")).toBe(false);
  });
});

describe("merging", () => {
  const scan = rc("scan", { source: "scan", createdAt: "2026-11-20T18:00:00Z", imageRefs: [{ hash: "h1" }], tax: 1.5,
    lineItems: [line("s1", "Milk", 4.29), line("s2", "Towels", 15.71)] });
  const email = rc("email", { source: "email", externalId: "m1", createdAt: "2026-11-21T08:00:00Z", financeTxnId: "t9", paymentLast4: "4417", orderNumber: "9021133",
    lineItems: [line("e1", "Order total", 0)] });
  it("keeps the id of the one linked to a charge, else one with a file, else the first saved", () => {
    expect(mergeKeeper(scan, email).id).toBe("email");
    const a = rc("a", { createdAt: "2026-11-01T00:00:00Z" }), b = rc("b", { createdAt: "2026-11-02T00:00:00Z" });
    expect(mergeKeeper(a, b).id).toBe("a");
    expect(mergeKeeper(a, b, (id) => id === "b").id).toBe("b");
  });
  it("takes the lines of the more detailed read and keeps what either has", () => {
    const m = normalizeReceipt(mergeReceipts(email, scan), createId);
    expect(m.id).toBe("email");
    expect(m.lineItems.map((l) => l.normalizedName)).toEqual(["Milk", "Towels"]);
    expect(m.lineItems.every((l) => l.receiptId === "email")).toBe(true);
    expect(m).toMatchObject({ financeTxnId: "t9", paymentLast4: "4417", orderNumber: "9021133", tax: 1.5, createdAt: "2026-11-20T18:00:00Z" });
    expect(m.imageRefs).toEqual([]); // the scan's old-style photos are keyed by its own id; its Document file is relinked instead
  });
  it("Personal wins; Keep-both memories carry over", () => {
    const m = mergeReceipts(rc("a", { notDuplicateOf: ["z"] }), rc("b", { view: "personal", notDuplicateOf: ["a", "y"] }));
    expect(m.view).toBe("personal");
    expect(m.notDuplicateOf.sort()).toEqual(["y", "z"]);
  });
  it("a hand-corrected read wins a tie", () => {
    const a = rc("a", { lineItems: [line("a1", "Thing", 5)] });
    const b = rc("b", { lineItems: [line("b1", "Better name", 5, { userCorrected: true })] });
    expect(mergeReceipts(a, b).lineItems[0].normalizedName).toBe("Better name");
  });
});

describe("Document after a merge", () => {
  it("points the dropped receipt's file at the kept one, or trashes it when the kept one has a file", () => {
    const files = [{ id: "f1", source: { receiptId: "drop" } }, { id: "f2", source: null }];
    expect(mergedReceiptFileActions(files, "keep", "drop")).toEqual([{ id: "f1", action: "relink" }]);
    expect(mergedReceiptFileActions([...files, { id: "f3", source: { receiptId: "keep" } }], "keep", "drop")).toEqual([{ id: "f1", action: "trash" }]);
  });
});
