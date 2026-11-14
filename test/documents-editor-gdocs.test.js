// Google Docs → Live document (WORD_PROCESSOR_DESIGN.md §9), against a response shaped
// like the Docs API's documents.get and Drive's comments.list.

import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { baseExtensions } from "../documents/editor/extensions.js";
import { gdocToDoc, attachComments } from "../documents/editor/gdocs-import.js";

const schema = getSchema(baseExtensions({ collaboration: true }));
const run = (content, textStyle = {}) => ({ textRun: { content, textStyle } });
const para = (elements, paragraphStyle = { namedStyleType: "NORMAL_TEXT" }, bullet) => ({ paragraph: { elements, paragraphStyle, ...(bullet ? { bullet } : {}) } });
const GDOC = {
  title: "Trip plan",
  documentStyle: { pageSize: { width: { magnitude: 595.3, unit: "PT" }, height: { magnitude: 841.9, unit: "PT" } }, marginLeft: { magnitude: 54, unit: "PT" }, defaultFooterId: "kix.f1" },
  lists: {
    "kix.l1": { listProperties: { nestingLevels: [{ glyphSymbol: "●" }, { glyphSymbol: "○" }] } },
    "kix.l2": { listProperties: { nestingLevels: [{ glyphType: "UPPER_ROMAN", startNumber: 3 }] } },
  },
  footnotes: { "kix.fn1": { content: [para([run("Booked in May.\n")])] } },
  inlineObjects: { "kix.img1": { inlineObjectProperties: { embeddedObject: { description: "Map", size: { width: { magnitude: 300, unit: "PT" } }, imageProperties: {} } } } },
  footers: { "kix.f1": { content: [para([run("Page "), { autoText: { type: "PAGE_NUMBER" } }, run("\n")], { namedStyleType: "NORMAL_TEXT", alignment: "END" })] } },
  body: {
    content: [
      { sectionBreak: {} },
      para([run("Trip plan\n")], { namedStyleType: "TITLE" }),
      para([run("Days\n")], { namedStyleType: "HEADING_1" }),
      para([run("Red bold", { bold: true, foregroundColor: { color: { rgbColor: { red: 1 } } } }), run(" Lora 14", { weightedFontFamily: { fontFamily: "Lora" }, fontSize: { magnitude: 14, unit: "PT" } }), run(" site", { link: { url: "https://example.com" }, underline: true }), { footnoteReference: { footnoteId: "kix.fn1" } }, run("\n")], { namedStyleType: "NORMAL_TEXT", alignment: "CENTER", lineSpacing: 150 }),
      para([run("Fly\n")], undefined, { listId: "kix.l1", nestingLevel: 0 }),
      para([run("Early\n")], undefined, { listId: "kix.l1", nestingLevel: 1 }),
      para([run("Drive\n")], undefined, { listId: "kix.l1", nestingLevel: 0 }),
      para([run("Third\n")], undefined, { listId: "kix.l2", nestingLevel: 0 }),
      para([{ inlineObjectElement: { inlineObjectId: "kix.img1" } }, run("\n")]),
      para([run("Before"), { pageBreak: {} }, run("After\n")]),
      { table: { tableRows: [{ tableCells: [{ content: [para([run("Cell\n")])], tableCellStyle: { backgroundColor: { color: { rgbColor: { red: 0.85, green: 0.92, blue: 0.83 } } } } }, { content: [para([run("B\n")])] }] }] } },
      para([run("Ask about the hotel deposit\n")]),
    ],
  },
};

describe("Google Docs import", () => {
  const r = gdocToDoc(GDOC, { imageFor: (id) => (id === "kix.img1" ? "a".repeat(32) : null) });
  const find = (n, type, out = []) => { if (n.type === type) out.push(n); for (const c of n.content || []) find(c, type, out); return out; };
  const texts = (n, out = []) => { if (n.text) out.push(n); for (const c of n.content || []) texts(c, out); return out; };

  it("is valid for the editor's schema", () => {
    expect(() => schema.nodeFromJSON(r.doc).check()).not.toThrow();
    expect(() => schema.nodeFromJSON(r.footer).check()).not.toThrow();
  });
  it("keeps styles, formatting, links and footnotes", () => {
    expect(r.doc.content[0]).toMatchObject({ type: "paragraph", attrs: { docStyle: "title" } });
    expect(find(r.doc, "heading")[0].attrs.level).toBe(1);
    const red = texts(r.doc).find((x) => x.text === "Red bold");
    expect(red.marks).toEqual(expect.arrayContaining([{ type: "bold" }, { type: "textStyle", attrs: { color: "#ff0000" } }]));
    expect(texts(r.doc).find((x) => x.text === " Lora 14").marks[0].attrs).toEqual({ fontFamily: "Lora", fontSize: 14 });
    expect(texts(r.doc).find((x) => x.text === " site").marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
    expect(r.doc.content[2].attrs).toMatchObject({ textAlign: "center", lineHeight: 1.5 });
    expect(find(r.doc, "footnote")[0].attrs.text).toBe("Booked in May.");
  });
  it("keeps lists, images, page breaks, tables and page setup", () => {
    const bl = find(r.doc, "bulletList");
    expect(bl.length).toBe(2);
    expect(bl[1].attrs.bulletStyle).toBe("circle");
    expect(find(r.doc, "orderedList")[0].attrs).toMatchObject({ listStyle: "upper-roman", start: 3 });
    expect(find(r.doc, "image")[0].attrs).toMatchObject({ src: `liveimg:${"a".repeat(32)}`, alt: "Map", width: 400 });
    expect(find(r.doc, "pageBreak").length).toBe(1);
    expect(find(r.doc, "tableCell")[0].attrs.background).toBe("#d9ebd4");
    expect(r.settings).toMatchObject({ pageSize: "a4", landscape: false, marginLeft: 0.75, headerFooter: true });
    expect(find(r.footer, "pageNumber").length).toBe(1);
  });
  it("puts comments back on their quoted text", () => {
    const doc = structuredClone(r.doc);
    const threads = attachComments(doc, [
      { content: "Did we pay?", quotedFileContent: { value: "hotel deposit" }, author: { displayName: "Marijane" }, createdTime: "2026-10-01T10:00:00Z", replies: [{ content: "Yes", author: { displayName: "Luke" }, createdTime: "2026-10-01T11:00:00Z" }] },
      { content: "Gone text", quotedFileContent: { value: "not in the doc" }, author: { displayName: "Luke" } },
    ]);
    expect(threads.length).toBe(2);
    expect(threads[0].replies.map((x) => x.text)).toEqual(["Did we pay?", "Yes"]);
    const marked = texts(doc).find((x) => x.marks?.some((m) => m.type === "comment"));
    expect(marked.text).toBe("hotel deposit");
    expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
  });
});
