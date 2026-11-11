// What the Document page needs from slides (SLIDES_DESIGN.md §11): make a new
// presentation (blank or from a template) and open one. Loaded lazily by
// documents/page.js, so the slides code is fetched only when a presentation is made
// or opened.

import * as Y from "yjs";
import { createSlidesModel, SLIDES_MIME } from "./model.js";
import { docToContent, docFromContent } from "../editor/doc-model.js";
import { createEverydayDocStore } from "../editor/store-everyday.js";

export { SLIDES_MIME };

// A new presentation's Y.Doc: blank (a title slide in the chosen theme), or a template.
export async function slidesYdoc({ template = null, themeId = "plain" } = {}) {
  const ydoc = new Y.Doc();
  const model = createSlidesModel(ydoc);
  if (template && template !== "blank") {
    const { buildTemplate } = await import("./templates.js");
    buildTemplate(model, template);
  } else model.init({ themeId });
  return { ydoc, model };
}

// Makes the file row and content; returns its id.
export async function createSlidesFile({ library, scope, folderId = null, name = "Untitled presentation", template = null, themeId = "plain" }) {
  const id = crypto.randomUUID();
  const { ydoc, model } = await slidesYdoc({ template, themeId });
  await library.addFile(scope, { id, content: docToContent(ydoc), text: model.searchText(100_000) || " ", folderId, kind: "slides", meta: { name, mime: SLIDES_MIME, pages: model.slideIds().length } });
  return id;
}

export function storeFor({ storage, transport, scope, fileId }) {
  return createEverydayDocStore({ storage, transport, scope, fileId });
}

export async function openSlidesFor(opts) {
  const { openSlidesEditor } = await import("./ui.js");
  return openSlidesEditor(opts);
}

export async function pickTemplate(root, opts = {}) {
  const { templatePicker } = await import("./templates.js");
  return templatePicker(root, opts);
}
export async function templateName(id) {
  const { TEMPLATES } = await import("./templates.js");
  return TEMPLATES.find((t) => t.id === id)?.name || "Untitled presentation";
}

// Google Slides through the gdocs Netlify function: list, and fetch one as a PowerPoint
// file (in pieces). Uses the same Google connection as Docs.
export function googleSlidesApi({ fetchImpl = (...a) => fetch(...a), base = "/.netlify/functions", getToken }) {
  async function call(body) {
    const res = await fetchImpl(`${base}/gdocs`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await getToken()}` }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) { const e = new Error("Google isn't connected yet."); e.code = "CONSENT"; throw e; }
    if (!res.ok) throw new Error(data.error || `Google request failed (${res.status})`);
    return data;
  }
  return {
    list: (folderId = null, pageToken = null) => call({ action: "list", kind: "slides", folderId, pageToken }),
    // Drive exports the deck afresh for every piece, so every piece names the whole file's
    // size and hash; pieces from different exports are refused (one retry from the start),
    // and the joined file is checked against the hash.
    async pptx(fileId) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const parts = [];
        let offset = 0, size = -1, hash = null, mixed = false;
        for (let i = 0; i < 10 && offset !== null; i++) {
          const r = await call({ action: "slidesPptx", fileId, offset });
          if (size === -1) { size = r.size; hash = r.hash; } else if (r.size !== size || r.hash !== hash) { mixed = true; break; }
          parts.push(Uint8Array.from(atob(r.data || ""), (c) => c.charCodeAt(0)));
          offset = r.next;
        }
        if (mixed || offset !== null || !(size > 0)) continue;
        const out = new Uint8Array(size);
        let at = 0;
        for (const p of parts) { out.set(p.subarray(0, Math.max(0, size - at)), at); at += p.length; }
        if (at < size) continue;
        if (hash) {
          const h = new Uint8Array(await crypto.subtle.digest("SHA-256", out));
          if (Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("") !== hash) continue;
        }
        return out;
      }
      throw new Error("Google handed the presentation over in pieces that didn't match. Try again, or download it from Google Slides as PowerPoint and open that file here.");
    },
  };
}

// A presentation from a PowerPoint file. The file is read in full first, with pictures and
// video held in memory, so a file that can't be read leaves nothing behind; then the file
// row (with the whole content and its search text), then the pictures into its store.
export async function createSlidesFromPptx({ library, storeFor, scope, folderId, name, bytes }) {
  const { pptxIntoModel } = await import("./pptx-import.js");
  const { mediaId } = await import("./media.js");
  const id = crypto.randomUUID();
  const store = storeFor(id);
  const ydoc = new Y.Doc();
  const model = createSlidesModel(ydoc);
  model.init();
  const held = new Map();
  const { notes } = await pptxIntoModel(model, bytes, { putMedia: async (b) => { const mid = await mediaId(store, b); held.set(mid, b); return mid; } });
  await library.addFile(scope, { id, content: docToContent(ydoc), text: model.searchText(100_000) || " ", folderId, kind: "slides", meta: { name, mime: SLIDES_MIME, pages: model.slideIds().length } });
  let lost = 0;
  for (const [mid, b] of held) { try { await store.images.put(mid, b); } catch { lost++; } }
  if (lost) notes.push?.(`${lost} picture${lost === 1 ? "" : "s"} couldn't be saved.`);
  return { id, notes };
}

// "Start from one of yours": a copy of another presentation (its slides, theme and
// uploaded pictures and video, which are copied part by part; comments aren't).
export async function copySlidesFile({ library, storeFor, scope, folderId, fromId, name }) {
  const src = storeFor(fromId);
  const bytes = await src.loadContent();
  const from = bytes ? docFromContent(bytes) : new Y.Doc();
  const fm = createSlidesModel(from);
  const to = new Y.Doc();
  const tm = createSlidesModel(to);
  tm.transact(() => {
    for (const k of ["format", "size", "w", "h", "theme"]) if (fm.meta.has(k)) tm.meta.set(k, fm.meta.get(k));
    tm.importSlides(fm.exportSlides(fm.slideIds()), 0);
  });
  const id = crypto.randomUUID();
  await library.addFile(scope, { id, content: docToContent(to), text: tm.searchText(100_000) || " ", folderId, kind: "slides", meta: { name, mime: SLIDES_MIME, pages: tm.slideIds().length } });
  const dst = storeFor(id);
  for (const mid of fm.usedMedia()) {
    const info = fm.mediaInfo(mid);
    try { await dst.images.put(mid, await src.images.get(mid)); if (info) tm.addMedia(mid, info); } catch { /* left as a soft box */ }
  }
  if (tm.media.size) await dst.saveContent(docToContent(to));
  return id;
}
