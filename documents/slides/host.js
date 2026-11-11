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

// A presentation from a PowerPoint file: the file row first (so its store exists), then
// pictures and video into that store, then the content.
export async function createSlidesFromPptx({ library, storeFor, scope, folderId, name, bytes }) {
  const { pptxIntoModel } = await import("./pptx-import.js");
  const { mediaId } = await import("./media.js");
  const id = crypto.randomUUID();
  const empty = new Y.Doc();
  createSlidesModel(empty).init();
  await library.addFile(scope, { id, content: docToContent(empty), text: " ", folderId, kind: "slides", meta: { name, mime: SLIDES_MIME, pages: 1 } });
  const store = storeFor(id);
  const ydoc = new Y.Doc();
  const model = createSlidesModel(ydoc);
  model.init();
  const { notes } = await pptxIntoModel(model, bytes, { putMedia: async (b) => { const mid = await mediaId(store, b); await store.images.put(mid, b); return mid; } });
  await store.saveContent(docToContent(ydoc));
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
