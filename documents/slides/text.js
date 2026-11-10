// Text in slides (SLIDES_DESIGN.md §3): every text box, shape's text and speaker note is
// a Y.XmlFragment edited with the word processor's own extensions, so fonts, lists,
// links and colours behave as they do in documents, and text pastes between the two.

import { getSchema, getHTMLFromFragment } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { baseExtensions } from "../editor/extensions.js";

let schema = null;
export const textSchema = () => (schema ||= getSchema(baseExtensions({ collaboration: true })));

// Stored text → HTML (checked: every attribute goes through the schema's renderers).
export function fragmentHtml(fr) {
  try {
    const json = yXmlFragmentToProsemirrorJSON(fr);
    if (!json?.content?.length) return "";
    const node = PMNode.fromJSON(textSchema(), json);
    return getHTMLFromFragment(node.content, textSchema());
  } catch { return ""; }
}

// ProseMirror JSON → into a fragment (templates, imports).
export function writeJson(fr, json) {
  const s = textSchema();
  s.nodeFromJSON(json).check();
  prosemirrorJSONToYXmlFragment(s, json, fr);
}

// Simple content: lines of text, optionally bulleted; a line may be { text, bold, size, color }.
export function linesJson(lines, { bullets = false, align = null } = {}) {
  const para = (l) => {
    const o = typeof l === "string" ? { text: l } : l;
    const marks = [];
    if (o.bold) marks.push({ type: "bold" });
    if (o.italic) marks.push({ type: "italic" });
    if (o.size || o.color || o.font) marks.push({ type: "textStyle", attrs: { fontSize: o.size || null, color: o.color || null, fontFamily: o.font || null } });
    return { type: "paragraph", ...(align || o.align ? { attrs: { textAlign: o.align || align } } : {}), content: o.text ? [{ type: "text", text: o.text, ...(marks.length ? { marks } : {}) }] : [] };
  };
  if (bullets) return { type: "doc", content: [{ type: "bulletList", content: lines.map((l) => ({ type: "listItem", content: [para(l)] })) }] };
  return { type: "doc", content: (lines.length ? lines : [""]).map(para) };
}
