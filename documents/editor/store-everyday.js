// Where an everyday document lives (WORD_PROCESSOR_DESIGN.md §3): its Yjs state is
// the file's "content" part in R2 (p/<scope>/<file>/content), images are "i<hex>"
// parts, version snapshots "v<slot>" parts with a row each in doc_pversions, and the
// doc_pfiles row carries the name, the plain text (search) and the size.
//
// The Safe has the same shape (documents/editor/store-safe.js) with every part and
// message encrypted, so the editor never knows which one it has.
//
// Egress: the content is read once on open and before each save (one GET), the
// version rows once when the panel opens, the file row's text at most once every few
// minutes. Nothing polls.

import { SLOT_RE } from "./doc-model.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG_RE = /^[0-9a-f]{32}$/;
const enc = encodeURIComponent;

export function createEverydayDocStore({ storage, transport, scope, fileId }) {
  if (!UUID_RE.test(fileId)) throw new Error("doc store: bad file id");
  const id = fileId.toLowerCase();
  let rows = null;

  async function loadContent() {
    try { return await storage.get(scope, id, "content"); } catch (e) {
      if (e?.code === "MISSING" || e?.status === 404) return null;
      throw e;
    }
  }

  return {
    kind: "everyday",
    scope,
    fileId: id,
    channel: `livedoc:${scope}:${id}`,
    encrypt: null, // everyday documents travel as they are (sign-in + row security)
    loadContent,
    saveContent: (bytes) => storage.putPart(scope, id, "content", bytes),
    async saveRow({ bodyText, size, pages }) {
      const patch = {};
      if (bodyText != null) patch.body_text = String(bodyText).slice(0, 100000);
      if (size != null) patch.size = Math.max(0, Math.round(size));
      if (pages != null) patch.page_count = Math.max(1, Math.min(10000, Math.round(pages)));
      if (Object.keys(patch).length) await transport.update("doc_pfiles", `id=eq.${id}&scope=eq.${enc(scope)}`, patch);
    },
    rename: (name) => transport.update("doc_pfiles", `id=eq.${id}&scope=eq.${enc(scope)}`, { name: String(name).slice(0, 200) }),

    images: {
      async put(imgId, bytes) {
        if (!IMG_RE.test(imgId)) throw new Error("doc store: bad image id");
        await storage.putPart(scope, id, `i${imgId}`, bytes);
      },
      get: (imgId) => {
        if (!IMG_RE.test(imgId)) throw new Error("doc store: bad image id");
        return storage.get(scope, id, `i${imgId}`);
      },
    },

    versions: {
      async list() {
        const r = await transport.select("doc_pversions", `file_id=eq.${id}&scope=eq.${enc(scope)}&select=slot,saved_at,saved_by,name,size&order=saved_at.desc&limit=200`);
        rows = r.map((x) => ({ slot: x.slot, savedAt: x.saved_at, savedBy: x.saved_by, name: x.name || "", size: x.size || 0 }));
        return rows;
      },
      cached: () => rows,
      async put(slot, bytes, { name = null } = {}) {
        if (!SLOT_RE.test(slot)) throw new Error("doc store: bad slot");
        await storage.putPart(scope, id, `v${slot}`, bytes);
        if (!rows) await this.list();
        const row = { file_id: id, scope, slot, name: name ? String(name).slice(0, 120) : null, size: bytes.length };
        if (rows.some((r) => r.slot === slot)) {
          await transport.update("doc_pversions", `file_id=eq.${id}&slot=eq.${slot}`, { name: row.name, size: row.size });
        } else {
          try { await transport.insert("doc_pversions", [row]); } catch (e) {
            if (e?.status !== 409) throw e; // another device made the row first
            await transport.update("doc_pversions", `file_id=eq.${id}&slot=eq.${slot}`, { name: row.name, size: row.size });
          }
        }
        const now = new Date().toISOString();
        rows = [{ slot, savedAt: now, name: row.name || "", size: row.size }, ...rows.filter((r) => r.slot !== slot)];
      },
      get: (slot) => {
        if (!SLOT_RE.test(slot)) throw new Error("doc store: bad slot");
        return storage.get(scope, id, `v${slot}`);
      },
      rename: (slot, name) => transport.update("doc_pversions", `file_id=eq.${id}&slot=eq.${slot}`, { name: name ? String(name).slice(0, 120) : null }),
    },

    // Parts to remove with the file when it's purged (after 30 days in Recently deleted).
    async extraParts(imageIds = []) {
      const r = await transport.select("doc_pversions", `file_id=eq.${id}&select=slot`).catch(() => []);
      return [...r.map((x) => `v${x.slot}`), ...imageIds.filter((x) => IMG_RE.test(x)).map((x) => `i${x}`)];
    },
  };
}
