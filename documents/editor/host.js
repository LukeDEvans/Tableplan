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

// A Word file shown without becoming a file (Mail's attachment viewer): converted on
// the device, opened view only from memory. Nothing is stored, sent or kept on the
// device. onKeep(converted) is the header button (Mail: "Save to Document"); the
// conversion is handed back so the file isn't read twice.
// → { close, warnings }. Throws when the bytes aren't a Word file.
export async function openDocxPreview({ bytes, name, me = { id: "preview", name: "" }, deps = {}, host, onKeep = null, keepLabel = "Save to Document", note = "View only", onClose = null }) {
  const converted = await convertDocx(bytes);
  const { ydoc } = ydocFromConverted(converted, { importedBy: me });
  const { createMemoryDocStore } = await import("./store-memory.js");
  const store = createMemoryDocStore({ content: docToContent(ydoc), images: converted.images || [] });
  const opened = await openEditorFor({
    store, file: { id: "preview", name, scope: "preview" }, me, people: [], host, onClose,
    deps: { toast: deps.toast, isNative: deps.isNative, share: deps.share, nativePdf: deps.nativePdf, startMode: "viewing" },
    preview: { note, keepLabel, onKeep: onKeep ? () => onKeep(converted) : null },
  });
  return { close: () => opened.close(), warnings: [...(converted.warnings || [])] };
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
