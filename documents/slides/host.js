// What the Document page needs from slides (SLIDES_DESIGN.md §11): make a new
// presentation (blank or from a template) and open one. Loaded lazily by
// documents/page.js, so the slides code is fetched only when a presentation is made
// or opened.

import * as Y from "yjs";
import { createSlidesModel, SLIDES_MIME } from "./model.js";
import { docToContent } from "../editor/doc-model.js";
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

export async function pickTemplate(root) {
  const { templatePicker } = await import("./templates.js");
  return templatePicker(root);
}
