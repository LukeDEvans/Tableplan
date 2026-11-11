// Browser side of scripts/qa-slides.mjs: opens a presentation on a stand-in store
// (blobs and version rows on the QA server) with a BroadcastChannel standing in for
// Supabase Realtime, so two pages in one browser can edit together.
import { openSlidesEditor } from "/documents/slides/ui.js";
import * as Y from "yjs";
import { sheetYdoc } from "/documents/sheet/host.js";
import { rangeFromA1 } from "/documents/sheet/rules.js";
import { docToContent } from "/documents/editor/doc-model.js";
import { toB64 } from "/documents/slides/tv-protocol.js";
window.__tvState = () => toB64(Y.encodeStateAsUpdate(window.__S.model.ydoc));

const params = new URLSearchParams(location.search);
const who = params.get("who") || "luke";
const ME = who === "luke" ? { id: "11111111-1111-4111-8111-111111111111", name: "Luke" } : { id: "22222222-2222-4222-8222-222222222222", name: "Marijane" };
const FILE = { id: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: params.get("name") || "QA presentation", scope: "g-qa" };

const blob = async (key, init) => fetch(`/qa-blob/${key}`, init);
let rows = [];
const images = new Map();
const store = {
  kind: "everyday", scope: FILE.scope, fileId: FILE.id, channel: `livedoc:${FILE.scope}:${FILE.id}`, encrypt: null,
  async loadContent() { const r = await blob("content"); return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer()); },
  async saveContent(bytes) { window.__saves = (window.__saves || 0) + 1; await blob("content", { method: "PUT", body: bytes }); },
  async saveRow(r) { window.__row = r; },
  async rename(n) { window.__renamed = n; },
  images: { put: async (id, b) => { await blob(`i${id}`, { method: "PUT", body: b }); }, get: async (id) => { const r = await blob(`i${id}`); if (r.status === 404) throw new Error("missing"); return new Uint8Array(await r.arrayBuffer()); } },
  versions: {
    async list() { rows = await (await fetch("/qa-rows")).json(); return rows; },
    cached: () => rows,
    async put(slot, bytes, { name = null } = {}) {
      await blob(`v${slot}`, { method: "PUT", body: bytes });
      await fetch("/qa-rows", { method: "POST", body: JSON.stringify({ slot, name, savedBy: ME.id, size: bytes.length }) });
      rows = await (await fetch("/qa-rows")).json();
    },
    get: async (slot) => new Uint8Array(await (await blob(`v${slot}`)).arrayBuffer()),
    rename: async () => {},
  },
};

function liveOpen(topic, h) {
  const bc = new BroadcastChannel(`qa-${topic}`);
  const peers = new Map();
  let meta = null;
  const announce = () => h.presence([...(meta ? [meta] : []), ...peers.values()]);
  bc.onmessage = (e) => {
    const m = e.data;
    if (m.kind === "join") { peers.set(m.meta.cid, m.meta); bc.postMessage({ kind: "here", meta }); announce(); }
    else if (m.kind === "here" && m.meta) { peers.set(m.meta.cid, m.meta); announce(); }
    else if (m.kind === "leave") { peers.delete(m.cid); announce(); }
    else if (m.kind === "msg") h.message(m.msg);
  };
  return {
    send: (msg) => { bc.postMessage({ kind: "msg", msg }); },
    track: (m) => { meta = m; bc.postMessage({ kind: "join", meta: m }); announce(); },
    close: () => { if (meta) bc.postMessage({ kind: "leave", cid: meta.cid }); bc.close(); },
  };
}

window.__toasts = [];
window.__shared = [];
window.__sh = await openSlidesEditor({
  store, file: FILE, me: ME, startEditing: params.get("view") !== "1",
  deps: {
    liveOpen, toast: (m) => window.__toasts.push(m),
    share: async (b, name, mime) => { const bytes = new Uint8Array(await b.arrayBuffer()); window.__shared.push({ name, mime, size: bytes.length, head: Array.from(bytes.slice(0, 8)) }); },
    // a spreadsheet to link to (built here; SLIDES_DESIGN.md §6)
    sheets: (() => {
      const { ydoc, model } = sheetYdoc({ tables: [{ name: "Budget", rows: [["Month", "Food", "Gas"], ["Jan", "300", "80"], ["Feb", "320", "85"], ["Mar", "290", "90"]] }] });
      const tab = model.tabIds()[0];
      model.setChart(tab, null, { type: "column", title: "Spending", range: rangeFromA1(model, tab, "A1:C4") });
      window.__sheet = { ydoc, model, tab, content: () => docToContent(ydoc) };
      return { list: async () => [{ id: "sheet1", name: "Budget" }], open: async () => ({ loadContent: async () => docToContent(ydoc) }) };
    })(),
  },
  onClose: () => { window.__closed = true; },
});
window.__S = document.querySelector(".sl-root").__slides;
window.__ready = true;
