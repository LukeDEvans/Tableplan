// The word processor's pure parts: the stored form, merge-then-save, version slots,
// comment threads and suggesting mode (WORD_PROCESSOR_DESIGN.md §3, §6–§8).

import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { baseExtensions, safeColor, changeCase } from "../documents/editor/extensions.js";
import {
  encodeContent, decodeContent, docToContent, docFromContent, mergeAndSave, slotsFor, liveVersions, weekSlot,
  addThread, replyTo, editReply, deleteReply, setResolved, listThreads, mentionsIn, countWords, readSettings, writeSettings, nodeText,
} from "../documents/editor/doc-model.js";
import { suggestTransaction, listSuggestions, resolveSuggestion } from "../documents/editor/suggest.js";

const schema = getSchema(baseExtensions({ collaboration: true }));
const para = (text, marks) => ({ type: "paragraph", content: text ? [{ type: "text", text, ...(marks ? { marks } : {}) }] : [] });
const docJson = (...ps) => ({ type: "doc", content: ps });
const ydocOf = (json) => prosemirrorJSONToYDoc(schema, json, "default");
const textOf = (ydoc) => nodeText(yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment("default"), schema));

function memStore() {
  let bytes = null;
  let writes = 0;
  return { loadContent: async () => bytes, saveContent: async (b) => { bytes = b; writes++; }, get writes() { return writes; }, peek: () => bytes };
}

describe("stored form", () => {
  it("round-trips and rejects anything else", () => {
    const d = ydocOf(docJson(para("Hello")));
    const bytes = docToContent(d);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("LDOC");
    expect(textOf(docFromContent(bytes))).toBe("Hello");
    expect(() => decodeContent(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(/not a Live document/);
    const newer = encodeContent(new Uint8Array([0]));
    newer[4] = 9;
    expect(() => decodeContent(newer)).toThrow(/newer/);
  });
});

describe("merge then save", () => {
  it("two devices editing offline both keep their edits", async () => {
    const store = memStore();
    const a = ydocOf(docJson(para("Shared")));
    await mergeAndSave(a, store);
    const b = docFromContent(store.peek());
    // offline: each edits
    a.getXmlFragment("default").insert(1, [new Y.XmlElement("paragraph")]);
    a.getXmlFragment("default").get(1).insert(0, [new Y.XmlText("From A")]);
    b.getXmlFragment("default").insert(1, [new Y.XmlElement("paragraph")]);
    b.getXmlFragment("default").get(1).insert(0, [new Y.XmlText("From B")]);
    await mergeAndSave(a, store);
    const r = await mergeAndSave(b, store);
    expect(r.merged).toBe(true);
    const final = docFromContent(store.peek());
    const t = textOf(final);
    expect(t).toContain("From A");
    expect(t).toContain("From B");
  });

  it("doesn't write when storage already has everything, and repairs a lost write", async () => {
    const store = memStore();
    const a = ydocOf(docJson(para("One")));
    await mergeAndSave(a, store);
    const n = store.writes;
    expect((await mergeAndSave(a, store)).wrote).toBe(false);
    expect(store.writes).toBe(n);
    // Someone else's write replaced ours with an older state (a race): ours has more.
    const stale = docFromContent(store.peek());
    a.getXmlFragment("default").get(0).get(0).insert(3, " two");
    await mergeAndSave(a, store);
    await store.saveContent(docToContent(stale)); // the other device's stale write lands after
    expect(textOf(docFromContent(store.peek()))).toBe("One");
    expect((await mergeAndSave(a, store)).wrote).toBe(true); // next save puts it back
    expect(textOf(docFromContent(store.peek()))).toBe("One two");
  });

  it("a delete-only change is noticed", async () => {
    const store = memStore();
    const a = ydocOf(docJson(para("Keep this")));
    await mergeAndSave(a, store);
    a.getXmlFragment("default").get(0).get(0).delete(4, 5);
    expect((await mergeAndSave(a, store)).wrote).toBe(true);
    expect(textOf(docFromContent(store.peek()))).toBe("Keep");
  });
});

describe("settings", () => {
  it("defaults, and stored junk is clamped", () => {
    const d = new Y.Doc();
    expect(readSettings(d)).toMatchObject({ pageless: false, pageSize: "letter", marginTop: 1 });
    writeSettings(d, { marginTop: 99, pageSize: "nope", pageColor: "red;}", junk: 1 });
    const s = readSettings(d);
    expect(s.marginTop).toBe(4);
    expect(s.pageSize).toBe("letter");
    expect(s.pageColor).toBe("#ffffff");
    expect(d.getMap("settings").has("junk")).toBe(false);
  });
});

describe("version slots", () => {
  const t0 = Date.UTC(2026, 10, 9, 13, 5);
  it("hour always; day and week at most once an hour", () => {
    expect(slotsFor(t0, [])).toEqual(["h13", "d09", weekSlot(t0)]);
    const rows = [{ slot: "d09", savedAt: new Date(t0 - 10 * 60e3).toISOString() }, { slot: weekSlot(t0), savedAt: new Date(t0 - 10 * 60e3).toISOString() }];
    expect(slotsFor(t0, rows)).toEqual(["h13"]);
    expect(slotsFor(t0 + 2 * 3600e3, rows)).toEqual(["h15", "d09", weekSlot(t0)]);
  });
  it("lists slots inside their window, one entry per snapshot, named kept", () => {
    const at = (ms) => new Date(ms).toISOString();
    const rows = [
      { slot: "h13", savedAt: at(t0) }, { slot: "d09", savedAt: at(t0) }, { slot: weekSlot(t0), savedAt: at(t0) },
      { slot: "h12", savedAt: at(t0 - 25 * 3600e3) }, // yesterday's hour slot: stale
      { slot: "d01", savedAt: at(t0 - 40 * 24 * 3600e3) }, // older than a month: stale
      { slot: `n${"a".repeat(32)}`, savedAt: at(t0 - 400 * 24 * 3600e3), name: "Signed" },
      { slot: "d08", savedAt: at(t0 - 24 * 3600e3) },
    ];
    const live = liveVersions(rows, t0 + 1000);
    expect(live.map((r) => r.slot)).toEqual(["h13", "d08", `n${"a".repeat(32)}`]);
  });
});

describe("comments", () => {
  const luke = { id: "u1", name: "Luke" };
  const wife = { id: "u2", name: "Marijane" };
  it("threads, replies, edits by the author only, resolve, delete", () => {
    const d = new Y.Doc();
    addThread(d, { id: "t1", quote: "the lease", text: "Check this @Marijane", user: luke });
    replyTo(d, "t1", { text: "Done", user: wife });
    let [t] = listThreads(d);
    expect(t.replies.map((r) => r.text)).toEqual(["Check this @Marijane", "Done"]);
    expect(editReply(d, "t1", t.replies[1].id, "Hack", "u1")).toBe(false);
    expect(editReply(d, "t1", t.replies[1].id, "Done!", "u2")).toBe(true);
    setResolved(d, "t1", true);
    [t] = listThreads(d);
    expect(t.resolved).toBe(true);
    expect(t.replies[1].text).toBe("Done!");
    replyTo(d, "t1", { text: "Reopen", user: luke });
    expect(listThreads(d)[0].resolved).toBe(false);
    expect(deleteReply(d, "t1", t.replies[0].id, "u2")).toBe(false);
    expect(deleteReply(d, "t1", t.replies[0].id, "u1")).toBe("thread");
    expect(listThreads(d)).toEqual([]);
    expect(mentionsIn("Check this @Marijane please", [luke, wife])).toEqual(["u2"]);
  });
});

describe("formatting helpers", () => {
  it("colours are checked", () => {
    expect(safeColor("#ABC")).toBe("#abc");
    expect(safeColor("rgb(255, 0, 10)")).toBe("#ff000a");
    expect(safeColor("red; background:url(x)")).toBe(null);
    expect(safeColor("expression(alert(1))")).toBe(null);
  });
  it("change case and word count", () => {
    expect(changeCase("hello wide world", "title")).toBe("Hello Wide World");
    expect(changeCase("Hello", "upper")).toBe("HELLO");
    expect(countWords("One two — three, 4")).toMatchObject({ words: 4 });
  });
});

describe("suggesting mode", () => {
  const luke = { id: "u1", name: "Luke" };
  const wife = { id: "u2", name: "Marijane" };
  const stateOf = (json, pos) => {
    const s = EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
    return pos == null ? s : s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
  };
  const run = (state, makeTr, user = luke) => {
    const tr = makeTr(state);
    const swapped = suggestTransaction(state, tr, user, 1000);
    return state.apply(swapped || tr);
  };
  const html = (state) => {
    const out = [];
    state.doc.descendants((n) => {
      if (!n.isText) return true;
      const ins = n.marks.find((m) => m.type.name === "insertion");
      const del = n.marks.find((m) => m.type.name === "deletion");
      out.push(ins ? `[+${n.text}]` : del ? `[-${n.text}]` : n.text);
      return false;
    });
    return out.join("");
  };

  it("typing becomes an insertion; continuing typing extends it", () => {
    let s = stateOf(docJson(para("Hello world")), 6);
    s = run(s, (st) => st.tr.insertText("big ", 7));
    expect(html(s)).toBe("Hello [+big ]world");
    s = run(s, (st) => st.tr.insertText("!", s.selection.from));
    const sug = listSuggestions(s.doc);
    expect(sug.length).toBe(1);
    expect(sug[0].inserted).toBe("big !");
  });

  it("deleting others' text marks it; deleting your own insertion removes it", () => {
    let s = stateOf(docJson(para("Hello world")), 12);
    s = run(s, (st) => st.tr.delete(7, 12)); // Backspace over "world"
    expect(html(s)).toBe("Hello [-world]");
    expect(s.selection.from).toBe(7); // cursor before the struck text
    s = run(s, (st) => st.tr.insertText("XY", 7));
    expect(html(s)).toBe("Hello [+XY][-world]");
    s = run(s, (st) => st.tr.delete(8, 9)); // remove own "Y"
    expect(html(s)).toBe("Hello [+X][-world]");
  });

  it("replacing a selection: struck text then the new text, one suggestion", () => {
    let s = stateOf(docJson(para("Hello world")));
    s = run(s, (st) => st.tr.replaceWith(1, 6, schema.text("Howdy")));
    expect(html(s)).toBe("[-Hello][+Howdy] world");
    const [sg] = listSuggestions(s.doc);
    expect(sg).toMatchObject({ deleted: "Hello", inserted: "Howdy", author: "u1", name: "Luke" });
  });

  it("another person deleting my suggestion marks it deleted (not removed)", () => {
    let s = stateOf(docJson(para("Hi")), 3);
    s = run(s, (st) => st.tr.insertText(" there", 3));
    s = run(s, (st) => st.tr.delete(3, 9), wife);
    expect(s.doc.textContent).toBe("Hi there");
    expect(listSuggestions(s.doc).length).toBe(2);
  });

  it("accept and reject", () => {
    let s = stateOf(docJson(para("Hello world")));
    s = run(s, (st) => st.tr.replaceWith(1, 6, schema.text("Howdy")));
    const id = listSuggestions(s.doc)[0].id;
    const accepted = s.apply(resolveSuggestion(s, id, true));
    expect(accepted.doc.textContent).toBe("Howdy world");
    expect(listSuggestions(accepted.doc)).toEqual([]);
    const rejected = s.apply(resolveSuggestion(s, id, false));
    expect(rejected.doc.textContent).toBe("Hello world");
    expect(listSuggestions(rejected.doc)).toEqual([]);
  });

  it("structural and formatting changes go through unchanged", () => {
    const s = stateOf(docJson(para("Hello")));
    const tr = s.tr.addMark(1, 3, schema.marks.bold.create());
    expect(suggestTransaction(s, tr, luke)).toBe(null);
    const tr2 = s.tr.insertText("x", 1).setMeta("y-sync$", { isChangeOrigin: true });
    expect(suggestTransaction(s, tr2, luke)).toBe(null); // someone else's edit arriving
  });
});
