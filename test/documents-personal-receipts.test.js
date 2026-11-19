// Personal receipts folder (documents/outbox.js movePersonalReceiptFiles): a receipt
// marked Personal has its file copied to the owner's Personal › Receipts, then the
// household file removed; a second run copies nothing twice.
import { describe, it, expect } from "vitest";
import { movePersonalReceiptFiles } from "../documents/outbox.js";

function fakeLibrary({ files = {}, refuseDrop = false } = {}) {
  const store = { ...files }; // scope → [file]
  const folders = {};
  let n = 0;
  return {
    store,
    async files(scope) { return (store[scope] || []).map((f) => ({ ...f })); },
    async ensureStartingFolders(scope) { folders[scope] ||= [{ id: `rf-${scope}`, kind: "receipts", name: "Receipts" }]; return folders[scope]; },
    async open(scope, id) { const f = store[scope].find((x) => x.id === id); return { bytes: f.bytes, name: f.name, mime: f.mime }; },
    async thumbnail(scope, id) { return store[scope].find((x) => x.id === id).thumb; },
    async addFile(scope, { content, thumb, folderId, source, meta }) {
      const id = `new-${++n}`;
      (store[scope] ||= []).push({ id, bytes: content, thumb, folderId, source, name: meta.name, mime: meta.mime, pages: meta.pages, documentDate: meta.documentDate, tags: meta.tags, parts: thumb ? ["content", "thumb"] : ["content"] });
      return id;
    },
    async dropMovedReceipt(scope, id) {
      if (refuseDrop) return false;
      store[scope] = store[scope].filter((x) => x.id !== id);
      return true;
    },
  };
}

const hhFile = (id, receiptId, extra = {}) => ({ id, name: `Costco · 2026-11-0${id.slice(-1)}`, mime: "application/pdf", bytes: new Uint8Array([1, 2]), thumb: new Uint8Array([9]), parts: ["content", "thumb"], pages: 1, documentDate: "2026-11-01", tags: ["receipt"], source: { receiptId }, ...extra });

describe("movePersonalReceiptFiles", () => {
  it("moves only the Personal receipts' files into Personal › Receipts", async () => {
    const lib = fakeLibrary({ files: { hh: [hhFile("f1", "r1"), hhFile("f2", "r2"), { ...hhFile("f3", ""), source: null }] } });
    const out = await movePersonalReceiptFiles({ library: lib, from: "hh", to: "u-me", personalIds: ["r1"] });
    expect(out).toEqual({ moved: 1, failed: 0 });
    expect(lib.store.hh.map((f) => f.id)).toEqual(["f2", "f3"]);
    const [copy] = lib.store["u-me"];
    expect(copy).toMatchObject({ folderId: "rf-u-me", name: "Costco · 2026-11-01", source: { receiptId: "r1", movedFrom: "f1" }, tags: ["receipt"] });
    expect(copy.thumb).toEqual(new Uint8Array([9]));
  });

  it("doesn't copy twice when the household file couldn't be removed", async () => {
    const lib = fakeLibrary({ files: { hh: [hhFile("f1", "r1")] }, refuseDrop: true });
    expect(await movePersonalReceiptFiles({ library: lib, from: "hh", to: "u-me", personalIds: ["r1"] })).toEqual({ moved: 0, failed: 1 });
    await movePersonalReceiptFiles({ library: lib, from: "hh", to: "u-me", personalIds: ["r1"] });
    expect(lib.store["u-me"]).toHaveLength(1);
    expect(lib.store.hh).toHaveLength(1); // still there: the database said no
  });

  it("does nothing without Personal receipts or with the same scope", async () => {
    const lib = fakeLibrary({ files: { hh: [hhFile("f1", "r1")] } });
    expect(await movePersonalReceiptFiles({ library: lib, from: "hh", to: "u-me", personalIds: [] })).toEqual({ moved: 0, failed: 0 });
    expect(await movePersonalReceiptFiles({ library: lib, from: "hh", to: "hh", personalIds: ["r1"] })).toEqual({ moved: 0, failed: 0 });
    expect(lib.store.hh).toHaveLength(1);
  });

  it("one failing file doesn't stop the rest", async () => {
    const lib = fakeLibrary({ files: { hh: [hhFile("f1", "r1"), hhFile("f2", "r2")] } });
    const open = lib.open;
    lib.open = async (scope, id) => { if (id === "f1") throw new Error("offline"); return open(scope, id); };
    expect(await movePersonalReceiptFiles({ library: lib, from: "hh", to: "u-me", personalIds: ["r1", "r2"] })).toEqual({ moved: 1, failed: 1 });
    expect(lib.store.hh.map((f) => f.id)).toEqual(["f1"]);
  });
});
