// Word files in and out (WORD_PROCESSOR_DESIGN.md §9): a document exported with
// docx-export.js and read back with docx-import.js keeps its formatting, lists,
// tables, footnotes, headers with page numbers, page setup, comments and suggestions;
// and the importer's output is valid for the editor's schema.

import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { baseExtensions } from "../documents/editor/extensions.js";
import { docToDocx } from "../documents/editor/docx-export.js";
import { docxToDoc } from "../documents/editor/docx-import.js";
import { DEFAULT_SETTINGS, addThread } from "../documents/editor/doc-model.js";
import { zipSync, strToU8 } from "fflate";

const schema = getSchema(baseExtensions({ collaboration: true }));
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: "paragraph", content });

const source = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { docStyle: "title" }, content: [t("Lease notes")] },
    { type: "heading", attrs: { level: 2 }, content: [t("Terms")] },
    { type: "paragraph", attrs: { textAlign: "center", lineHeight: 1.5, spaceAfter: 12 }, content: [
      t("Bold", [{ type: "bold" }]), t(" and "), t("red Georgia 14", [{ type: "textStyle", attrs: { color: "#ff0000", fontFamily: "Georgia", fontSize: 14 } }]),
      t(" link", [{ type: "link", attrs: { href: "https://example.com" } }]),
      { type: "footnote", attrs: { id: "fn1", text: "See clause 4." } },
    ] },
    { type: "bulletList", content: [
      { type: "listItem", content: [p(t("One")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("One-a"))] }] }] },
      { type: "listItem", content: [p(t("Two"))] },
    ] },
    { type: "orderedList", attrs: { listStyle: "lower-roman", start: 1 }, content: [{ type: "listItem", content: [p(t("First"))] }] },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableCell", attrs: { background: "#d9ead3" }, content: [p(t("A1"))] }, { type: "tableCell", content: [p(t("B1"))] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [p(t("A2"))] }, { type: "tableCell", content: [p(t("B2"))] }] },
    ] },
    { type: "pageBreak" },
    p(t("Kept "), t("commented", [{ type: "comment", attrs: { id: "th1" } }]), t(" and "), t("added", [{ type: "insertion", attrs: { id: "s1", author: "u1", name: "Luke", at: 1700000000000 } }]), t("gone", [{ type: "deletion", attrs: { id: "s2", author: "u1", name: "Luke", at: 1700000000000 } }])),
  ],
};

async function roundTrip() {
  const ydoc = prosemirrorJSONToYDoc(schema, source, "default");
  prosemirrorJSONToYXmlFragment(schema, { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "right" }, content: [t("Page "), { type: "pageNumber" }] }] }, ydoc.getXmlFragment("footer"));
  addThread(ydoc, { id: "th1", quote: "commented", text: "Is this right?", user: { id: "u2", name: "Marijane" } });
  const settings = { ...DEFAULT_SETTINGS, pageSize: "a4", landscape: true, marginLeft: 0.75, headerFooter: true };
  const blob = await docToDocx({ json: source, settings, ydoc, schema, imageSize: async () => ({ w: 10, h: 10 }) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return docxToDoc(bytes);
}

const flat = (n, out = []) => { if (n.text) out.push(n); for (const c of n.content || []) flat(c, out); return out; };
const find = (n, type, out = []) => { if (n.type === type) out.push(n); for (const c of n.content || []) find(c, type, out); return out; };

describe("docx round trip", () => {
  it("keeps text, styles and formatting", async () => {
    const r = await roundTrip();
    expect(() => schema.nodeFromJSON(r.doc).check()).not.toThrow();
    const texts = flat(r.doc).map((x) => x.text).join("|");
    for (const s of ["Lease notes", "Terms", "Bold", "red Georgia 14", "One", "One-a", "Two", "First", "A1", "B2", "commented", "added", "gone"]) expect(texts).toContain(s);
    expect(r.doc.content[0]).toMatchObject({ type: "paragraph", attrs: { docStyle: "title" } });
    expect(find(r.doc, "heading")[0].attrs.level).toBe(2);
    const red = flat(r.doc).find((x) => x.text === "red Georgia 14");
    expect(red.marks.find((m) => m.type === "textStyle").attrs).toMatchObject({ color: "#ff0000", fontFamily: "Georgia", fontSize: 14 });
    expect(flat(r.doc).find((x) => x.text === "Bold").marks.map((m) => m.type)).toContain("bold");
    const centered = r.doc.content.find((b) => b.attrs?.textAlign === "center");
    expect(centered.attrs).toMatchObject({ lineHeight: 1.5, spaceAfter: 12 });
    expect(flat(r.doc).find((x) => x.text.includes("link")).marks.find((m) => m.type === "link").attrs.href).toBe("https://example.com");
  });

  it("keeps lists (nested), tables, page breaks and footnotes", async () => {
    const r = await roundTrip();
    const bl = find(r.doc, "bulletList");
    expect(bl.length).toBe(2); // outer and nested
    expect(find(r.doc, "orderedList")[0].attrs.listStyle).toBe("lower-roman");
    const tbl = find(r.doc, "table")[0];
    expect(tbl.content.length).toBe(2);
    expect(tbl.content[0].content[0].attrs.background).toBe("#d9ead3");
    expect(find(r.doc, "pageBreak").length).toBe(1);
    expect(find(r.doc, "footnote")[0].attrs.text).toBe("See clause 4.");
  });

  it("keeps page setup, the footer's page number, comments and suggestions", async () => {
    const r = await roundTrip();
    expect(r.settings).toMatchObject({ pageSize: "a4", landscape: true, marginLeft: 0.75, headerFooter: true });
    expect(find(r.footer, "pageNumber").length).toBe(1);
    expect(r.threads.length).toBe(1);
    expect(r.threads[0].replies[0]).toMatchObject({ name: "Marijane", text: "Is this right?" });
    expect(r.threads[0].quote).toBe("commented");
    const added = flat(r.doc).find((x) => x.text === "added");
    expect(added.marks.find((m) => m.type === "insertion").attrs.name).toBe("Luke");
    expect(flat(r.doc).find((x) => x.text === "gone").marks.find((m) => m.type === "deletion")).toBeTruthy();
  });
});

describe("docx import edge cases", () => {
  it("refuses something that isn't a Word file", () => {
    expect(() => docxToDoc(new Uint8Array([1, 2, 3]))).toThrow(/Word/);
    expect(() => docxToDoc(zipSync({ "a.txt": strToU8("x") }))).toThrow(/no document/);
  });

  it("drops script-ish links and keeps unknown content as text", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r"><w:body>
      <w:p><w:hyperlink r:id="rId9"><w:r><w:t>click</w:t></w:r></w:hyperlink><w:customThing><w:r><w:t> kept</w:t></w:r></w:customThing></w:p>
    </w:body></w:document>`;
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId9" Target="javascript:alert(1)" TargetMode="External" Type="hyperlink"/></Relationships>`;
    const r = docxToDoc(zipSync({ "word/document.xml": strToU8(xml), "word/_rels/document.xml.rels": strToU8(rels) }));
    const texts = flat(r.doc);
    expect(texts.map((x) => x.text).join("")).toBe("click kept");
    expect(texts[0].marks).toBeUndefined();
    expect(r.warnings.length).toBe(1);
    expect(() => schema.nodeFromJSON(r.doc).check()).not.toThrow();
  });

  it("keeps text boxes, symbols and paragraphs inside tracked changes (review, 2026-11-09)", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:mc="mc" xmlns:wps="wps"><w:body>
      <w:p><w:r><w:t>Before</w:t></w:r><w:r><mc:AlternateContent><mc:Choice><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>TEXTBOX SECRET</w:t></w:r></w:p><w:p><w:r><w:t>BOX2</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>
      <w:ins w:author="Ann" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>BODYINS</w:t></w:r></w:p></w:ins>
      <w:p><w:r><w:t>A</w:t><w:noBreakHyphen/><w:t>B</w:t><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:p>
    </w:body></w:document>`;
    const r = docxToDoc(zipSync({ "word/document.xml": strToU8(xml) }));
    const all = flat(r.doc).map((x) => x.text).join("|");
    for (const s of ["Before", "TEXTBOX SECRET", "BOX2", "BODYINS", "A", "\u2011", "B"]) expect(all).toContain(s);
    expect(flat(r.doc).find((x) => x.text === "BODYINS").marks.find((m) => m.type === "insertion").attrs.name).toBe("Ann");
    expect(r.warnings.some((w) => /text boxes/.test(w))).toBe(true);
    expect(() => schema.nodeFromJSON(r.doc).check()).not.toThrow();
  });
});
