// The word processor in the Safe (WORD_PROCESSOR_DESIGN.md §12): every piece of a Safe
// document leaves the device encrypted and bound to its file and place; the editor's
// save/merge and live channel work the same through it.

import { describe, it, expect, beforeAll } from "vitest";
import * as Y from "yjs";
import { loadSodium, decryptBlob } from "../documents/crypto/index.js";
import { sealPart, openPart } from "../documents/crypto/editor-parts.js";
import { createSafeDocStore } from "../documents/editor/store-safe.js";
import { mergeAndSave, docFromContent } from "../documents/editor/doc-model.js";
import { connectLive, memoryBus } from "../documents/editor/live.js";
import { Awareness } from "y-protocols/awareness";

let key, otherKey;
const FILE = "0f0f0f0f-1111-4222-8333-444455556666";
const OTHER = "0f0f0f0f-1111-4222-8333-444455557777";
beforeAll(async () => {
  const s = await loadSodium();
  key = s.randombytes_buf(32);
  otherKey = s.randombytes_buf(32);
});

describe("editor parts", () => {
  it("open only for the same key, file and piece", () => {
    const b = new TextEncoder().encode("snapshot");
    const sealed = sealPart(key, FILE, "vh07", b);
    expect(new TextDecoder().decode(openPart(key, FILE, "vh07", sealed))).toBe("snapshot");
    expect(() => openPart(otherKey, FILE, "vh07", sealed)).toThrow();
    expect(() => openPart(key, OTHER, "vh07", sealed)).toThrow();
    expect(() => openPart(key, FILE, "vh08", sealed)).toThrow(); // a server swapping slots
    expect(() => openPart(key, FILE, "live", sealed)).toThrow();
    const t = sealed.slice(); t[t.length - 1] ^= 1;
    expect(() => openPart(key, FILE, "vh07", t)).toThrow();
    expect(() => sealPart(key, FILE, "../x", b)).toThrow();
  });
});

function fakes() {
  const blobs = new Map();
  const rows = [];
  const storage = {
    putPart: async (scope, id, part, bytes) => { blobs.set(`${scope}/${id}/${part}`, bytes.slice()); return bytes.length; },
    get: async (scope, id, part) => { const b = blobs.get(`${scope}/${id}/${part}`); if (!b) throw Object.assign(new Error("missing"), { code: "MISSING" }); return b; },
  };
  const transport = {
    select: async () => rows.map((r) => ({ slot: r.slot, saved_at: r.saved_at, saved_by: "u1", name: r.name, size: r.size })),
    insert: async (t, rs) => { for (const r of rs) rows.push({ ...r, saved_at: new Date().toISOString() }); },
    update: async (t, q, patch) => { const slot = /slot=eq\.([a-z0-9]+)/.exec(q)[1]; Object.assign(rows.find((r) => r.slot === slot), patch); },
  };
  return { blobs, rows, storage, transport };
}

describe("the Safe document store", () => {
  it("content, text, images, versions and names are ciphertext; they read back on the device", async () => {
    const f = fakes();
    const store = createSafeDocStore({ ...f, library: { rename: async () => {} }, scope: "g1", fileId: FILE, fileKey: key });
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "Passport number and private notes");
    await mergeAndSave(doc, store);
    const content = f.blobs.get(`g1/${FILE}/content`);
    expect(Buffer.from(content).toString("latin1")).not.toContain("Passport");
    expect(decryptBlob(key, FILE, "content", content).subarray(0, 4)).toEqual(new Uint8Array([0x4c, 0x44, 0x4f, 0x43]));
    expect(docFromContent(await store.loadContent()).getText("t").toString()).toContain("Passport");
    await store.saveRow({ bodyText: "Passport number" });
    expect(Buffer.from(f.blobs.get(`g1/${FILE}/text`)).toString("latin1")).not.toContain("Passport");
    const img = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    await store.images.put("a".repeat(32), img);
    expect(await store.images.get("a".repeat(32))).toEqual(img);
    await store.versions.put(`n${"b".repeat(32)}`, new Uint8Array([9, 9]), { name: "Before the trip" });
    expect(f.rows[0].name).not.toContain("trip");
    const list = await store.versions.list();
    expect(list[0].name).toBe("Before the trip");
    expect(await store.versions.get(`n${"b".repeat(32)}`)).toEqual(new Uint8Array([9, 9]));
    // A row moved onto another file's id doesn't open.
    const other = createSafeDocStore({ ...f, library: {}, scope: "g1", fileId: OTHER, fileKey: key });
    f.blobs.set(`g1/${OTHER}/vh01`, f.blobs.get(`g1/${FILE}/vn${"b".repeat(32)}`));
    await expect(other.versions.get("h01")).rejects.toThrow();
  });

  it("live editing between two devices carries only ciphertext", async () => {
    const f = fakes();
    const mk = () => createSafeDocStore({ ...f, library: {}, scope: "g1", fileId: FILE, fileKey: key });
    const bus = memoryBus();
    const sent = [];
    const person = (name) => {
      const ydoc = new Y.Doc();
      const s = mk();
      const live = connectLive({ ydoc, awareness: new Awareness(ydoc), open: (h) => { const c = bus.open(h); return { ...c, send: (m) => { sent.push(m); c.send(m); } }; }, me: { id: name, name, color: "#000" }, encrypt: s.encrypt, decrypt: s.decrypt });
      return { ydoc, live };
    };
    const a = person("a");
    const b = person("b");
    await new Promise((r) => setTimeout(r, 30));
    a.ydoc.getText("t").insert(0, "secret plans");
    await new Promise((r) => setTimeout(r, 400));
    expect(b.ydoc.getText("t").toString()).toBe("secret plans");
    expect(sent.map((m) => atob(m.d || "")).join("")).not.toContain("secret");
    a.live.close(); b.live.close();
  });
});
