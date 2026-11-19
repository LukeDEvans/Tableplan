// A spreadsheet in the Safe (SPREADSHEET_DESIGN.md §9): the same encrypted store as Safe
// documents; what's stored is ciphertext and reads back into the same cells.

import { describe, it, expect, beforeAll } from "vitest";
import * as Y from "yjs";
import { loadSodium } from "../documents/crypto/index.js";
import { createSafeDocStore } from "../documents/editor/store-safe.js";
import { mergeAndSave, docFromContent } from "../documents/editor/doc-model.js";
import { createSheetModel } from "../documents/sheet/model.js";
import { MIME_TYPES as SAFE_MIMES } from "../documents/crypto/meta.js";
import { MIME_TYPES as EVERYDAY_MIMES } from "../documents/common.js";

let key;
const FILE = "0f0f0f0f-1111-4222-8333-444455558888";
beforeAll(async () => { key = (await loadSodium()).randombytes_buf(32); });

describe("a Safe spreadsheet", () => {
  it("is stored as ciphertext and opens with its cells and formulas", async () => {
    const blobs = new Map();
    const storage = {
      putPart: async (scope, id, part, bytes) => { blobs.set(`${scope}/${id}/${part}`, bytes.slice()); return bytes.length; },
      get: async (scope, id, part) => { const b = blobs.get(`${scope}/${id}/${part}`); if (!b) throw Object.assign(new Error("missing"), { code: "MISSING" }); return b; },
    };
    const store = createSafeDocStore({ storage, transport: { select: async () => [], insert: async () => {}, update: async () => {} }, library: {}, scope: "g1", fileId: FILE, fileKey: key });
    const ydoc = new Y.Doc();
    const m = createSheetModel(ydoc);
    m.init({ rows: 10, cols: 4 });
    const t = m.tabIds()[0];
    m.setInput(t, 0, 0, "Account 99887766");
    m.setInput(t, 1, 0, "=LEN(A1)");
    await mergeAndSave(ydoc, store);
    const stored = blobs.get(`g1/${FILE}/content`);
    expect(new TextDecoder("latin1").decode(stored)).not.toContain("99887766");
    expect(new TextDecoder("latin1").decode(stored)).not.toContain("LEN");
    const back = createSheetModel(docFromContent(await store.loadContent()));
    const t2 = back.tabIds()[0];
    expect(back.inputText(t2, 0, 0)).toBe("Account 99887766");
    expect(back.inputText(t2, 1, 0)).toBe("=LEN(A1)");
  });
  it("the Live spreadsheet type is allowed in both file lists", () => {
    expect(SAFE_MIMES).toContain("application/vnd.live.sheet");
    expect(EVERYDAY_MIMES).toContain("application/vnd.live.sheet");
  });
});
