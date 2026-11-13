// Where a Safe document lives (WORD_PROCESSOR_DESIGN.md §12): the same shape as an
// everyday document's store (store-everyday.js), with everything encrypted on the
// device under the file's key before it leaves:
//   content   the Safe's own file format (file.js: secretstream, "content" part)
//   text      the search text (meta.js encryptText), so Safe search finds words in it
//   images, version snapshots, live-editing messages, the device copy, version names
//             sealed with crypto/editor-parts.js, each bound to the file and the piece
// Version rows (doc_sversions) carry only the slot, time, size and a sealed name.
//
// createSafeDocStore({ storage, transport, library, scope, fileId, fileKey })
// fileKey comes from library.docKey (vault key → file key on this device only).

import { encryptBlob, decryptBlob, encryptText, toB64, fromB64 } from "../crypto/index.js";
import { sealPart, openPart } from "../crypto/editor-parts.js";
import { SLOT_RE } from "./doc-model.js";

const IMG_RE = /^[0-9a-f]{32}$/;
const enc = encodeURIComponent;
const te = new TextEncoder();
const td = new TextDecoder();

export function createSafeDocStore({ storage, transport, library, scope, fileId, fileKey }) {
  const id = fileId.toLowerCase();
  let rows = null;
  const sealName = (slot, name) => (name ? toB64(sealPart(fileKey, id, `name-${slot}`, te.encode(String(name).slice(0, 120)))) : null);
  const openName = (slot, v) => { if (!v) return ""; try { return td.decode(openPart(fileKey, id, `name-${slot}`, fromB64(v))); } catch { return ""; } };

  return {
    kind: "safe",
    scope,
    fileId: id,
    channel: `livedoc:${scope}:${id}`,
    encrypt: async (bytes) => sealPart(fileKey, id, "live", bytes),
    decrypt: async (bytes) => openPart(fileKey, id, "live", bytes),
    cacheSeal: { seal: async (b) => sealPart(fileKey, id, "cache", b), open: async (b) => openPart(fileKey, id, "cache", b) },
    async loadContent() {
      let blob;
      try { blob = await storage.get(scope, id, "content"); } catch (e) { if (e?.code === "MISSING" || e?.status === 404) return null; throw e; }
      return decryptBlob(fileKey, id, "content", blob);
    },
    saveContent: (bytes) => storage.putPart(scope, id, "content", encryptBlob(fileKey, id, "content", bytes)),
    async saveRow({ bodyText }) {
      if (bodyText == null) return;
      await storage.putPart(scope, id, "text", encryptText(fileKey, id, String(bodyText).slice(0, 100000) || " "));
    },
    rename: (name) => library.rename(scope, id, name),
    images: {
      async put(imgId, bytes) {
        if (!IMG_RE.test(imgId)) throw new Error("doc store: bad image id");
        await storage.putPart(scope, id, `i${imgId}`, sealPart(fileKey, id, `i${imgId}`, bytes));
      },
      async get(imgId) {
        if (!IMG_RE.test(imgId)) throw new Error("doc store: bad image id");
        return openPart(fileKey, id, `i${imgId}`, await storage.get(scope, id, `i${imgId}`));
      },
    },
    versions: {
      async list() {
        const r = await transport.select("doc_sversions", `file_id=eq.${id}&scope=eq.${enc(scope)}&select=slot,saved_at,saved_by,name,size&order=saved_at.desc&limit=200`);
        rows = r.filter((x) => SLOT_RE.test(x.slot)).map((x) => ({ slot: x.slot, savedAt: x.saved_at, savedBy: x.saved_by, name: openName(x.slot, x.name), size: x.size || 0 }));
        return rows;
      },
      cached: () => rows,
      async put(slot, bytes, { name = null } = {}) {
        if (!SLOT_RE.test(slot)) throw new Error("doc store: bad slot");
        const sealed = sealPart(fileKey, id, `v${slot}`, bytes);
        await storage.putPart(scope, id, `v${slot}`, sealed);
        if (!rows) await this.list();
        const row = { file_id: id, scope, slot, name: sealName(slot, name), size: sealed.length };
        if (rows.some((r) => r.slot === slot)) await transport.update("doc_sversions", `file_id=eq.${id}&slot=eq.${slot}`, { name: row.name, size: row.size });
        else {
          try { await transport.insert("doc_sversions", [row]); } catch (e) {
            if (e?.status !== 409) throw e;
            await transport.update("doc_sversions", `file_id=eq.${id}&slot=eq.${slot}`, { name: row.name, size: row.size });
          }
        }
        rows = [{ slot, savedAt: new Date().toISOString(), name: name || "", size: row.size }, ...rows.filter((r) => r.slot !== slot)];
      },
      async get(slot) {
        if (!SLOT_RE.test(slot)) throw new Error("doc store: bad slot");
        return openPart(fileKey, id, `v${slot}`, await storage.get(scope, id, `v${slot}`));
      },
      rename: (slot, name) => transport.update("doc_sversions", `file_id=eq.${id}&slot=eq.${slot}`, { name: sealName(slot, name) }),
    },
  };
}
