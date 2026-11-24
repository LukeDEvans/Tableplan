// Send to Finance (Luke, 2026-11-22): an email picked in Mail becomes a receipt
// in the one receipts list, with its text filed in Document › Receipts as a PDF.
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { emailReceiptPdf, wrapLines, toWinAnsiBytes, LINE_CHARS } from "../email-receipt-pdf.js";
import { receiptFromFinanceInbox, normalizeReceipt, receiptForFinance } from "../receipt-domain.js";
import { scoreReceiptTxn } from "../receipt-matcher.js";

const require = createRequire(import.meta.url);
const { parseReceiptReply } = require("../netlify/functions/_gmail-shared.js");

let n = 0;
const createId = (p) => `${p}-${++n}`;

describe("the reader's reply", () => {
  const cats = [{ key: "cat:g:food", name: "Needs · Groceries" }];
  it("keeps the new fields and checks them", () => {
    const r = parseReceiptReply(JSON.stringify({ receipt: {
      merchant: "Target", date: "2026-11-20", subtotal: 20, tax: 1.5, total: 21.5, cardLast4: "**** 4417", orderNumber: " #902-1133 ",
      items: [{ name: "Milk", price: 4.29, category: "cat:g:food" }, { name: "Toy", price: 15.71, category: "cat:made:up" }],
    } }), cats);
    expect(r).toMatchObject({ merchant: "Target", date: "2026-11-20", subtotal: 20, tax: 1.5, total: 21.5, cardLast4: "4417", orderNumber: "#902-1133" });
    expect(r.items[1].category).toBe(""); // not one of the household's categories
    expect(r.portions).toEqual([{ label: "cat:g:food", amount: 4.29 }, { label: "", amount: 17.21 }]);
  });
  it("drops card digits that aren't four; null only without a total", () => {
    expect(parseReceiptReply('{"receipt":{"merchant":"A","total":5,"cardLast4":"12"}}').cardLast4).toBe("");
    expect(parseReceiptReply('{"receipt":{"merchant":"A"}}')).toBeNull();
    expect(parseReceiptReply('{"receipt":{"merchant":"A","total":-5}}')).toBeNull();
    // A free membership is still a receipt (Target Circle 360, 2026-11-24).
    expect(parseReceiptReply('{"receipt":{"merchant":"Target","total":0,"items":[{"name":"Target Circle 360","price":99}]}}')).toMatchObject({ merchant: "Target", total: 0 });
    expect(parseReceiptReply('{"receipt":null}')).toBeNull();
    expect(parseReceiptReply("not json")).toBeNull();
  });
});

describe("into the receipts list", () => {
  it("carries card, order number, tax and view; the id is the Gmail message id", () => {
    const r = receiptFromFinanceInbox({ id: "18c0ffee12", merchant: "Costco", date: "2026-11-19", total: 84.1, subtotal: 80, tax: 4.1, cardLast4: "4417", orderNumber: "1185520", view: "personal", items: [] }, createId);
    expect(r).toMatchObject({ id: "receipt-email-18c0ffee12", source: "email", externalId: "18c0ffee12", paymentLast4: "4417", orderNumber: "1185520", tax: 4.1, subtotal: 80, view: "personal" });
    expect(receiptForFinance(r).last4).toBe("4417");
  });
  it("an inbox receipt without the new fields is unchanged", () => {
    const r = receiptFromFinanceInbox({ id: "m1", merchant: "Aldi", date: "2026-11-01", total: 30, items: [] }, createId);
    expect(r).toMatchObject({ paymentLast4: "", orderNumber: "", view: "", tax: 0 });
  });
});

describe("matching an online order", () => {
  const txn = (posted, amount = -21.5) => ({ id: "t", amount, posted: `${posted}T15:00:00Z`, description: "TARGET.COM" });
  it("an emailed order may be charged up to 14 days later, but past 5 days only as likely", () => {
    const email = { id: "r", merchant: "Target", date: "2026-11-01", total: 21.5, source: "email" };
    expect(scoreReceiptTxn(email, txn("2026-11-04")).confidence).toBe("sure");
    expect(scoreReceiptTxn(email, txn("2026-11-10")).confidence).toBe("likely");
    expect(scoreReceiptTxn(email, txn("2026-11-15"))).not.toBeNull();
    expect(scoreReceiptTxn(email, txn("2026-11-16"))).toBeNull();
  });
  it("a scanned receipt keeps the 5-day window", () => {
    expect(scoreReceiptTxn({ id: "r", merchant: "Target", date: "2026-11-01", total: 21.5, source: "scan" }, txn("2026-11-07"))).toBeNull();
  });
});

describe("the PDF", () => {
  it("wraps long lines at words and keeps blank lines single", () => {
    const lines = wrapLines(`${"word ".repeat(40)}\n\n\n\nend`);
    expect(lines.every((l) => l.length <= LINE_CHARS)).toBe(true);
    expect(lines.filter((l) => l === "").length).toBe(1);
    expect(lines[lines.length - 1]).toBe("end");
  });
  it("writes quotes and dashes in WinAnsi and drops emoji", () => {
    expect(toWinAnsiBytes("“Hi” – café 🎉")).toEqual([0x93, 0x48, 0x69, 0x94, 0x20, 0x96, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x20]);
  });
  const sample = () => {
    const text = ["Order #1185520", "Kirkland Paper Towels (12)   $24.99", "Subtotal $80.00", "Tax $4.10", "Total $84.10 (paren) back\\slash", ...Array.from({ length: 120 }, (_, i) => `line ${i}`)].join("\n");
    return emailReceiptPdf({ subject: "Your Costco order", from: "Costco <orders@costco.com>", date: "Thu, 19 Nov 2026", text });
  };
  it("has a correct cross-reference table and three pages", () => {
    const pdf = sample();
    const str = Buffer.from(pdf).toString("latin1");
    expect(str.startsWith("%PDF-1.4\n")).toBe(true);
    expect(str.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(str.match(/startxref\n(\d+)\n%%EOF/)[1]);
    expect(str.slice(startxref, startxref + 4)).toBe("xref");
    const [, count] = str.slice(startxref).match(/^xref\n0 (\d+)\n/);
    const rows = str.slice(startxref).split("\n").slice(3, 2 + Number(count));
    rows.forEach((row, i) => {
      const at = Number(row.slice(0, 10));
      expect(str.slice(at, at + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`);
    });
    expect(str).toContain("/Count 3");
    expect(str).toContain("(Kirkland Paper Towels \\(12\\)   $24.99) Tj");
    expect(str).toContain("back\\\\slash");
  });
  const haveTools = (() => { try { execFileSync("qpdf", ["--version"]); execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.runIf(haveTools)("passes qpdf's check and its text reads back (where qpdf and pdftotext are installed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "erpdf-"));
    const file = join(dir, "r.pdf");
    writeFileSync(file, sample());
    execFileSync("qpdf", ["--check", file]); // throws on a broken file
    const out = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
    expect(out).toContain("Your Costco order");
    expect(out).toContain("Kirkland Paper Towels (12)   $24.99");
    expect(out).toContain("Total $84.10 (paren) back\\slash");
    expect(out).toContain("line 119");
    expect(execFileSync("qpdf", ["--show-npages", file]).toString().trim()).toBe("3");
  });
});
