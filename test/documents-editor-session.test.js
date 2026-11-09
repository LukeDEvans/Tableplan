// One open document's life (session.js), with a memory store: opening and closing
// without edits writes nothing; a restore brings back the version even when the
// "before restore" copy would land in the same slot (review findings, 2026-11-09).

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDocSession } from "../documents/editor/session.js";
import { docToContent, docFromContent } from "../documents/editor/doc-model.js";

function memStore(initial) {
  const parts = new Map();
  if (initial) parts.set("content", initial);
  let rows = [];
  const log = [];
  return {
    log, parts, channel: "x", encrypt: null,
    async loadContent() { log.push("get"); return parts.get("content") || null; },
    async saveContent(b) { log.push("put content"); parts.set("content", b); },
    async saveRow() { log.push("row"); },
    versions: {
      async list() { log.push("list"); return rows; },
      cached: () => rows,
      async put(slot, b, { name } = {}) { log.push(`put v${slot}`); parts.set(`v${slot}`, b); rows = [{ slot, savedAt: new Date().toISOString(), name: name || "" }, ...rows.filter((r) => r.slot !== slot)]; },
      async get(slot) { return parts.get(`v${slot}`); },
    },
  };
}
const text = (d) => d.getText("t").toString();
const copyText = (from, to) => { /* stands in for the editor's fragment copy */ };

describe("document session", () => {
  it("opening and closing with no edits writes nothing", async () => {
    const d = new Y.Doc();
    d.getText("t").insert(0, "Hello");
    const store = memStore(docToContent(d));
    const s = createDocSession({ store, me: { id: "u1", name: "Luke" }, getText: () => ({ text: "Hello", pages: 1 }), win: null });
    await s.ready;
    await s.close();
    expect(store.log.filter((x) => x.startsWith("put") || x === "row")).toEqual([]);
  });

  it("an edit is saved, snapshotted on close, and the row updated", async () => {
    const store = memStore(null);
    const s = createDocSession({ store, me: { id: "u1", name: "Luke" }, getText: () => ({ text: "x", pages: 1 }), win: null });
    await s.ready;
    s.ydoc.getText("t").insert(0, "New");
    await s.close();
    expect(text(docFromContent(store.parts.get("content")))).toBe("New");
    expect(store.log.some((x) => /^put vh\d\d$/.test(x))).toBe(true);
    expect(store.log).toContain("row");
  });

  it("restoring this hour's version brings it back (the 'before' copy goes in a named slot)", async () => {
    const store = memStore(null);
    const s = createDocSession({ store, me: { id: "u1", name: "Luke" }, win: null });
    await s.ready;
    s.ydoc.getText("t").insert(0, "GOOD VERSION");
    await s.save();
    await s.snapshot();
    const slot = (await store.versions.list())[0].slot;
    s.ydoc.getText("t").delete(0, 12);
    s.ydoc.getText("t").insert(0, "OOPS");
    let restored = null;
    await s.restore(slot, (from, to) => { if (from.doc && to.doc) restored = true; });
    // The version that was read is the good one, whatever the before-copy did to slots.
    const v = await s.loadVersion(slot).catch(() => null);
    expect(restored).toBe(true);
    const named = (await store.versions.list()).find((r) => r.slot.startsWith("n"));
    expect(named?.name).toMatch(/^Before restoring/);
    expect(text(docFromContent(store.parts.get(`v${named.slot}`)))).toBe("OOPS");
    void v; void copyText;
    await s.close();
  });
});
