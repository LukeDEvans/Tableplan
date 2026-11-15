import { describe, it, expect } from "vitest";
import { textToPdf, wrapLines } from "../documents/text-pdf.js";

const asText = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("textToPdf (emailed receipts filed in Document)", () => {
  it("makes a well-formed PDF with the title and lines", () => {
    const pdf = asText(textToPdf("Order #123\nTotal: $41.46 (incl. tax)", { title: "Your Uber Eats order" }));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("(Your Uber Eats order) Tj");
    expect(pdf).toContain("(Total: $41.46 \\(incl. tax\\)) Tj");
    // xref offsets point at the objects
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
  it("adds pages for long emails and keeps bytes Latin-1", () => {
    const pdf = asText(textToPdf(Array.from({ length: 130 }, (_, i) => `Line ${i} — “quoted” 🍕`).join("\n")));
    expect(pdf).toMatch(/\/Count 3/);
    expect(pdf).toContain("(Line 0 - \"quoted\" ?) Tj");
  });
  it("wraps long lines and trims runs of blank lines", () => {
    const lines = wrapLines(`${"word ".repeat(40)}\n\n\n\n\nend`, 50);
    expect(lines.every((l) => l.length <= 50)).toBe(true);
    expect(lines[lines.length - 1]).toBe("end");
    expect(lines.filter((l) => l === "").length).toBeLessThanOrEqual(2);
  });
});
