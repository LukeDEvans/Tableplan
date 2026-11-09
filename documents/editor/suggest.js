// Suggesting mode (WORD_PROCESSOR_DESIGN.md §8): typing becomes marked insertions,
// deleting marks text as a suggested deletion instead of removing it; others accept or
// reject. Formatting and structural changes (lists, tables) are applied directly, as
// they are when a single edit can't be expressed as a text suggestion.
//
// suggestTransaction(state, tr, user) → the transaction to dispatch instead (or null
// to dispatch tr unchanged). Pure ProseMirror, so it's tested without a browser.
//
// Rules:
//   - one ReplaceStep (typing, paste, Enter, Backspace, Delete, replacing a selection)
//     is turned into a suggestion; anything else goes through as it is;
//   - deleting your own suggested insertion really deletes it (as Docs);
//   - text already suggested for deletion stays so; deleting across paragraphs marks
//     the text and keeps the paragraphs (the join isn't suggested);
//   - a replacement's deletion and insertion share one id, so they're accepted or
//     rejected together; typing on from your own suggestion continues it.

import { Extension } from "@tiptap/core";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { shortId } from "./extensions.js";

export const SKIP_META = "suggest-skip";
export const suggestKey = new PluginKey("liveSuggest");

function markSlice(slice, mark, schema) {
  const del = schema.marks.deletion;
  const mapFrag = (frag) => {
    const out = [];
    frag.forEach((node) => {
      if (node.isText || node.isInline) {
        const marks = mark.addToSet(del ? del.removeFromSet(node.marks) : node.marks);
        out.push(node.mark(marks));
      } else out.push(node.copy(mapFrag(node.content)));
    });
    return Fragment.from(out);
  };
  return new Slice(mapFrag(slice.content), slice.openStart, slice.openEnd);
}

const sameAuthor = (mark, user) => mark && mark.attrs.author === user.id;

export function suggestTransaction(state, tr, user, now = Date.now()) {
  if (!tr.docChanged || tr.getMeta(SKIP_META) || tr.getMeta("y-sync$") || tr.getMeta("addToHistory") === false) return null;
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0];
  if (step.structure) return null;
  const { from, to, slice } = step;
  const schema = state.schema;
  const insMark = schema.marks.insertion;
  const delMark = schema.marks.deletion;
  if (!insMark || !delMark) return null;
  const doc = state.doc;
  const out = state.tr;
  out.setMeta(SKIP_META, true);
  out.setMeta("suggest", true);

  // The suggestion's id: continue an adjacent suggestion of yours, else a new one.
  const $from = doc.resolve(from);
  const prevIns = from > 0 ? insMark.isInSet($from.nodeBefore?.marks || []) : null;
  const prevDel = from > 0 ? delMark.isInSet($from.nodeBefore?.marks || []) : null;
  let attrs = null;
  if (sameAuthor(prevIns, user)) attrs = { ...prevIns.attrs };
  else if (from === to && sameAuthor(prevDel, user)) attrs = { ...prevDel.attrs };
  if (!attrs) attrs = { id: shortId(), author: user.id, name: String(user.name || "").slice(0, 80), at: now };

  // 1. The deleted range: own insertions really go; the rest is marked deleted.
  const ownInserted = [];
  if (to > from) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return true;
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + node.nodeSize);
      if (e <= s) return false;
      if (sameAuthor(insMark.isInSet(node.marks), user)) ownInserted.push([s, e]);
      else if (!delMark.isInSet(node.marks)) out.addMark(s, e, delMark.create(attrs));
      return false;
    });
  }
  // 2. The inserted content goes after the struck text.
  let insertAt = to;
  for (const [s, e] of ownInserted.reverse()) {
    out.delete(out.mapping.map(s), out.mapping.map(e));
  }
  insertAt = out.mapping.map(insertAt, -1);
  let cursor;
  if (slice.size > 0) {
    const marked = markSlice(slice, insMark.create(attrs), schema);
    const before = out.doc.content.size;
    out.replace(insertAt, insertAt, marked);
    cursor = insertAt + (out.doc.content.size - before);
  } else {
    // Backspace (cursor was at the end) leaves the cursor before the struck text;
    // Delete (cursor at the start) after it.
    const sel = state.selection;
    const backspace = sel.empty && sel.from === to;
    cursor = backspace ? out.mapping.map(from, -1) : out.mapping.map(to, 1);
  }
  try {
    out.setSelection(TextSelection.create(out.doc, Math.max(0, Math.min(cursor, out.doc.content.size))));
  } catch { /* the default mapping is fine */ }
  if (tr.storedMarks) out.setStoredMarks(tr.storedMarks);
  out.scrollIntoView();
  return out;
}

// ---- reading and resolving suggestions -------------------------------------------------------

// [{ id, author, name, at, inserted, deleted, from, to }] in document order.
export function listSuggestions(doc) {
  const byId = new Map();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if (m.type.name !== "insertion" && m.type.name !== "deletion") continue;
      const id = m.attrs.id || "?";
      let s = byId.get(id);
      if (!s) { s = { id, author: m.attrs.author, name: m.attrs.name, at: m.attrs.at, inserted: "", deleted: "", from: pos, to: pos + node.nodeSize }; byId.set(id, s); }
      const text = node.isText ? node.text : node.type.name === "smartChip" ? node.attrs.label : "▫";
      if (m.type.name === "insertion") s.inserted += text; else s.deleted += text;
      s.from = Math.min(s.from, pos);
      s.to = Math.max(s.to, pos + node.nodeSize);
    }
    return false;
  });
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

function rangesOf(doc, id) {
  const ranges = [];
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if ((m.type.name === "insertion" || m.type.name === "deletion") && (id === null || m.attrs.id === id)) {
        const last = ranges[ranges.length - 1];
        if (last && last.type === m.type.name && last.to === pos && last.id === m.attrs.id) last.to = pos + node.nodeSize;
        else ranges.push({ type: m.type.name, id: m.attrs.id, from: pos, to: pos + node.nodeSize, mark: m });
      }
    }
    return false;
  });
  return ranges;
}

// accept: insertions stay (mark removed), deletions go. reject: the opposite.
// id null = all suggestions.
export function resolveSuggestion(state, id, accept) {
  const tr = state.tr;
  tr.setMeta(SKIP_META, true);
  const ranges = rangesOf(state.doc, id).sort((a, b) => b.from - a.from);
  if (!ranges.length) return null;
  for (const r of ranges) {
    const keep = (r.type === "insertion") === accept;
    if (keep) tr.removeMark(r.from, r.to, r.mark.type);
    else tr.delete(r.from, r.to);
  }
  return tr;
}

// ---- the extension -----------------------------------------------------------------------------

// editor.storage.suggesting = { enabled, user: { id, name } }
export const Suggesting = Extension.create({
  name: "suggesting",
  addStorage: () => ({ enabled: false, user: { id: "me", name: "" } }),
  dispatchTransaction({ transaction, next }) {
    const st = this.editor?.storage?.suggesting;
    if (st?.enabled) {
      const swapped = suggestTransaction(this.editor.state, transaction, st.user);
      if (swapped) return next(swapped);
    }
    return next(transaction);
  },
  addCommands() {
    return {
      acceptSuggestion: (id) => ({ state, dispatch }) => { const tr = resolveSuggestion(state, id, true); if (tr && dispatch) dispatch(tr); return Boolean(tr); },
      rejectSuggestion: (id) => ({ state, dispatch }) => { const tr = resolveSuggestion(state, id, false); if (tr && dispatch) dispatch(tr); return Boolean(tr); },
      acceptAllSuggestions: () => ({ state, dispatch }) => { const tr = resolveSuggestion(state, null, true); if (tr && dispatch) dispatch(tr); return Boolean(tr); },
      rejectAllSuggestions: () => ({ state, dispatch }) => { const tr = resolveSuggestion(state, null, false); if (tr && dispatch) dispatch(tr); return Boolean(tr); },
    };
  },
  addProseMirrorPlugins() {
    // Viewing mode: no edits at all except from others (remote) and resolving.
    return [new Plugin({ key: suggestKey })];
  },
});
