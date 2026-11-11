// What the Document page needs from the word processor (WORD_PROCESSOR_DESIGN.md
// §13): make a new document, make one from a Word file or a Google Doc, and open one.
// Loaded lazily by documents/page.js, so the editor's code is fetched only when a
// document is made or opened.

import "./editor.css";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { baseExtensions } from "./extensions.js";
import { docToContent, writeSettings, addThread, setResolved, DOC_MIME, nodeText } from "./doc-model.js";
import { createEverydayDocStore } from "./store-everyday.js";

let schema = null;
const getDocSchema = () => (schema ||= getSchema(baseExtensions({ collaboration: true })));

export { DOC_MIME };

// A Y.Doc from converted content: { doc, header?, footer?, headerFirst?, footerFirst?,
// settings?, threads? }.
export function ydocFromConverted(conv, { importedBy = { id: "import", name: "" } } = {}) {
  const s = getDocSchema();
  const node = s.nodeFromJSON(conv.doc);
  node.check();
  const ydoc = prosemirrorJSONToYDoc(s, conv.doc, "default");
  for (const k of ["header", "footer", "headerFirst", "footerFirst"]) {
    if (conv[k]) { s.nodeFromJSON(conv[k]).check(); prosemirrorJSONToYXmlFragment(s, conv[k], ydoc.getXmlFragment(k)); }
  }
  if (conv.settings) writeSettings(ydoc, conv.settings);
  for (const t of conv.threads || []) {
    const first = t.replies[0];
    if (!first) continue;
    addThread(ydoc, { id: t.id, quote: t.quote, text: first.text, user: { id: importedBy.id, name: first.name } });
    const thread = ydoc.getMap("comments").get(t.id);
    const replies = thread.get("replies");
    ydoc.transact(() => {
      replies.delete(0, 1);
      replies.push(t.replies.map((r, i) => ({ id: `${t.id}-${i}`, by: `import:${String(r.name).slice(0, 40)}`, name: String(r.name || "Someone").slice(0, 80), text: String(r.text || "").slice(0, 5000), at: r.at || Date.now() })));
    });
    if (t.resolved) setResolved(ydoc, t.id, true);
  }
  return { ydoc, text: nodeText(node) };
}

// Makes the document's file row and content. images: [{ id, bytes }] go in first.
export async function createDocFile({ library, storage, transport, scope, folderId = null, name = "Untitled document", converted = null, me = null }) {
  const id = crypto.randomUUID();
  let ydoc = new Y.Doc();
  let text = "";
  if (converted) ({ ydoc, text } = ydocFromConverted(converted, { importedBy: me || undefined }));
  const content = docToContent(ydoc);
  // Images are parts of the file; the row comes last so a listed document has them all.
  if (converted?.images?.length) {
    for (const img of converted.images) await storage.putPart(scope, id, `i${img.id}`, img.bytes);
  }
  await library.addFile(scope, { id, content, text, folderId, kind: "doc", meta: { name, mime: DOC_MIME, pages: 1 } });
  void transport;
  return id;
}

export function storeFor({ storage, transport, scope, fileId }) {
  return createEverydayDocStore({ storage, transport, scope, fileId });
}

export async function openEditorFor(opts) {
  const { openDocEditor } = await import("./editor.js");
  return openDocEditor(opts);
}

export async function convertDocx(bytes) {
  const { docxToDoc } = await import("./docx-import.js");
  return docxToDoc(bytes);
}

// Google Docs: list / convert through the gdocs Netlify function.
export function googleDocsApi({ fetchImpl = (...a) => fetch(...a), base = "/.netlify/functions", getToken }) {
  async function call(body) {
    const res = await fetchImpl(`${base}/gdocs`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await getToken()}` }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) { const e = new Error("Google Docs isn't connected yet."); e.code = "CONSENT"; throw e; }
    if (!res.ok) throw new Error(data.error || `Google Docs request failed (${res.status})`);
    return data;
  }
  return {
    list: (folderId = null, pageToken = null) => call({ action: "list", folderId, pageToken }),
    // A Google Sheets file as a workbook (sheet/gsheets-import.js) — tab by tab, in blocks of
    // rows, fewer at a time when Google's answer is too large for one reply.
    async sheet(fileId, { onProgress = () => {} } = {}) {
      const { gsheetToWorkbook } = await import("../sheet/gsheets-import.js");
      const { meta, hasComments } = await call({ action: "sheetMeta", fileId });
      const rowsByTab = {};
      const grids = (meta.sheets || []).filter((s) => !s.properties?.sheetType || s.properties.sheetType === "GRID");
      for (const s of grids) {
        const title = s.properties.title;
        const total = Math.min(s.properties.gridProperties?.rowCount || 1000, 200_000);
        const blocks = (rowsByTab[title] = []);
        let start = 0, count = 2000;
        while (start < total) {
          onProgress({ tab: title, row: start, rows: total });
          let r;
          try { r = await call({ action: "sheetRows", fileId, sheet: title, start, count: Math.min(count, total - start) }); }
          catch (e) { if (/too large|413/.test(e.message) && count > 50) { count = Math.floor(count / 2); continue; } throw e; }
          if (!r.data?.rowData?.length) break; // nothing below here
          blocks.push(r.data);
          start += Math.min(count, total - start);
        }
      }
      const wb = gsheetToWorkbook(meta, rowsByTab, { hasComments });
      wb.title = meta.properties?.title || "Untitled spreadsheet";
      return wb;
    },
    async convert(fileId, { prepareImage = async (b) => b } = {}) {
      const { gdocToDoc, attachComments } = await import("./gdocs-import.js");
      const { doc, comments, images } = await call({ action: "get", fileId });
      const imgs = [];
      const ids = {};
      for (const objectId of Object.keys(images || {})) {
        try {
          const r = await call({ action: "image", fileId, objectId });
          const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
          const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
          imgs.push({ id, bytes: await prepareImage(bytes, r.mime) });
          ids[objectId] = id;
        } catch { /* left out; counted as a warning */ }
      }
      const conv = gdocToDoc(doc, { imageFor: (objectId) => ids[objectId] || null });
      conv.threads = attachComments(conv.doc, comments || []);
      conv.images = imgs;
      conv.title = doc.title || "Untitled document";
      return conv;
    },
  };
}
